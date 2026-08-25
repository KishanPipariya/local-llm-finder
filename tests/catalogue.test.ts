import assert from "node:assert/strict";
import test from "node:test";
import { getCatalogue, interleaveUnique, mapWithConcurrency, normalizationExclusions, normalizeHubModel, normalizeModels, parseHubModelList, retrieveCatalogue } from "../lib/catalogue";
import { fetchJson, MAX_RESPONSE_BYTES } from "../lib/catalogue-request";

const ggufCommit = "1111111111111111111111111111111111111111";
const mlxCommit = "2222222222222222222222222222222222222222";
const listedModel = { id: "org/Model-GGUF", sha: ggufCommit, pipeline_tag: "text-generation", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", sha: mlxCommit, pipeline_tag: "text-generation", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };
test("normalization discards malformed optional Hugging Face metadata", () => {
  const [model] = parseHubModelList([{ ...listedModel, downloads: "many", lastModified: 42, gated: { value: true }, tags: ["code", 42], pipeline_tag: ["text-generation"], gguf: { total: "large", chat_template: 4, context_length: "large" }, safetensors: { total: "large", parameters: { BF16: "large" } }, config: { max_position_embeddings: "large" }, cardData: { license: 3, params: {}, base_model: ["base/model"] }, siblings: [{ rfilename: "unknown-size.Q4_K_M.gguf", size: "large" }, listedModel.siblings[0]] }]);
  assert.deepEqual(model.tags, ["code"]);
  assert.equal(model.downloads, undefined);
  assert.equal(model.cardData?.base_model, "base/model");
  assert.equal(model.gguf, undefined);
  assert.equal(model.safetensors, undefined);
  assert.equal(model.config, undefined);
  assert.deepEqual(normalizeModels([model], "gguf").map((artifact) => artifact.sizeBytes), [4_000_000_000]);
  assert.equal(normalizeHubModel(null), undefined);
  assert.equal(normalizeHubModel({}), undefined);
  assert.deepEqual(normalizeHubModel({ id: "org/NoCard", cardData: null, siblings: [{ rfilename: "model.gguf" }] })?.siblings, [{ rfilename: "model.gguf" }]);
});

test("normalization rejects unsafe catalogue paths before generating artifacts", () => {
  assert.equal(normalizeHubModel({ id: "--help" }), undefined);
  for (const id of ["org/<bad>", "org/a&b", "org/name:tag", "org/double--dash", "org/double..dot", "org/trailing.", "org/repository.git"]) {
    assert.equal(normalizeHubModel({ id }), undefined, `${id} is not a valid Hugging Face repository ID`);
  }
  const unsafe = normalizeHubModel({
    id: "org/Unsafe-GGUF",
    siblings: [{ rfilename: "safe\nSYSTEM injected.gguf", size: 4_000_000_000 }],
  });
  assert.equal(unsafe, undefined);
  assert.deepEqual(normalizeModels([{ id: "org/Unsafe-GGUF", siblings: [{ rfilename: "../../outside.gguf", size: 4_000_000_000 }] }], "gguf"), []);
});

test("normalization rejects repositories with excessive metadata cardinality", () => {
  const siblings = Array.from({ length: 20_001 }, (_, index) => ({ rfilename: `file-${index}.json`, size: 1 }));
  assert.equal(normalizeHubModel({ id: "org/Too-Many-Files", siblings }), undefined);
  assert.equal(normalizeHubModel({ id: "org/Too-Many-Tags", tags: Array.from({ length: 257 }, (_, index) => `tag-${index}`) }), undefined);
  assert.equal(normalizeHubModel({ id: `org/${"x".repeat(253)}` }), undefined);
  assert.equal(normalizeHubModel({ id: "org/Long-Path", siblings: [{ rfilename: `${"x".repeat(1_025)}.json`, size: 1 }] }), undefined);
  const oversizedMetadata = Array.from({ length: 1_025 }, () => ({ rfilename: "x".repeat(1_024), size: 1 }));
  assert.equal(normalizeHubModel({ id: "org/Too-Much-Metadata", siblings: oversizedMetadata }), undefined);
});

test("normalization rejects duplicate repository paths before sizing artifacts", () => {
  const duplicateWeights = {
    id: "mlx-community/Duplicate-Weights",
    pipeline_tag: "text-generation",
    siblings: [
      { rfilename: "weights.safetensors", size: 4_000_000_000 },
      { rfilename: "weights.safetensors", size: 4_000_000_000 },
      { rfilename: "config.json", size: 1_000 },
      { rfilename: "tokenizer.json", size: 1_000 },
    ],
  };
  assert.equal(normalizeHubModel(duplicateWeights), undefined);
  assert.deepEqual(normalizeModels([duplicateWeights], "mlx"), [], "direct normalization cannot double-count duplicate paths");
});

test("normalization rejects an entire repository when any sibling entry is malformed", () => {
  const malformedSnapshot = {
    ...listedMlxModel,
    siblings: [...listedMlxModel.siblings, { rfilename: "../hidden.bin", size: 9_000_000_000 }],
  };
  assert.equal(normalizeHubModel(malformedSnapshot), undefined);
  assert.deepEqual(normalizeModels([malformedSnapshot], "mlx"), [], "direct normalization cannot undercount a malformed snapshot");
});

test("catalogue list parsing rejects a materially malformed upstream sample", () => {
  assert.throws(
    () => parseHubModelList([listedModel, {}, { id: "unsafe id" }, null]),
    /materially incomplete/,
  );
});

test("normalizes numeric parameter metadata into billions", () => {
  const raw = { id: "org/Typed-GGUF", pipeline_tag: "text-generation", siblings: [{ rfilename: "model.Q4.gguf", size: 4_000_000_000 }] };
  assert.equal(normalizeModels([{ ...raw, cardData: { params: 7_000_000_000 } }], "gguf")[0].paramsB, 7);
  assert.equal(normalizeModels([{ ...raw, cardData: { params: 7 } }], "gguf")[0].paramsB, 7);
});

test("normalization keeps only canonical commit revisions", () => {
  assert.equal(normalizeHubModel({ id: "org/Model", sha: "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" })?.sha, "abcdefabcdefabcdefabcdefabcdefabcdefabcd");
  for (const sha of ["main", "9f4d7c1", "main;not-a-commit", "g".repeat(40), "1".repeat(41)]) {
    assert.equal(normalizeHubModel({ id: "org/Model", sha })?.sha, undefined);
  }
});

test("normalizes standard Hugging Face GGUF metadata", () => {
  const model = {
    id: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
    gguf: { total: 7_615_616_512, chat_template: "{{ messages }}", context_length: 32768 },
    cardData: { base_model: "Qwen/Qwen2.5-Coder-7B-Instruct" },
    siblings: [{ rfilename: "qwen.Q4_K_M.gguf", size: 4_000_000_000 }],
  };
  const [artifact] = normalizeModels([model], "gguf");
  assert.equal(artifact.paramsB, 7.615616512);
  assert.equal(artifact.baseModel, "Qwen/Qwen2.5-Coder-7B-Instruct");
  assert.equal(artifact.chatTemplate, true);
  assert.equal(artifact.maxContextTokens, 32768);
});

test("falls back to standard parameter metadata when a custom card value is implausible", () => {
  const [artifact] = normalizeModels([{
    id: "org/Qwen-7B-GGUF",
    pipeline_tag: "text-generation",
    gguf: { total: 7_000_000_000 },
    cardData: { params: "999B" },
    siblings: [{ rfilename: "qwen.Q4_K_M.gguf", size: 4_000_000_000 }],
  }], "gguf");
  assert.equal(artifact.paramsB, 7);
});

test("structured parameter metadata takes precedence over plausible custom card metadata", () => {
  const [artifact] = normalizeModels([{
    id: "org/Qwen-70B-GGUF",
    pipeline_tag: "text-generation",
    gguf: { total: 70_000_000_000 },
    cardData: { params: "7B" },
    siblings: [{ rfilename: "qwen.Q2_K.gguf", size: 20_000_000_000 }],
  }], "gguf");
  assert.equal(artifact.paramsB, 70);
});

test("parameter metadata must be plausible for the declared precision", () => {
  const model = { id: "org/Claimed-70B-GGUF", pipeline_tag: "text-generation", cardData: { params: "70B" } };
  assert.equal(normalizeModels([{ ...model, siblings: [{ rfilename: "model.Q4.gguf", size: 4_000_000_000 }] }], "gguf")[0].paramsB, undefined);
  assert.equal(normalizeModels([{ ...model, siblings: [{ rfilename: "model.Q4.gguf", size: 35_000_000_000 }] }], "gguf")[0].paramsB, 70);
});

test("normalizes standard safetensors parameter metadata for MLX repositories", () => {
  const [artifact] = normalizeModels([{
    id: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    safetensors: { parameters: { BF16: 7_000_000_000 } },
    siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }],
  }], "mlx");
  assert.equal(artifact.paramsB, 7);
});

