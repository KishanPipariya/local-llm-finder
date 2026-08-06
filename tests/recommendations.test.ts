import assert from "node:assert/strict";
import test from "node:test";
import { chipProfiles, estimateMemoryGb, rankArtifacts, runtimeEligibility, validateConfig, type Artifact, type MacConfig } from "../lib/recommendations";
import { CatalogueCache, isFresh } from "../lib/catalogue-cache";
import { normalizeModels } from "../lib/catalogue";
import { createPostHandler } from "../app/api/recommendations/route";

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
test("returns typed field errors while preserving the API error list", () => {
  const invalid = validateConfig({ chip: "m4Pro", memoryGb: 16, diskGb: 0, workload: "other" });
  assert.equal(invalid.valid, false);
  if (!invalid.valid) {
    assert.equal(invalid.fieldErrors.memoryGb, "Choose a memory configuration supported by that chip.");
    assert.equal(invalid.fieldErrors.diskGb, "Free disk space must be between 1 and 4,000 GB.");
    assert.deepEqual(invalid.errors, Object.values(invalid.fieldErrors));
  }
});
test("makes Apple Silicon runtimes available", () => { assert.deepEqual(runtimeEligibility(mac, mlx), ["MLX"]); assert.ok(runtimeEligibility(mac, gguf).includes("Ollama")); });
test("enforces exact disk boundaries and estimates from exact bytes", () => { assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 4.999999999 }).length, 0); assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 5 }).length, 1); assert.ok(estimateMemoryGb({ ...gguf, sizeGb: 1 }) > 5); });
test("ranks coding models and carries gated warning plus runtime commands", () => { const generic = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", paramsB: 8, tags: [] }; const gated = { ...gguf, gated: true }; const ranked = rankArtifacts([generic, gated], mac); assert.equal(ranked[0].title, "Coder 7B"); assert.ok(ranked[0].notes.some((note) => note.startsWith("Gated"))); assert.ok(ranked[0].guidance.some((g) => g.runtime === "llama.cpp" && g.command.includes("-hf"))); });
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
test("normalizes exact GGUF and aggregate MLX artifact sizes", () => {
  const model = { id: "org/Test-GGUF", siblings: [{ rfilename: "large.Q8.gguf", size: 8_000_000_000 }, { rfilename: "small.Q4_K_M.gguf", size: 4_000_000_001 }, { rfilename: "weights.safetensors", size: 3_000_000_000 }, { rfilename: "config.json", size: 200_000_000 }] };
  const ggufArtifact = normalizeModels([model], "gguf")[0]; const mlxArtifact = normalizeModels([model], "mlx")[0];
  assert.equal(ggufArtifact.filename, "small.Q4_K_M.gguf"); assert.equal(ggufArtifact.sizeBytes, 4_000_000_001); assert.equal(mlxArtifact.sizeBytes, 3_200_000_000);
  assert.equal(normalizeModels([{ id: "org/bad", siblings: [{ rfilename: "tiny.gguf", size: 1 }] }], "gguf").length, 0);
});
test("cache coalesces concurrent refreshes, rejects invalid timestamps, and serves stale fallback", async () => {
  let calls = 0; let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  const cache = new CatalogueCache(async () => { calls += 1; await pending; return { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" }; }, 1, () => Date.parse("2026-08-01T00:00:00Z"));
  const first = cache.get(); const second = cache.get(); release(); assert.equal((await first).stale, false); assert.equal((await second).stale, false); assert.equal(calls, 1);
  assert.equal(isFresh({ items: [], refreshedAt: "not-a-date" }), false);
  const stale = new CatalogueCache(async () => { throw new Error("offline"); }, 1, () => Date.parse("2026-08-02T00:00:00Z"));
  (stale as unknown as { state: { items: Artifact[]; refreshedAt: string } }).state = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" };
  assert.equal((await stale.get()).stale, true);
});
test("API preserves status codes and returns typed input errors", async () => {
  const handler = createPostHandler(async () => ({ recommendations: [], refreshedAt: "2026-08-01T00:00:00Z", stale: true }));
  const invalid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ chip: "m4", memoryGb: 99, diskGb: 0, workload: "nope" }) }));
  assert.equal(invalid.status, 400); assert.ok((await invalid.json()).fieldErrors);
  const valid = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }));
  assert.deepEqual(await valid.json(), { recommendations: [], refreshedAt: "2026-08-01T00:00:00Z", stale: true });
  const unavailable = createPostHandler(async () => { throw new Error("offline"); });
  assert.equal((await unavailable(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(mac) }))).status, 503);
});
