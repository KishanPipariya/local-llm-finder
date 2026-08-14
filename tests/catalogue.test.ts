import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency, normalizationExclusions, normalizeModels, parseHubModelList, retrieveCatalogue } from "../lib/catalogue";

const listedModel = { id: "org/Model-GGUF", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };
test("normalization discards malformed optional Hugging Face metadata", () => {
  const [model] = parseHubModelList([{ ...listedModel, downloads: "many", lastModified: 42, gated: { value: true }, tags: ["code", 42], pipeline_tag: ["text-generation"], cardData: { license: 3, params: {} }, siblings: [{ rfilename: "model.Q4_K_M.gguf", size: "large" }, listedModel.siblings[0], { rfilename: 42, size: 5 }] }]);
  assert.deepEqual(model.tags, ["code"]);
  assert.equal(model.downloads, undefined);
  assert.deepEqual(normalizeModels([model], "gguf").map((artifact) => artifact.sizeBytes), [4_000_000_000]);
});

test("normalizes numeric parameter metadata into billions", () => {
  const raw = { id: "org/Typed-GGUF", siblings: [{ rfilename: "model.Q4.gguf", size: 1_000_000_000 }] };
  assert.equal(normalizeModels([{ ...raw, cardData: { params: 7_000_000_000 } }], "gguf")[0].paramsB, 7);
  assert.equal(normalizeModels([{ ...raw, cardData: { params: 7 } }], "gguf")[0].paramsB, 7);
});

test("GGUF exclusion counts track each invalid file in a mixed-validity repository", () => {
  const model = {
    id: "org/Mixed-GGUF",
    siblings: [
      { rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 },
      { rfilename: "model.Q2_K.gguf", size: 99_999_999 },
      { rfilename: "model.Q8_0.gguf" },
      { rfilename: "README.md", size: 1_000 },
    ],
  };
  assert.equal(normalizeModels([model], "gguf").length, 1);
  assert.deepEqual(normalizationExclusions([model], "gguf"), { invalidSize: 2 });
});

test("MLX exclusion counts remain at repository snapshot level", () => {
  const model = {
    id: "mlx-community/Mixed-MLX",
    siblings: [
      { rfilename: "weights.safetensors", size: 4_000_000_000 },
      { rfilename: "config.json" },
      { rfilename: "tokenizer.json", size: 0 },
    ],
  };
  assert.deepEqual(normalizeModels([model], "mlx"), []);
  assert.deepEqual(normalizationExclusions([model], "mlx"), { invalidSize: 1 });
});

test("catalogue excludes non-chat tasks and non-standalone GGUF files", () => {
  const multimodal = { id: "org/Vision-GGUF", pipeline_tag: "image-text-to-text", siblings: [{ rfilename: "vision.gguf", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([multimodal], "gguf"), []);
  assert.deepEqual(normalizationExclusions([multimodal], "gguf"), { unsupportedArtifact: 1 });

  const featureExtraction = { id: "org/Embedding-GGUF", pipeline_tag: "feature-extraction", siblings: [{ rfilename: "embedding.Q4.gguf", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([featureExtraction], "gguf"), []);
  assert.deepEqual(normalizationExclusions([featureExtraction], "gguf"), { unsupportedArtifact: 1 });

  const unknownTask = { id: "org/UnknownTask-GGUF", pipeline_tag: "future-text-task", siblings: [{ rfilename: "model.Q4.gguf", size: 4_000_000_000 }] };
  assert.equal(normalizeModels([unknownTask], "gguf").length, 1, "unknown task metadata stays eligible and neutral");

  const split = {
    id: "org/Split-GGUF",
    pipeline_tag: "text-generation",
    siblings: [
      { rfilename: "model-00001-of-00002.gguf", size: 2_000_000_000 },
      { rfilename: "model-00002-of-00002.gguf", size: 2_000_000_000 },
      { rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 },
      { rfilename: "mmproj-model-f16.gguf", size: 300_000_000 },
    ],
  };
  assert.deepEqual(normalizeModels([split], "gguf").map((item) => item.filename), ["model.Q4_K_M.gguf"]);
  assert.deepEqual(normalizationExclusions([split], "gguf"), { unsupportedArtifact: 3 });
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

test("catalogue refresh uses blob metadata, rejects incomplete format feeds, and rejects failed lists", async () => {
  const urls: string[] = [];
  const listOnly = async (url: string, init?: RequestInit) => {
    urls.push(url);
    return upstream()(url, init);
  };
  const catalogue = await retrieveCatalogue(listOnly as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
  assert.equal(urls.filter((url) => url.includes("?blobs=true")).length, 2);
  await assert.rejects(retrieveCatalogue(upstream({ unavailableModel: "org/Model-GGUF" }) as typeof fetch), /gguf metadata refresh was materially incomplete/);

  const partiallyUnavailable = async (url: string) => {
    if (url.includes("?full=true")) {
      return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel, { ...listedModel, id: "org/Second-Model-GGUF" }]);
    }
    if (url.includes("org/Model-GGUF")) return new Response(null, { status: 503 });
    return Response.json(url.includes("mlx-community") ? listedMlxModel : listedModel);
  };
  const partial = await retrieveCatalogue(partiallyUnavailable as typeof fetch);
  assert.deepEqual(partial.items.map((item) => item.format).sort(), ["gguf", "mlx"]);
  await assert.rejects(retrieveCatalogue((async () => new Response(null, { status: 503 })) as typeof fetch));
});

test("catalogue refresh rejects a materially incomplete metadata sample", async () => {
  const models = Array.from({ length: 4 }, (_, index) => ({ id: `org/Partial-${index}-GGUF` }));
  const incomplete = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : models);
    if (url.includes("Partial-0") || url.includes("Partial-1") || url.includes("Partial-2")) return new Response(null, { status: 503 });
    return Response.json(listedMlxModel);
  };
  await assert.rejects(retrieveCatalogue(incomplete as typeof fetch), /materially incomplete/);
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
