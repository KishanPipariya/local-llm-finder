import { CatalogueCache, type Catalogue } from "./catalogue-cache";
import type { Artifact, ExclusionSummary } from "./recommendations";
import { unstable_cache } from "next/cache";
import { fetchJson, mapWithConcurrency, type FetchLike, REFRESH_TIMEOUT_MS } from "./catalogue-request";

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

function params(value: unknown, text: string): number | undefined {
  // Card metadata commonly uses either a small value in billions (7) or a raw
  // parameter count (7_000_000_000); normalize both to the paramsB unit.
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value >= 1_000_000 ? value / 1e9 : value;
  const parseText = (candidate: unknown) => {
    const match = String(candidate ?? "").match(/(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/);
    return match ? Number(match[1]) : undefined;
  };
  return parseText(value) ?? parseText(text);
}
const titleOf = (id: string) => id.split("/").at(-1)?.replace(/-(GGUF|MLX)$/i, "") ?? id;
const validSize = (size: unknown): size is number => typeof size === "number" && Number.isSafeInteger(size) && size >= MIN_ARTIFACT_BYTES;
const knownFileSize = (size: unknown): size is number => typeof size === "number" && Number.isSafeInteger(size) && size > 0;
const isMlxWeightFile = (file: HubFile) => /(?:^|\/)[^/]+\.safetensors$/i.test(file.rfilename) && knownFileSize(file.size);
const supportedPipelineTags = new Set(["text-generation", "text2text-generation", "conversational"]);
// Unknown tags remain eligible so newly introduced Hugging Face tasks do not
// disappear silently. Explicitly recognized non-conversational tasks must not
// be presented as local chat/coding models, however.
const knownIncompatiblePipelineTags = new Set([
  "audio-classification",
  "audio-to-audio",
  "automatic-speech-recognition",
  "depth-estimation",
  "document-question-answering",
  "feature-extraction",
  "fill-mask",
  "image-classification",
  "image-feature-extraction",
  "image-segmentation",
  "image-to-image",
  "image-to-text",
  "image-text-to-text",
  "mask-generation",
  "multiple-choice",
  "ner",
  "object-detection",
  "question-answering",
  "reinforcement-learning",
  "sentence-similarity",
  "summarization",
  "table-question-answering",
  "text-classification",
  "text-to-speech",
  "token-classification",
  "translation",
  "text-to-image",
  "video-classification",
  "visual-question-answering",
  "voice-activity-detection",
  "zero-shot-classification",
  "zero-shot-image-classification",
]);
const isSupportedTask = (model: HubModel) => {
  const task = model.pipeline_tag?.toLowerCase();
  return !task || supportedPipelineTags.has(task) || !knownIncompatiblePipelineTags.has(task);
};
const isGgufShard = (file: HubFile) => /(?:^|[-_.])\d{5}-of-\d{5}\.gguf$/i.test(file.rfilename);
const isGgufAuxiliary = (file: HubFile) => /(?:^|[._/-])(?:mmproj|imatrix|adapter|lora|tokenizer|vocab)(?:[._/-]|$)/i.test(file.rfilename);
const isStandaloneGguf = (file: HubFile) => !isGgufShard(file) && !isGgufAuxiliary(file);
const repoUrl = (id: string) => `https://huggingface.co/${id}`;
const revisionUrl = (id: string, revision?: string) => revision ? `${repoUrl(id)}/tree/${encodeURIComponent(revision)}` : repoUrl(id);
const fileUrl = (id: string, filename: string, revision?: string) => `${repoUrl(id)}/resolve/${encodeURIComponent(revision ?? "main")}/${filename.split("/").map(encodeURIComponent).join("/")}`;
const modelInfoUrl = (id: string) => `${HUB_BASE}/${id.split("/").map(encodeURIComponent).join("/")}?blobs=true`;

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
  return files.filter((file) => isStandaloneGguf(file) && validSize(file.size)).sort((a, b) => a.size! - b.size! || a.rfilename.localeCompare(b.rfilename));
}

