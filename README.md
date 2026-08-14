# Mac Local LLM Finder

[Try the live demo](https://local-llm-finder-m7qb.vercel.app/) — a privacy-first finder for current local chat and coding models that fit an Apple Silicon Mac.

![Fixture-backed recommended results](docs/images/recommended-results.png)

Your Mac configuration is used only for that request; it is not saved. The finder gives conservative, best-effort compatibility and storage estimates—not guarantees that a download, import, or run will succeed—and qualitative pace estimates rather than performance benchmarks.

## Alternatives

You can also explore local-model tools and catalogues directly:

- [Local LLM](https://localllm.fun/) for finding models that fit your hardware.
- [ModelLens](https://modellens.ai/) for model-memory estimates and hardware compatibility.
- [LLM Fit Check](https://llmfitcheck.com/) for estimating whether a model fits GPU VRAM, Apple unified memory, or system RAM.
- [Can I Run LLMs Locally?](https://canirunllms.com/) for GPU and Apple Silicon memory-compatibility estimates.
- [Ollama](https://ollama.com/) for downloading and running supported models locally.
- [LM Studio](https://lmstudio.ai/) for discovering and running local models through a desktop app.
- [Hugging Face](https://huggingface.co/models) for browsing model repositories and files.
- [MLX](https://ml-explore.github.io/mlx/build/html/index.html) for Apple Silicon-focused machine-learning tooling.

## Highlights

- Complete, shareable GET links and a server-rendered form that work without JavaScript.
- Validated Apple Silicon chip and unified-memory combinations.
- Hugging Face GGUF recommendations for Ollama, LM Studio, and llama.cpp, plus MLX recommendations for MLX.
- A server-side Hugging Face catalogue with a shared six-hour refresh cache, six-hour local cache, and stale fallback.

## Request and data flow

```text
GET form or preset link ─┐
                         ├─> validate Mac profile ─> server-side catalogue cache ─> ranked HTML results
POST /api/recommendations ┘                                      └───────────────> JSON results
```

## API

`POST /api/recommendations` accepts the same configuration used by the GET form:

```json
{
  "chip": "m4",
  "memoryGb": 16,
  "diskGb": 80,
  "workload": "balanced",
  "runtime": "ollama",
  "context": "normal"
}
```

A successful response returns the existing recommendation result object, including `recommendations`, `exclusions`, and `stale`. Invalid configurations return `400` with `errors` and `fieldErrors`; a catalogue outage with no cached result returns `503` with `error`. JSON request bodies are bounded before parsing. The GET-only `runtime=any` choice represents the legacy runtime-neutral preference; the JSON API accepts only concrete runtime names.

Hugging Face GGUF files use import-based Ollama guidance; the finder never
emits `ollama pull` for an arbitrary Hugging Face file. Gated artifacts keep
their licence warning and use `hf auth login` plus an exact-revision download
before the runtime-specific import command.

## Catalogue refresh and fallback

The complete server-side catalogue refresh is shared through Next.js's
six-hour persistent cache, so source data can be up to six hours old. Each process
also keeps its own six-hour `CatalogueCache`: it coalesces requests, serves the
last valid result as stale during a refresh or outage, marks an already-expired
refresh result as stale, and waits five minutes before retrying a failed refresh.
If neither cache has a valid catalogue, the GET flow shows its temporary error
and the API returns `503`.

Each shared refresh uses four Hugging Face `full=true` list responses (20 popular
and 20 recently updated GGUF repositories, plus the same two samples from
`mlx-community`), then requests each selected
repository's `blobs=true` metadata before normalizing it. There are no
non-Hugging-Face catalogue requests. MLX sizes represent the complete snapshot
download and are rejected when any repository file has an unknown size; imports
may also need temporary free disk space beyond the displayed download size.

## Run locally

You need Node.js 24.x.

Use `mise exec node@24 -- …` or `nvm use` (the repository includes `.nvmrc`) to
select it. The release checks reject other Node major versions.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) after the development server starts.

## Private-demo smoke check

After warming a deployment's catalogue cache, run:

```bash
npm run smoke:deploy -- https://your-deployment.example
```

It checks a server-rendered GET and JSON API shortlists for Ollama, LM Studio,
llama.cpp, and MLX. It reports stale catalogue status and fails on unavailable,
malformed, or empty compatible results. Submitted configurations are request-only.

For project internals, development checks, and architecture details, see [codewiki.md](codewiki.md).
For a repeatable demo handoff, see [the showcase checklist](docs/showcase-checklist.md).
