import assert from "node:assert/strict";
import test from "node:test";
import { createPostHandler } from "../app/api/recommendations/route";
import { parseFinderRequest } from "../lib/request";
import { validateConfig, type MacConfig } from "../lib/hardware";
import { handleRecommendationPost } from "../lib/recommendation-request";
import { mergeExclusions } from "../lib/recommendation-service";

const valid: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };

test("GET parsing keeps the first repeated query value and numeric coercion", () => {
  const parsed = parseFinderRequest({ chip: ["m4", "m5"], memoryGb: ["16", "32"], diskGb: ["80", "100"], workload: ["balanced", "coding"] });
  assert.equal(parsed.submitted, true);
  assert.deepEqual(parsed.candidate, valid);
  assert.deepEqual(parsed.validation, validateConfig(valid));
});

test("GET parsing and POST validation keep runtime and context preferences aligned", async () => {
  const configured = { ...valid, runtime: "llamaCpp", context: "long" } as const;
  const parsed = parseFinderRequest(Object.fromEntries(Object.entries(configured).map(([key, value]) => [key, String(value)])));
  assert.deepEqual(parsed.validation, validateConfig(configured));
  const handler = createPostHandler(async () => ({ recommendations: [], exclusions: { insufficientDisk: 0, insufficientMemory: 0, insufficientContext: 0, invalidSize: 0, unsupportedFormat: 0, unsupportedArtifact: 0, catalogueLimit: 0 }, refreshedAt: "2026-08-01T00:00:00Z", stale: false }));
  assert.equal((await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(configured) }))).status, 200);
  const invalid = { ...configured, runtime: "unsupported" };
  const response = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(invalid) }));
  assert.deepEqual(parsed.candidate, configured);
  assert.equal(response.status, 400);
});

test("successful validation returns only canonical configuration fields", async () => {
  const input = { ...valid, runtime: "mlx" as const, context: "small" as const, ignored: "request-only data" };
  assert.deepEqual(validateConfig(input), {
    valid: true,
    data: { ...valid, runtime: "mlx", context: "small" },
  });

  let received: MacConfig | undefined;
  const handler = createPostHandler(async (config) => { received = config; return {}; });
  assert.equal((await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(input) }))).status, 200);
  assert.deepEqual(received, { ...valid, runtime: "mlx", context: "small" });
});

test("GET validation remains aligned with POST validation", async () => {
  const handler = createPostHandler(async () => ({ recommendations: [], exclusions: { insufficientDisk: 0, insufficientMemory: 0, insufficientContext: 0, invalidSize: 0, unsupportedFormat: 0, unsupportedArtifact: 0, catalogueLimit: 0 }, refreshedAt: "2026-08-01T00:00:00Z", stale: false }));
  for (const input of [valid, { chip: "m4" }, { ...valid, memoryGb: 99, diskGb: 0, workload: "other" }]) {
    const getValidation = parseFinderRequest(Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]))).validation;
    const response = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify(input) }));
    const postBody = await response.json();
    const expected = validateConfig(input);
    assert.deepEqual(getValidation, expected);
    if (expected.valid) assert.equal(response.status, 200);
    else {
      assert.equal(response.status, 400);
      assert.deepEqual(postBody, { errors: expected.errors, fieldErrors: expected.fieldErrors });
    }
  }
});

test("POST treats malformed JSON and non-object JSON as validation errors", async () => {
  const handler = createPostHandler(async () => { throw new Error("must not run"); });
  const expectedValidation = validateConfig(null);
  if (expectedValidation.valid) throw new Error("null must be invalid");
  const expected = { errors: expectedValidation.errors, fieldErrors: expectedValidation.fieldErrors };
  for (const body of ["{", "null", "42", "[]"]) {
    const response = await handler(new Request("http://test/api/recommendations", { method: "POST", body }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), expected);
  }
});

test("GET treats the explicit runtime-neutral UI choice as an omitted preference", () => {
  const parsed = parseFinderRequest({ chip: "m4", memoryGb: "16", diskGb: "80", workload: "balanced", runtime: "any" });
  assert.deepEqual(parsed.candidate, { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" });
  assert.deepEqual(parsed.validation, validateConfig(valid));
});

test("GET rejects non-decimal numeric syntax instead of applying broad JavaScript coercion", async () => {
  const handler = createPostHandler(async () => { throw new Error("must not run"); });
  for (const numericInput of ["0x10", " 16 ", "+16", "16."]) {
    const getValidation = parseFinderRequest({ chip: "m4", memoryGb: numericInput, diskGb: "80", workload: "balanced" }).validation;
    assert.equal(getValidation?.valid, false, `${JSON.stringify(numericInput)} is not valid form-number syntax`);

    const response = await handler(new Request("http://test/api/recommendations", {
      method: "POST",
      body: JSON.stringify({ ...valid, memoryGb: numericInput }),
    }));
    assert.equal(response.status, 400, "POST rejects the corresponding non-numeric JSON string");
  }

  assert.equal(parseFinderRequest({ chip: "m4", memoryGb: "1.6e1", diskGb: "8e1", workload: "balanced" }).validation?.valid, true);
});

test("POST bounds request-body reads before validation", async () => {
  let called = false;
  const handler = createPostHandler(async () => { called = true; return {}; });
  const response = await handler(new Request("http://test/api/recommendations", { method: "POST", body: JSON.stringify({ ...valid, padding: "x".repeat(40_000) }) }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("POST bounds request-body read time before validation", async () => {
  let called = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } });
  const request = new Request("http://test/api/recommendations", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  const result = await handleRecommendationPost(request, async () => { called = true; return {}; }, "unavailable", 5);
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("POST deadlines do not wait for request-stream cancellation", async () => {
  let called = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
    cancel() { return new Promise<void>(() => undefined); },
  });
  const request = new Request("http://test/api/recommendations", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  const result = await Promise.race([
    handleRecommendationPost(request, async () => { called = true; return {}; }, "unavailable", 5),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("request cancellation blocked the deadline")), 100)),
  ]);
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("service merges only known typed catalogue exclusion reasons", () => {
  const ranking = { insufficientDisk: 1, insufficientMemory: 0, insufficientContext: 0, invalidSize: 0, unsupportedFormat: 2, unsupportedArtifact: 0, catalogueLimit: 0 };
  assert.deepEqual(mergeExclusions(ranking, { insufficientMemory: 3, invalidSize: 1, catalogueLimit: 4 }), { insufficientDisk: 1, insufficientMemory: 3, insufficientContext: 0, invalidSize: 1, unsupportedFormat: 2, unsupportedArtifact: 0, catalogueLimit: 4 });
  assert.deepEqual(mergeExclusions(ranking, undefined), ranking);
});