test("safetensors parameter groups require non-negative safe-integer counts", () => {
  const normalized = normalizeHubModel({
    id: "org/Parameter-Groups-GGUF",
    pipeline_tag: "text-generation",
    safetensors: { total: -1, parameters: { BF16: 70_000_000_000, negative: -63_000_000_000, fractional: 1.5, unsafe: Number.MAX_SAFE_INTEGER + 1 } },
    siblings: [{ rfilename: "model.Q4.gguf", size: 4_000_000_000 }],
  });
  assert.deepEqual(normalized?.safetensors?.parameters, { BF16: 70_000_000_000 });
  assert.equal(normalized?.safetensors?.total, undefined);
  assert.ok(normalized);
  assert.equal(normalizeModels([normalized], "gguf")[0].paramsB, undefined, "invalid groups cannot cancel a spoofed parameter total into a plausible value");
});

test("zero or overflowing safetensors totals do not suppress or create parameter metadata", () => {
  const zeroTotal = normalizeHubModel({
    ...listedMlxModel,
    safetensors: { total: 0, parameters: { BF16: 7_000_000_000 } },
  });
  assert.ok(zeroTotal);
  assert.equal(zeroTotal?.safetensors?.total, undefined);
  assert.equal(normalizeModels([zeroTotal], "mlx")[0].paramsB, 7);

  const overflow = normalizeHubModel({
    ...listedMlxModel,
    safetensors: { parameters: { first: Number.MAX_SAFE_INTEGER, second: Number.MAX_SAFE_INTEGER } },
  });
  assert.ok(overflow);
  assert.equal(normalizeModels([overflow], "mlx")[0].paramsB, undefined);
});

