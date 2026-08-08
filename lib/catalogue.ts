import { CatalogueCache, type Catalogue } from "./catalogue-cache";
import type { Artifact, ExclusionSummary } from "./recommendations";
import { unstable_cache } from "next/cache";
import { parse } from "parse5";
import { fetchJson, mapWithConcurrency, requestSignal, type FetchLike, REFRESH_TIMEOUT_MS } from "./catalogue-request";

const MIN_ARTIFACT_BYTES = 100_000_000;
export { REFRESH_TIMEOUT_MS } from "./catalogue-request";
const OLLAMA_CONCURRENCY = 6;
const HUB_BASE = "https://huggingface.co/api/models";
const OLLAMA_REGISTRY_BASE = "https://registry.ollama.ai/v2/library";
const OLLAMA_LIBRARY_BASE = "https://ollama.com/library";

const OLLAMA_LAYER_MEDIA_TYPES = new Set([
  "application/vnd.ollama.image.model",
  "application/vnd.ollama.image.adapter",
  "application/vnd.ollama.image.projector",
  "application/vnd.ollama.image.template",
  "application/vnd.ollama.image.system",
  "application/vnd.ollama.image.params",
  "application/vnd.ollama.image.license",
  "application/vnd.ollama.image.messages",
]);

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
/** The library presents a 12-character (or longer) manifest digest prefix. */
export type OllamaTag = { family: string; name: string; textInput: boolean; digest: string };
export type OllamaManifest = { schemaVersion: number; config: { mediaType: string; digest: string; size: number }; layers: { mediaType: string; size: number }[] };
export type OllamaConfig = { modelFamily: string; paramsB: number; quantization: string };
type HtmlNode = { nodeName?: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[]; parentNode?: HtmlNode };

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

export function parseOllamaManifest(value: unknown): OllamaManifest {
  const manifest = asRecord(value);
  const config = asRecord(manifest?.config);
  const configMediaType = asString(config?.mediaType);
  const configDigest = asString(config?.digest);
  const configSize = config?.size;
  if (!manifest || manifest.schemaVersion !== 2 || !configMediaType || !/^application\/vnd\.docker\.container\.image\.v1\+json$/.test(configMediaType) || !validDigest(configDigest) || !knownFileSize(configSize) || !Array.isArray(manifest.layers) || !manifest.layers.length) throw new Error("Ollama returned an invalid manifest");
  const layers = manifest.layers.map((value) => {
    const layer = asRecord(value);
    const mediaType = asString(layer?.mediaType);
    const size = layer?.size;
    if (!mediaType || !OLLAMA_LAYER_MEDIA_TYPES.has(mediaType) || !knownFileSize(size)) throw new Error("Ollama returned an invalid manifest layer");
    return { mediaType, size };
  });
  const totalSize = layers.reduce((total, layer) => total + layer.size, 0);
  if (!Number.isSafeInteger(totalSize) || !validSize(totalSize)) throw new Error("Ollama returned an implausible manifest size");
  return { schemaVersion: 2, config: { mediaType: configMediaType, digest: configDigest, size: configSize }, layers };
}

const validDigest = (value: string | undefined): value is string => Boolean(value && /^sha256:[a-f0-9]{64}$/i.test(value));
const validOllamaName = (value: string) => /^[a-z0-9][a-z0-9._-]*$/i.test(value);
const qualityQuantization = /(?:^|[-_.:])(Q4_K_M|Q5_K_M|Q6_K|Q8_0|FP16)(?:$|[-_.:])/i;
const defaultTag = (name: string) => /^(?:latest|default)$/i.test(name) || !/(?:^|[-_.:])(?:Q\d|IQ\d|FP(?:16|32)|BF16)(?:$|[-_.:])/i.test(name);

function attributes(node: HtmlNode) { return new Map((node.attrs ?? []).map(({ name, value }) => [name.toLowerCase(), value])); }
function nodeText(node: HtmlNode): string { return node.nodeName === "#text" ? (node.value ?? "") : (node.childNodes ?? []).map(nodeText).join(" "); }
function walk(node: HtmlNode, visitor: (node: HtmlNode) => void) { visitor(node); for (const child of node.childNodes ?? []) walk(child, visitor); }
function ancestorText(node: HtmlNode) { let current: HtmlNode | undefined = node; while (current && !["article", "li", "tr"].includes(current.tagName ?? "")) current = current.parentNode; return nodeText(current ?? node).replace(/\s+/g, " ").trim(); }

