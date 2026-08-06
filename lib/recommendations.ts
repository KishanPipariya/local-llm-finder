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
  pipelineTag?: string;
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
  explanation: RecommendationExplanation;
};

export type WorkloadCategory = "coding-oriented" | "general chat" | "mixed";
export type RecommendationExplanation = {
  fit: {
    disk: { availableBytes: number; headroomBytes: number };
    memory: { availableGb: number; headroomGb: number; assumption: string };
    runtimes: Recommendation["runtimes"];
    workload: { category: WorkloadCategory; relevance: string };
    pace: { bandwidthGbps: number; inputs: string };
  };
  rankingFactors: string[];
  familyKey: string;
};

export type ExclusionReason = "insufficientDisk" | "insufficientMemory" | "invalidSize" | "unsupportedFormat";
export type ExclusionSummary = Record<ExclusionReason, number>;
export type RankingResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary };

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

function modelScore(item: Artifact, config: MacConfig, memoryGb: number, now: number): number {
  const work = taskRelevanceScore(item, config.workload);
  // Artifact size is a quantization/download property, not a parameter count.
  // Do not turn missing parameter metadata into an unsupported capability claim.
  const capacity = item.paramsB ? Math.min(35, Math.log2(item.paramsB + 1) * 8) : 0;
  const pace = Math.min(45, Math.log2(chipProfiles[config.chip].bandwidthGbps / memoryGb + 1) * 10);
  return capacity + pace + work + recencyScore(item.updatedAt, now) + Math.min(12, Math.log10(Math.max(0, item.downloads) + 1) * 2);
}

function isCodingOriented(item: Artifact) {
  return /(?:^|[^a-z])(?:code|coder|coding|programming)(?:$|[^a-z])/i.test(taskMetadata(item));
}

function taskMetadata(item: Artifact) {
  return `${item.title} ${item.tags.join(" ")} ${item.pipelineTag ?? ""}`;
}

function isChatOriented(item: Artifact) {
  return /(?:^|[^a-z])(?:instruct|chat|assistant|conversation|text-generation|text2text-generation)(?:$|[^a-z])/i.test(taskMetadata(item));
}

function taskRelevanceScore(item: Artifact, workload: MacConfig["workload"]) {
  const coding = isCodingOriented(item);
  const chat = isChatOriented(item);
  if (workload === "coding") return coding ? 36 : chat ? 8 : 0;
  if (workload === "chat") return chat ? 24 : coding ? 4 : 0;
  return coding && chat ? 20 : coding || chat ? 14 : 0;
}

function recencyScore(updatedAt: string, now: number) {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return 0;
  const ageDays = Math.max(0, (now - updated) / (24 * 60 * 60 * 1000));
  return Math.max(0, 6 * (1 - ageDays / 730));
}

function workloadCategory(item: Artifact): WorkloadCategory {
  if (isCodingOriented(item)) return "coding-oriented";
  if (isChatOriented(item)) return "general chat";
  return "mixed";
}

function workloadRelevance(category: WorkloadCategory, workload: MacConfig["workload"]): string {
  if (workload === "balanced") return category === "mixed" ? "A balanced metadata signal for chat and coding." : `Useful for a balanced shortlist; metadata suggests ${category}.`;
  if (workload === "coding") return category === "coding-oriented" ? "Metadata suggests coding-oriented use." : "Included as a general-purpose option; its metadata is not coding-oriented.";
  return category === "coding-oriented" ? "Included for chat, though its metadata is coding-oriented." : "Metadata suggests general chat or mixed use.";
}

function familyKey(item: Artifact) {
  return item.modelId.replace(/-(GGUF|MLX|[Qq]\d[^/]*)$/i, "");
}

function variantKey(item: Recommendation) {
  return `${item.explanation.familyKey}|${item.format}|${item.quantization ?? item.filename ?? item.id}`;
}

function compareArtifactIdentity(a: Artifact, b: Artifact) {
  return a.id.localeCompare(b.id)
    || a.modelId.localeCompare(b.modelId)
    || a.format.localeCompare(b.format)
    || (a.filename ?? "").localeCompare(b.filename ?? "");
}

