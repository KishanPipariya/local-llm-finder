import { CatalogueCache, type Catalogue } from "./catalogue-cache";
import type { Artifact, ExclusionSummary } from "./recommendations";

const MIN_ARTIFACT_BYTES = 100_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DETAIL_CONCURRENCY = 4;
const HUB_BASE = "https://huggingface.co/api/models";

export type HubFile = { rfilename: string; size?: number };
export type HubModel = {
  id: string;
  downloads?: number;
  lastModified?: string;
  gated?: boolean | string;
  tags?: string[];
  cardData?: { license?: string; model_name?: string; params?: string | number };
  siblings?: HubFile[];
};

type FetchLike = typeof fetch;

const params = (value: unknown, text: string): number | undefined => {
  const match = String(value ?? text).match(/(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/);
  return match ? Number(match[1]) : undefined;
};
const titleOf = (id: string) => id.split("/").at(-1)?.replace(/-(GGUF|MLX)$/i, "") ?? id;
const validSize = (size: unknown): size is number => typeof size === "number" && Number.isSafeInteger(size) && size >= MIN_ARTIFACT_BYTES;
const repoUrl = (id: string) => `https://huggingface.co/${id}`;
const fileUrl = (id: string, filename: string) => `${repoUrl(id)}/resolve/main/${filename.split("/").map(encodeURIComponent).join("/")}`;

export function isHubModel(value: unknown): value is HubModel {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

export function parseHubModelList(value: unknown): HubModel[] {
  if (!Array.isArray(value) || !value.every(isHubModel)) throw new Error("Hugging Face returned an invalid model list");
  return value;
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
    const files = Array.isArray(model.siblings) ? model.siblings.filter((file): file is HubFile => Boolean(file) && typeof file.rfilename === "string") : [];
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files.filter((file) => /config\.json$|\.safetensors$/i.test(file.rfilename));
    const selectedFiles = format === "gguf" ? validGgufFiles(matched) : [undefined];
    if (format === "gguf" && !selectedFiles.length) return [];
    const sizeBytes = format === "gguf" ? undefined : matched.reduce((sum, file) => validSize(file.size) ? sum + file.size : Number.NaN, 0);
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
        downloads: Number.isFinite(model.downloads) ? model.downloads! : 0,
        updatedAt: typeof model.lastModified === "string" ? model.lastModified : new Date(0).toISOString(),
        licence: model.cardData?.license,
        gated: Boolean(model.gated),
        tags: Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === "string") : [],
        repositoryUrl: repoUrl(model.id),
        sourceUrl: filename ? fileUrl(model.id, filename) : repoUrl(model.id),
        filename,
      }];
    });
  });
}

export function normalizationExclusions(models: HubModel[], format: Artifact["format"]): Partial<ExclusionSummary> {
  return models.reduce<Partial<ExclusionSummary>>((counts, model) => {
    const files = Array.isArray(model.siblings) ? model.siblings.filter((file): file is HubFile => Boolean(file) && typeof file.rfilename === "string") : [];
    const matched = format === "gguf" ? files.filter((file) => /\.gguf$/i.test(file.rfilename)) : files.filter((file) => /config\.json$|\.safetensors$/i.test(file.rfilename));
    if (!matched.length) counts.unsupportedFormat = (counts.unsupportedFormat ?? 0) + 1;
    else if (!normalizeModels([model], format).length) counts.invalidSize = (counts.invalidSize ?? 0) + 1;
    return counts;
  }, {});
}

async function fetchJson(url: string, fetcher: FetchLike): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Hugging Face request failed (${response.status})`);
  return response.json();
}

export async function mapWithConcurrency<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

function uniqueModels(models: HubModel[]) {
  return [...new Map(models.map((model) => [model.id, model])).values()];
}

export async function retrieveCatalogue(fetcher: FetchLike = fetch): Promise<Catalogue> {
  const base = `${HUB_BASE}?full=true&limit=20&sort=downloads&direction=-1`;
  const [ggufList, mlxList] = await Promise.all([
    fetchJson(`${base}&search=GGUF`, fetcher).then(parseHubModelList),
    fetchJson(`${base}&author=mlx-community`, fetcher).then(parseHubModelList),
  ]);
  const models = uniqueModels([...ggufList, ...mlxList]);
  const details = await mapWithConcurrency(models, DETAIL_CONCURRENCY, async (model) => {
    const id = model.id.split("/").map(encodeURIComponent).join("/");
    try {
      const detail = await fetchJson(`${HUB_BASE}/${id}?blobs=true`, fetcher);
      return isHubModel(detail) ? detail : model;
    } catch { return model; }
  });
  const ggufModels = details.filter((model) => ggufList.some((listed) => listed.id === model.id));
  const mlxModels = details.filter((model) => mlxList.some((listed) => listed.id === model.id));
  const items = [...normalizeModels(ggufModels, "gguf"), ...normalizeModels(mlxModels, "mlx")];
  if (!items.length) throw new Error("Hugging Face returned no usable artifacts");
  const ggufExclusions = normalizationExclusions(ggufModels, "gguf");
  const mlxExclusions = normalizationExclusions(mlxModels, "mlx");
  return { items, refreshedAt: new Date().toISOString(), exclusions: { invalidSize: (ggufExclusions.invalidSize ?? 0) + (mlxExclusions.invalidSize ?? 0), unsupportedFormat: (ggufExclusions.unsupportedFormat ?? 0) + (mlxExclusions.unsupportedFormat ?? 0) } };
}

const cache = new CatalogueCache(retrieveCatalogue);
export const getCatalogue = () => cache.get();
