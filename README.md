# Mac Local LLM Finder

[Try the live demo](https://local-llm-finder-m7qb.vercel.app/) — a privacy-first finder for current local chat and coding models that fit an Apple Silicon Mac.

![Fixture-backed recommended results](docs/images/recommended-results.png)

Your Mac configuration is used only for that request; it is not saved. The finder gives conservative compatibility, storage, and qualitative pace estimates rather than performance benchmarks.

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
- Verified native Ollama pulls for Ollama, plus Hugging Face GGUF recommendations for LM Studio and llama.cpp and MLX recommendations for MLX.
- A server-side mixed Ollama-registry/Hugging-Face catalogue with six-hour caching and stale fallback.

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

A successful response returns the existing recommendation result object, including `recommendations`, `exclusions`, and `stale`. Invalid configurations return `400` with `errors` and `fieldErrors`; a catalogue outage with no cached result returns `503` with `error`.

Native Ollama recommendations include `pullName` and always provide the exact
command `ollama pull <pullName> && ollama run <pullName>`. Hugging Face GGUF
files keep their import-based Ollama guidance; the finder never emits `ollama
pull` for an arbitrary Hugging Face file.

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
