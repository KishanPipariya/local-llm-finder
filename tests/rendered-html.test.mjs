import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the Mac Local LLM finder", async () => {
  const response = await render();
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Mac model finder/);
  assert.match(html, /Find a local model/);
  assert.match(html, /Apple Silicon/);
  assert.match(html, /Find compatible models/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
