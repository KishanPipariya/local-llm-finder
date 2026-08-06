import assert from "node:assert/strict";
import test from "node:test";
import { createPostHandler } from "../app/api/recommendations/route";
import { parseFinderRequest } from "../lib/request";
import { validateConfig, type MacConfig } from "../lib/recommendations";

const valid: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };

test("GET parsing keeps the first repeated query value and numeric coercion", () => {
  const parsed = parseFinderRequest({ chip: ["m4", "m5"], memoryGb: ["16", "32"], diskGb: ["80", "100"], workload: ["balanced", "coding"] });
  assert.equal(parsed.submitted, true);
  assert.deepEqual(parsed.candidate, valid);
  assert.deepEqual(parsed.validation, validateConfig(valid));
});

test("GET validation remains aligned with POST validation", async () => {
  const handler = createPostHandler(async () => ({ recommendations: [], exclusions: { insufficientDisk: 0, insufficientMemory: 0, invalidSize: 0, unsupportedFormat: 0 }, refreshedAt: "2026-08-01T00:00:00Z", stale: false }));
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
