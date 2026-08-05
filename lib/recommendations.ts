export type MacConfig = {
  chipTier: "base" | "pro" | "max" | "ultra";
  memoryGb: number;
  diskGb: number;
  workload: "chat" | "coding" | "balanced";
};

export type Artifact = {
  id: string;
  modelId: string;
  title: string;
  format: "gguf" | "mlx";
  sizeGb: number;
  paramsB?: number;
  quantization?: string;
  downloads: number;
  updatedAt: string;
  licence?: string;
  gated: boolean;
  tags: string[];
  sourceUrl: string;
};

export type Recommendation = Artifact & {
  runtimes: ("Ollama" | "LM Studio" | "llama.cpp" | "MLX")[];
  memoryGb: number;
  performance: "Comfortable" | "Tight memory" | "Likely slow";
  why: string;
  notes: string[];
  guidance: { runtime: string; command: string }[];
};

const workloads = ["chat", "coding", "balanced"] as const;
export const memoryConfigurationsGb = [8, 16, 18, 24, 32, 36, 48, 64, 96, 128, 192, 256, 512] as const;

export function validateConfig(value: unknown): { valid: true; data: MacConfig } | { valid: false; errors: string[] } {
  const v = value as Partial<MacConfig>;
  const errors: string[] = [];
  if (!v || !["base", "pro", "max", "ultra"].includes(v.chipTier ?? "")) errors.push("Choose a chip tier.");
  if (!memoryConfigurationsGb.includes(v?.memoryGb as typeof memoryConfigurationsGb[number])) errors.push("Choose an available memory configuration.");
  if (!Number.isFinite(v?.diskGb) || (v.diskGb ?? 0) < 1 || (v.diskGb ?? 0) > 4000) errors.push("Free disk space must be between 1 and 4,000 GB.");
  if (!workloads.includes(v?.workload as typeof workloads[number])) errors.push("Choose a workload.");
  return errors.length ? { valid: false, errors } : { valid: true, data: v as MacConfig };
}

export function runtimeEligibility(config: MacConfig, artifact: Artifact): Recommendation["runtimes"] {
  if (artifact.format === "mlx") return ["MLX"];
  const runtimes: Recommendation["runtimes"] = ["LM Studio", "llama.cpp"];
  runtimes.unshift("Ollama");
  return runtimes;
}

export function estimateMemoryGb(artifact: Artifact): number {
  // File mapping plus KV/context/runtime overhead; deliberately conservative for a 4k context.
  return Math.round((artifact.sizeGb + Math.max(1.4, artifact.sizeGb * 0.22) + (artifact.paramsB ? Math.min(2.5, artifact.paramsB * 0.025) : 0)) * 10) / 10;
}

function modelScore(item: Artifact, config: MacConfig): number {
  const tags = item.tags.join(" ").toLowerCase();
  const isCode = /code|coder|programming/.test(`${item.title} ${tags}`.toLowerCase());
  const fit = item.paramsB ?? item.sizeGb;
  const work = config.workload === "coding" ? (isCode ? 40 : -10) : config.workload === "chat" ? (isCode ? -4 : 18) : (isCode ? 13 : 10);
  return fit * 9 + work + Math.min(12, Math.log10(item.downloads + 1) * 2);
}

export function buildGuidance(item: Artifact, runtimes: Recommendation["runtimes"]): Recommendation["guidance"] {
  const q = item.quantization ? ` (${item.quantization})` : "";
  return runtimes.map((runtime) => {
    if (runtime === "Ollama") return { runtime, command: `See ${item.sourceUrl} and import its GGUF with an Ollama Modelfile.` };
    if (runtime === "LM Studio") return { runtime, command: `lms get ${item.id}  # or open the model link in LM Studio${q}` };
    if (runtime === "llama.cpp") return { runtime, command: `llama-cli -hf ${item.id} -p "Hello"` };
    return { runtime, command: `uvx mlx_lm.generate --model ${item.id} --prompt "Hello"` };
  });
}

export function rankArtifacts(artifacts: Artifact[], config: MacConfig): Recommendation[] {
  const eligible = artifacts.flatMap((item) => {
    const runtimes = runtimeEligibility(config, item);
    const memoryGb = estimateMemoryGb(item);
    if (!runtimes.length || !Number.isFinite(item.sizeGb) || item.sizeGb > config.diskGb) return [];
    const tight = memoryGb > config.memoryGb * 0.82;
    const slow = memoryGb > config.memoryGb * 0.94;
    const notes: string[] = [];
    if (tight) notes.push("Tight memory: close other apps and use a modest context window.");
    if (slow) notes.push("May swap memory or run slowly at larger contexts.");
    if (item.gated) notes.push("Gated: accept the model licence and sign in to Hugging Face first.");
    const performance: Recommendation["performance"] = slow ? "Likely slow" : tight ? "Tight memory" : "Comfortable";
    return [{ ...item, runtimes, memoryGb, performance, notes, why: `${item.paramsB ? `${item.paramsB}B parameters` : "A current compact model"}${config.workload === "coding" ? " with coding-oriented ranking" : " sized for your Mac"}.`, guidance: buildGuidance(item, runtimes) }];
  });
  const grouped = new Map<string, Recommendation>();
  for (const item of eligible.sort((a, b) => modelScore(b, config) - modelScore(a, config))) {
    const key = item.modelId.replace(/-(GGUF|MLX|[Qq]\d[^/]*)$/i, "");
    if (!grouped.has(key)) grouped.set(key, item);
  }
  return [...grouped.values()].slice(0, 10);
}
