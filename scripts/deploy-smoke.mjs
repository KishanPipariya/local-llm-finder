const runtimeLabels = {
  ollama: "Ollama",
  lmStudio: "LM Studio",
  llamaCpp: "llama.cpp",
  mlx: "MLX",
};

const baseConfig = {
  chip: "m4",
  memoryGb: 16,
  diskGb: 80,
  workload: "balanced",
  context: "normal",
};

function usage() {
  console.error("Usage: npm run smoke:deploy -- https://your-deployment.example");
  process.exit(1);
}

function deploymentUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol");
    return url;
  } catch {
    usage();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function endpoint(origin, path) {
  return new URL(path, origin).toString();
}

function verifyResult(body, runtime) {
  assert(body !== null && typeof body === "object" && !Array.isArray(body), `${runtime}: API returned an invalid response object.`);
  assert(Array.isArray(body.recommendations), `${runtime}: API response is missing recommendations.`);
  assert(body.recommendations.length > 0, `${runtime}: API returned no compatible recommendations.`);
  assert(typeof body.stale === "boolean", `${runtime}: API response is missing stale catalogue status.`);
  assert(typeof body.refreshedAt === "string" && Number.isFinite(Date.parse(body.refreshedAt)), `${runtime}: API response has an invalid catalogue timestamp.`);
  assert(body.exclusions !== null && typeof body.exclusions === "object" && !Array.isArray(body.exclusions), `${runtime}: API response is missing exclusions.`);

  for (const reason of ["insufficientDisk", "insufficientMemory", "insufficientContext", "invalidSize", "unsupportedFormat", "unsupportedArtifact"]) {
    assert(typeof body.exclusions[reason] === "number" && body.exclusions[reason] >= 0, `${runtime}: API response has an invalid ${reason} exclusion count.`);
  }

  const runtimeLabel = runtimeLabels[runtime];
  for (const recommendation of body.recommendations) {
    assert(recommendation !== null && typeof recommendation === "object", `${runtime}: API returned an invalid recommendation.`);
    assert(Array.isArray(recommendation.runtimes) && recommendation.runtimes.includes(runtimeLabel), `${runtime}: API returned a recommendation incompatible with ${runtimeLabel}.`);
    assert(typeof recommendation.sourceUrl === "string" && recommendation.sourceUrl.startsWith("https://huggingface.co/"), `${runtime}: API recommendation is missing its Hugging Face source URL.`);
    if (runtime === "ollama") {
      const ollamaGuidance = recommendation.guidance?.find((guide) => guide.runtime === "Ollama")?.command;
      assert(typeof ollamaGuidance === "string" && ollamaGuidance.includes("ollama create") && ollamaGuidance.includes("ollama run"), "ollama: API recommendation is missing its GGUF import recipe.");
      assert(!ollamaGuidance.includes("ollama pull"), "ollama: API recommendation must not use a native pull path.");
    }
  }

  return body.stale;
}

async function main() {
  if (process.argv.length !== 3) usage();
  const origin = deploymentUrl(process.argv[2]);
  const getConfig = { ...baseConfig, runtime: "ollama" };
  const getUrl = new URL("/", origin);
  Object.entries(getConfig).forEach(([key, value]) => getUrl.searchParams.set(key, String(value)));
  const getResponse = await fetch(getUrl, { redirect: "error" });
  assert(getResponse.ok, `GET finder flow failed with HTTP ${getResponse.status}.`);
  const html = await getResponse.text();
  assert(html.includes('id="results"'), "GET finder flow did not render a shortlist.");

  console.log(`GET finder flow: ${getResponse.status}`);
  for (const runtime of Object.keys(runtimeLabels)) {
    const response = await fetch(endpoint(origin, "/api/recommendations"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...baseConfig, runtime }),
      redirect: "error",
    });
    assert(response.status !== 503, `${runtime}: catalogue is unavailable (503).`);
    assert(response.ok, `${runtime}: API failed with HTTP ${response.status}.`);
    const stale = verifyResult(await response.json(), runtime);
    console.log(`${runtime}: ${stale ? "stale catalogue" : "current catalogue"}`);
  }
}

main().catch((error) => {
  console.error(`Deployment smoke check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
