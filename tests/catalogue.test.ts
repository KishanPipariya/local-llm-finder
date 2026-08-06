import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModels, parseHubModelList, retrieveCatalogue } from "../lib/catalogue";

const listedModel = { id: "org/Model-GGUF", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };

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

test("catalogue refresh fails when a list request fails and falls back when a detail request fails", async () => {
  const listFailure = async () => { throw new Error("offline"); };
  await assert.rejects(retrieveCatalogue(listFailure as typeof fetch));

  const detailFailure = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    throw new Error("detail unavailable");
  };
  const catalogue = await retrieveCatalogue(detailFailure as typeof fetch);
  assert.equal(catalogue.items.length, 2, "list metadata remains usable when details fail");
  assert.deepEqual(catalogue.items.map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
});
