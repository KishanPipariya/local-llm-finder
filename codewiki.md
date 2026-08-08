# Code Wiki — Mac Local LLM Finder

## Purpose

Mac Local LLM Finder is a privacy-first Next.js application that recommends
current local chat and coding models that fit a chosen Apple Silicon Mac. It
uses verified public Ollama registry manifests and public Hugging Face data,
keeps submitted hardware details only within the request, and renders
recommendations without requiring client-side JavaScript.

## Request and data flow

```text
Browser GET /?chip=…&memoryGb=…&diskGb=…&workload=…&runtime=…&context=…
  -> lib/request.ts takes the first value for repeated fields, coerces numeric query values, and validates the query
  -> lib/recommendation-service.ts obtains the catalogue and ranks artifacts
  -> server-rendered FinderForm and Results response, including typed fit explanations and exclusion counts

Browser POST /api/recommendations (same configuration JSON)
  -> app/api/recommendations/route.ts validates the body and uses the same catalogue-unavailable message
  -> the same recommendation service
  -> the same JSON result (including fit explanations and exclusion counts), 400 validation error, or 503 catalogue error
```

`app/page.tsx` is intentionally a server component. Its query parameters make
the page request-time rendered. The form in `FinderForm` uses `method="get"`,
so the ordinary page flow remains functional when JavaScript is disabled.
The page also offers three ordinary GET preset links (Everyday, Developer, and
High-capacity). Each link includes a complete valid configuration, so it is
shareable and lands directly on server-rendered results without JavaScript.
`HardwareSelector` is a small progressive-enhancement client component. Its
initial server-rendered and hydrated states retain the complete memory list, so
the selector does not shift at load time and no-JavaScript users keep the same
server-validated fallback flow. After the user explicitly changes the chip, it
exposes only that chip's supported unified-memory options and chooses the
closest valid amount (ties go lower) when the current amount is impossible.
Once any configuration query parameter is present, the four
hardware/workload fields are required; runtime and context are optional for
backwards-compatible shared URLs. Incomplete direct GET requests receive the same
field-specific errors as the JSON API.

Each recommendation card uses native, initially collapsed `<details>` controls
for installation guidance and technical/ranking information. Their summaries
have visible expand/collapse indicators and remain fully operable by mouse and
keyboard without client-side JavaScript.

