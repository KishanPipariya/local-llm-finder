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
  /** URL retained for installation guidance: an exact GGUF file or MLX repository. */
  sourceUrl: string;
  /** Human-facing Hugging Face viewer URL; unlike sourceUrl, this must not download the artifact. */
  viewUrl?: string;
  /** Verified model context capacity when catalogue metadata supplies one. */
  maxContextTokens?: number;
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
    disk: { availableBytes: number; requiredBytes: number; headroomBytes: number; assumption: string };
    memory: { availableGb: number; headroomGb: number; assumption: string };
    context: { preset: ContextPreset; label: string; requestedTokens: number; maxTokens?: number };
    runtimes: Recommendation["runtimes"];
    runtimeAssumption: string;
    workload: { category: WorkloadCategory; relevance: string };
    pace: { bandwidthGbps: number; inputs: string };
  };
  rankingFactors: string[];
  familyKey: string;
};

export type ExclusionReason = "insufficientDisk" | "insufficientMemory" | "insufficientContext" | "invalidSize" | "unsupportedFormat" | "unsupportedArtifact";
export type ExclusionSummary = Record<ExclusionReason, number>;
export type RankingResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary };

const runtimeNames: Record<Runtime, Recommendation["runtimes"][number]> = { ollama: "Ollama", lmStudio: "LM Studio", llamaCpp: "llama.cpp", mlx: "MLX" };
const contextOverheadGb: Record<ContextPreset, number> = { small: 0.8, normal: 1.4, long: 3.2 };
const contextSurchargeGb: Record<ContextPreset, number> = { small: 0, normal: 0.25, long: 2 };
const contextLabels: Record<ContextPreset, string> = { small: "Small", normal: "Normal", long: "Long" };
const contextTokens: Record<ContextPreset, number> = { small: 4_096, normal: 16_384, long: 32_768 };
const downloadDiskHeadroom = 1.25;
const ollamaImportDiskHeadroom = 2.5;

function runtimeDiskHeadroomFactor(artifact: Artifact, runtime: Recommendation["runtimes"][number]) {
  // Ollama uploads the downloaded GGUF into its content-addressed model store
  // during `ollama create`, so the source and imported blob can coexist. Keep
  // the existing 20% reserve on top of that temporary second copy.
  return artifact.format === "gguf" && runtime === "Ollama"
    ? ollamaImportDiskHeadroom
    : downloadDiskHeadroom;
}

function diskHeadroomFactor(artifact: Artifact, runtimes: Recommendation["runtimes"]) {
  return Math.max(...runtimes.map((runtime) => runtimeDiskHeadroomFactor(artifact, runtime)));
}

function diskAssumption(artifact: Artifact, runtimes: Recommendation["runtimes"]) {
  return artifact.format === "gguf" && runtimes.includes("Ollama")
    ? "Download plus temporary Ollama import copy, with 20% free-space reserve."
    : "Download plus temporary working space, with 20% free-space reserve.";
}

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
  return capacity + pace + quantizationPreference(item) + work + recencyScore(item.updatedAt, now) + Math.min(12, Math.log10(Math.max(0, item.downloads) + 1) * 2);
}

function quantizationPreference(item: Artifact) {
  const quantization = item.quantization?.toUpperCase();
  if (!quantization) return 0;
  if (/^(?:I?Q)2/.test(quantization)) return 0;
  if (/^(?:I?Q)3/.test(quantization)) return 3;
  if (/^(?:I?Q)4/.test(quantization)) return 6;
  if (/^(?:I?Q)5/.test(quantization)) return 8;
  if (/^(?:I?Q)6/.test(quantization)) return 10;
  if (/^Q8/.test(quantization)) return 12;
  if (/^(?:BF16|F16|F32)$/.test(quantization)) return 14;
  return 0;
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
  return { insufficientDisk: 0, insufficientMemory: 0, insufficientContext: 0, invalidSize: 0, unsupportedFormat: 0, unsupportedArtifact: 0 };
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
  const temporaryModelFile = shellPath("$workdir", filename);
  const persistentModelFile = shellPath("$modeldir", filename);
  const persistentDirectory = `"$PWD/local-models/"${shellQuote(modelName)}`;
  const modelfile = `printf '%s\\n' "FROM $workdir/"${shellQuote(filename)} > "$workdir/Modelfile"`;
  const hf = item.format === "mlx" ? "uvx hf" : "hf";
  const hfDownload = (directory: "$workdir" | "$modeldir") => `${hf} download${revisionOption} --local-dir "${directory}" -- ${shellQuote(item.modelId)}${item.filename ? ` ${shellQuote(item.filename)}` : ""}`;
  const download = (directory: "$workdir" | "$modeldir", modelFile: string) => item.format === "gguf" && !item.gated && item.filename
    ? `curl --fail --location --create-dirs ${shellQuote(item.sourceUrl)} --output ${modelFile}`
    : hfDownload(directory);
  const authenticate = item.gated ? `${hf} auth login && ` : "";
  const temporarySetup = `set -eu && workdir="$(mktemp -d)" && trap 'rm -rf "$workdir"' EXIT && ${authenticate}${download("$workdir", temporaryModelFile)}`;
  const persistentSetup = `set -eu && modeldir=${persistentDirectory} && mkdir -p "$modeldir" && ${authenticate}${download("$modeldir", persistentModelFile)}`;
  return runtimes.map((runtime) => {
    if (runtime === "Ollama") return { runtime, command: `${temporarySetup} && ${modelfile} && ollama create ${shellQuote(modelName)} -f "$workdir/Modelfile" && ollama run ${shellQuote(modelName)}` };
    if (runtime === "LM Studio") return { runtime, command: `${temporarySetup} && lms import ${temporaryModelFile}` };
    if (runtime === "llama.cpp") return { runtime, command: `${persistentSetup} && llama-cli -m ${persistentModelFile} -p "Hello"` };
    return { runtime, command: `${persistentSetup} && uvx --from mlx-lm mlx_lm.generate --model "$modeldir" --prompt "Hello"` };
  });
}

