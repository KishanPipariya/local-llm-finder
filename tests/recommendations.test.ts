import assert from "node:assert/strict";
import test from "node:test";
import { buildGuidance, chipProfiles, estimateMemoryGb, rankArtifacts, rankArtifactsWithExplanations, runtimeEligibility, runtimes, validateConfig, type Artifact, type MacConfig } from "../lib/recommendations";
import { CatalogueCache, isFresh } from "../lib/catalogue-cache";
import { normalizationExclusions, normalizeModels, REFRESH_TIMEOUT_MS, retrieveCatalogue } from "../lib/catalogue";
import { createPostHandler } from "../app/api/recommendations/route";

const mac: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 12, workload: "coding" };
const gguf: Artifact = { id: "org/Coder-7B-GGUF/model.Q4_K_M.gguf", modelId: "org/Coder-7B-GGUF", title: "Coder 7B", format: "gguf", sizeBytes: 5_000_000_000, sizeGb: 5, paramsB: 7, downloads: 3000, updatedAt: "2026-08-01T00:00:00Z", gated: false, tags: ["code"], repositoryUrl: "https://huggingface.co/org/Coder-7B-GGUF", sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF/resolve/main/model.Q4_K_M.gguf", filename: "model.Q4_K_M.gguf" };
const mlx: Artifact = { ...gguf, id: "mlx-community/Coder-7B-4bit", modelId: "mlx-community/Coder-7B-4bit", format: "mlx", sizeBytes: 4_500_000_000, sizeGb: 4.5, filename: undefined };
const nativeOllama: Artifact = { ...gguf, id: "ollama/qwen3:4b", modelId: "qwen3:4b", title: "Qwen3 4B", sizeBytes: 3_000_000_000, sizeGb: 3, paramsB: 4, sourceUrl: "https://ollama.com/library/qwen3:4b", repositoryUrl: "https://ollama.com/library/qwen3:4b", filename: undefined, pullName: "qwen3:4b" };

test("accepts every chip's supported memory options and rejects impossible pairs", () => {
  for (const [chip, profile] of Object.entries(chipProfiles)) {
    for (const memoryGb of profile.memoryOptionsGb) assert.equal(validateConfig({ ...mac, chip, memoryGb }).valid, true, `${chip} / ${memoryGb} GB`);
  }
  assert.equal(validateConfig({ ...mac, chip: "m4Pro", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: "m6", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: { family: "m4" }, memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, diskGb: 0 }).valid, false);
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
test("makes Apple Silicon runtimes available in preferred display order", () => { assert.deepEqual(runtimes, ["llamaCpp", "mlx", "lmStudio", "ollama"]); assert.deepEqual(runtimeEligibility(mac, mlx), ["MLX"]); assert.deepEqual(runtimeEligibility(mac, gguf), ["llama.cpp", "LM Studio", "Ollama"]); assert.deepEqual(runtimeEligibility(mac, nativeOllama), ["Ollama"]); });
test("filters artifacts to a chosen runtime while requests without a runtime remain neutral", () => {
  assert.deepEqual(rankArtifacts([gguf, mlx], { ...mac, runtime: "mlx" }).map((item) => item.format), ["mlx"]);
  assert.deepEqual(rankArtifacts([gguf, mlx, nativeOllama], { ...mac, runtime: "ollama" }).map((item) => item.format), ["gguf", "gguf"]);
  assert.deepEqual(rankArtifacts([gguf, mlx, nativeOllama], mac).map((item) => item.format).sort(), ["gguf", "gguf", "mlx"]);
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
test("validates optional runtime and context preferences without requiring them for legacy callers", () => {
  assert.equal(validateConfig(mac).valid, true);
  assert.equal(validateConfig({ ...mac, runtime: "other" }).valid, false);
  assert.equal(validateConfig({ ...mac, context: "huge" }).valid, false);
});
test("enforces exact disk boundaries and estimates from exact bytes", () => { assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 4.999999999 }).length, 0); assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 5 }).length, 1); assert.ok(estimateMemoryGb({ ...gguf, sizeGb: 1 }) > 5); });
test("ranks coding models and carries gated and licence warnings plus runtime commands", () => { const generic = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", paramsB: 8, tags: [] }; const gated = { ...gguf, gated: true, licence: "apache-2.0" }; const ranked = rankArtifacts([generic, gated], mac); assert.equal(ranked[0].title, "Coder 7B"); assert.ok(ranked[0].notes.some((note) => note.startsWith("Gated"))); assert.ok(ranked[0].notes.some((note) => note.startsWith("Licence: apache-2.0"))); assert.ok(ranked[0].guidance.some((g) => g.runtime === "llama.cpp" && g.command.includes("-hf"))); });
test("uses Hugging Face task metadata as a bounded workload preference", () => {
  const coding = { ...gguf, id: "org/Code-GGUF/file.gguf", modelId: "org/Code-GGUF", title: "Plain model", tags: ["coding"], pipelineTag: undefined };
  const chat = { ...gguf, id: "org/Chat-GGUF/file.gguf", modelId: "org/Chat-GGUF", title: "Plain model", tags: [], pipelineTag: "text2text-generation" };
  const unknown = { ...gguf, id: "org/Unknown-GGUF/file.gguf", modelId: "org/Unknown-GGUF", title: "Plain model", tags: [], pipelineTag: undefined };
  assert.equal(rankArtifacts([unknown, chat, coding], { ...mac, workload: "coding" }, Date.parse("2026-08-06T00:00:00Z"))[0].id, coding.id);
  assert.equal(rankArtifacts([unknown, coding, chat], { ...mac, workload: "chat" }, Date.parse("2026-08-06T00:00:00Z"))[0].id, chat.id);
  assert.equal(rankArtifacts([unknown], mac, Date.parse("2026-08-06T00:00:00Z")).length, 1, "unknown task metadata remains eligible");
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
test("names the exact GGUF file in links and runtime guidance", () => { const recommendation = rankArtifacts([gguf], mac)[0]; assert.equal(recommendation.sourceUrl, gguf.sourceUrl); assert.match(recommendation.guidance.find((guide) => guide.runtime === "llama.cpp")!.command, /model\.Q4_K_M\.gguf/); });
test("uses native pull-and-run guidance only for verified Ollama entries", () => {
  assert.deepEqual(buildGuidance(nativeOllama, ["Ollama"]), [{ runtime: "Ollama", command: "ollama pull qwen3:4b && ollama run qwen3:4b" }]);
  assert.match(buildGuidance(gguf, ["Ollama"])[0].command, /ollama create local-model/);
  assert.doesNotMatch(buildGuidance(gguf, ["Ollama"])[0].command, /ollama pull/);
  assert.deepEqual(rankArtifacts([nativeOllama], { ...mac, runtime: "lmStudio" }), []);
});
test("returns typed fit explanations and actionable exclusion categories", () => {
  const tooLarge = { ...gguf, id: "org/Large-GGUF/file.gguf", modelId: "org/Large-GGUF", sizeBytes: 13_000_000_000, sizeGb: 13 };
  const tooHungry = { ...gguf, id: "org/Memory-GGUF/file.gguf", modelId: "org/Memory-GGUF", sizeBytes: 11_500_000_000, sizeGb: 11.5, paramsB: 100 };
  const invalid = { ...gguf, id: "org/Invalid-GGUF/file.gguf", modelId: "org/Invalid-GGUF", sizeBytes: 0, sizeGb: 0 };
  const result = rankArtifactsWithExplanations([gguf, tooLarge, tooHungry, invalid], mac);
  assert.equal(result.exclusions.insufficientDisk, 1);
  assert.equal(result.exclusions.insufficientMemory, 1);
  assert.equal(result.exclusions.invalidSize, 1);
  assert.equal(result.recommendations[0].explanation.fit.disk.availableBytes, 12_000_000_000);
  assert.equal(result.recommendations[0].explanation.fit.memory.assumption.includes("normal-context"), true);
  assert.equal(result.recommendations[0].explanation.fit.workload.category, "coding-oriented");
  assert.ok(result.recommendations[0].explanation.rankingFactors.length >= 3);
});
test("normalizes exact GGUF and aggregate MLX artifact sizes", () => {
  const model = { id: "org/Test-GGUF", pipeline_tag: "text-generation", siblings: [{ rfilename: "large.Q8.gguf", size: 8_000_000_000 }, { rfilename: "small.Q4_K_M.gguf", size: 4_000_000_001 }, { rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "config.json", size: 12_000 }, { rfilename: "tokenizer.json", size: 8_000 }, { rfilename: "README.md", size: 900_000_000 }] };
  const ggufArtifacts = normalizeModels([model], "gguf"); const mlxArtifact = normalizeModels([model], "mlx")[0];
  assert.deepEqual(ggufArtifacts.map((artifact) => [artifact.filename, artifact.quantization, artifact.sizeBytes]), [["small.Q4_K_M.gguf", "Q4_K_M", 4_000_000_001], ["large.Q8.gguf", "Q8", 8_000_000_000]]);
  assert.equal(mlxArtifact.sizeBytes, 3_000_020_000);
  assert.equal(ggufArtifacts[0].pipelineTag, "text-generation");
  assert.equal(normalizeModels([{ id: "org/bad", siblings: [{ rfilename: "tiny.gguf", size: 1 }] }], "gguf").length, 0);
  assert.equal(normalizeModels([{ id: "org/unknown-tokenizer", siblings: [{ rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "tokenizer.json" }] }], "mlx").length, 0);
});
test("keeps multiple GGUF quantization variants from one model family", () => {
  const q4 = { ...gguf, quantization: "Q4_K_M" };
  const q8 = { ...gguf, id: "org/Coder-7B-GGUF/model.Q8_0.gguf", filename: "model.Q8_0.gguf", quantization: "Q8_0", sizeBytes: 8_000_000_000, sizeGb: 8, sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF/resolve/main/model.Q8_0.gguf" };
  const ranked = rankArtifacts([q4, q8], mac);
  assert.deepEqual(ranked.map((item) => item.quantization).sort(), ["Q4_K_M", "Q8_0"]);
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
test("thirty-second cold-start deadline aborts requests and preserves the unavailable response", async () => {
  let requestAborted = false;
  const hangingFetch = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { requestAborted = true; reject(init.signal?.reason); }, { once: true });
  });
  assert.equal(REFRESH_TIMEOUT_MS, 30_000);
  await assert.rejects(retrieveCatalogue(hangingFetch as typeof fetch));
  assert.equal(requestAborted, true, "the refresh deadline reaches outstanding requests");

  const empty = new CatalogueCache(() => retrieveCatalogue(hangingFetch as typeof fetch, 5));
  const deadlineHandler = createPostHandler(async () => empty.get());
  assert.equal((await deadlineHandler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }))).status, 503);
});
test("API preserves status codes and returns typed input errors", async () => {
  const response = { recommendations: [], exclusions: { insufficientDisk: 0, insufficientMemory: 0, invalidSize: 0, unsupportedFormat: 0 }, refreshedAt: "2026-08-01T00:00:00Z", stale: true };
  const handler = createPostHandler(async () => response);
  const invalid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ chip: "m4", memoryGb: 99, diskGb: 0, workload: "nope" }) }));
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).fieldErrors);
  const partial = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ chip: "m4" }) }));
  assert.deepEqual(Object.keys((await partial.json()).fieldErrors).sort(), ["diskGb", "memoryGb", "workload"]);
  const valid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }));
  assert.deepEqual(await valid.json(), response);
  const unavailable = createPostHandler(async () => { throw new Error("offline"); });
  assert.equal((await unavailable(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }))).status, 503);
});
