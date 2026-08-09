import { CatalogueCache, type Catalogue } from "./catalogue-cache";
import type { Artifact, ExclusionSummary } from "./recommendations";
import { unstable_cache } from "next/cache";
import { fetchJson, type FetchLike, REFRESH_TIMEOUT_MS } from "./catalogue-request";

const MIN_ARTIFACT_BYTES = 100_000_000;
export { REFRESH_TIMEOUT_MS } from "./catalogue-request";
const HUB_BASE = "https://huggingface.co/api/models";

export type HubFile = { rfilename: string; size?: number };
export type HubModel = {
  id: string;
  sha?: string;
  downloads?: number;
  lastModified?: string;
  gated?: boolean | string;
  tags?: string[];
  pipeline_tag?: string;
  cardData?: { license?: string; model_name?: string; params?: string | number };
  siblings?: HubFile[];
};
type UnknownRecord = Record<string, unknown>;

const params = (value: unknown, text: string): number | undefined => {
  const match = String(value ?? text).match(/(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/);
  return match ? Number(match[1]) : undefined;
};
const titleOf = (id: string) => id.split("/").at(-1)?.replace(/-(GGUF|MLX)$/i, "") ?? id;
const validSize = (size: unknown): size is number => typeof size === "number" && Number.isSafeInteger(size) && size >= MIN_ARTIFACT_BYTES;
const knownFileSize = (size: unknown): size is number => typeof size === "number" && Number.isSafeInteger(size) && size > 0;
const isMlxRuntimeFile = (filename: string) => /(?:^|\/)(?:[^/]+\.safetensors|[^/]+\.safetensors\.index\.json|(?:config|generation_config|tokenizer(?:_config)?|special_tokens_map|added_tokens|preprocessor_config|processor_config|vocab)\.json|[^/]+\.model|chat_template\.jinja|merges\.txt|[^/]+\.tiktoken)$/i.test(filename);
const repoUrl = (id: string) => `https://huggingface.co/${id}`;
const revisionUrl = (id: string, revision?: string) => revision ? `${repoUrl(id)}/tree/${encodeURIComponent(revision)}` : repoUrl(id);
const fileUrl = (id: string, filename: string, revision?: string) => `${repoUrl(id)}/resolve/${encodeURIComponent(revision ?? "main")}/${filename.split("/").map(encodeURIComponent).join("/")}`;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeHubFile(value: unknown): HubFile | undefined {
  const file = asRecord(value);
  if (!file) return undefined;
  const rfilename = asString(file.rfilename);
  if (!rfilename) return undefined;
  const size = asFiniteNumber(file.size);
  return size === undefined ? { rfilename } : { rfilename, size };
}

function normalizeCardData(value: unknown): HubModel["cardData"] | undefined {
  const cardData = asRecord(value);
  if (!cardData) return undefined;
  const license = asString(cardData.license);
  const modelName = asString(cardData.model_name);
  const rawParams = cardData.params;
  const params = typeof rawParams === "string" || typeof rawParams === "number" ? rawParams : undefined;
  return license === undefined && modelName === undefined && params === undefined
    ? undefined
    : { license, model_name: modelName, params };
}

export function normalizeHubModel(value: unknown): HubModel | undefined {
  const model = asRecord(value);
  if (!model) return undefined;
  const id = asString(model.id);
  if (!id) return undefined;
  const sha = asString(model.sha)?.trim() || undefined;
  const downloads = asFiniteNumber(model.downloads);
  const lastModified = asString(model.lastModified);
  const gated = typeof model.gated === "boolean" || typeof model.gated === "string" ? model.gated : undefined;
  const tags = Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === "string") : undefined;
  const pipelineTag = asString(model.pipeline_tag);
  const siblings = Array.isArray(model.siblings)
    ? model.siblings.map(normalizeHubFile).filter((file): file is HubFile => file !== undefined)
    : undefined;
  return {
    id,
    sha,
    downloads,
    lastModified,
    gated,
    tags,
    pipeline_tag: pipelineTag,
    cardData: normalizeCardData(model.cardData),
    siblings,
  };
}

export function isHubModel(value: unknown): value is HubModel {
  return normalizeHubModel(value) !== undefined;
}

export function parseHubModelList(value: unknown): HubModel[] {
  if (!Array.isArray(value)) throw new Error("Hugging Face returned an invalid model list");
  const models = value.map(normalizeHubModel).filter((model): model is HubModel => model !== undefined);
  if (!models.length) throw new Error("Hugging Face returned an invalid model list");
  return models;
}

function modelFiles(model: HubModel): HubFile[] {
  return model.siblings ?? [];
}

function validGgufFiles(files: HubFile[]) {
  return files.filter((file) => validSize(file.size)).sort((a, b) => a.size! - b.size! || a.rfilename.localeCompare(b.rfilename));
}

function quantizationOf(filename: string) {
  // GGUF names commonly use Q2-Q8 (including K/IQ variants), or full-precision
  // labels such as F16/BF16/F32. Preserve the label so it is visible in the UI.
  const match = filename.match(/(?:^|[._-])((?:I?Q\d+(?:_[A-Z0-9]+)*)|(?:BF16|F(?:16|32)))(?=[._-]|$)/i);
  return match?.[1]?.toUpperCase();
}

