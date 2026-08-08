import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency, normalizeModels, ollamaArtifact, parseHubModelList, parseOllamaConfig, parseOllamaLibrary, parseOllamaManifest, parseOllamaTags, retrieveCatalogue, selectOllamaTags } from "../lib/catalogue";

const listedModel = { id: "org/Model-GGUF", siblings: [{ rfilename: "model.Q4_K_M.gguf", size: 4_000_000_000 }] };
const listedMlxModel = { id: "mlx-community/Model", siblings: [{ rfilename: "weights.safetensors", size: 4_000_000_000 }, { rfilename: "config.json", size: 1_000 }, { rfilename: "tokenizer.json", size: 1_000 }] };
const manifestDigest = `sha256:${"a".repeat(64)}`;
const configDigest = `sha256:${"b".repeat(64)}`;
const manifest = { schemaVersion: 2, config: { mediaType: "application/vnd.docker.container.image.v1+json", digest: configDigest, size: 123 }, layers: [{ mediaType: "application/vnd.ollama.image.model", size: 2_000_000_000 }, { mediaType: "application/vnd.ollama.image.template", size: 1_000 }] };
const config = { model_family: "llama", model_type: "3.2B", file_type: "Q4_K_M" };
const libraryHtml = '<main><a href="/library/llama3.2">Llama</a><a href="/library/qwen">Qwen</a><a href="/library/llama3.2">Duplicate</a></main>';
const tagsHtml = (family: string) => `<ul><li><a href="/library/${family}:latest">latest</a><span>Input: Text</span><code>${manifestDigest}</code></li><li><a href="/library/${family}:vision">vision</a><span>Input: Image</span><code>${manifestDigest}</code></li><li><a href="/library/${family}:q4_k_m">q4</a><span>Input: Text</span><code>${manifestDigest}</code></li><li><a href="/library/${family}:q2_k">q2</a><span>Input: Text</span><code>${manifestDigest}</code></li></ul>`;

test("parses unique Ollama families and selects only text defaults and quality quantizations", () => {
  assert.deepEqual(parseOllamaLibrary(libraryHtml), ["llama3.2", "qwen"]);
  const tags = parseOllamaTags(tagsHtml("llama3.2"), "llama3.2");
  assert.deepEqual(selectOllamaTags(tags).map((tag) => tag.name), ["latest", "q4_k_m"]);
  assert.equal(parseOllamaTags(`<li><a href="/library/llama3.2:latest">latest</a> Text input a80c4f17acd5</li>`, "llama3.2")[0].digest, "a80c4f17acd5");
  assert.throws(() => parseOllamaLibrary("<a href='/library/llama3.2:latest'>tag</a>"));
  assert.throws(() => parseOllamaTags(tagsHtml("llama3.2"), "not/a-family"));
  assert.throws(() => parseOllamaTags("<a href='/library/llama3.2:latest'>Input: Text</a>", "llama3.2"));
  assert.throws(() => parseOllamaTags(`<li><a href="/library/llama3.2:latest">one</a> Text input ${manifestDigest}</li><li><a href="/library/llama3.2:latest">two</a> Text input ${manifestDigest}</li>`, "llama3.2"));
});

test("validates manifest bytes and config-derived Ollama metadata", () => {
  const parsed = parseOllamaManifest(manifest);
  const metadata = parseOllamaConfig(config);
  const artifact = ollamaArtifact({ family: "qwen-coder", name: "q4_k_m", textInput: true, digest: manifestDigest }, parsed, metadata);
  assert.equal(artifact.sizeBytes, 2_000_001_000);
  assert.equal(artifact.paramsB, 3.2);
  assert.equal(artifact.quantization, "Q4_K_M");
  assert.deepEqual(artifact.tags, ["code", "coder"]);
  assert.equal(artifact.sourceUrl, "https://ollama.com/library/qwen-coder:q4_k_m");
  for (const invalid of [
    { schemaVersion: 1, config: manifest.config, layers: manifest.layers },
    { schemaVersion: 2, config: manifest.config, layers: [] },
    { schemaVersion: 2, config: { ...manifest.config, digest: "bad" }, layers: manifest.layers },
    { schemaVersion: 2, config: manifest.config, layers: [{ mediaType: "application/octet-stream", size: 2_000_000_000 }] },
    { schemaVersion: 2, config: manifest.config, layers: [{ mediaType: "application/vnd.ollama.image.model", size: 99_999_999 }] },
  ]) assert.throws(() => parseOllamaManifest(invalid));
  assert.throws(() => parseOllamaConfig({ model_family: "llama", model_type: "3.2B" }));
});

