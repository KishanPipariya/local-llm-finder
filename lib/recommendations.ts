import { chipProfiles, type ChipProfile, type ContextPreset, type MacConfig, type Runtime } from "./hardware";

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
  /** Immutable Hugging Face commit revision when supplied by the catalogue. */
  revision?: string;
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
    context: { preset: ContextPreset; label: string };
    runtimes: Recommendation["runtimes"];
    workload: { category: WorkloadCategory; relevance: string };
    pace: { bandwidthGbps: number; inputs: string };
  };
  rankingFactors: string[];
  familyKey: string;
};

export type ExclusionReason = "insufficientDisk" | "insufficientMemory" | "invalidSize" | "unsupportedFormat" | "unsupportedArtifact";
export type ExclusionSummary = Record<ExclusionReason, number>;
export type RankingResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary };

const runtimeNames: Record<Runtime, Recommendation["runtimes"][number]> = { ollama: "Ollama", lmStudio: "LM Studio", llamaCpp: "llama.cpp", mlx: "MLX" };
const contextOverheadGb: Record<ContextPreset, number> = { small: 0.8, normal: 1.4, long: 3.2 };
const contextLabels: Record<ContextPreset, string> = { small: "Small", normal: "Normal", long: "Long" };

export function runtimeEligibility(config: MacConfig, artifact: Artifact): Recommendation["runtimes"] {
  if (artifact.format === "mlx") return ["MLX"];
  return ["llama.cpp", "LM Studio", "Ollama"];
}