test("GGUF exclusion counts track each invalid file in a mixed-validity repository", () => {
  const model = {
    id: "org/Mixed-GGUF",
    pipeline_tag: "text-generation",
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
    pipeline_tag: "text-generation",
    siblings: [
      { rfilename: "weights.safetensors", size: 4_000_000_000 },
      { rfilename: "config.json" },
      { rfilename: "tokenizer.json", size: 0 },
    ],
  };
  assert.deepEqual(normalizeModels([model], "mlx"), []);
  assert.deepEqual(normalizationExclusions([model], "mlx"), { invalidSize: 1 });
});

test("MLX repositories without weights are classified as unsupported artifacts", () => {
  const model = {
    id: "mlx-community/Config-Only",
    siblings: [{ rfilename: "config.json", size: 1_000 }, { rfilename: "README.md", size: 2_000 }],
  };
  assert.deepEqual(normalizationExclusions([model], "mlx"), { unsupportedArtifact: 1 });
});

test("MLX repositories cannot use non-model safetensors as a complete weight set", () => {
  for (const rfilename of ["tokenizer.safetensors", "optimizer.safetensors", "training/state.safetensors"]) {
    const model = {
      id: "mlx-community/Non-Model-Safetensors",
      pipeline_tag: "text-generation",
      siblings: [
        { rfilename, size: 200_000_000 },
        { rfilename: "config.json", size: 1_000 },
        { rfilename: "tokenizer.json", size: 1_000 },
      ],
    };
    assert.deepEqual(normalizeModels([model], "mlx"), [], `${rfilename} is not a model weight file`);
    assert.deepEqual(normalizationExclusions([model], "mlx"), { unsupportedArtifact: 1 });
  }
});

