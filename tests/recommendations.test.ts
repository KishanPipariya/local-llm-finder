import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildGuidance, estimateMemoryGb, rankArtifacts, rankArtifactsWithExplanations, runtimeEligibility, type Artifact } from "../lib/recommendations";
import { chipProfiles, runtimes, validateConfig, type MacConfig } from "../lib/hardware";
import { CatalogueCache, isFresh } from "../lib/catalogue-cache";
import { normalizationExclusions, normalizeModels, REFRESH_TIMEOUT_MS, retrieveCatalogue } from "../lib/catalogue";
import { createPostHandler } from "../app/api/recommendations/route";
import { CatalogueUnavailableError } from "../lib/recommendation-service";

const mac: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 12, workload: "coding" };
const gguf: Artifact = { id: "org/Coder-7B-GGUF/model.Q4_K_M.gguf", modelId: "org/Coder-7B-GGUF", title: "Coder 7B", format: "gguf", sizeBytes: 5_000_000_000, sizeGb: 5, paramsB: 7, downloads: 3000, updatedAt: "2026-08-01T00:00:00Z", gated: false, tags: ["code"], repositoryUrl: "https://huggingface.co/org/Coder-7B-GGUF", sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF/resolve/main/model.Q4_K_M.gguf", filename: "model.Q4_K_M.gguf" };
const mlx: Artifact = { ...gguf, id: "mlx-community/Coder-7B-4bit", modelId: "mlx-community/Coder-7B-4bit", format: "mlx", sizeBytes: 4_500_000_000, sizeGb: 4.5, filename: undefined };

test("accepts every chip's supported memory options and rejects impossible pairs", () => {
  for (const [chip, profile] of Object.entries(chipProfiles)) {
    for (const memoryGb of profile.memoryOptionsGb) assert.equal(validateConfig({ ...mac, chip, memoryGb }).valid, true, `${chip} / ${memoryGb} GB`);
  }
  assert.equal(validateConfig({ ...mac, chip: "m4Pro", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: "m6", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: { family: "m4" }, memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, diskGb: 0 }).valid, false);
});
test("uses conservative lower-bound bandwidth for configurable Max variants", () => {
  assert.equal(chipProfiles.m3Max.bandwidthGbps, 300);
  assert.equal(chipProfiles.m4Max.bandwidthGbps, 410);
  assert.equal(chipProfiles.m5Max.bandwidthGbps, 460);
});
test("returns typed field errors while preserving the API error list", () => {
  const invalid = validateConfig({ chip: "m4Pro", memoryGb: 16, diskGb: 0, workload: "other" });
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.fieldErrors.memoryGb, "Choose a memory configuration supported by that chip.");
    assert.equal(invalid.fieldErrors.diskGb, "Free disk space must be between 1 and 4,000 GB.");
    assert.deepEqual(invalid.errors, Object.values(invalid.fieldErrors));
  }
});
test("makes Apple Silicon runtimes available in preferred display order", () => { assert.deepEqual(runtimes, ["llamaCpp", "mlx", "lmStudio", "ollama"]); assert.deepEqual(runtimeEligibility(mac, mlx), ["MLX"]); assert.deepEqual(runtimeEligibility(mac, gguf), ["llama.cpp", "LM Studio", "Ollama"]); });
test("filters artifacts to a chosen runtime while requests without a runtime remain neutral", () => {
  assert.deepEqual(rankArtifacts([gguf, mlx], { ...mac, runtime: "mlx" }).map((item) => item.format), ["mlx"]);
  assert.deepEqual(rankArtifacts([gguf, mlx], { ...mac, runtime: "ollama" }).map((item) => item.format), ["gguf"]);
  assert.deepEqual(rankArtifacts([gguf, mlx], mac).map((item) => item.format).sort(), ["gguf", "mlx"]);
  assert.equal(rankArtifacts([gguf], { ...mac, runtime: "ollama" })[0].guidance.length, 1);
});
test("context presets increase conservative memory use and can exclude a former fit", () => {
  const contextSensitive = { ...gguf, sizeBytes: 12_900_000_000, sizeGb: 12.9, paramsB: undefined };
  const small = rankArtifacts([contextSensitive], { ...mac, memoryGb: 16, diskGb: 20, context: "small" })[0];
  const long = rankArtifacts([contextSensitive], { ...mac, memoryGb: 16, diskGb: 20, context: "long" });
  assert.ok(small.memoryGb < 16);
  assert.equal(long.length, 0);
  assert.equal(small.explanation.fit.memory.headroomGb, Math.round((16 - small.memoryGb) * 10) / 10);
  assert.equal(small.explanation.fit.context.preset, "small");
});
test("context presets continue to change estimates for large artifacts", () => {
  const large = { ...gguf, sizeBytes: 40_000_000_000, sizeGb: 40, paramsB: undefined };
  const small = estimateMemoryGb(large, "small");
  const normal = estimateMemoryGb(large, "normal");
  const long = estimateMemoryGb(large, "long");
  assert.ok(small < normal && normal < long);
});
test("validates optional runtime and context preferences without requiring them for legacy callers", () => {
  assert.equal(validateConfig(mac).valid, true);
  assert.equal(validateConfig({ ...mac, runtime: "other" }).valid, false);
  assert.equal(validateConfig({ ...mac, context: "huge" }).valid, false);
});
test("enforces operational disk headroom and estimates from exact bytes", () => { assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 6.249999999 }).length, 0); assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 6.25 }).length, 1); assert.ok(estimateMemoryGb({ ...gguf, sizeGb: 1 }) > 5); });
test("ranks coding models and carries gated and licence warnings plus runtime commands", () => { const generic = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", paramsB: 8, tags: [] }; const gated = { ...gguf, gated: true, licence: "apache-2.0" }; const ranked = rankArtifacts([generic, gated], mac); assert.equal(ranked[0].title, "Coder 7B"); assert.ok(ranked[0].notes.some((note) => note.startsWith("Gated"))); assert.ok(ranked[0].notes.some((note) => note.startsWith("Licence: apache-2.0"))); assert.ok(ranked[0].guidance.some((g) => g.runtime === "llama.cpp" && g.command.includes("hf auth login") && g.command.includes("-m"))); });
test("uses Hugging Face task metadata as a bounded workload preference", () => {
  const coding = { ...gguf, id: "org/Code-GGUF/file.gguf", modelId: "org/Code-GGUF", title: "Plain model", tags: ["coding"], pipelineTag: undefined };
  const chat = { ...gguf, id: "org/Chat-GGUF/file.gguf", modelId: "org/Chat-GGUF", title: "Plain model", tags: ["chat"], pipelineTag: "text2text-generation" };
  const unknown = { ...gguf, id: "org/Unknown-GGUF/file.gguf", modelId: "org/Unknown-GGUF", title: "Plain model", tags: [], pipelineTag: undefined };
  assert.equal(rankArtifacts([unknown, chat, coding], { ...mac, workload: "coding" }, Date.parse("2026-08-06T00:00:00Z"))[0].id, coding.id);
  assert.equal(rankArtifacts([unknown, coding, chat], { ...mac, workload: "chat" }, Date.parse("2026-08-06T00:00:00Z"))[0].id, chat.id);
  assert.equal(rankArtifacts([unknown], mac, Date.parse("2026-08-06T00:00:00Z")).length, 1, "manually supplied artifacts without task metadata remain neutral");
});
test("does not treat generic text generation as chat suitability", () => {
  const coding = { ...gguf, id: "org/Coder-GGUF/file.gguf", modelId: "org/Coder-GGUF", title: "Coder", tags: ["code"], pipelineTag: "text-generation" };
  const chat = { ...gguf, id: "org/Assistant-GGUF/file.gguf", modelId: "org/Assistant-GGUF", title: "Assistant", tags: [], pipelineTag: "text-generation" };
  const ranked = rankArtifacts([coding, chat], { ...mac, workload: "chat" }, Date.parse("2026-08-06T00:00:00Z"));
  assert.equal(ranked[0].id, chat.id);
  assert.equal(ranked.find((item) => item.id === coding.id)?.explanation.fit.workload.category, "coding-oriented");
});
test("recognizes explicit conversational and chat-template metadata", () => {
  const conversational = { ...gguf, title: "Plain model", tags: [], pipelineTag: "conversational" };
  const templated = { ...gguf, id: "org/Template-GGUF/model.gguf", modelId: "org/Template-GGUF", title: "Plain model", tags: [], pipelineTag: "text-generation", chatTemplate: true };
  assert.equal(rankArtifacts([conversational], { ...mac, workload: "balanced" })[0].explanation.fit.workload.category, "general chat");
  assert.equal(rankArtifacts([templated], { ...mac, workload: "balanced" })[0].explanation.fit.workload.category, "general chat");
});
test("keeps malformed update timestamps neutral", () => {
  const malformed = { ...gguf, updatedAt: "not-a-date" };
  assert.equal(rankArtifacts([malformed], mac)[0].explanation.rankingFactors.some((factor) => factor.includes("freshness")), true);
});
test("explains combined and unknown workload metadata accurately", () => {
  const unknown = { ...gguf, id: "org/Unknown-GGUF/file.gguf", modelId: "org/Unknown-GGUF", title: "Unknown", tags: [], pipelineTag: undefined };
  const combined = { ...gguf, id: "org/Combined-GGUF/file.gguf", modelId: "org/Combined-GGUF", title: "Combined", tags: ["coding", "chat"], pipelineTag: undefined };
  const unknownResult = rankArtifacts([unknown], { ...mac, workload: "balanced" })[0];
  const combinedResult = rankArtifacts([combined], { ...mac, workload: "balanced" })[0];
  const combinedCodingResult = rankArtifacts([combined], { ...mac, workload: "coding" })[0];
  assert.equal(unknownResult.explanation.fit.workload.category, "unknown");
  assert.match(unknownResult.explanation.fit.workload.relevance, /no strong chat or coding signal/i);
  assert.equal(combinedResult.explanation.fit.workload.category, "mixed");
  assert.match(combinedResult.explanation.fit.workload.relevance, /both chat and coding/i);
  assert.match(combinedCodingResult.explanation.fit.workload.relevance, /both coding and chat/i);
});
test("keeps fit tied to memory but changes pace and ranking by chip bandwidth", () => {
  const compact: Artifact = { ...gguf, id: "org/Chat-3B-GGUF", modelId: "org/Chat-3B-GGUF", title: "Chat 3B", sizeBytes: 2_000_000_000, sizeGb: 2, paramsB: 3, tags: [] };
  const larger: Artifact = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", sizeBytes: 6_000_000_000, sizeGb: 6, paramsB: 8, tags: [] };
  const lowBandwidth = rankArtifacts([compact, larger], { ...mac, chip: "m1", memoryGb: 16, workload: "balanced" });
  const highBandwidth = rankArtifacts([compact, larger], { ...mac, chip: "m5", memoryGb: 16, workload: "balanced" });
  assert.equal(lowBandwidth.length, 2);
  assert.equal(highBandwidth.length, 2);
  assert.equal(lowBandwidth.find((item) => item.id === compact.id)?.performance, highBandwidth.find((item) => item.id === compact.id)?.performance);
  assert.equal(lowBandwidth.find((item) => item.id === compact.id)?.pace, "Moderate");
  assert.equal(highBandwidth.find((item) => item.id === compact.id)?.pace, "Fast");
  assert.equal(lowBandwidth[0].title, "Chat 3B");
  assert.equal(highBandwidth[0].title, "Chat 8B");
});
test("names the exact GGUF file in links and runtime guidance", () => {
  const recommendation = rankArtifacts([gguf], mac)[0];
  assert.equal(recommendation.sourceUrl, gguf.sourceUrl);
  assert.equal(recommendation.viewUrl, undefined, "hand-built fixtures without a viewer URL fall back to the repository");
  const llama = recommendation.guidance.find((guide) => guide.runtime === "llama.cpp")!.command;
  assert.match(llama, /curl --fail --location --create-dirs 'https:\/\/huggingface\.co\/org\/Coder-7B-GGUF\/resolve\/main\/model\.Q4_K_M\.gguf'/);
  assert.match(llama, /--output \"\$workdir\/\"'model\.Q4_K_M\.gguf'/);
  assert.doesNotMatch(llama, /--hf-repo/);
});

test("shell-quotes catalogue filenames and keeps nested paths usable", () => {
  const hostile = { ...gguf, filename: "nested/a'; printf INJECTED; 'b.gguf", sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF/resolve/main/nested/a%27%3B%20printf%20INJECTED%3B%20%27b.gguf" };
  for (const runtime of ["Ollama", "LM Studio"] as const) {
    const command = buildGuidance(hostile, [runtime])[0].command;
    assert.match(command, /curl --fail --location --create-dirs/);
    assert.match(command, /a'\"'\"'; printf INJECTED; '\"'\"'b\.gguf/);
    assert.match(command, /mktemp -d/);
    assert.match(command, /trap 'rm -rf \"\$workdir\"' EXIT/);
    assert.equal(spawnSync("sh", ["-n", "-c", command]).status, 0, `${runtime} guidance remains valid shell syntax`);
  }
});
test("uses Hugging Face GGUF import guidance for Ollama", () => {
  const guidance = buildGuidance(gguf, ["Ollama"])[0].command;
  assert.ok(guidance.includes(gguf.sourceUrl));
  assert.match(guidance, /ollama create 'local-/);
  assert.match(guidance, /ollama run 'local-/);
  assert.doesNotMatch(guidance, /ollama pull/);
  assert.doesNotMatch(guidance, /> Modelfile/);
});
test("uses exact-file LM Studio and mlx-lm installation guidance", () => {
  const lmStudio = buildGuidance(gguf, ["LM Studio"])[0].command;
  assert.match(lmStudio, /curl --fail --location --create-dirs/);
  assert.match(lmStudio, /lms import \"\$workdir\/\"'model\.Q4_K_M\.gguf'/);
  assert.doesNotMatch(lmStudio, /lms get/);

  const mlxGuidance = buildGuidance(mlx, ["MLX"])[0].command;
  assert.match(mlxGuidance, /uvx --from mlx-lm mlx_lm\.generate/);
});

test("pins ungated llama.cpp and MLX downloads to the catalogue revision", () => {
  const pinnedGguf = { ...gguf, revision: "9f4d7c1" };
  const llama = buildGuidance(pinnedGguf, ["llama.cpp"])[0].command;
  assert.match(llama, /hf download 'org\/Coder-7B-GGUF' 'model\.Q4_K_M\.gguf' --revision '9f4d7c1'/);
  assert.match(llama, /llama-cli -m \"\$workdir\/\"'model\.Q4_K_M\.gguf'/);
  assert.doesNotMatch(llama, /--hf-repo/);

  const pinnedMlx = { ...mlx, revision: "a1b2c3" };
  const mlxGuidance = buildGuidance(pinnedMlx, ["MLX"])[0].command;
  assert.match(mlxGuidance, /hf download 'mlx-community\/Coder-7B-4bit' --revision 'a1b2c3'/);
  assert.match(mlxGuidance, /--local-dir \"\$workdir\"/);
  assert.match(mlxGuidance, /--model \"\$workdir\"/);
});
test("uses authenticated exact-revision downloads for gated artifacts", () => {
  const gated = { ...gguf, gated: true, revision: "9f4d7c1" };
  const ollama = buildGuidance(gated, ["Ollama"])[0].command;
  assert.match(ollama, /hf auth login/);
  assert.match(ollama, /hf download 'org\/Coder-7B-GGUF' 'model\.Q4_K_M\.gguf' --revision '9f4d7c1'/);
  assert.match(ollama, /ollama create 'local-/);
  assert.doesNotMatch(ollama, /curl -L/);

  const gatedMlx = buildGuidance({ ...mlx, gated: true, revision: "a1b2c3" }, ["MLX"])[0].command;
  assert.match(gatedMlx, /hf auth login/);
  assert.match(gatedMlx, /hf download 'mlx-community\/Coder-7B-4bit' --revision 'a1b2c3'/);
  assert.match(gatedMlx, /mlx_lm\.generate/);
});

test("ignores parameter metadata that is implausible for the artifact size", () => {
  const spoofed = normalizeModels([{ id: "new/Definitely-Coder-999B-GGUF", downloads: 0, lastModified: "2026-08-14T00:00:00Z", pipeline_tag: "text-generation", cardData: { params: "999B" }, siblings: [{ rfilename: "model.Q4.gguf", size: 100_000_000 }] }], "gguf")[0];
  assert.equal(spoofed.paramsB, undefined);
  const real = normalizeModels([{ id: "org/Real-Coder-7B-GGUF", downloads: 100_000, lastModified: "2026-08-14T00:00:00Z", pipeline_tag: "text-generation", cardData: { params: "7B" }, siblings: [{ rfilename: "model.Q4.gguf", size: 5_000_000_000 }] }], "gguf")[0];
  assert.equal(rankArtifacts([spoofed, real], { ...mac, diskGb: 10 }, Date.parse("2026-08-14T00:00:00Z"))[0].title, "Real-Coder-7B");
});
test("keeps non-gated runtime guidance unchanged", () => {
  assert.doesNotMatch(buildGuidance(gguf, ["Ollama"])[0].command, /hf auth login/);
  assert.doesNotMatch(buildGuidance(mlx, ["MLX"])[0].command, /hf auth login/);
});
test("warns about near disk and memory limits without changing eligibility", () => {
  const diskNearLimit = rankArtifacts([{ ...gguf, sizeBytes: 9_000_000_000, sizeGb: 9 }], { ...mac, diskGb: 11.5, memoryGb: 16 })[0];
  assert.ok(diskNearLimit.notes.some((note) => note.startsWith("Near disk limit")));
  const memoryNearLimit = rankArtifacts([{ ...gguf, sizeBytes: 12_000_000_000, sizeGb: 12, paramsB: undefined }], { ...mac, diskGb: 20, memoryGb: 16 })[0];
  assert.ok(memoryNearLimit, "an artifact below the existing memory threshold remains eligible");
  assert.ok(memoryNearLimit.notes.some((note) => note.startsWith("Near memory limit")));
});
test("returns typed fit explanations and actionable exclusion categories", () => {
  const tooLarge = { ...gguf, id: "org/Large-GGUF/file.gguf", modelId: "org/Large-GGUF", sizeBytes: 17_000_000_000, sizeGb: 17 };
  const tooHungry = { ...gguf, id: "org/Memory-GGUF/file.gguf", modelId: "org/Memory-GGUF", sizeBytes: 14_500_000_000, sizeGb: 14.5, paramsB: 100 };
  const invalid = { ...gguf, id: "org/Invalid-GGUF/file.gguf", modelId: "org/Invalid-GGUF", sizeBytes: 0, sizeGb: 0 };
  const result = rankArtifactsWithExplanations([gguf, tooLarge, tooHungry, invalid], { ...mac, diskGb: 20 });
  assert.equal(result.exclusions.insufficientDisk, 1);
  assert.equal(result.exclusions.insufficientMemory, 1);
  assert.equal(result.exclusions.insufficientContext, 0);
  assert.equal(result.exclusions.invalidSize, 1);
  assert.equal(result.recommendations[0].explanation.fit.disk.availableBytes, 20_000_000_000);
  assert.equal(result.recommendations[0].explanation.fit.memory.assumption.includes("normal-context"), true);
  assert.equal(result.recommendations[0].explanation.fit.workload.category, "coding-oriented");
  assert.ok(result.recommendations[0].explanation.rankingFactors.length >= 3);
});
test("normalizes exact GGUF and aggregate MLX artifact sizes", () => {
  const model = { id: "org/Test-GGUF", sha: "immutable-revision", pipeline_tag: "text-generation", config: { max_position_embeddings: 32768 }, siblings: [{ rfilename: "large.Q8.gguf", size: 8_000_000_000 }, { rfilename: "small.Q4_K_M.gguf", size: 4_000_000_001 }, { rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "config.json", size: 12_000 }, { rfilename: "tokenizer.json", size: 8_000 }, { rfilename: "README.md", size: 900_000_000 }] };
  const ggufArtifacts = normalizeModels([model], "gguf"); const mlxArtifact = normalizeModels([model], "mlx")[0];
  assert.deepEqual(ggufArtifacts.map((artifact) => [artifact.filename, artifact.quantization, artifact.sizeBytes]), [["small.Q4_K_M.gguf", "Q4_K_M", 4_000_000_001], ["large.Q8.gguf", "Q8", 8_000_000_000]]);
  assert.equal(mlxArtifact.sizeBytes, 15_900_020_001);
  assert.equal(ggufArtifacts[0].pipelineTag, "text-generation");
  assert.equal(ggufArtifacts[0].revision, "immutable-revision");
  assert.equal(ggufArtifacts[0].viewUrl, "https://huggingface.co/org/Test-GGUF/blob/immutable-revision/small.Q4_K_M.gguf");
  assert.equal(ggufArtifacts[0].maxContextTokens, 32768);
  assert.equal(normalizeModels([{ id: "org/bad", siblings: [{ rfilename: "tiny.gguf", size: 1 }] }], "gguf").length, 0);
  assert.equal(normalizeModels([{ id: "org/unknown-tokenizer", siblings: [{ rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "tokenizer.json" }] }], "mlx").length, 0);
  assert.equal(normalizeModels([{ id: "org/unknown-extra", siblings: [{ rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "unrecognised.bin" }] }], "mlx").length, 0);
  assert.equal(normalizeModels([{ id: "org/config-only", siblings: [{ rfilename: "config.json", size: 120_000_000 }, { rfilename: "tokenizer.json", size: 1_000 }] }], "mlx").length, 0);
});
test("keeps multiple GGUF quantization variants from one model family", () => {
  const q4 = { ...gguf, quantization: "Q4_K_M" };
  const q8 = { ...gguf, id: "org/Coder-7B-GGUF/model.Q8_0.gguf", filename: "model.Q8_0.gguf", quantization: "Q8_0", sizeBytes: 8_000_000_000, sizeGb: 8, sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF/resolve/main/model.Q8_0.gguf" };
  const ranked = rankArtifacts([q4, q8], mac);
  assert.deepEqual(ranked.map((item) => item.quantization).sort(), ["Q4_K_M", "Q8_0"]);
  assert.equal(ranked[0].quantization, "Q8_0", "higher precision wins when both variants fit");
});
test("excludes known context-incompatible artifacts and explains unknown limits", () => {
  const shortOnly = { ...gguf, maxContextTokens: 4096 };
  const unknown = { ...gguf, id: "org/Unknown-context/model.gguf", modelId: "org/Unknown-context", maxContextTokens: undefined };
  const excluded = rankArtifactsWithExplanations([shortOnly], { ...mac, context: "normal" });
  assert.equal(excluded.recommendations.length, 0);
  assert.equal(excluded.exclusions.insufficientContext, 1);
  const result = rankArtifactsWithExplanations([unknown], { ...mac, context: "long" });
  assert.equal(result.recommendations[0].explanation.fit.context.requestedTokens, 32768);
  assert.equal(result.recommendations[0].explanation.fit.context.maxTokens, undefined);
  assert.match(result.recommendations[0].explanation.rankingFactors.join(" "), /unavailable/i);
});
test("groups equivalent format conversions by base model family", () => {
  const ggufVariant = { ...gguf, baseModel: "Qwen/Qwen2.5-Coder-7B-Instruct", title: "Qwen2.5-Coder-7B-Instruct", modelId: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF" };
  const mlxVariant = { ...mlx, title: "Qwen2.5-Coder-7B-Instruct-4bit", modelId: "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit" };
  const alternative = { ...gguf, id: "org/Alternative-7B-GGUF/model.gguf", modelId: "org/Alternative-7B-GGUF", title: "Alternative 7B" };
  const ranked = rankArtifacts([ggufVariant, mlxVariant, alternative], { ...mac, runtime: undefined });
  assert.notEqual(ranked[0].explanation.familyKey, ranked[1].explanation.familyKey);
  assert.equal(ranked[0].explanation.familyKey, ranked[2].explanation.familyKey);
});
test("gives distinct model families priority over additional variants", () => {
  const familyVariant = (id: string, quantization: string, sizeBytes: number) => ({ ...gguf, id, modelId: "org/Popular-7B-GGUF", title: "Popular 7B", quantization, filename: `${quantization}.gguf`, sizeBytes, sizeGb: sizeBytes / 1e9, downloads: 100_000, tags: [] });
  const popularQ4 = familyVariant("org/Popular-7B-GGUF/Q4.gguf", "Q4", 4_000_000_000);
  const popularQ8 = familyVariant("org/Popular-7B-GGUF/Q8.gguf", "Q8", 8_000_000_000);
  const alternative = { ...gguf, id: "org/Alternative-7B-GGUF/Q4.gguf", modelId: "org/Alternative-7B-GGUF", title: "Alternative 7B", quantization: "Q4", filename: "Q4.gguf", downloads: 1, tags: [] };
  const ranked = rankArtifacts([popularQ4, popularQ8, alternative], { ...mac, workload: "balanced" });
  assert.deepEqual(ranked.slice(0, 2).map((item) => item.modelId), ["org/Popular-7B-GGUF", "org/Alternative-7B-GGUF"]);
});
test("does not infer model capacity from a download footprint and rewards maintained entries", () => {
  const typed = { ...gguf, id: "org/Typed-GGUF/model.gguf", modelId: "org/Typed-GGUF", title: "Typed 3B", paramsB: 3, sizeBytes: 3_000_000_000, sizeGb: 3, downloads: 100, tags: [], updatedAt: new Date().toISOString() };
  const untypedLarge = { ...gguf, id: "org/Untyped-GGUF/model.gguf", modelId: "org/Untyped-GGUF", title: "Untyped", paramsB: undefined, sizeBytes: 10_000_000_000, sizeGb: 10, downloads: 100, tags: [], updatedAt: new Date().toISOString() };
  const stale = { ...typed, id: "org/Stale-GGUF/model.gguf", modelId: "org/Stale-GGUF", title: "Stale 3B", updatedAt: "2020-01-01T00:00:00Z" };
  const ranked = rankArtifacts([untypedLarge, stale, typed], { ...mac, workload: "balanced" });
  assert.equal(ranked[0].title, "Typed 3B");
  assert.ok(ranked.findIndex((item) => item.id === typed.id) < ranked.findIndex((item) => item.id === stale.id));
});
test("uses the supplied ranking clock for deterministic recency ordering", () => {
  const newer = { ...gguf, id: "org/New-GGUF/file.gguf", modelId: "org/New-GGUF", title: "Same", tags: [], downloads: 1, updatedAt: "2026-08-01T00:00:00Z" };
  const older = { ...newer, id: "org/Old-GGUF/file.gguf", modelId: "org/Old-GGUF", updatedAt: "2024-01-01T00:00:00Z" };
  const now = Date.parse("2026-08-06T00:00:00Z");
  assert.equal(rankArtifacts([older, newer], { ...mac, workload: "balanced" }, now)[0].id, newer.id);
});
test("orders equal-score artifacts by stable identity regardless of input order", () => {
  const alpha = { ...gguf, id: "org/Alpha-GGUF/file.gguf", modelId: "org/Alpha-GGUF", title: "Same", tags: [], downloads: 1, updatedAt: "2026-08-01T00:00:00Z" };
  const beta = { ...alpha, id: "org/Beta-GGUF/file.gguf", modelId: "org/Beta-GGUF" };
  const now = Date.parse("2026-08-06T00:00:00Z");
  assert.deepEqual(rankArtifacts([beta, alpha], { ...mac, workload: "balanced" }, now).map((item) => item.id), [alpha.id, beta.id]);
  assert.deepEqual(rankArtifacts([alpha, beta], { ...mac, workload: "balanced" }, now).map((item) => item.id), [alpha.id, beta.id]);
});
test("labels IQ and full-precision GGUF variants", () => {
  const artifacts = normalizeModels([{ id: "org/Precision-GGUF", siblings: [{ rfilename: "model.BF16.gguf", size: 9_000_000_000 }, { rfilename: "model.IQ3_XS.gguf", size: 3_000_000_000 }, { rfilename: "model.Q2_K.gguf", size: 2_000_000_000 }] }], "gguf");
  assert.deepEqual(artifacts.map((artifact) => artifact.quantization), ["Q2_K", "IQ3_XS", "BF16"]);
});
test("retains only counts for invalid or unsupported catalogue candidates", () => {
  const counts = normalizationExclusions([{ id: "org/tiny", siblings: [{ rfilename: "tiny.gguf", size: 1 }] }, { id: "org/missing", siblings: [{ rfilename: "readme.md", size: 1_000_000_000 }] }], "gguf");
  assert.deepEqual(counts, { invalidSize: 1, unsupportedFormat: 1 });
});
test("cache coalesces cold refreshes and rejects invalid timestamps", async () => {
  let calls = 0; let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  const cache = new CatalogueCache(async () => { calls += 1; await pending; return { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" }; }, 1, () => Date.parse("2026-08-01T00:00:00Z"));
  const first = cache.get(); const second = cache.get();
  assert.equal(calls, 1);
  release();
  assert.equal((await first).stale, false); assert.equal((await second).stale, false);
  assert.equal(isFresh({ items: [], refreshedAt: "not-a-date" }), false);
});

test("cold and completed refreshes mark already-expired catalogues stale", async () => {
  const now = Date.parse("2026-08-02T00:00:00Z");
  const expiredCatalogue = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" };
  let coldCalls = 0;
  const cold = new CatalogueCache(async () => { coldCalls += 1; return expiredCatalogue; }, 1, () => now, 60_000);
  assert.deepEqual(await cold.get(), { catalogue: expiredCatalogue, stale: true });
  assert.deepEqual(await cold.get(), { catalogue: expiredCatalogue, stale: true });
  assert.equal(coldCalls, 1, "a cold stale result also respects retry backoff");

  let release!: (catalogue: typeof expiredCatalogue) => void;
  const pending = new Promise<typeof expiredCatalogue>((resolve) => { release = resolve; });
  const refreshed = new CatalogueCache(async () => pending, 1, () => now);
  (refreshed as unknown as { state: typeof expiredCatalogue }).state = expiredCatalogue;
  assert.deepEqual(await refreshed.get(), { catalogue: expiredCatalogue, stale: true });
  release(expiredCatalogue);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(await refreshed.get(), { catalogue: expiredCatalogue, stale: true });
});

test("expired cache responds stale immediately, shares one background refresh, and adopts its result", async () => {
  const now = Date.parse("2026-08-02T00:00:00Z");
  let calls = 0; let release!: (catalogue: { items: Artifact[]; refreshedAt: string }) => void;
  const pending = new Promise<{ items: Artifact[]; refreshedAt: string }>((resolve) => { release = resolve; });
  const cache = new CatalogueCache(async () => { calls += 1; return pending; }, 1, () => now);
  const oldCatalogue = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" };
  const freshCatalogue = { items: [{ ...gguf, id: "org/Fresh-GGUF/model.gguf", modelId: "org/Fresh-GGUF" }], refreshedAt: "2026-08-02T00:00:00Z" };
  (cache as unknown as { state: typeof oldCatalogue }).state = oldCatalogue;

  const results = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.deepEqual(results, [{ catalogue: oldCatalogue, stale: true }, { catalogue: oldCatalogue, stale: true }, { catalogue: oldCatalogue, stale: true }]);
  assert.equal(calls, 1);

  release(freshCatalogue);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(await cache.get(), { catalogue: freshCatalogue, stale: false });
});

test("failed background refreshes stay stale and respect retry backoff", async () => {
  let staleCalls = 0; let now = Date.parse("2026-08-02T00:00:00Z");
  const stale = new CatalogueCache(async () => { staleCalls += 1; throw new Error("offline"); }, 1, () => now, 60_000);
  (stale as unknown as { state: { items: Artifact[]; refreshedAt: string } }).state = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" };
  assert.equal((await stale.get()).stale, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await stale.get()).stale, true);
  assert.equal(staleCalls, 1);
  now += 60_000;
  assert.equal((await stale.get()).stale, true);
  assert.equal(staleCalls, 2);
});
test("resolved stale background refreshes also respect retry backoff", async () => {
  let calls = 0; let now = Date.parse("2026-08-02T00:00:00Z");
  const oldCatalogue = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" };
  const freshCatalogue = { items: [{ ...gguf, id: "org/Fresh-after-framework-stale/model.gguf" }], refreshedAt: "2026-08-02T00:00:00Z" };
  const cache = new CatalogueCache(async () => { calls += 1; return calls === 1 ? oldCatalogue : freshCatalogue; }, 6 * 60 * 60 * 1000, () => now, 60_000);
  (cache as unknown as { state: typeof oldCatalogue }).state = oldCatalogue;
  assert.equal((await cache.get()).stale, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal((await cache.get()).catalogue, oldCatalogue);
  assert.equal(calls, 1, "a stale framework result does not trigger another refresh during backoff");
  now += 60_000;
  assert.equal((await cache.get()).stale, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal((await cache.get()).catalogue, freshCatalogue);
});
test("failed cold refreshes respect retry backoff", async () => {
  let calls = 0;
  let now = 1000;
  const cache = new CatalogueCache(async () => { calls += 1; throw new Error("offline"); }, 1, () => now, 60_000);
  await assert.rejects(cache.get());
  now += 1;
  await assert.rejects(cache.get(), /backing off/);
  assert.equal(calls, 1);
});
test("thirty-second cold-start deadline aborts requests and preserves the unavailable response", async () => {
  let requestAborted = false;
  const hangingFetch = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { requestAborted = true; reject(init.signal?.reason); }, { once: true });
  });
  assert.equal(REFRESH_TIMEOUT_MS, 30_000);
  await assert.rejects(retrieveCatalogue(hangingFetch as typeof fetch));
  assert.equal(requestAborted, true, "the refresh deadline reaches outstanding requests");

  const empty = new CatalogueCache(() => retrieveCatalogue(hangingFetch as typeof fetch, 5));
  const deadlineHandler = createPostHandler(async () => {
    try { return await empty.get(); }
    catch (error) { throw new CatalogueUnavailableError("offline", { cause: error }); }
  });
  assert.equal((await deadlineHandler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }))).status, 503);
});
test("API preserves status codes and returns typed input errors", async () => {
  const response = { recommendations: [], exclusions: { insufficientDisk: 0, insufficientMemory: 0, insufficientContext: 0, invalidSize: 0, unsupportedFormat: 0, unsupportedArtifact: 0 }, refreshedAt: "2026-08-01T00:00:00Z", stale: true };
  const handler = createPostHandler(async () => response);
  const invalid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ chip: "m4", memoryGb: 99, diskGb: 0, workload: "nope" }) }));
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).fieldErrors);
  const partial = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ chip: "m4" }) }));
  assert.deepEqual(Object.keys((await partial.json()).fieldErrors).sort(), ["diskGb", "memoryGb", "workload"]);
  const valid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }));
  assert.deepEqual(await valid.json(), response);
  const unavailable = createPostHandler(async () => { throw new CatalogueUnavailableError("offline"); });
  assert.equal((await unavailable(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }))).status, 503);
  const unexpected = createPostHandler(async () => { throw new Error("programmer bug"); });
  await assert.rejects(unexpected(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) })), /programmer bug/);
});
