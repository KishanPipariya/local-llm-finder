export type MacConfig = {
  chip: Chip;
  memoryGb: number;
  diskGb: number;
  workload: "chat" | "coding" | "balanced";
};

export type Chip = keyof typeof chipProfiles;
export type ConfigField = "chip" | "memoryGb" | "diskGb" | "workload";
export type ConfigFieldErrors = Partial<Record<ConfigField, string>>;

type ChipProfile = {
  name: string;
  memoryOptionsGb: readonly number[];
  bandwidthGbps: number;
};

// Bandwidth is Apple's published family-level maximum. It is a comparative input,
// not a promise for a particular GPU-core bin or Mac chassis.
export const chipProfiles = {
  m1: { name: "M1", memoryOptionsGb: [8, 16], bandwidthGbps: 68 },
  m1Pro: { name: "M1 Pro", memoryOptionsGb: [16, 32], bandwidthGbps: 200 },
  m1Max: { name: "M1 Max", memoryOptionsGb: [32, 64], bandwidthGbps: 400 },
  m1Ultra: { name: "M1 Ultra", memoryOptionsGb: [64, 128], bandwidthGbps: 800 },
  m2: { name: "M2", memoryOptionsGb: [8, 16, 24], bandwidthGbps: 100 },
  m2Pro: { name: "M2 Pro", memoryOptionsGb: [16, 32], bandwidthGbps: 200 },
  m2Max: { name: "M2 Max", memoryOptionsGb: [32, 64, 96], bandwidthGbps: 400 },
  m2Ultra: { name: "M2 Ultra", memoryOptionsGb: [64, 128, 192], bandwidthGbps: 800 },
  m3: { name: "M3", memoryOptionsGb: [8, 16, 24], bandwidthGbps: 100 },
  m3Pro: { name: "M3 Pro", memoryOptionsGb: [18, 36], bandwidthGbps: 150 },
  m3Max: { name: "M3 Max", memoryOptionsGb: [36, 48, 64, 96, 128], bandwidthGbps: 400 },
  m3Ultra: { name: "M3 Ultra", memoryOptionsGb: [96, 256, 512], bandwidthGbps: 800 },
  m4: { name: "M4", memoryOptionsGb: [16, 24, 32], bandwidthGbps: 120 },
  m4Pro: { name: "M4 Pro", memoryOptionsGb: [24, 48, 64], bandwidthGbps: 273 },
  m4Max: { name: "M4 Max", memoryOptionsGb: [36, 48, 64, 128], bandwidthGbps: 546 },
  m5: { name: "M5", memoryOptionsGb: [16, 24, 32], bandwidthGbps: 153 },
  m5Pro: { name: "M5 Pro", memoryOptionsGb: [24, 48, 64], bandwidthGbps: 307 },
  m5Max: { name: "M5 Max", memoryOptionsGb: [36, 48, 64, 128], bandwidthGbps: 614 },
} as const satisfies Record<string, ChipProfile>;

export const chips = Object.entries(chipProfiles).map(([id, profile]) => ({ id: id as Chip, ...profile }));

export type Artifact = {
  id: string;
  modelId: string;
  title: string;
  format: "gguf" | "mlx";
  /** Exact artifact bytes: use this for all fit calculations. */
  sizeBytes: number;
  sizeGb: number;
  paramsB?: number;
  quantization?: string;
  downloads: number;
  updatedAt: string;
  licence?: string;
  gated: boolean;
  tags: string[];
  sourceUrl: string;
  repositoryUrl: string;
  filename?: string;
};

export type Recommendation = Artifact & {
  runtimes: ("Ollama" | "LM Studio" | "llama.cpp" | "MLX")[];
  memoryGb: number;
  performance: "Comfortable" | "Tight memory" | "Likely slow";
  pace: "Fast" | "Moderate" | "Slow";
  why: string;
  notes: string[];
  guidance: { runtime: string; command: string }[];
};

const workloads = ["chat", "coding", "balanced"] as const;

export function validateConfig(value: unknown): { valid: true; data: MacConfig } | { valid: false; errors: string[]; fieldErrors: ConfigFieldErrors } {
  const v = value as Partial<MacConfig>;
  const errors: string[] = [];
  const fieldErrors: ConfigFieldErrors = {};
  const profile = v && typeof v.chip === "string" ? chipProfiles[v.chip as Chip] : undefined;
  if (!profile) fieldErrors.chip = "Choose a supported Apple chip.";
  if (!(profile?.memoryOptionsGb as readonly number[] | undefined)?.includes(v?.memoryGb ?? Number.NaN)) fieldErrors.memoryGb = "Choose a memory configuration supported by that chip.";
  if (!Number.isFinite(v?.diskGb) || (v.diskGb ?? 0) < 1 || (v.diskGb ?? 0) > 4000) fieldErrors.diskGb = "Free disk space must be between 1 and 4,000 GB.";
  if (!workloads.includes(v?.workload as typeof workloads[number])) fieldErrors.workload = "Choose a workload.";
  errors.push(...Object.values(fieldErrors));
  return errors.length ? { valid: false, errors, fieldErrors } : { valid: true, data: v as MacConfig };
}

