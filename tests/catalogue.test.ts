import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency, normalizeModels, parseHubModelList, retrieveCatalogue } from "../lib/catalogue";

const listedModel = { id: "org/Model-GGUF", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };
test("normalization discards malformed optional Hugging Face metadata", () => {
  const [model] = parseHubModelList([{ ...listedModel, downloads: "many", lastModified: 42, gated: { value: true }, tags: ["code", 42], pipeline_tag: ["text-generation"], cardData: { license: 3, params: {} }, siblings: [{ rfilename: "model.Q4_K_M.gguf", size: "large" }, listedModel.siblings[0], { rfilename: 42, size: 5 }] }]);
  assert.deepEqual(model.tags, ["code"]);
  assert.equal(model.downloads, undefined);
  assert.deepEqual(normalizeModels([model], "gguf").map((artifact) => artifact.sizeBytes), [4_000_000_000]);
});

function upstream() {
  return async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    throw new Error(`Unexpected upstream request: ${url}`);
  };
}

test("catalogue refresh uses only the two Hugging Face list responses", async () => {
  const catalogue = await retrieveCatalogue(upstream() as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.format).sort(), ["gguf", "mlx"]);
  assert.equal(catalogue.items.some((item) => item.pullName), false);
});

test("catalogue refresh uses list metadata without Hugging Face detail requests and rejects failed lists", async () => {
  const urls: string[] = [];
  const listOnly = async (url: string, init?: RequestInit) => {
    urls.push(url);
    return upstream()(url, init);
  };
  const catalogue = await retrieveCatalogue(listOnly as typeof fetch);
  assert.deepEqual(catalogue.items.filter((item) => !item.pullName).map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
  assert.equal(urls.some((url) => url.startsWith("https://huggingface.co/api/models/") && !url.includes("?full=true")), false);
  await assert.rejects(retrieveCatalogue((async () => new Response(null, { status: 503 })) as typeof fetch));
});

test("bounded mapper preserves order and does not start workers for an empty list", async () => {
  let running = 0; let peak = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise<void>((resolve) => setImmediate(resolve));
    running -= 1;
    return value * 2;
  });
  assert.deepEqual(values, [2, 4, 6, 8]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 2, async () => 1), []);
});

test("catalogue refresh rejects a failed list request", async () => {
  await assert.rejects(retrieveCatalogue((async () => { throw new Error("offline"); }) as typeof fetch));
});