test("MLX adapter-only repositories are not treated as runnable model snapshots", () => {
  const adapter = {
    id: "mlx-community/Example-LoRA",
    pipeline_tag: "text-generation",
    tags: ["peft", "lora"],
    siblings: [
      { rfilename: "adapter_model.safetensors", size: 200_000_000 },
      { rfilename: "adapter_config.json", size: 1_000 },
    ],
  };
  assert.deepEqual(normalizeModels([adapter], "mlx"), []);
  assert.deepEqual(normalizationExclusions([adapter], "mlx"), { unsupportedArtifact: 1 });

  const completeFiles = [
    { rfilename: "weights.safetensors", size: 200_000_000 },
    { rfilename: "config.json", size: 1_000 },
    { rfilename: "tokenizer.json", size: 1_000 },
  ];
  const adapterWithGenericWeightName = { ...adapter, id: "mlx-community/Adapter-Example", siblings: completeFiles };
  assert.deepEqual(normalizeModels([adapterWithGenericWeightName], "mlx"), [], "adapter metadata prevents a generic weight filename from bypassing the completeness check");

  for (const pluralSignal of ["Adapters", "LoRAs", "QLoRAs", "PEFTs"]) {
    const pluralAdapter = { id: `mlx-community/Example-${pluralSignal}`, pipeline_tag: "text-generation", siblings: completeFiles };
    assert.deepEqual(normalizeModels([pluralAdapter], "mlx"), [], `${pluralSignal} repository names remain adapter signals`);
  }
});

test("MLX repositories require complete weight shards and self-contained runtime assets", () => {
  const files = [
    { rfilename: "config.json", size: 1_000 },
    { rfilename: "tokenizer.json", size: 1_000 },
  ];
  const incomplete = {
    id: "mlx-community/Incomplete-Shards",
    pipeline_tag: "text-generation",
    siblings: [{ rfilename: "model-00001-of-00002.safetensors", size: 2_000_000_000 }, ...files],
  };
  assert.deepEqual(normalizeModels([incomplete], "mlx"), []);
  assert.deepEqual(normalizationExclusions([incomplete], "mlx"), { unsupportedArtifact: 1 });

  const complete = {
    ...incomplete,
    id: "mlx-community/Complete-Shards",
    siblings: [
      { rfilename: "model-00002-of-00002.safetensors", size: 2_000_000_000 },
      { rfilename: "model-00001-of-00002.safetensors", size: 2_000_000_000 },
      ...files,
    ],
  };
  assert.equal(normalizeModels([complete], "mlx").length, 1, "all checkpoint shards form one runnable snapshot");

  for (const siblings of [
    [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "tokenizer.json", size: 1_000 }],
    [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }],
  ]) {
    assert.deepEqual(normalizeModels([{ id: "mlx-community/Missing-Runtime-Asset", pipeline_tag: "text-generation", siblings }], "mlx"), []);
  }
});

test("upstream JSON responses are bounded before parsing", async () => {
  const controller = new AbortController();
  const oversized = new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
  await assert.rejects(fetchJson("https://example.test/metadata", async () => oversized, controller.signal, "Catalogue"), /exceeded/);

  const streamedOversized = new Response("x".repeat(MAX_RESPONSE_BYTES + 1));
  await assert.rejects(fetchJson("https://example.test/metadata", async () => streamedOversized, controller.signal, "Catalogue"), /exceeded/);
});