export function rankArtifactsWithExplanations(artifacts: Artifact[], config: MacConfig, now = Date.now()): RankingResult {
  const profile = chipProfiles[config.chip];
  const selectedRuntime = config.runtime;
  const exclusions = emptyExclusions();
  const eligible = artifacts.flatMap((item) => {
    const availableRuntimes = runtimeEligibility(config, item);
    const requestedRuntimes = selectedRuntime ? availableRuntimes.filter((runtime) => runtime === runtimeNames[selectedRuntime]) : availableRuntimes;
    const context = config.context ?? "normal";
    const memoryGb = estimateMemoryGb(item, context);
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0) { exclusions.invalidSize += 1; return []; }
    if (!requestedRuntimes.length) { exclusions.unsupportedFormat += 1; return []; }
    const availableDiskBytes = config.diskGb * 1e9;
    const runtimes = requestedRuntimes.filter((runtime) => item.sizeBytes * runtimeDiskHeadroomFactor(item, runtime) <= availableDiskBytes);
    if (!runtimes.length) { exclusions.insufficientDisk += 1; return []; }
    const requiredDiskBytes = item.sizeBytes * diskHeadroomFactor(item, runtimes);
    if (memoryGb > config.memoryGb) { exclusions.insufficientMemory += 1; return []; }
    if (item.maxContextTokens !== undefined && item.maxContextTokens < contextTokens[context]) { exclusions.insufficientContext += 1; return []; }
    const tight = memoryGb > config.memoryGb * 0.82;
    const slow = memoryGb > config.memoryGb * 0.94;
    const notes: string[] = [];
    if (tight) notes.push("May be tight: close other apps before running this model.");
    if (slow) notes.push("May swap memory or run slowly with this context setting.");
    if (item.gated) notes.push(item.format === "mlx"
      ? "Gated: install uv/uvx, accept the model licence, and sign in to Hugging Face first."
      : "Gated: install Hugging Face's hf CLI, accept the model licence, and sign in first.");
    if (item.licence) notes.push(`Licence: ${item.licence}. Check its terms before use.`);
    const performance: Recommendation["performance"] = slow ? "Likely slow" : tight ? "Tight memory" : "Comfortable";
    const pace = expectedPace(profile, memoryGb);
    const category = workloadCategory(item);
    const diskHeadroom = Math.round((availableDiskBytes - requiredDiskBytes) / 1e6) * 1e6;
    const memoryHeadroom = Math.round((config.memoryGb - memoryGb) * 10) / 10;
    if (diskHeadroom / availableDiskBytes < 0.25) notes.push("Near disk limit: less than 25% reserve-adjusted disk headroom remains beyond the download/import estimate.");
    if (memoryHeadroom < 2) notes.push("Near memory limit: less than 2 GB of estimated unified-memory headroom remains.");
    const rankingFactors = [
      workloadRelevance(category, config.workload),
      item.paramsB ? `${item.paramsB}B parameter metadata contributes to capacity ranking.` : "Parameter metadata was unavailable, so download size is not treated as a capability signal.",
      item.maxContextTokens !== undefined ? `Catalogue metadata reports a maximum context of ${item.maxContextTokens.toLocaleString()} tokens.` : "Model context capacity was unavailable, so context fit is a memory estimate rather than a verified model limit.",
      item.quantization ? "Quantization precision receives a bounded preference among variants that fit; this is not a model-quality benchmark." : "No quantization metadata was available for a precision preference.",
      `${profile.name}'s ${profile.bandwidthGbps} GB/s memory bandwidth contributes to the qualitative pace estimate.`,
      "More recently updated catalogue entries receive a small, bounded freshness signal.",
      "Download count is used as a light popularity signal, not a quality benchmark.",
    ];
    return [{
      ...item,
      runtimes,
      memoryGb,
      performance,
      pace,
      notes,
      why: `${item.paramsB ? `${item.paramsB}B parameters` : "A current compact model"}; ${workloadRelevance(category, config.workload)} It leaves ${memoryHeadroom.toFixed(1)} GB of estimated memory headroom at the ${contextLabels[context].toLowerCase()} context preset.`,
      guidance: buildGuidance(item, runtimes),
      explanation: {
        fit: {
          disk: {
            availableBytes: availableDiskBytes,
            requiredBytes: requiredDiskBytes,
            headroomBytes: diskHeadroom,
            assumption: diskAssumption(item, runtimes),
          },
          memory: {
            availableGb: config.memoryGb,
            headroomGb: memoryHeadroom,
            assumption: `File mapping plus conservative runtime, ${contextLabels[context].toLowerCase()}-context, and KV-cache overhead.`,
          },
          context: {
            preset: context,
            label: contextLabels[context],
            requestedTokens: contextTokens[context],
            maxTokens: item.maxContextTokens,
          },
          runtimes,
          runtimeAssumption: "Runtime support is inferred from the artifact format; the model architecture is not verified against an installed runtime version.",
          workload: { category, relevance: workloadRelevance(category, config.workload) },
          pace: {
            bandwidthGbps: profile.bandwidthGbps,
            inputs: "Published family memory bandwidth relative to estimated model memory.",
          },
        },
        rankingFactors,
        familyKey: familyKey(item),
      },
    }];
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
