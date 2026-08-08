import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModels, ollamaArtifact, ollamaCandidates, parseHubModelList, parseOllamaManifest, retrieveCatalogue } from "../lib/catalogue";

const listedModel = { id: "org/Model-GGUF", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };
const manifest = { schemaVersion: 2, layers: [{ mediaType: "application/vnd.ollama.image.model", size: 2_000_000_000 }, { mediaType: "application/vnd.ollama.image.template", size: 1_000 }] };

test("validates complete Ollama manifest layers and uses their exact byte total", () => {
  const parsed = parseOllamaManifest(manifest);
  const artifact = ollamaArtifact(ollamaCandidates[0], parsed);
  assert.equal(artifact.sizeBytes, 2_000_001_000);
  assert.equal(artifact.pullName, "llama3.2:3b");
  assert.equal(artifact.sourceUrl, "https://ollama.com/library/llama3.2:3b");
  for (const invalid of [
    { schemaVersion: 1, layers: manifest.layers },
    { schemaVersion: 2, layers: [] },
    { schemaVersion: 2, layers: [{ mediaType: "application/octet-stream", size: 2_000_000_000 }] },
    { schemaVersion: 2, layers: [{ mediaType: "application/vnd.ollama.image.model", size: "large" }] },
    { schemaVersion: 2, layers: [{ mediaType: "application/vnd.ollama.image.model", size: 99_999_999 }] },
  ]) assert.throws(() => parseOllamaManifest(invalid));
});

test("normalization discards malformed optional Hugging Face metadata", () => {
  const [model] = parseHubModelList([{ ...listedModel, downloads: "many", lastModified: 42, gated: { value: true }, tags: ["code", 42], pipeline_tag: ["text-generation"], cardData: { license: 3, params: {} }, siblings: [{ rfilename: "model.Q4_K_M.gguf", size: "large" }, listedModel.siblings[0], { rfilename: 42, size: 5 }] }]);
  assert.deepEqual(model.tags, ["code"]);
  assert.equal(model.downloads, undefined);
  assert.equal(model.lastModified, undefined);
  assert.equal(model.gated, undefined);
  assert.equal(model.pipeline_tag, undefined);
  assert.equal(model.cardData, undefined);
  assert.deepEqual(normalizeModels([model], "gguf").map((artifact) => artifact.sizeBytes), [4_000_000_000]);
});

test("normalization pins exact-file links to the supplied Hugging Face revision and falls back to main", () => {
  const revision = "4c2a8bf1199eec10af0a5c8c0e9d9b5c715b2af1";
  const [pinned] = normalizeModels([{ ...listedModel, sha: revision }], "gguf");
  const [fallback] = normalizeModels([listedModel], "gguf");
  const [pinnedMlx] = normalizeModels([{ ...listedMlxModel, sha: revision }], "mlx");
  assert.equal(pinned.sourceUrl, `https://huggingface.co/org/Model-GGUF/resolve/${revision}/model.Q4_K_M.gguf`);
  assert.equal(fallback.sourceUrl, "https://huggingface.co/org/Model-GGUF/resolve/main/model.Q4_K_M.gguf");
  assert.equal(pinnedMlx.sourceUrl, `https://huggingface.co/mlx-community/Model/tree/${revision}`);
});

test("catalogue refresh fails when a list request fails and falls back when a detail request fails", async () => {
  const listFailure = async () => { throw new Error("offline"); };
  await assert.rejects(retrieveCatalogue(listFailure as typeof fetch));

  const detailFailure = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url.includes("registry.ollama.ai")) return Response.json(manifest);
    throw new Error("detail unavailable");
  };
  const catalogue = await retrieveCatalogue(detailFailure as typeof fetch);
  assert.equal(catalogue.items.filter((item) => item.pullName).length, ollamaCandidates.length);
  assert.deepEqual(catalogue.items.filter((item) => !item.pullName).map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000], "list metadata remains usable when Hugging Face details fail");
});

test("removes retired Ollama candidates but fails a refresh for malformed or transient registry responses", async () => {
  const upstream = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url.includes("registry.ollama.ai") && url.includes("llama3.2/manifests/3b")) return new Response(null, { status: 404 });
    if (url.includes("registry.ollama.ai")) return Response.json(manifest);
    return Response.json(listedModel);
  };
  const catalogue = await retrieveCatalogue(upstream as typeof fetch);
  assert.equal(catalogue.items.some((item) => item.pullName === "llama3.2:3b"), false);
  assert.equal(catalogue.items.filter((item) => item.pullName).length, ollamaCandidates.length - 1);

  const malformed = async (url: string) => url.includes("registry.ollama.ai") ? Response.json({ schemaVersion: 2, layers: [] }) : Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
  await assert.rejects(retrieveCatalogue(malformed as typeof fetch));
  const unavailable = async (url: string) => url.includes("registry.ollama.ai") ? new Response(null, { status: 503 }) : Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
  await assert.rejects(retrieveCatalogue(unavailable as typeof fetch));
});