/** Strictly extracts the current family links from the public Ollama library. */
export function parseOllamaLibrary(html: string): string[] {
  if (!html.trim()) throw new Error("Ollama library returned empty HTML");
  const families = new Set<string>();
  walk(parse(html) as HtmlNode, (node) => {
    if (node.tagName !== "a") return;
    const href = attributes(node).get("href");
    const match = href?.match(/^\/library\/([a-z0-9][a-z0-9._-]*)\/?$/i);
    if (match) families.add(match[1]);
  });
  if (!families.size) throw new Error("Ollama library markup contained no model families");
  return [...families].sort((a, b) => a.localeCompare(b));
}

/** Extracts library tag rows, including the public text-input and digest markers. */
export function parseOllamaTags(html: string, family: string): OllamaTag[] {
  if (!validOllamaName(family) || !html.trim()) throw new Error("Ollama tags returned invalid HTML");
  const tags = new Map<string, OllamaTag>();
  walk(parse(html) as HtmlNode, (node) => {
    if (node.tagName !== "a") return;
    const href = attributes(node).get("href");
    const match = href?.match(new RegExp(`^/library/${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([a-z0-9][a-z0-9._-]*)/?$`, "i"));
    if (!match) return;
    const text = ancestorText(node);
    const digest = text.match(/(?:sha256:)?([a-f0-9]{12,64})\b/i)?.[1]?.toLowerCase();
    // The library exposes modality as an Input badge. Do not infer it from names.
    const textInput = /\btext\b/i.test(text) && /\binput\b/i.test(text);
    if (!digest) throw new Error("Ollama tags markup omitted a digest");
    const name = match[1];
    if (tags.has(name)) throw new Error("Ollama tags markup duplicated a tag");
    tags.set(name, { family, name, textInput, digest });
  });
  if (!tags.size) throw new Error("Ollama tags markup contained no tags");
  return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectOllamaTags(tags: OllamaTag[]): OllamaTag[] {
  return tags.filter((tag) => tag.textInput && (defaultTag(tag.name) || qualityQuantization.test(tag.name)));
}

export function parseOllamaConfig(value: unknown): OllamaConfig {
  const config = asRecord(value);
  const modelFamily = asString(config?.model_family);
  // Public OCI config blobs use model_type and file_type (unlike local /api/tags).
  const parameterSize = asString(config?.model_type);
  const quantization = asString(config?.file_type);
  const paramsB = params(parameterSize, "");
  if (!modelFamily || !validOllamaName(modelFamily) || !paramsB || !Number.isFinite(paramsB) || !quantization || !/^[A-Z0-9_.-]+$/i.test(quantization)) throw new Error("Ollama returned invalid model metadata");
  return { modelFamily, paramsB, quantization: quantization.toUpperCase() };
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

function ollamaLibraryUrl(pullName: string) { return `${OLLAMA_LIBRARY_BASE}/${pullName}`; }

export function ollamaArtifact(tag: OllamaTag, manifest: OllamaManifest, config: OllamaConfig): Artifact {
  const sizeBytes = manifest.layers.reduce((total, layer) => total + layer.size, 0);
  const pullName = `${tag.family}:${tag.name}`;
  return {
    id: `ollama/${pullName}`,
    modelId: pullName,
    title: tag.family.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    format: "gguf",
    sizeBytes,
    sizeGb: Math.round((sizeBytes / 1e9) * 10) / 10,
    paramsB: config.paramsB,
    quantization: config.quantization,
    downloads: 0,
    updatedAt: new Date().toISOString(),
    gated: false,
    // Family names are deliberately neutral except for the narrowly useful coder hint.
    tags: /(?:^|[-_])(?:code|coder)(?:$|[-_])/i.test(tag.family) ? ["code", "coder"] : [],
    pipelineTag: "text-generation",
    repositoryUrl: ollamaLibraryUrl(pullName),
    sourceUrl: ollamaLibraryUrl(pullName),
    pullName,
  };
}

async function fetchOllama(url: string, fetcher: FetchLike, refreshSignal: AbortSignal, accept?: string): Promise<Response> {
  return fetcher(url, { signal: requestSignal(refreshSignal), headers: accept ? { Accept: accept } : undefined });
}

async function retrieveOllamaArtifacts(fetcher: FetchLike, refreshSignal: AbortSignal): Promise<Artifact[]> {
  const library = await fetchOllama(OLLAMA_LIBRARY_BASE, fetcher, refreshSignal);
  if (!library.ok) throw new Error(`Ollama library request failed (${library.status})`);
  const families = parseOllamaLibrary(await library.text());
  const tagLists = await mapWithConcurrency(families, OLLAMA_CONCURRENCY, async (family) => {
    const response = await fetchOllama(`${OLLAMA_LIBRARY_BASE}/${encodeURIComponent(family)}/tags`, fetcher, refreshSignal);
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Ollama tags request failed (${response.status})`);
    return selectOllamaTags(parseOllamaTags(await response.text(), family));
  });
  const selected = tagLists.flat();
  if (!selected.length) throw new Error("Ollama library returned no usable text tags");
  const entries = await mapWithConcurrency(selected, OLLAMA_CONCURRENCY, async (tag) => {
    const response = await fetchOllama(`${OLLAMA_REGISTRY_BASE}/${encodeURIComponent(tag.family)}/manifests/${encodeURIComponent(tag.name)}`, fetcher, refreshSignal, "application/vnd.docker.distribution.manifest.v2+json");
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Ollama registry request failed (${response.status})`);
    const manifestDigest = response.headers.get("docker-content-digest")?.toLowerCase();
    if (!validDigest(manifestDigest) || !manifestDigest.startsWith(`sha256:${tag.digest}`)) throw new Error("Ollama registry manifest digest did not match the library");
    const manifest = parseOllamaManifest(await response.json());
    const configResponse = await fetchOllama(`${OLLAMA_REGISTRY_BASE}/${encodeURIComponent(tag.family)}/blobs/${encodeURIComponent(manifest.config.digest)}`, fetcher, refreshSignal, "application/vnd.docker.container.image.v1+json");
    if (configResponse.status === 404) return undefined;
    if (!configResponse.ok) throw new Error(`Ollama config request failed (${configResponse.status})`);
    return { tag, manifest, config: parseOllamaConfig(await configResponse.json()), manifestDigest };
  });
  // Multiple library names can resolve to one manifest. Keep the first stable
  // family/tag ordering from the parser, while preserving its direct library URL.
  const unique = new Map<string, Exclude<(typeof entries)[number], undefined>>();
  for (const entry of entries) if (entry && !unique.has(entry.manifestDigest)) unique.set(entry.manifestDigest, entry);
  const artifacts = [...unique.values()].map(({ tag, manifest, config }) => ollamaArtifact(tag, manifest, config));
  if (!artifacts.length) throw new Error("Ollama registry returned no usable artifacts");
  return artifacts;
}

export { mapWithConcurrency } from "./catalogue-request";

export async function retrieveCatalogue(fetcher: FetchLike = fetch, refreshTimeoutMs = REFRESH_TIMEOUT_MS): Promise<Catalogue> {
  const refreshController = new AbortController();
  const deadline = setTimeout(() => refreshController.abort(new Error("Hugging Face catalogue refresh timed out")), refreshTimeoutMs);
  try {
  const base = `${HUB_BASE}?full=true&limit=20&sort=downloads&direction=-1`;
  const [ggufList, mlxList, ollamaItems] = await Promise.all([
    fetchJson(`${base}&search=GGUF`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
    fetchJson(`${base}&author=mlx-community`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
    retrieveOllamaArtifacts(fetcher, refreshController.signal),
  ]);
  // The full list responses include sibling metadata, so normalize their files
  // directly instead of adding one detail request per repository.
  const items = [...ollamaItems, ...normalizeModels(ggufList, "gguf"), ...normalizeModels(mlxList, "mlx")];
  if (!items.length) throw new Error("Model catalogues returned no usable artifacts");
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