function quantizationOf(filename: string) {
  // GGUF names commonly use Q2-Q8 (including K/IQ variants), or full-precision
  // labels such as F16/BF16/F32. Preserve the label so it is visible in the UI.
  const match = filename.match(/(?:^|[._-])((?:I?Q\d+(?:_[A-Z0-9]+)*)|(?:BF16|F(?:16|32)))(?=[._-]|$)/i);
  return match?.[1]?.toUpperCase();
}

export function normalizeModels(models: HubModel[], format: Artifact["format"]): Artifact[] {
  return models.flatMap((model) => {
    if (!isSupportedTask(model)) return [];
    const files = modelFiles(model);
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files;
    const selectedFiles = format === "gguf" ? validGgufFiles(matched) : [undefined];
    if (format === "gguf" && !selectedFiles.length) return [];
    // `hf download` snapshots the repository. Count every file, including files
    // not recognised as runtime assets, and reject unknown sizes so disk-fit
    // guidance remains conservative.
    const sizeBytes = format === "gguf" ? undefined : matched.reduce((sum, file) => knownFileSize(file.size) ? sum + file.size : Number.NaN, 0);
    if (format === "mlx" && (!matched.some(isMlxWeightFile) || !validSize(sizeBytes))) return [];
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
        revision: model.sha,
        filename,
      }];
    });
  });
}

export function normalizationExclusions(models: HubModel[], format: Artifact["format"]): Partial<ExclusionSummary> {
  return models.reduce<Partial<ExclusionSummary>>((counts, model) => {
    const files = modelFiles(model);
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files;
    if (!isSupportedTask(model)) counts.unsupportedArtifact = (counts.unsupportedArtifact ?? 0) + 1;
    else if (!matched.length) counts.unsupportedFormat = (counts.unsupportedFormat ?? 0) + 1;
    else if (format === "gguf") {
      // A GGUF file becomes its own recommendation, so account for every
      // rejected file even when its repository has valid alternatives.
      const nonStandaloneFiles = matched.filter((file) => !isStandaloneGguf(file)).length;
      const invalidFiles = matched.filter((file) => isStandaloneGguf(file) && !validSize(file.size)).length;
      if (nonStandaloneFiles) counts.unsupportedArtifact = (counts.unsupportedArtifact ?? 0) + nonStandaloneFiles;
      if (invalidFiles) counts.invalidSize = (counts.invalidSize ?? 0) + invalidFiles;
    } else if (!normalizeModels([model], format).length) {
      // MLX is downloaded as one repository snapshot, so its exclusion stays
      // at repository level even when multiple files have invalid sizes.
      counts.invalidSize = (counts.invalidSize ?? 0) + 1;
    }
    return counts;
  }, {});
}

export { mapWithConcurrency } from "./catalogue-request";

export function interleaveUnique(lists: HubModel[][], limit: number): HubModel[] {
  const selected: HubModel[] = [];
  const seen = new Set<string>();
  const maxLength = lists.reduce((maximum, list) => Math.max(maximum, list.length), 0);
  for (let index = 0; selected.length < limit && index < maxLength; index += 1) {
    for (const model of lists.map((list) => list[index]).filter((candidate): candidate is HubModel => candidate !== undefined)) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        selected.push(model);
        if (selected.length === limit) break;
      }
    }
  }
  return selected;
}

async function retrieveModelMetadata(model: HubModel, fetcher: FetchLike, refreshSignal: AbortSignal): Promise<HubModel | undefined> {
  try {
    return normalizeHubModel(await fetchJson(modelInfoUrl(model.id), fetcher, refreshSignal, "Hugging Face"));
  } catch (error) {
    // The overall refresh deadline invalidates the entire sample. A request
    // timeout or ordinary repository failure remains isolated to that one repo.
    if (refreshSignal.aborted) throw refreshSignal.reason ?? error;
    // A repository can disappear or be temporarily unavailable between the
    // list and detail requests. Excluding that one unverified artifact keeps
    // the remaining, size-verified catalogue usable.
    return undefined;
  }
}

