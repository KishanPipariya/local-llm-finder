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
- Hugging Face GGUF recommendations for Ollama, LM Studio, and llama.cpp, plus MLX recommendations for MLX, with separate viewer and download links.
- A server-side Hugging Face catalogue with a six-hour framework refresh cache, six-hour local cache, and stale fallback.

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

A successful response returns the existing recommendation result object, including `recommendations`, `exclusions`, and `stale`. Exclusions include disk, memory, verified-context, invalid-size, unsupported-format, unsupported-artifact, and catalogue-limit counts. Invalid configurations return `400` with `errors` and `fieldErrors`; a catalogue outage with no cached result returns `503` with `error`. JSON request bodies are limited to 32 KiB and five seconds of body-read time before parsing. The GET-only `runtime=any` choice represents the legacy runtime-neutral preference; the JSON API accepts only concrete runtime names.

Hugging Face GGUF files use import-based Ollama guidance; the finder never
emits `ollama pull` for an arbitrary Hugging Face file. Human-facing source links
open the Hugging Face viewer while public GGUF installation guidance downloads
the exact revision URL with macOS's built-in `curl`. Gated GGUF artifacts keep
their licence and `hf` CLI prerequisite warning, then use `hf auth login` plus
an exact-revision download. MLX guidance uses `uvx hf` and `mlx-lm`, so it
requires `uv`/`uvx` rather than a separately installed `hf` command. llama.cpp
and MLX recipes keep their downloads in an artifact-specific directory under
`./local-models`; Ollama and LM Studio use temporary staging because their
import steps persist the model elsewhere. Runtime suggestions are inferred from
GGUF or MLX format and do not verify architecture support in the installed app
version.

## Catalogue refresh and fallback

The complete server-side catalogue refresh uses Next.js Cache Components with a
six-hour revalidation interval, so source data can be up to six hours old. Each process
also keeps its own six-hour `CatalogueCache`: it coalesces requests, serves the
last valid result as stale during a refresh or outage, marks an already-expired
refresh result as stale, and waits five minutes before retrying a failed refresh
or failed background-work registration.
If neither cache has a valid catalogue, the GET flow shows its temporary error
and the API returns `503`.

Each framework-cached refresh uses four Hugging Face `full=true` list responses (20 popular
and 20 recently updated repositories filtered by the GGUF format, plus the same two samples from
`mlx-community`). A refresh tolerates either the popular or recent request failing
within a format, but requires at least one valid discovery response for both GGUF
and MLX. Responses to the MLX feeds are explicitly checked to remain within the
requested `mlx-community` owner. It then requests each selected repository's `blobs=true` metadata and
normalizes the verified responses. There are no
non-Hugging-Face catalogue requests. MLX sizes represent the complete snapshot
download and are rejected when any repository file has an unknown size; imports
may also need temporary free disk space beyond the displayed download size.
Repository IDs must match Hugging Face's bounded `owner/name` grammar, and each
detail response must repeat the exact requested repository ID and supply a
canonical 40-character commit hash before its artifacts can enter the production
catalogue. Parameter metadata is retained
only when the exact artifact size is plausible for its declared quantization or
precision, using a conservative Q2 floor when precision is unknown.
Adapter-only LoRA, QLoRA, and PEFT repositories—including plural metadata
signals—are not treated as runnable MLX base models, and equivalent GGUF
adapter files are excluded from standalone recommendations. MLX snapshots must
also contain every declared weight shard, a root model config, self-contained
tokenizer assets, and at least 100 MB of recognized model weights independently
of unrelated snapshot files. Model-weight recognition is
limited to standard model, weights, or consolidated safetensors names so
tokenizer and training-state files cannot satisfy the snapshot check. Duplicate
normalized repository paths and repositories containing any malformed sibling
entry are rejected before snapshot sizing. Structured GGUF or safetensors
parameter metadata takes precedence over optional model-card values; positive
totals and non-negative parameter groups must be safe integers, malformed group
maps are discarded atomically, and group sums must remain safe integers. Split
GGUF files with numeric `N-of-M` suffixes are excluded rather than being presented as
standalone downloads. Normalized metadata has per-field, per-repository, and whole-refresh
size limits in addition to the upstream response-size bound. GGUF
results that can fit Ollama reserve a larger operational disk estimate for the
download and temporary import copy. With the runtime-neutral option, runtimes
whose workflow does not fit are removed individually instead of excluding an
artifact that remains usable through another GGUF runtime. Missing task metadata
requires explicit text, chat, or coding evidence rather than a repository format,
author, or model family name. A refresh must retain at least one usable GGUF and
MLX artifact, and each repository contributes at most 64 deterministic GGUF
variants sampled across represented quantizations and sizes. Valid variants
omitted by that operational cap are reported separately in the exclusion
summary. Upstream body reads remain subject to their request deadline even after
response headers arrive.

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
malformed, or empty format-compatible results. Submitted configurations are request-only.
Each smoke-check request has a 60-second deadline.

For project internals, development checks, and architecture details, see [codewiki.md](codewiki.md).
For a repeatable demo handoff, see [the showcase checklist](docs/showcase-checklist.md).