export function normalizeModels(models: HubModel[], format: Artifact["format"]): Artifact[] {
  return models.flatMap((model) => {
    const files = modelFiles(model);
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files.filter((file) => isMlxRuntimeFile(file.rfilename));
    const selectedFiles = format === "gguf" ? validGgufFiles(matched) : [undefined];
    if (format === "gguf" && !selectedFiles.length) return [];
    // MLX runtimes need weights plus configuration and tokenizer assets. Include
    // every known runtime file and reject an aggregate if any required size is
    // missing, so the displayed disk check remains conservative.
    const sizeBytes = format === "gguf" ? undefined : matched.reduce((sum, file) => knownFileSize(file.size) ? sum + file.size : Number.NaN, 0);
    if (format === "mlx" && !validSize(sizeBytes)) return [];
    return selectedFiles.flatMap((selected) => {
      const artifactSize = format === "gguf" ? selected!.size : sizeBytes;
      if (!validSize(artifactSize)) return [];
      const filename = selected?.rfilename;
      return [{
        id: filename ? `${model.id}/${filename}` : model.id,
        modelId: model.id,
        title: titleOf(model.id),
        format,
        sizeBytes: artifactSize,
        sizeGb: Math.round((artifactSize / 1e9) * 10) / 10,
        paramsB: params(model.cardData?.params, `${model.id} ${(model.tags ?? []).join(" ")}`),
        quantization: filename ? quantizationOf(filename) : undefined,
        downloads: model.downloads !== undefined && model.downloads >= 0 ? model.downloads : 0,
        updatedAt: typeof model.lastModified === "string" ? model.lastModified : new Date(0).toISOString(),
        licence: model.cardData?.license,
        gated: Boolean(model.gated),
        tags: model.tags ?? [],
        pipelineTag: model.pipeline_tag,
        repositoryUrl: repoUrl(model.id),
        sourceUrl: filename ? fileUrl(model.id, filename, model.sha) : revisionUrl(model.id, model.sha),
        filename,
      }];
    });
  });
}

export function normalizationExclusions(models: HubModel[], format: Artifact["format"]): Partial<ExclusionSummary> {
  return models.reduce<Partial<ExclusionSummary>>((counts, model) => {
    const files = modelFiles(model);
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files.filter((file) => isMlxRuntimeFile(file.rfilename));
    if (!matched.length) counts.unsupportedFormat = (counts.unsupportedFormat ?? 0) + 1;
    else if (!normalizeModels([model], format).length) counts.invalidSize = (counts.invalidSize ?? 0) + 1;
    return counts;
  }, {});
}

export { mapWithConcurrency } from "./catalogue-request";

export async function retrieveCatalogue(fetcher: FetchLike = fetch, refreshTimeoutMs = REFRESH_TIMEOUT_MS): Promise<Catalogue> {
  const refreshController = new AbortController();
  const deadline = setTimeout(() => refreshController.abort(new Error("Hugging Face catalogue refresh timed out")), refreshTimeoutMs);
  try {
  const base = `${HUB_BASE}?full=true&limit=20&sort=downloads&direction=-1`;
  const [ggufList, mlxList] = await Promise.all([
    fetchJson(`${base}&search=GGUF`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
    fetchJson(`${base}&author=mlx-community`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
  ]);
  // The full list responses include sibling metadata, so normalize their files
  // directly instead of adding one detail request per repository.
  const items = [...normalizeModels(ggufList, "gguf"), ...normalizeModels(mlxList, "mlx")];
  if (!items.length) throw new Error("Hugging Face catalogue returned no usable artifacts");
  const ggufExclusions = normalizationExclusions(ggufList, "gguf");
  const mlxExclusions = normalizationExclusions(mlxList, "mlx");
  return { items, refreshedAt: new Date().toISOString(), exclusions: { invalidSize: (ggufExclusions.invalidSize ?? 0) + (mlxExclusions.invalidSize ?? 0), unsupportedFormat: (ggufExclusions.unsupportedFormat ?? 0) + (mlxExclusions.unsupportedFormat ?? 0) } };
  } finally {
    clearTimeout(deadline);
  }
}

// This is intentionally reachable only from the child process spawned by the
// browser suite. It keeps the progressive-enhancement check offline and does
// not create a public endpoint or persist any configuration.
const browserTestCatalogue: Catalogue = {
  items: [{
    id: "ollama/llama3.2:3b",
    modelId: "llama3.2:3b",
    title: "Llama 3.2 3B",
    format: "gguf",
    sizeBytes: 2_000_000_000,
    sizeGb: 2,
    paramsB: 3,
    downloads: 0,
    updatedAt: "2026-08-01T00:00:00Z",
    gated: false,
    tags: ["instruct", "chat"],
    pipelineTag: "text-generation",
    repositoryUrl: "https://ollama.com/library/llama3.2:3b",
    sourceUrl: "https://ollama.com/library/llama3.2:3b",
    pullName: "llama3.2:3b",
  }],
  refreshedAt: "2026-08-01T00:00:00Z",
};

const persistentCatalogueRefresh = unstable_cache(
  retrieveCatalogue,
  ["mac-local-llm-finder", "catalogue-refresh", "v1"],
  { revalidate: 24 * 60 * 60 },
);

// Keep the fixture isolated from the persistent production cache so browser
// tests remain fully offline. The outer cache retains process-local stale
// responses and retry backoff when the shared refresh is unavailable.
const cache = new CatalogueCache(process.env.MAC_LLM_BROWSER_TEST_FIXTURE === "1" ? async () => browserTestCatalogue : persistentCatalogueRefresh);
export const getCatalogue = () => cache.get();