export async function retrieveCatalogue(fetcher: FetchLike = fetch, refreshTimeoutMs = REFRESH_TIMEOUT_MS): Promise<Catalogue> {
  const refreshController = new AbortController();
  const deadline = setTimeout(() => refreshController.abort(new Error("Hugging Face catalogue refresh timed out")), refreshTimeoutMs);
  try {
    // A popularity-only sample hides newer repositories until they have
    // accumulated enough downloads. Interleave popular and recently updated
    // feeds while keeping the detail crawl bounded to twenty repositories per
    // format.
    const listBase = `${HUB_BASE}?full=true&limit=20&direction=-1`;
    const [popularGguf, recentGguf, popularMlx, recentMlx] = await Promise.all([
      fetchJson(`${listBase}&sort=downloads&search=GGUF`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
      fetchJson(`${listBase}&sort=lastModified&search=GGUF`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
      fetchJson(`${listBase}&sort=downloads&author=mlx-community`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
      fetchJson(`${listBase}&sort=lastModified&author=mlx-community`, fetcher, refreshController.signal, "Hugging Face").then(parseHubModelList),
    ]);
    const ggufList = interleaveUnique([popularGguf, recentGguf], 20);
    const mlxList = interleaveUnique([popularMlx, recentMlx], 20);
    // List responses contain filenames but no byte sizes. Fetch each selected
    // repository's blob metadata before normalizing, otherwise conservative size
    // validation would exclude every artifact. Both formats share one upstream
    // concurrency limit, so a mixed catalogue refresh has at most six detail
    // requests in flight at once.
    const detailed = await mapWithConcurrency(
      [...ggufList.map((model) => ({ format: "gguf" as const, model })), ...mlxList.map((model) => ({ format: "mlx" as const, model }))],
      6,
      async ({ format, model }) => ({ format, model: await retrieveModelMetadata(model, fetcher, refreshController.signal) }),
    );
    refreshController.signal.throwIfAborted();
    const detailFailures = detailed.filter((entry) => entry.model === undefined).length;
    if (detailFailures > detailed.length / 2) throw new Error("Hugging Face catalogue metadata refresh was materially incomplete");
    for (const format of ["gguf", "mlx"] as const) {
      const formatEntries = detailed.filter((entry) => entry.format === format);
      const verifiedCount = formatEntries.filter((entry) => entry.model !== undefined).length;
      if (!verifiedCount || formatEntries.filter((entry) => entry.model === undefined).length > formatEntries.length / 2) {
        throw new Error(`Hugging Face ${format} metadata refresh was materially incomplete`);
      }
    }
    const verifiedGgufModels = detailed.filter((entry): entry is { format: "gguf"; model: HubModel } => entry.format === "gguf" && entry.model !== undefined).map((entry) => entry.model);
    const verifiedMlxModels = detailed.filter((entry): entry is { format: "mlx"; model: HubModel } => entry.format === "mlx" && entry.model !== undefined).map((entry) => entry.model);
    const items = [...normalizeModels(verifiedGgufModels, "gguf"), ...normalizeModels(verifiedMlxModels, "mlx")];
    if (!items.length) throw new Error("Hugging Face catalogue returned no usable artifacts");
    const ggufExclusions = normalizationExclusions(verifiedGgufModels, "gguf");
    const mlxExclusions = normalizationExclusions(verifiedMlxModels, "mlx");
    return {
      items,
      refreshedAt: new Date().toISOString(),
      exclusions: {
        invalidSize: (ggufExclusions.invalidSize ?? 0) + (mlxExclusions.invalidSize ?? 0),
        unsupportedFormat: (ggufExclusions.unsupportedFormat ?? 0) + (mlxExclusions.unsupportedFormat ?? 0),
        unsupportedArtifact: (ggufExclusions.unsupportedArtifact ?? 0) + (mlxExclusions.unsupportedArtifact ?? 0),
      },
    };
  } finally {
    clearTimeout(deadline);
    // Stop parallel upstream work whenever this refresh completes or fails.
    if (!refreshController.signal.aborted) refreshController.abort();
  }
}

const persistentCatalogueRefresh = unstable_cache(
  retrieveCatalogue,
  ["mac-local-llm-finder", "catalogue-refresh", "v1"],
  { revalidate: 6 * 60 * 60 },
);

const cache = new CatalogueCache(persistentCatalogueRefresh);
export const getCatalogue = () => cache.get();