test("catalogue excludes non-chat tasks and non-standalone GGUF files", () => {
  const multimodal = { id: "org/Vision-GGUF", pipeline_tag: "image-text-to-text", siblings: [{ rfilename: "vision.gguf", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([multimodal], "gguf"), []);
  assert.deepEqual(normalizationExclusions([multimodal], "gguf"), { unsupportedArtifact: 1 });

  const featureExtraction = { id: "org/Embedding-GGUF", pipeline_tag: "feature-extraction", siblings: [{ rfilename: "embedding.Q4.gguf", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([featureExtraction], "gguf"), []);
  assert.deepEqual(normalizationExclusions([featureExtraction], "gguf"), { unsupportedArtifact: 1 });

  const unknownTask = { id: "org/UnknownTask-GGUF", pipeline_tag: "future-text-task", siblings: [{ rfilename: "model.Q4.gguf", size: 4_000_000_000 }] };
  assert.equal(normalizeModels([unknownTask], "gguf").length, 0, "unknown task metadata is excluded conservatively");

  const split = {
    id: "org/Split-GGUF",
    pipeline_tag: "text-generation",
    siblings: [
      { rfilename: "model-00001-of-00002.gguf", size: 2_000_000_000 },
      { rfilename: "model-00002-of-00002.gguf", size: 2_000_000_000 },
      { rfilename: "alternate-1-of-2.gguf", size: 2_000_000_000 },
      { rfilename: "alternate-2-of-2.gguf", size: 2_000_000_000 },
      { rfilename: "padded-000001-of-000002.gguf", size: 2_000_000_000 },
      { rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 },
      { rfilename: "mmproj-model-f16.gguf", size: 300_000_000 },
    ],
  };
  assert.deepEqual(normalizeModels([split], "gguf").map((item) => item.filename), ["model.Q4_K_M.gguf"]);
  assert.deepEqual(normalizationExclusions([split], "gguf"), { unsupportedArtifact: 6 });

  const noTaskSignal = { id: "org/NoTaskSignal", siblings: [{ rfilename: "weights.gguf", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([noTaskSignal], "gguf"), [], "metadata-poor artifacts are not admitted without a text-model signal");
  assert.deepEqual(normalizationExclusions([noTaskSignal], "gguf"), { unsupportedArtifact: 1 });

  const formatOnly = { id: "org/Vision-GGUF", siblings: [{ rfilename: "vision.gguf", size: 4_000_000_000 }] };
  const authorOnly = { id: "mlx-community/ImageGenerator", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }] };
  assert.deepEqual(normalizeModels([formatOnly], "gguf"), [], "a format name is not task evidence");
  assert.deepEqual(normalizeModels([authorOnly], "mlx"), [], "an organization name is not task evidence");

  const mixedUnsupported = { id: "org/NoTaskSignal", siblings: [{ rfilename: "valid.gguf", size: 4_000_000_000 }, { rfilename: "tiny.gguf", size: 1 }] };
  assert.deepEqual(normalizeModels([mixedUnsupported], "gguf"), []);
  assert.deepEqual(normalizationExclusions([mixedUnsupported], "gguf"), { unsupportedArtifact: 1, invalidSize: 1 });
});

test("GGUF normalization caps repository variants before ranking", () => {
  const siblings = Array.from({ length: 100 }, (_, index) => ({ rfilename: `model-${String(index).padStart(3, "0")}.Q4_K_M.gguf`, size: 100_000_000 + index }));
  const artifacts = normalizeModels([{ id: "org/Bulk-GGUF", pipeline_tag: "text-generation", siblings }], "gguf");
  assert.equal(artifacts.length, 64);
  assert.deepEqual(artifacts.map((artifact) => artifact.filename), siblings.slice(0, 64).map((file) => file.rfilename));
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

function requestedModelId(url: string) {
  return decodeURIComponent(new URL(url).pathname.replace("/api/models/", ""));
}

test("catalogue refresh fetches blob metadata for every listed repository", async () => {
  const catalogue = await retrieveCatalogue(upstream() as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.format).sort(), ["gguf", "mlx"]);
  assert.deepEqual(catalogue.items.map((item) => item.revision).sort(), [ggufCommit, mlxCommit]);
});

test("catalogue refresh rejects detail metadata without an immutable commit", async () => {
  const unpinned = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    return Response.json({ ...(url.includes("mlx-community") ? listedMlxModel : listedModel), sha: "main" });
  };
  await assert.rejects(retrieveCatalogue(unpinned as typeof fetch), /materially incomplete/);
});

test("catalogue refresh rejects detail metadata for a substituted repository identity", async () => {
  const substituted = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url.includes("org/Model-GGUF")) return Response.json({ ...listedModel, id: "org/Other-Model-GGUF" });
    return Response.json(listedMlxModel);
  };
  await assert.rejects(retrieveCatalogue(substituted as typeof fetch), /gguf metadata refresh was materially incomplete/);
});

test("catalogue refresh bounds aggregate normalized metadata", async () => {
  await assert.rejects(retrieveCatalogue(upstream() as typeof fetch, 30_000, 12_000, 1), /normalized size limit/);
});

test("framework cache adapter is isolated from the unit-test runtime", async () => {
  await assert.rejects(getCatalogue(), /cacheComponents/);
});

test("catalogue refresh uses blob metadata, rejects incomplete format feeds, and rejects total discovery failure", async () => {
  const urls: string[] = [];
  const listOnly = async (url: string, init?: RequestInit) => {
    urls.push(url);
    return upstream()(url, init);
  };
  const catalogue = await retrieveCatalogue(listOnly as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
  assert.ok(urls.filter((url) => url.includes("?full=true")).every((url) => url.includes("filter=gguf") || url.includes("author=mlx-community")), "GGUF feeds use the format filter rather than a name search");
  assert.equal(urls.filter((url) => url.includes("?blobs=true")).length, 2);
  await assert.rejects(retrieveCatalogue(upstream({ unavailableModel: "org/Model-GGUF" }) as typeof fetch), /gguf metadata refresh was materially incomplete/);

  const partiallyUnavailable = async (url: string) => {
    if (url.includes("?full=true")) {
      return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel, { ...listedModel, id: "org/Second-Model-GGUF" }]);
    }
    if (url.includes("org/Model-GGUF")) return new Response(null, { status: 503 });
    return Response.json(url.includes("mlx-community") ? listedMlxModel : { ...listedModel, id: requestedModelId(url) });
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

test("catalogue refresh requires usable artifacts from both formats", async () => {
  const emptyGguf = { id: "org/Empty-GGUF", sha: ggufCommit, pipeline_tag: "text-generation", siblings: [{ rfilename: "README.md", size: 1_000 }] };
  const noUsableGguf = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [emptyGguf]);
    return Response.json(url.includes("mlx-community") ? listedMlxModel : emptyGguf);
  };
  await assert.rejects(retrieveCatalogue(noUsableGguf as typeof fetch), /GGUF catalogue returned no usable artifacts/);

  const emptyMlx = { id: "mlx-community/Empty", sha: mlxCommit, pipeline_tag: "text-generation", siblings: [{ rfilename: "README.md", size: 1_000 }] };
  const noUsableMlx = async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [emptyMlx] : [listedModel]);
    return Response.json(url.includes("mlx-community") ? emptyMlx : listedModel);
  };
  await assert.rejects(retrieveCatalogue(noUsableMlx as typeof fetch), /MLX catalogue returned no usable artifacts/);
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
    const id = requestedModelId(url);
    return Response.json(url.includes("mlx-community") ? { ...listedMlxModel, id } : { ...listedModel, id });
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

test("interleaves popular and recent feeds without duplicate repositories", () => {
  const popular = [{ id: "org/Popular" }, { id: "org/Shared" }, { id: "org/Popular-2" }];
  const recent = [{ id: "org/Recent" }, { id: "org/Shared" }];
  assert.deepEqual(interleaveUnique([popular, recent], 4).map((model) => model.id), ["org/Popular", "org/Recent", "org/Shared", "org/Popular-2"]);
});

test("catalogue refresh tolerates one failed discovery feed per format", async () => {
  const partialDiscovery = async (url: string, init?: RequestInit) => {
    if (url.includes("sort=downloads&filter=gguf") || url.includes("sort=lastModified&author=mlx-community")) {
      return new Response(null, { status: 503 });
    }
    return upstream()(url, init);
  };
  const catalogue = await retrieveCatalogue(partialDiscovery as typeof fetch);
  assert.deepEqual(catalogue.items.map((item) => item.format).sort(), ["gguf", "mlx"]);
});

test("catalogue refresh rejects when every discovery feed for a format fails", async () => {
  const missingGgufDiscovery = async (url: string, init?: RequestInit) => {
    if (url.includes("filter=gguf")) return new Response(null, { status: 503 });
    return upstream()(url, init);
  };
  await assert.rejects(retrieveCatalogue(missingGgufDiscovery as typeof fetch), /gguf discovery feeds were unavailable/);
  await assert.rejects(retrieveCatalogue((async () => { throw new Error("offline"); }) as typeof fetch));
});
