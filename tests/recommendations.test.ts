import assert from "node:assert/strict";
import test from "node:test";
import { estimateMemoryGb, rankArtifacts, runtimeEligibility, validateConfig, type Artifact, type MacConfig } from "../lib/recommendations";
import { cachedCatalogue } from "../lib/catalogue-cache";

const mac: MacConfig = { chipTier: "base", memoryGb: 16, diskGb: 12, workload: "coding" };
const gguf: Artifact = { id: "org/Coder-7B-GGUF", modelId: "org/Coder-7B-GGUF", title: "Coder 7B", format: "gguf", sizeGb: 5, paramsB: 7, downloads: 3000, updatedAt: "2026-08-01T00:00:00Z", gated: false, tags: ["code"], sourceUrl: "https://huggingface.co/org/Coder-7B-GGUF" };
const mlx: Artifact = { ...gguf, id: "mlx-community/Coder-7B-4bit", modelId: "mlx-community/Coder-7B-4bit", format: "mlx", sizeGb: 4.5 };

test("validates available memory configurations", () => { assert.equal(validateConfig(mac).valid, true); assert.equal(validateConfig({ ...mac, memoryGb: 7 }).valid, false); assert.equal(validateConfig({ ...mac, memoryGb: 20 }).valid, false); assert.equal(validateConfig({ ...mac, diskGb: 0 }).valid, false); });
test("makes Apple Silicon runtimes available", () => { assert.deepEqual(runtimeEligibility(mac, mlx), ["MLX"]); assert.ok(runtimeEligibility(mac, gguf).includes("Ollama")); });
test("enforces disk bounds and estimates conservative memory", () => { assert.equal(rankArtifacts([gguf], { ...mac, diskGb: 4.9 }).length, 0); assert.ok(estimateMemoryGb(gguf) > gguf.sizeGb); });
test("ranks coding models and carries gated warning plus runtime commands", () => { const generic = { ...gguf, id: "org/Chat-8B-GGUF", modelId: "org/Chat-8B-GGUF", title: "Chat 8B", paramsB: 8, tags: [] }; const gated = { ...gguf, gated: true }; const ranked = rankArtifacts([generic, gated], mac); assert.equal(ranked[0].title, "Coder 7B"); assert.ok(ranked[0].notes.some((note) => note.startsWith("Gated"))); assert.ok(ranked[0].guidance.some((g) => g.runtime === "llama.cpp" && g.command.includes("-hf"))); });
test("uses the last valid catalogue when refresh fails", async () => { const prior = { items: [gguf], refreshedAt: "2026-08-01T00:00:00Z" }; const result = await cachedCatalogue(prior, async () => { throw new Error("offline"); }, Date.parse("2026-08-02T00:00:01Z")); assert.equal(result.stale, true); assert.equal(result.catalogue, prior); });
