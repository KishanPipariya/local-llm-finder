import assert from "node:assert/strict";
import test from "node:test";
import { chipProfiles, estimateMemoryGb, rankArtifacts, runtimeEligibility, validateConfig, type Artifact, type MacConfig } from "../lib/recommendations";
import { cachedCatalogue } from "../lib/catalogue-cache";

const mac: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 12, workload: "coding" };
const gguf: Artifact = { id: "org/Coder-7B-GGUF", modelId: "org/Coder-7B-GGUF", title: "Coder 7B", format: "gguf", sizeGb: 5, paramsB: 7, downloads: 3000, updatedAt: "2026-08-01T00:00:00Z", gated: false, tags: ["code"], sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF" };
const mlx: Artifact = { ...gguf, id: "mlx-community/Coder-7B-4bit", modelId: "mlx-community/Coder-7B-4bit", format: "mlx", sizeGb: 4.5 };

test("accepts every chip's supported memory options and rejects impossible pairs", () => {
  for (const [chip, profile] of Object.entries(chipProfiles)) {
    for (const memoryGb of profile.memoryOptionsGb) assert.equal(validateConfig({ ...mac, chip, memoryGb }).valid, true, `${chip} / ${memoryGb} GB`);
  }
  assert.equal(validateConfig({ ...mac, chip: "m4Pro", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: "m6", memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, chip: { family: "m4" }, memoryGb: 16 }).valid, false);
  assert.equal(validateConfig({ ...mac, diskGb: 0 }).valid, false);
});
test("makes Apple Silicon runtimes available", () => { assert.deepEqual(runtimeEligibility(mac, mlx), ["MLX"]); assert.ok(runtimeEligibility(mac, gguf).includes("Ollama")); });
test("enforces disk bounds and estimates conservative memory", () => { assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 4.9 }).length, 0); assert.ok(estimateMemoryGb(gguf) > gguf.sizeGb); });
test("ranks coding models and carries gated warning plus runtime commands", () => { const generic = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", paramsB: 8, tags: [] }; const gated = { ...gguf, gated: true }; const ranked = rankArtifacts([generic, gated], mac); assert.equal(ranked[0].title, "Coder 7B"); assert.ok(ranked[0].notes.some((note) => note.startsWith("Gated"))); assert.ok(ranked[0].guidance.some((g) => g.runtime === "llama.cpp" && g.command.includes("-hf"))); });
test("keeps fit tied to memory but changes pace and ranking by chip bandwidth", () => {
  const compact: Artifact = { ...gguf, id: "org/Chat-3B-GGUF", modelId: "org/Chat-3B-GGUF", title: "Chat 3B", sizeGb: 2, paramsB: 3, tags: [] };
  const larger: Artifact = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", sizeGb: 6, paramsB: 8, tags: [] };
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
test("uses the last valid catalogue when refresh fails", async () => { const prior = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" }; const result = await cachedCatalogue(prior, async () => { throw new Error("offline"); }, Date.parse("2026-08-02T00:00:01Z")); assert.equal(result.stale, true); assert.equal(result.catalogue, prior); });