The server-rendered finder presentation groups configuration controls into
Hardware, Use and context, and Runtime sections. The Runtime choices present
llama.cpp and MLX before LM Studio and Ollama. The hero repeats the
no-account, no-tracking, and no-saved-configuration promise beside the primary
task. Results keep the complete ranked shortlist, but visually mark the first
already-ranked card as the “Top pick”; this is a presentation label only and
does not alter scoring, ranking, or API output.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/layout.tsx` | Root HTML layout and site metadata. |
| `app/opengraph-image.tsx` | Code-generated 1200×630 branded social image route. |
| `app/icon.tsx` | Code-generated branded application icon route. |
| `next.config.ts` | Next configuration, including the TypeScript 6 compatibility API mode required while TypeScript 7 has no compiler API. |
| `app/page.tsx` | Uses parsed GET query values, retrieves results, and renders page-level errors. |
| `app/components/finder-form.tsx` | Accessible configuration form and field-level validation messages. |
| `app/components/hardware-selector.tsx` | Client-side chip/memory filtering and accessible automatic-adjustment announcement. |
| `app/components/results.tsx` | Results heading, plain-language catalogue status and scope disclosure, pace disclaimer, actionable exclusion disclosure, and visual Top pick designation for the first ranked item. |
| `app/components/recommendation-card.tsx` | Recommendation fit explanation, metric hierarchy, source-aware Ollama/Hugging Face link, licence and gated-model notices, and initially collapsed installation and technical/ranking disclosures. |
| `app/api/recommendations/route.ts` | Node.js POST JSON endpoint; exposes `createPostHandler` for testing. |
| `lib/request.ts` | Typed GET-query parsing and shared request-level catalogue-unavailable message. |
| `lib/recommendations.ts` | Pure validation, memory and pace estimates, eligibility, scoring, ranking, and guidance. |
| `lib/recommendation-service.ts` | Composition layer joining catalogue retrieval to ranking. |
| `lib/catalogue.ts` | Server-side Hugging Face retrieval plus curated native Ollama manifest verification and conversion to normalized artifacts. |
| `lib/catalogue-cache.ts` | Six-hour, process-local cache with request coalescing and stale fallback. |
| `tests/recommendations.test.ts` | Node tests for domain logic, ranking, cache behavior, and API statuses. |
| `tests/request.test.ts` | Node tests for GET parsing and GET/POST validation parity. |
| `tests/catalogue.test.ts` | Node tests for catalogue boundary normalization and upstream failure behavior. |
| `tests/accessibility.test.ts` | Playwright and axe checks for keyboard use, validation, responsive reflow, and no-JavaScript behavior. |
| `docs/accessibility-release-checklist.md` | Manual release checks for public UI changes. |
| `docs/showcase-checklist.md` | Demo warm-up, upstream-outage fallback, and installation-path review checklist. |
| `docs/images/recommended-results.png` | Checked-in fixture-backed screenshot used in the README. |
| `mise.toml` | Node 24 version-management configuration. |
| `.nvmrc` | Node 24 configuration for nvm. |
| `scripts/check-node-version.mjs` | Enforces Node 24 for release checks. |
| `scripts/deploy-smoke.mjs` | Tests a deployment's GET finder flow and all supported API runtime filters without persisting configurations. |

## Core domain contracts

### Configuration validation

`validateConfig` requires four values and accepts two optional preferences:

- `chip`: a key in `chipProfiles`.
- `memoryGb`: one of that chip's published unified-memory options.
- `diskGb`: finite and between 1 and 4,000 GB.
- `workload`: `chat`, `coding`, or `balanced`.
- `runtime` (optional): `ollama`, `lmStudio`, `llamaCpp`, or `mlx`. When absent,
  ranking remains runtime-neutral for legacy API callers and URLs.
- `context` (optional): `small`, `normal`, or `long`. When absent it uses the
  established conservative Normal estimate.

It returns both an ordered error list and typed field errors. Both GET and POST
must use this function so they reject the same impossible Mac configurations,
including incomplete submitted configurations.

### Artifact normalization and fit

`Artifact.sizeBytes` is the source of truth for capacity calculations;
`sizeGb` is display-only. Hugging Face responses are untrusted runtime input:
models without a valid ID are discarded, malformed optional nested metadata is
omitted, and malformed files are discarded before `Artifact` values are
created. Normalization excludes unknown, non-integer, and smaller-than-100 MB
artifacts.

- Native Ollama: the maintained candidate set is `llama3.2:3b`, `qwen3:4b`,
  `qwen3:8b`, `gemma3:4b`, `qwen2.5-coder:3b`, `qwen2.5-coder:7b`,
  `qwen3-coder:30b`, and `devstral:24b`. Every refresh fetches each public
  registry manifest, validates every recognized Ollama layer and its positive
  byte size, and uses the complete layer-byte total for disk and conservative
  memory calculations. A `404` removes a retired candidate; a malformed or
  transient registry response fails the refresh. Native entries carry a
  `pullName`, support only Ollama, link to Ollama, and use exactly
  `ollama pull <pullName> && ollama run <pullName>`.
- GGUF: retain every valid Hugging Face `.gguf` file as a separate quantization
  variant (Q2–Q8, IQ variants, and F16/BF16/F32 labels when present). It supports
  Ollama, LM Studio, and llama.cpp. Its Ollama guidance remains the explicit
  download-and-`ollama create` import recipe; arbitrary Hugging Face files never
  use `ollama pull`.
- MLX: add known positive weights, configuration, and tokenizer runtime-file
  sizes, then require the aggregate artifact to meet the 100 MB minimum. A
  missing size for any recognized required runtime file excludes the artifact.
  It supports MLX.
- Disk fit is strict: the exact byte size must be no greater than free disk.
- Memory estimate adds conservative file-mapping, runtime, and context overhead.
  Small is for short chats, Normal is the default for typical chat/coding, and
  Long reserves more headroom for large documents or repositories. A selected
  runtime filters results to directly usable formats and gives each card one
  exact-file setup command.
  A model is omitted when the estimate exceeds unified memory.
- Gated models remain eligible, but carry a sign-in and licence-acceptance note.
- When Hugging Face supplies a repository revision, exact GGUF file links and
  MLX repository links use that revision rather than a moving branch; links fall
  back to `main` or the repository root when it is unavailable. Available
  licence metadata is shown alongside gated-model notes.

The ranking score combines parameter metadata when available, workload fit, a
qualitative pace factor, a small bounded update-recency signal, and download
popularity. Download footprint is never treated as a parameter-count proxy.
It keeps the highest-ranked representative of
each normalized model-family/format/quantization variant and returns at most ten results. Every returned
recommendation includes typed fit checks (disk and memory headroom, compatible
runtimes, workload category, and pace inputs), ranking contributors, and its
normalized family key. Hugging Face `pipeline_tag` is retained alongside titles
and tags: text generation, text-to-text generation, instruct/chat, and coding
metadata add a bounded workload preference. Missing or unknown task metadata
stays eligible and neutral. Workload metadata is presented only as
coding-oriented, general chat, or mixed—not as a capability benchmark. Ranking
accepts an optional clock value for deterministic callers and tests; normal
requests use `Date.now()`. Equal scores use stable artifact identity fields as
explicit tie-breakers, so an upstream list's order cannot change a shortlist.

The recommendation result also includes an `exclusions` count by reason. Counts
include candidates rejected during Hugging Face normalization, but never expose
the rejected artifact metadata. The
UI only exposes reasons with a non-zero count and offers safe next actions for
disk, memory, unsupported-format, and invalid-size constraints. Invalid sizes
remain excluded and are never shown as installable artifacts.

### Pace and memory language

`expectedPace` compares a chip profile's published family memory bandwidth with
the estimated memory footprint and returns `Fast`, `Moderate`, or `Slow`.
This is deliberately qualitative, never a tokens-per-second claim. Memory
statuses are `Comfortable`, `Tight memory`, and `Likely slow`; the latter
two add operational notes.

## Catalogue lifecycle

`retrieveCatalogue` makes two server-side Hugging Face list requests: popular
GGUF repositories and repositories from `mlx-community`. It then loads model
details (up to four at once) to obtain artifact file sizes, while concurrently
fetching the manifest for each curated native Ollama candidate. Each request has
a 12-second timeout, while a complete refresh has a five-second deadline that
aborts all outstanding list, detail, and registry requests. An individual
Hugging Face detail request may fall back to its list result unless that
refresh-wide deadline expires; an Ollama registry failure is not tolerated
because native pull targets must be verified. An empty usable mixed catalogue
fails the full refresh.

`CatalogueCache` holds the last valid normalized catalogue in memory for six
hours. A cold cache blocks only for the five-second refresh budget; without a
successful catalogue, the refresh error is propagated. Once a catalogue has
expired, callers immediately receive the prior catalogue with `stale: true`
while one shared background refresh runs. A successful background refresh
replaces the cache and clears the retry backoff. A failed refresh is consumed
internally, keeps the prior catalogue stale, and waits five minutes before the
next refresh attempt, avoiding repeated upstream calls during an outage.
If no valid catalogue has ever been acquired, the error is propagated:

| Entry point | Invalid configuration | No catalogue available |
| --- | --- | --- |
| GET page | Inline, field-specific form errors | Inline temporary catalogue error |
| `POST /api/recommendations` | `400` with `errors` and `fieldErrors` | `503` with `error` |

No persistence layer, analytics, account service, or client-side catalogue
request is part of this design.

## Development and verification

Requires Node.js 24.x and npm.

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
npm run verify
```