test("normalization discards malformed optional Hugging Face metadata", () => {
  const [model] = parseHubModelList([{ ...listedModel, downloads: "many", lastModified: 42, gated: { value: true }, tags: ["code", 42], pipeline_tag: ["text-generation"], cardData: { license: 3, params: {} }, siblings: [{ rfilename: "model.Q4_K_M.gguf", size: "large" }, listedModel.siblings[0], { rfilename: 42, size: 5 }] }]);
  assert.deepEqual(model.tags, ["code"]);
  assert.equal(model.downloads, undefined);
  assert.deepEqual(normalizeModels([model], "gguf").map((artifact) => artifact.sizeBytes), [4_000_000_000]);
});

function upstream(options: { retired?: boolean; badDigest?: boolean; fail?: number } = {}) {
  return async (url: string) => {
    if (url.includes("?full=true")) return Response.json(url.includes("author=mlx-community") ? [listedMlxModel] : [listedModel]);
    if (url === "https://ollama.com/library") return new Response(libraryHtml);
    if (url.includes("/tags")) return new Response(tagsHtml(url.includes("llama3.2") ? "llama3.2" : "qwen"));
    if (url.includes("/manifests/")) {
      if (options.retired && url.includes("llama3.2") && url.includes("latest")) return new Response(null, { status: 404 });
      if (options.fail) return new Response(null, { status: options.fail });
      return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json", "docker-content-digest": options.badDigest ? `sha256:${"c".repeat(64)}` : manifestDigest } });
    }
    if (url.includes("/blobs/")) return Response.json(config);
    return Response.json(listedModel);
  };
}

test("discovery deduplicates manifests and removes 404 tags while rejecting other registry failures", async () => {
  const catalogue = await retrieveCatalogue(upstream() as typeof fetch);
  assert.equal(catalogue.items.filter((item) => item.pullName).length, 1, "aliases resolving to one manifest use one canonical pull");
  assert.equal(catalogue.items.find((item) => item.pullName)?.pullName, "llama3.2:latest");
  const retired = await retrieveCatalogue(upstream({ retired: true }) as typeof fetch);
  assert.equal(retired.items.find((item) => item.pullName)?.pullName, "llama3.2:q4_k_m");
  await assert.rejects(retrieveCatalogue(upstream({ badDigest: true }) as typeof fetch));
  await assert.rejects(retrieveCatalogue(upstream({ fail: 503 }) as typeof fetch));
});

test("discovery skips retired tag pages but retains atomic registry and detail fallback behavior", async () => {
  const tagPageRetired = async (url: string, init?: RequestInit) => {
    if (url.includes("/qwen/tags")) return new Response(null, { status: 404 });
    return upstream()(url, init);
  };
  const retired = await retrieveCatalogue(tagPageRetired as typeof fetch);
  assert.equal(retired.items.find((item) => item.pullName)?.pullName, "llama3.2:latest");

  const detailFailure = async (url: string, init?: RequestInit) => {
    if (url.includes("huggingface.co/api/models/") && !url.includes("?full=true")) throw new Error("details unavailable");
    return upstream()(url, init);
  };
  const fallback = await retrieveCatalogue(detailFailure as typeof fetch);
  assert.deepEqual(fallback.items.filter((item) => !item.pullName).map((item) => item.sizeBytes).sort((a, b) => a - b), [4_000_000_000, 4_000_002_000]);
  await assert.rejects(retrieveCatalogue((async (url: string, init?: RequestInit) => url === "https://ollama.com/library" ? new Response(null, { status: 503 }) : upstream()(url, init)) as typeof fetch));
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
