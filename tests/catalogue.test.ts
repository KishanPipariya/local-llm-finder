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

function upstream(options: { unavailableModel?: string } = {}) {
  return async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url.includes("?blobs=true")) {
      if (options.unavailableModel && url.includes(options.unavailableModel)) return new Response(null, { status: 503 });
      return Response.json(url.includes("mlx-community") ? listedMlxModel : listedModel);
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
}

test("catalogue refresh fetches blob metadata for every listed repository", async () => {
  const catalogue = await retrieveCatalogue(upstream() as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.format).sort(), ["gguf", "mlx"]);
});

test("catalogue refresh uses blob metadata, tolerates an unavailable repository, and rejects failed lists", async () => {
  const urls: string[] = [];
  const listOnly = async (url: string, init?: RequestInit) => {
    urls.push(url);
    return upstream()(url, init);
  };
  const catalogue = await retrieveCatalogue(listOnly as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
  assert.equal(urls.filter((url) => url.includes("?blobs=true")).length, 2);
  const partial = await retrieveCatalogue(upstream({ unavailableModel: "org/Model-GGUF" }) as typeof fetch);
  assert.deepEqual(partial.items.map((item) => item.format), ["mlx"]);
  await assert.rejects(retrieveCatalogue((async () => new Response(null, { status: 503 })) as typeof fetch));
});

test("catalogue refresh fails atomically when its deadline aborts metadata retrieval", async () => {
  let successfulDetail = false;
  const deadlineAbort = async (url: string, init?: RequestInit) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url.includes("org/Model-GGUF")) { successfulDetail = true; return Response.json(listedModel); }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  };
  await assert.rejects(retrieveCatalogue(deadlineAbort as typeof fetch, 10));
  assert.equal(successfulDetail, true, "a successful repository cannot make a timed-out refresh partial");
});

test("catalogue refresh shares one six-request detail concurrency limit across formats", async () => {
  const ggufModels = Array.from({ length: 5 }, (_, index) => ({ id: `org/Gguf-${index}-GGUF` }));
  const mlxModels = Array.from({ length: 5 }, (_, index) => ({ id: `mlx-community/Mlx-${index}` }));
  let inFlight = 0;
  let peak = 0;
  const boundedUpstream = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? mlxModels : ggufModels);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return Response.json(url.includes("mlx-community") ? listedMlxModel : listedModel);
  };
  await retrieveCatalogue(boundedUpstream as typeof fetch);
  assert.equal(peak, 6);
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
