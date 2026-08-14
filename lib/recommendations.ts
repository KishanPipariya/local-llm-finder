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
  baseModel?: string;
  chatTemplate?: boolean;
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

export type WorkloadCategory = "coding-oriented" | "general chat" | "mixed" | "unknown";
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
const contextSurchargeGb: Record<ContextPreset, number> = { small: 0, normal: 0.25, long: 2 };
const contextLabels: Record<ContextPreset, string> = { small: "Small", normal: "Normal", long: "Long" };
const operationalDiskHeadroom = 1.2;

export function runtimeEligibility(config: MacConfig, artifact: Artifact): Recommendation["runtimes"] {
  if (artifact.format === "mlx") return ["MLX"];
  return ["llama.cpp", "LM Studio", "Ollama"];
}

export function estimateMemoryGb(artifact: Artifact, context: ContextPreset = "normal"): number {
  // File mapping plus KV/context/runtime overhead; deliberately conservative.
  // Keep a context surcharge additive so a large model does not make the
  // user's 4K, 16K, and 32K choices collapse to the same estimate.
  const sizeGb = artifact.sizeBytes / 1e9;
  const runtimeOverhead = Math.max(contextOverheadGb[context], sizeGb * 0.22) + contextSurchargeGb[context];
  return Math.round((sizeGb + runtimeOverhead + (artifact.paramsB ? Math.min(2.5, artifact.paramsB * 0.025) : 0)) * 10) / 10;
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
  return /(?:^|[^a-z])(?:code|coder|coding|programming)(?:$|[^a-z])/i.test(`${item.title} ${item.tags.join(" ")} ${item.pipelineTag ?? ""}`);
}

function isChatOriented(item: Artifact) {
  return item.chatTemplate === true
    || item.pipelineTag?.trim().toLowerCase() === "conversational"
    || /(?:^|[^a-z])(?:instruct|chat|assistant|conversation)(?:$|[^a-z])/i.test(`${item.title} ${item.tags.join(" ")}`);
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
  const coding = isCodingOriented(item);
  const chat = isChatOriented(item);
  if (coding && chat) return "mixed";
  if (coding) return "coding-oriented";
  if (chat) return "general chat";
  return "unknown";
}

function workloadRelevance(category: WorkloadCategory, workload: MacConfig["workload"]): string {
  if (workload === "balanced") {
    if (category === "mixed") return "Metadata suggests both chat and coding use.";
    if (category === "unknown") return "No strong chat or coding signal was available in the metadata.";
    return `Useful for a balanced shortlist; metadata suggests ${category}.`;
  }
  if (workload === "coding") {
    if (category === "coding-oriented") return "Metadata suggests coding-oriented use.";
    if (category === "mixed") return "Metadata suggests both coding and chat use.";
    return "Included as a general-purpose option; its metadata is not coding-oriented.";
  }
  return category === "coding-oriented" ? "Included for chat, though its metadata is coding-oriented." : category === "unknown" ? "Included for chat; the metadata has no strong workload signal." : "Metadata suggests general chat or mixed use.";
}

function familyKey(item: Artifact) {
  const seedSource = item.baseModel ?? item.modelId;
  const seed = seedSource.split("/").at(-1) ?? seedSource;
  return seed
    .replace(/(?:[-_.](?:GGUF|MLX|\d+bit|[Qq]\d[^/]*)|[-_.](?:f(?:16|32)|bf16))$/i, "")
    .replace(/[-_.]+$/, "")
    .toLowerCase();
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

function shellPath(variable: string, path: string) {
  return `"${variable}/"${shellQuote(path)}`;
}

function identitySuffix(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

function localModelName(item: Artifact) {
  const seed = `${item.modelId}-${item.filename ?? item.format}`
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `local-${(seed || "model").slice(0, 56)}-${identitySuffix(`${item.id}|${item.revision ?? "main"}`)}`;
}

export function buildGuidance(item: Artifact, runtimes: Recommendation["runtimes"]): Recommendation["guidance"] {
  const filename = item.filename ?? "model.gguf";
  const revisionOption = item.revision ? ` --revision ${shellQuote(item.revision)}` : "";
  const modelName = localModelName(item);
  const modelFile = shellPath("$workdir", filename);
  const modelDirectory = '"$workdir"';
  const modelfile = `printf '%s\\n' "FROM $workdir/"${shellQuote(filename)} > "$workdir/Modelfile"`;
  const hfDownload = `hf download ${shellQuote(item.modelId)}${item.filename ? ` ${shellQuote(item.filename)}` : ""}${revisionOption} --local-dir "$workdir"`;
  const curlDownload = item.filename
    ? `curl --fail --location --create-dirs ${shellQuote(item.sourceUrl)} --output ${modelFile}`
    : hfDownload;
  const ungatedDownload = item.format === "gguf" && !item.revision ? curlDownload : hfDownload;
  const setup = (authenticated: boolean, download: string) => `set -eu && workdir="$(mktemp -d)" && trap 'rm -rf "$workdir"' EXIT && ${authenticated ? `hf auth login && ${download}` : download}`;
  return runtimes.map((runtime) => {
    if (!item.gated) {
      if (runtime === "Ollama") return { runtime, command: `${setup(false, ungatedDownload)} && ${modelfile} && ollama create ${shellQuote(modelName)} -f "$workdir/Modelfile" && ollama run ${shellQuote(modelName)}` };
      if (runtime === "LM Studio") return { runtime, command: `${setup(false, ungatedDownload)} && lms import ${modelFile}` };
      if (runtime === "llama.cpp") return { runtime, command: `${setup(false, ungatedDownload)} && llama-cli -m ${modelFile} -p "Hello"` };
      return { runtime, command: `${setup(false, ungatedDownload)} && uvx --from mlx-lm mlx_lm.generate --model ${modelDirectory} --prompt "Hello"` };
    }
    if (runtime === "Ollama") return { runtime, command: `${setup(true, hfDownload)} && ${modelfile} && ollama create ${shellQuote(modelName)} -f "$workdir/Modelfile" && ollama run ${shellQuote(modelName)}` };
    if (runtime === "LM Studio") return { runtime, command: `${setup(true, hfDownload)} && lms import ${modelFile}` };
    if (runtime === "llama.cpp") return { runtime, command: `${setup(true, hfDownload)} && llama-cli -m ${modelFile} -p "Hello"` };
    return { runtime, command: `${setup(true, hfDownload)} && uvx --from mlx-lm mlx_lm.generate --model ${modelDirectory} --prompt "Hello"` };
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
    if (item.sizeBytes * operationalDiskHeadroom > config.diskGb * 1e9) { exclusions.insufficientDisk += 1; return []; }
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
    if (diskHeadroom / (config.diskGb * 1e9) < 0.25) notes.push("Near disk limit: only 20–25% free space remains after download; importing may need temporary disk space.");
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
  const ranked = [...grouped.values()];
  const familySeen = new Set<string>();
  const diverse: Recommendation[] = [];
  const deferred: Recommendation[] = [];
  for (const item of ranked) {
    if (familySeen.has(item.explanation.familyKey)) deferred.push(item);
    else {
      familySeen.add(item.explanation.familyKey);
      diverse.push(item);
    }
  }
  return { recommendations: [...diverse, ...deferred].slice(0, 10), exclusions };
}

export function rankArtifacts(artifacts: Artifact[], config: MacConfig, now = Date.now()): Recommendation[] {
  return rankArtifactsWithExplanations(artifacts, config, now).recommendations;
}