function emptyExclusions(): ExclusionSummary {
  return { insufficientDisk: 0, insufficientMemory: 0, invalidSize: 0, unsupportedFormat: 0 };
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

export function rankArtifactsWithExplanations(artifacts: Artifact[], config: MacConfig, now = Date.now()): RankingResult {
  const profile = chipProfiles[config.chip];
  const exclusions = emptyExclusions();
  const eligible = artifacts.flatMap((item) => {
    const runtimes = runtimeEligibility(config, item);
    const memoryGb = estimateMemoryGb(item);
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0) { exclusions.invalidSize += 1; return []; }
    if (!runtimes.length) { exclusions.unsupportedFormat += 1; return []; }
    if (item.sizeBytes > config.diskGb * 1e9) { exclusions.insufficientDisk += 1; return []; }
    if (memoryGb > config.memoryGb) { exclusions.insufficientMemory += 1; return []; }
    const tight = memoryGb > config.memoryGb * 0.82;
    const slow = memoryGb > config.memoryGb * 0.94;
    const notes: string[] = [];
    if (tight) notes.push("Tight memory: close other apps and use a modest context window.");
    if (slow) notes.push("May swap memory or run slowly at larger contexts.");
    if (item.gated) notes.push("Gated: accept the model licence and sign in to Hugging Face first.");
    const performance: Recommendation["performance"] = slow ? "Likely slow" : tight ? "Tight memory" : "Comfortable";
    const pace = expectedPace(profile, memoryGb);
    const category = workloadCategory(item);
    const diskHeadroom = Math.round((config.diskGb * 1e9 - item.sizeBytes) / 1e6) * 1e6;
    const memoryHeadroom = Math.round((config.memoryGb - memoryGb) * 10) / 10;
    const rankingFactors = [
      workloadRelevance(category, config.workload),
      item.paramsB ? `${item.paramsB}B parameter metadata contributes to capacity ranking.` : "Parameter metadata was unavailable, so download size is not treated as a capability signal.",
      `${profile.name}'s ${profile.bandwidthGbps} GB/s memory bandwidth contributes to the qualitative pace estimate.`,
      "More recently updated catalogue entries receive a small, bounded freshness signal.",
      "Download count is used as a light popularity signal, not a quality benchmark.",
    ];
    return [{ ...item, runtimes, memoryGb, performance, pace, notes, why: `${item.paramsB ? `${item.paramsB}B parameters` : "A current compact model"}; ${workloadRelevance(category, config.workload)} ${profile.name}'s ${profile.bandwidthGbps} GB/s memory bandwidth suggests ${pace.toLowerCase()} expected pace for this footprint.`, guidance: buildGuidance(item, runtimes), explanation: { fit: { disk: { availableBytes: config.diskGb * 1e9, headroomBytes: diskHeadroom }, memory: { availableGb: config.memoryGb, headroomGb: memoryHeadroom, assumption: "File mapping plus conservative runtime, 4k-context, and KV-cache overhead." }, runtimes, workload: { category, relevance: workloadRelevance(category, config.workload) }, pace: { bandwidthGbps: profile.bandwidthGbps, inputs: "Published family memory bandwidth relative to estimated model memory." } }, rankingFactors, familyKey: familyKey(item) } }];
  });
  const grouped = new Map<string, Recommendation>();
  for (const item of eligible.sort((a, b) => {
    const scoreDifference = modelScore(b, config, b.memoryGb, now) - modelScore(a, config, a.memoryGb, now);
    return scoreDifference || compareArtifactIdentity(a, b);
  })) {
    const key = variantKey(item);
    if (!grouped.has(key)) grouped.set(key, item);
  }
  return { recommendations: [...grouped.values()].slice(0, 10), exclusions };
}

export function rankArtifacts(artifacts: Artifact[], config: MacConfig, now = Date.now()): Recommendation[] {
  return rankArtifactsWithExplanations(artifacts, config, now).recommendations;
}