export function estimateMemoryGb(artifact: Artifact, context: ContextPreset = "normal"): number {
  // File mapping plus KV/context/runtime overhead; deliberately conservative.
  const sizeGb = artifact.sizeBytes / 1e9;
  return Math.round((sizeGb + Math.max(contextOverheadGb[context], sizeGb * 0.22) + (artifact.paramsB ? Math.min(2.5, artifact.paramsB * 0.025) : 0)) * 10) / 10;
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
  return { insufficientDisk: 0, insufficientMemory: 0, invalidSize: 0, unsupportedFormat: 0, unsupportedArtifact: 0 };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function buildGuidance(item: Artifact, runtimes: Recommendation["runtimes"]): Recommendation["guidance"] {
  const filename = item.filename ?? "model.gguf";
  const revision = item.revision ?? "main";
  const localModelDirectory = item.modelId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const download = item.filename
    ? `hf download ${shellQuote(item.modelId)} ${shellQuote(item.filename)} --revision ${shellQuote(revision)} --local-dir .`
    : `hf download ${shellQuote(item.modelId)} --revision ${shellQuote(revision)} --local-dir ${shellQuote(localModelDirectory)}`;
  const authenticatedDownload = `hf auth login && ${download}`;
  const revisionPinnedDownload = item.revision ? download : undefined;
  return runtimes.map((runtime) => {
    if (!item.gated) {
      if (runtime === "Ollama") return { runtime, command: `curl --fail --location --create-dirs ${shellQuote(item.sourceUrl)} --output ${shellQuote(filename)} && printf '%s\\n' ${shellQuote(`FROM ./${filename}`)} > Modelfile && ollama create local-model -f Modelfile && ollama run local-model` };
      if (runtime === "LM Studio") return { runtime, command: `curl --fail --location --create-dirs ${shellQuote(item.sourceUrl)} --output ${shellQuote(filename)} && lms import ${shellQuote(filename)}` };
      if (runtime === "llama.cpp") return { runtime, command: revisionPinnedDownload ? `${revisionPinnedDownload} && llama-cli -m ${shellQuote(filename)} -p "Hello"` : `llama-cli --hf-repo ${shellQuote(item.modelId)}${item.filename ? ` --hf-file ${shellQuote(item.filename)}` : ""} -p "Hello"` };
      return { runtime, command: revisionPinnedDownload ? `${revisionPinnedDownload} && uvx --from mlx-lm mlx_lm.generate --model ${shellQuote(localModelDirectory)} --prompt "Hello"` : `uvx --from mlx-lm mlx_lm.generate --model ${shellQuote(item.modelId)} --prompt "Hello"` };
    }
    if (runtime === "Ollama") return { runtime, command: `${authenticatedDownload} && printf '%s\\n' ${shellQuote(`FROM ./${filename}`)} > Modelfile && ollama create local-model -f Modelfile && ollama run local-model` };
    if (runtime === "LM Studio") return { runtime, command: `${authenticatedDownload} && lms import ${shellQuote(filename)}` };
    if (runtime === "llama.cpp") return { runtime, command: `${authenticatedDownload} && llama-cli -m ${shellQuote(filename)} -p "Hello"` };
    return { runtime, command: `${authenticatedDownload} && uvx --from mlx-lm mlx_lm.generate --model ${shellQuote(localModelDirectory)} --prompt "Hello"` };
  });
}

export function rankArtifactsWithExplanations(artifacts: Artifact[], config: MacConfig, now = Date.now()): RankingResult {
  const profile = chipProfiles[config.chip];
  const selectedRuntime = config.runtime;
  const exclusions = emptyExclusions();
  const eligible = artifacts.flatMap((item) => {
    const availableRuntimes = runtimeEligibility(config, item);
    const runtimes = selectedRuntime ? availableRuntimes.filter((runtime) => runtime === runtimeNames[selectedRuntime]) : availableRuntimes;
    const context = config.context ?? "normal";
    const memoryGb = estimateMemoryGb(item, context);
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0) { exclusions.invalidSize += 1; return []; }
    if (!runtimes.length) { exclusions.unsupportedFormat += 1; return []; }
    if (item.sizeBytes > config.diskGb * 1e9) { exclusions.insufficientDisk += 1; return []; }
    if (memoryGb > config.memoryGb) { exclusions.insufficientMemory += 1; return []; }
    const tight = memoryGb > config.memoryGb * 0.82;
    const slow = memoryGb > config.memoryGb * 0.94;
    const notes: string[] = [];
    if (tight) notes.push("May be tight: close other apps before running this model.");
    if (slow) notes.push("May swap memory or run slowly with this context setting.");
    if (item.gated) notes.push("Gated: accept the model licence and sign in to Hugging Face first.");
    if (item.licence) notes.push(`Licence: ${item.licence}. Check its terms before use.`);
    const performance: Recommendation["performance"] = slow ? "Likely slow" : tight ? "Tight memory" : "Comfortable";
    const pace = expectedPace(profile, memoryGb);
    const category = workloadCategory(item);
    const diskHeadroom = Math.round((config.diskGb * 1e9 - item.sizeBytes) / 1e6) * 1e6;
    const memoryHeadroom = Math.round((config.memoryGb - memoryGb) * 10) / 10;
    if (diskHeadroom / (config.diskGb * 1e9) < 0.2) notes.push("Near disk limit: less than 20% free space remains after download; importing may need temporary disk space.");
    if (memoryHeadroom < 2) notes.push("Near memory limit: less than 2 GB of estimated unified-memory headroom remains.");
    const rankingFactors = [
      workloadRelevance(category, config.workload),
      item.paramsB ? `${item.paramsB}B parameter metadata contributes to capacity ranking.` : "Parameter metadata was unavailable, so download size is not treated as a capability signal.",
      `${profile.name}'s ${profile.bandwidthGbps} GB/s memory bandwidth contributes to the qualitative pace estimate.`,
      "More recently updated catalogue entries receive a small, bounded freshness signal.",
      "Download count is used as a light popularity signal, not a quality benchmark.",
    ];
    return [{ ...item, runtimes, memoryGb, performance, pace, notes, why: `${item.paramsB ? `${item.paramsB}B parameters` : "A current compact model"}; ${workloadRelevance(category, config.workload)} It leaves ${memoryHeadroom.toFixed(1)} GB of estimated memory headroom at the ${contextLabels[context].toLowerCase()} context preset.`, guidance: buildGuidance(item, runtimes), explanation: { fit: { disk: { availableBytes: config.diskGb * 1e9, headroomBytes: diskHeadroom }, memory: { availableGb: config.memoryGb, headroomGb: memoryHeadroom, assumption: `File mapping plus conservative runtime, ${contextLabels[context].toLowerCase()}-context, and KV-cache overhead.` }, context: { preset: context, label: contextLabels[context] }, runtimes, workload: { category, relevance: workloadRelevance(category, config.workload) }, pace: { bandwidthGbps: profile.bandwidthGbps, inputs: "Published family memory bandwidth relative to estimated model memory." } }, rankingFactors, familyKey: familyKey(item) } }];
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