`npm install` runs the `prepare` script, which configures Git to use the
version-controlled Husky hooks in `.husky/`. `pre-commit` runs `npm run lint`.
`pre-push` runs `npm run verify`, which runs linting, tests, and a production
build. The individual commands remain available, and Git's standard
`--no-verify` option can bypass a hook when explicitly needed. There is no
GitHub Actions verification workflow; local hooks are the project's verification
gate.

`npm test` includes
both the Node test suite and the Playwright/axe accessibility suite; the latter
builds the app, allocates an ephemeral localhost port, and starts a local
production Next.js server. That spawned browser-test process alone receives an
in-memory catalogue fixture; the fixture has no public endpoint or persistence
and lets the no-JavaScript flow assert successful server-rendered results
without calling the external catalogue. Cleanup explicitly terminates and waits
for the production server.

`npm run test:unit` uses Node's built-in experimental test coverage report for
the exercised server and domain modules. It enforces the current baseline of
98.28% lines, 90.10% branches, and 95.74% functions; a regression below any
threshold fails the command. Consequently, `npm test` and `npm run verify`
print and enforce this coverage report before running the separate
accessibility suite. Browser-rendered pages and components are outside this
unit-coverage scope.

Use Node 24.x (`.nvmrc` is provided). The toolchain uses ESLint 10.8.0,
`eslint-config-next` 16.3.0, `tsx` 4.23.9, and TypeScript 7.0.2. TypeScript
7 currently has no compiler API, so its official `@typescript/native` package
supplies `tsc` while the `typescript` dependency aliases the TypeScript 6
compatibility API required by Next and typescript-eslint. ESLint's official
compatibility adapter keeps Next's configured rules working under ESLint 10.

When changing visible finder UI, also follow
[`docs/accessibility-release-checklist.md`](docs/accessibility-release-checklist.md).
Use `mise.toml` as an additional Node 24 version-management configuration.

`npm test`, `npm run lint`, and `npm run build` begin by enforcing Node 24.
For an invited-demo deployment, run `npm run smoke:deploy -- <deployment-url>`
after warming the cache. It performs one valid server-rendered GET and API
requests for Ollama, LM Studio, llama.cpp, and MLX; it reports stale catalogue
status and fails on a 503, invalid response shape, or an empty compatible
shortlist. The check only sends request-scoped configurations and saves none.

## Sharing and showcase assets

Root metadata uses `https://local-llm-finder-m7qb.vercel.app/` as its canonical
and Open Graph URL and declares a large-image Twitter card. Next serves the
branded, code-generated `/opengraph-image` and `/icon` metadata routes using
the same cream, navy, and blue visual language as the finder. The README's
`docs/images/recommended-results.png` is captured from the fixture-backed
production server, not from a live catalogue. See
[`docs/showcase-checklist.md`](docs/showcase-checklist.md) before a demo or
recording.

## Safe change checklist

1. Keep the GET form server-rendered and behaviorally aligned with the POST API.
2. Update focused tests when modifying validation, normalization, estimates,
   ranking, cache behavior, or API errors.
3. Preserve the privacy boundary: configuration values are request input only.
4. Keep disk checks byte-accurate and memory estimates conservative.
5. Preserve accessible labels, error associations, focus behavior, responsive
   layout, and the qualitative-pace disclaimer.
6. Update this wiki whenever architecture, flows, contracts, commands, or
   repository layout change.
