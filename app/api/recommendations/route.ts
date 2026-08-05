import { Artifact, rankArtifacts, validateConfig } from "@/lib/recommendations";
import { cachedCatalogue } from "@/lib/catalogue-cache";

export const runtime = "edge";
const MAX_AGE = 6 * 60 * 60 * 1000;
let catalogue: { items: Artifact[]; refreshedAt: string } | undefined;

type HubModel = { id: string; downloads?: number; lastModified?: string; gated?: boolean | string; tags?: string[]; cardData?: { license?: string; model_name?: string; params?: string | number }; siblings?: { rfilename: string; size?: number }[] };

const params = (value: unknown, text: string): number | undefined => {
  const match = String(value ?? text).match(/(\d+(?:\.\d+)?)\s*[bB](?:illion)?\b/);
  return match ? Number(match[1]) : undefined;
};
const titleOf = (id: string) => id.split("/").at(-1)?.replace(/-(GGUF|MLX)$/i, "") ?? id;

function preferredGguf(files: { rfilename: string; size?: number }[]) {
  const quantized = files.filter((file) => /(?:Q4_K_M|Q4_K_S|Q4_0|Q4_1|IQ4)/i.test(file.rfilename));
  return (quantized.length ? quantized : files).sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0];
}

export function normalize(models: HubModel[], format: Artifact["format"]): Artifact[] {
  return models.flatMap((model) => {
    const files = model.siblings ?? [];
    const matched = format === "gguf" ? files.filter((f) => /\.gguf$/i.test(f.rfilename)) : files.filter((f) => /config\.json$|\.safetensors$/i.test(f.rfilename));
    const selected = format === "gguf" ? preferredGguf(matched) : undefined;
    const size = selected?.size ?? (format === "mlx" ? matched.reduce((sum, f) => sum + (f.size ?? 0), 0) : 0);
    if (!size || size < 100_000_000) return [];
    const q = selected?.rfilename.match(/(Q\d(?:_[A-Z]+)?|IQ\d_[A-Z]+)/i)?.[1];
    return [{ id: model.id, modelId: model.id, title: titleOf(model.id), format, sizeGb: Math.round((size / 1e9) * 10) / 10, paramsB: params(model.cardData?.params, `${model.id} ${(model.tags ?? []).join(" ")}`), quantization: q, downloads: model.downloads ?? 0, updatedAt: model.lastModified ?? new Date(0).toISOString(), licence: model.cardData?.license, gated: Boolean(model.gated), tags: model.tags ?? [], sourceUrl: `https://huggingface.co/${model.id}` }];
  });
}

async function refresh(): Promise<{ items: Artifact[]; refreshedAt: string }> {
  const base = "https://huggingface.co/api/models?full=true&limit=20&sort=downloads&direction=-1";
  const [gguf, mlx] = await Promise.all([
    fetch(`${base}&search=GGUF`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Hugging Face GGUF request failed"))),
    fetch(`${base}&author=mlx-community`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Hugging Face MLX request failed"))),
  ]);
  const details = await Promise.all([...gguf, ...mlx].map(async (model: HubModel) => {
    const id = model.id.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://huggingface.co/api/models/${id}?blobs=true`);
    return response.ok ? response.json() as Promise<HubModel> : model;
  }));
  const ggufIds = new Set(gguf.map((model: HubModel) => model.id));
  const items = [...normalize(details.filter((model) => ggufIds.has(model.id)), "gguf"), ...normalize(details.filter((model) => !ggufIds.has(model.id)), "mlx")];
  if (!items.length) throw new Error("Hugging Face returned no usable artifacts");
  return { items, refreshedAt: new Date().toISOString() };
}

export async function POST(request: Request) {
  const validation = validateConfig(await request.json().catch(() => null));
  if (!validation.valid) return Response.json({ errors: validation.errors }, { status: 400 });
  try {
    const cached = await cachedCatalogue(catalogue, refresh, Date.now(), MAX_AGE);
    catalogue = cached.catalogue;
    return Response.json({ recommendations: rankArtifacts(catalogue.items, validation.data), refreshedAt: catalogue.refreshedAt, stale: cached.stale });
  } catch { return Response.json({ error: "The model catalogue is temporarily unavailable. Please try again shortly." }, { status: 503 }); }
}