export function runtimeEligibility(config: MacConfig, artifact: Artifact): Recommendation["runtimes"] {
  if (artifact.format === "mlx") return ["MLX"];
  const runtimes: Recommendation["runtimes"] = ["LM Studio", "llama.cpp"];
  runtimes.unshift("Ollama");
  return runtimes;
}

export function estimateMemoryGb(artifact: Artifact): number {
  // File mapping plus KV/context/runtime overhead; deliberately conservative for a 4k context.
  const sizeGb = artifact.sizeBytes / 1e9;
  return Math.round((sizeGb + Math.max(1.4, sizeGb * 0.22) + (artifact.paramsB ? Math.min(2.5, artifact.paramsB * 0.025) : 0)) * 10) / 10;
}

export function expectedPace(profile: ChipProfile, estimatedMemoryGb: number): Recommendation["pace"] {
  const bandwidthPerGb = profile.bandwidthGbps / estimatedMemoryGb;
  if (bandwidthPerGb >= 40) return "Fast";
  if (bandwidthPerGb >= 15) return "Moderate";
  return "Slow";
}

function modelScore(item: Artifact, config: MacConfig, memoryGb: number): number {
  const tags = item.tags.join(" ").toLowerCase();
  const isCode = /code|coder|programming/.test(`${item.title} ${tags}`.toLowerCase());
  const fit = item.paramsB ?? item.sizeGb;
  const work = config.workload === "coding" ? (isCode ? 40 : -10) : config.workload === "chat" ? (isCode ? -4 : 18) : (isCode ? 13 : 10);
  const capacity = Math.min(35, Math.log2(fit + 1) * 8);
  const pace = Math.min(45, Math.log2(chipProfiles[config.chip].bandwidthGbps / memoryGb + 1) * 10);
  return capacity + pace + work + Math.min(12, Math.log10(item.downloads + 1) * 2);
}

export function buildGuidance(item: Artifact, runtimes: Recommendation["runtimes"]): Recommendation["guidance"] {
  const q = item.quantization ? ` (${item.quantization})` : "";
  const artifact = item.filename ? `${item.modelId}/${item.filename}` : item.modelId;
  return runtimes.map((runtime) => {
    if (runtime === "Ollama") return { runtime, command: `Download ${artifact} from ${item.sourceUrl}, then import that GGUF with an Ollama Modelfile.` };
    if (runtime === "LM Studio") return { runtime, command: `lms get ${artifact}  # or open the exact file link in LM Studio${q}` };
    if (runtime === "llama.cpp") return { runtime, command: `llama-cli -hf ${artifact} -p "Hello"` };
    return { runtime, command: `uvx mlx_lm.generate --model ${item.modelId} --prompt "Hello"` };
  });
}

export function rankArtifacts(artifacts: Artifact[], config: MacConfig): Recommendation[] {
  const profile = chipProfiles[config.chip];
  const eligible = artifacts.flatMap((item) => {
    const runtimes = runtimeEligibility(config, item);
    const memoryGb = estimateMemoryGb(item);
    if (!runtimes.length || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0 || item.sizeBytes > config.diskGb * 1e9 || memoryGb > config.memoryGb) return [];
    const tight = memoryGb > config.memoryGb * 0.82;
    const slow = memoryGb > config.memoryGb * 0.94;
    const notes: string[] = [];
    if (tight) notes.push("Tight memory: close other apps and use a modest context window.");
    if (slow) notes.push("May swap memory or run slowly at larger contexts.");
    if (item.gated) notes.push("Gated: accept the model licence and sign in to Hugging Face first.");
    const performance: Recommendation["performance"] = slow ? "Likely slow" : tight ? "Tight memory" : "Comfortable";
    const pace = expectedPace(profile, memoryGb);
    return [{ ...item, runtimes, memoryGb, performance, pace, notes, why: `${item.paramsB ? `${item.paramsB}B parameters` : "A current compact model"}; ${profile.name}'s ${profile.bandwidthGbps} GB/s memory bandwidth suggests ${pace.toLowerCase()} expected pace for this footprint${config.workload === "coding" ? ", with coding-oriented ranking" : ""}.`, guidance: buildGuidance(item, runtimes) }];
  });
  const grouped = new Map<string, Recommendation>();
  for (const item of eligible.sort((a, b) => modelScore(b, config, b.memoryGb) - modelScore(a, config, a.memoryGb))) {
    const key = item.modelId.replace(/-(GGUF|MLX|[Qq]\d[^/]*)$/i, "");
    if (!grouped.has(key)) grouped.set(key, item);
  }
  return [...grouped.values()].slice(0, 10);
}
