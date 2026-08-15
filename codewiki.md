# Code Wiki — Mac Local LLM Finder

## Purpose

Mac Local LLM Finder is a privacy-first Next.js application that recommends
current local chat and coding models that fit a chosen Apple Silicon Mac. It
uses a server-side public Hugging Face catalogue,
keeps submitted hardware details only within the request, and renders
recommendations without requiring client-side JavaScript.

## Request and data flow

```text
Browser GET /?chip=…&memoryGb=…&diskGb=…&workload=…&runtime=…&context=…
  -> lib/request.ts takes the first value for repeated fields, coerces numeric query values, and delegates hardware validation to lib/hardware.ts
  -> lib/recommendation-service.ts obtains the catalogue and ranks artifacts
  -> server-rendered FinderForm and Results response, including typed fit explanations and exclusion counts

Browser POST /api/recommendations (same configuration JSON)
  -> app/api/recommendations/route.ts bounds the JSON body, validates it, and uses the same catalogue-unavailable message
  -> the same recommendation service
  -> the same JSON result (including fit explanations and exclusion counts), 400 validation error, or 503 catalogue error
```

`app/page.tsx` is intentionally a server component. Its query parameters make
the page request-time rendered; it explicitly opts out of instant prerendering
so the query-bound GET form and catalogue response stay in one server-rendered
request. The form in `FinderForm` uses `method="get"`,
so the ordinary page flow remains functional when JavaScript is disabled.
The page also offers three ordinary GET presets organized around first-time goals
(Everyday chat, Help with coding, and Large code and documents). Each states its
Mac, free-storage, and runtime assumptions and includes a complete valid
configuration, so it is shareable and lands directly on server-rendered results
without JavaScript. The form includes a native “Find your Mac specs” disclosure
that explains chip, unified memory, and free disk space in plain language.
`FinderForm` and its small `HardwareSelector` enhancement server-render the
union of memory options so the GET form remains usable without JavaScript. After
hydration, the selector narrows to the selected chip's valid options. With
JavaScript, changing chip retains a compatible memory amount or chooses the
closest valid amount (ties go lower), then announces the adjustment. The live
“Profile ready” summary and submit label reflect chip, memory, available
storage, use, context, and runtime as choices change. Without JavaScript, the
same GET form remains usable and server validation provides field-specific
recovery for impossible shared URLs. Validation summaries link directly to the
invalid control and focus it when activated.
Once any configuration query parameter is present, the four
hardware/workload fields are required; runtime and context are optional for
backwards-compatible shared URLs. Incomplete direct GET requests receive the same
field-specific errors as the JSON API.

Each recommendation card uses native, initially collapsed `<details>` controls
for installation guidance and technical/ranking information. Their summaries
have visible expand/collapse indicators and remain fully operable by mouse and
keyboard without client-side JavaScript.

The server-rendered finder presentation groups configuration controls into
Hardware, outcome/context, and Runtime sections. Context is described as how
much text or code belongs in one conversation; Balanced, Normal context, and
Ollama are explicitly marked as sensible first-time defaults. An explicit Any
compatible format runtime option preserves runtime-neutral legacy links. The hero repeats
the no-account, no-tracking, and no-saved-configuration promise beside the
primary task. Results begin with a compact submitted-setup summary and an Edit
profile GET link that preserves the complete configuration. They visually mark
the first already-ranked card as the “Top pick”, explain its fit,
download/storage, qualitative pace, and offer a primary runtime-specific model
source link alongside the collapsed installation guidance. Remaining cards are grouped as alternatives with a one-line choice cue.
This presentation does not alter scoring, ranking, or API output. Catalogue
scope and performance caveats are kept in a native “How these results work”
disclosure while freshness remains visible. An empty shortlist renders an
actionable recovery panel with an Edit profile link, rather than only listing
exclusions.

The responsive presentation preserves the desktop and tablet grids while
reflowing phone widths from 320 CSS pixels upward. On phones, the finder and
recommendation cards use one column, radio choices use full-width 44px targets,
and long links and disclosure summaries wrap rather than overflow.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/layout.tsx` | Root HTML layout and site metadata. |
| `app/opengraph-image.tsx` | Code-generated 1200×630 branded social image route. |
| `app/icon.tsx` | Code-generated branded application icon route. |
| `next.config.ts` | Next configuration, including the TypeScript 6 compatibility API mode required while TypeScript 7 has no compiler API. |
| `app/page.tsx` | Server-side route composition: parses GET query values, retrieves results, and passes them to presentation sections. |
| `app/components/hero.tsx` | Static editorial hero and privacy promise. |
| `app/components/preset-links.tsx` | Complete, shareable GET profile links. |
| `app/components/site-footer.tsx` | Product constraints and runtime-format footer. |
| `app/components/finder-form.tsx` | Progressively enhanced accessible configuration form, live profile summary, contextual guidance, and field-level validation recovery. |
| `app/components/hardware-selector.tsx` | Chip-valid memory selector and accessible automatic-adjustment announcement. |
| `app/components/results.tsx` | Results heading, submitted setup summary/edit link, top-pick and alternatives grouping, no-results recovery, catalogue disclosure, and actionable exclusion disclosure. |
| `app/components/results-header.tsx` | Timestamp, stale-status, and shortlist heading presentation. |
| `app/components/recommendation-card.tsx` | Recommendation fit explanation, metric hierarchy, Hugging Face source link, licence and gated-model notices, and initially collapsed installation and technical/ranking disclosures. |
| `app/components/recommendation-metrics.tsx` | Reusable download, memory, pace, and setup-check card section. |
| `app/api/recommendations/route.ts` | POST JSON endpoint; exposes `createPostHandler` for testing. |
| `lib/request.ts` | Typed GET-query parsing and shared request-level catalogue-unavailable message. |
| `lib/hardware.ts` | Typed Apple Silicon profiles and configuration validation used by request boundaries and interactive hardware controls. |
| `lib/recommendation-request.ts` | Typed POST request boundary that maps shared validation and catalogue failures to the API contract. |
| `lib/recommendations.ts` | Pure memory and pace estimates, eligibility, scoring, ranking, and runtime guidance. |
| `lib/recommendation-service.ts` | Composition layer joining catalogue retrieval to ranking and safely merging typed exclusion counts. |
| `lib/catalogue.ts` | Stable retrieval facade: server-side Hugging Face retrieval, metadata normalization, and framework-cache composition. |
| `lib/catalogue-request.ts` | Shared upstream timeout, bounded JSON-response, and bounded-concurrency helpers. |
| `lib/catalogue-cache.ts` | Six-hour, process-local cache with request coalescing, stale fallback, and retry backoff. |
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

`lib/hardware.ts` is the sole owner of chip profiles, runtime/context types, and `validateConfig`. Validation requires four values and accepts two optional preferences:

- `chip`: a key in `chipProfiles`.
- `memoryGb`: one of that chip's published unified-memory options.
- `diskGb`: finite and between 1 and 4,000 GB.
- `workload`: `chat`, `coding`, or `balanced`.
- `runtime` (optional): `ollama`, `lmStudio`, `llamaCpp`, or `mlx`. When absent,
  ranking remains runtime-neutral for legacy API callers and URLs.
- The finder exposes that neutral state as `runtime=any` in shareable GET links;
  it is parsed as an omitted runtime preference and is not accepted by the JSON
  API as a runtime value.
- `context` (optional): `small` (4K tokens), `normal` (16K tokens), or `long`
  (32K tokens). When absent it uses the established conservative Normal
  estimate. UI edit links serialize omitted context as `normal` and omitted
  runtime as `any`, so a round trip preserves the visible runtime-neutral profile.

It returns both an ordered error list and typed field errors. Both GET and POST
must use this function so they reject the same impossible Mac configurations,
including incomplete submitted configurations.

The hardware selector server-renders the union of all memory sizes so a person
can choose a valid chip/memory pair even with JavaScript disabled. After
hydration, the client narrows that list to the selected chip and adjusts memory
to the nearest supported value when the chip changes.

### Artifact normalization and fit

`Artifact.sizeBytes` is the source of truth for capacity calculations;
`sizeGb` is display-only. Hugging Face responses are untrusted runtime input:
models without a valid ID are discarded, malformed optional nested metadata is
omitted, and malformed files are discarded before `Artifact` values are
created. Normalization excludes unknown, non-integer, and smaller-than-100 MB
artifacts.

- GGUF: retain every valid, standalone Hugging Face `.gguf` file as a separate
  quantization variant (Q2–Q8, IQ variants, and F16/BF16/F32 labels when
  present). Split shards and auxiliary `mmproj`, tokenizer, adapter, LoRA, and
  imatrix files are excluded because the exact-file guidance cannot run them by
  themselves. Explicit unknown or incompatible pipeline tasks are excluded;
  missing task metadata is accepted only when the model has a text/chat/coding
  or known model-family/format signal in its ID, tags, or GGUF chat-template metadata; otherwise it is counted
  as an unsupported artifact. It supports Ollama, LM Studio, and llama.cpp. Each
  runtime recipe downloads into a fresh temporary directory (`curl` for an
  unpinned ungated GGUF file, `hf` for pinned or gated files and MLX snapshots), uses an
  artifact-specific local model name, and shell-quotes catalogue-controlled
  values; unsafe control-character and traversal paths are discarded before
  guidance is built; arbitrary Hugging Face files never use `ollama pull` or a catalogue
  search command. `sourceUrl` remains the exact GGUF download or MLX
  repository URL used by installation guidance, while optional `viewUrl`
  points to the human-facing Hugging Face file or repository viewer. Model
  context metadata is normalized to
  `maxContextTokens` when available.
- MLX: require at least one positively sized `.safetensors` weight file and a
  supported text-generation pipeline, then sum every file in the repository
  snapshot—not only recognised runtime assets.
  Any unknown, non-integer, or non-positive included file size excludes the
  artifact, and the aggregate must meet the 100 MB minimum. This keeps snapshot
  download estimates conservative. Its guidance uses `uvx --from mlx-lm
  mlx_lm.generate`. It supports MLX.
- Disk fit is operationally strict: normal downloads and temporary working files
  use a 1.25× artifact estimate, while GGUF results that may use Ollama use 2.5×
  to account for the downloaded file and temporary import copy while preserving
  20% free disk. Recommendations can still warn when operational headroom is only
  20–25%, and each card states the assumption used.
- Memory estimate adds conservative file-mapping, runtime, and context overhead.
  Small (4K tokens) is for short chats, Normal (16K tokens) is the default for
  typical chat/coding, and Long (32K tokens) reserves more headroom for large
  documents or repositories. A selected runtime filters results to directly
  usable formats and gives each card one exact-file setup command.
  Context surcharges remain additive even for large artifacts, so changing from
  Small to Normal to Long always changes the estimate. Parameter metadata is
  ignored when it is implausibly large for the exact artifact size. A model is
  omitted when the estimate exceeds unified memory. Recommendations
  warn when estimated unified-memory headroom is below 2 GB; eligibility itself
  remains unchanged. Known model context limits below the selected 4K, 16K, or
  32K preset are excluded as `insufficientContext`; unknown limits remain
  eligible but are labeled as memory-only estimates. Fit estimates are not
  run-success guarantees.
- Gated models remain eligible, but carry a sign-in and licence-acceptance note.
  Their guidance starts with `hf auth login`, downloads the exact artifact or
  repository snapshot at the immutable Hugging Face revision when available,
  then runs the runtime-specific local import command.
- When Hugging Face supplies a repository revision, it is retained in normalized
  artifact metadata. Exact GGUF file links and MLX repository links use that
  revision rather than a moving branch; links fall back to `main` or the
  repository root when it is unavailable. Available
  licence metadata is shown alongside gated-model notes.

The ranking score combines parameter metadata when available, workload fit, a
qualitative pace factor, a small bounded update-recency signal, and download
popularity. Download footprint is never treated as a parameter-count proxy.
It keeps the highest-ranked representative of
each normalized model-family/format/quantization variant, prioritizes one
representative from each family before adding additional variants, and returns at most ten results. Every returned
recommendation includes typed fit checks (disk and memory headroom, verified or
unknown context capacity, compatible runtimes, workload category, and pace
inputs), ranking contributors, and its
normalized family key. Hugging Face `pipeline_tag` is retained alongside titles
and tags: generic `text-generation` and `text2text-generation` identify compatible
generation tasks but do not by themselves imply chat suitability; instruct/chat
tags, conversational tasks, and GGUF chat-template metadata provide chat signals.
Missing task metadata stays eligible and neutral; explicit unknown or incompatible
pipeline tasks are excluded conservatively. Numeric parameter metadata is
normalized to billions from standard GGUF or safetensors totals, model-card
values, base-model names, or repository names when plausible. Workload metadata is presented only as
coding-oriented, general chat, mixed, or unknown—not as a capability benchmark. A bounded
precision preference ranks higher-precision variants ahead of more aggressively
compressed variants when both fit; this is not presented as a quality benchmark. Ranking
accepts an optional clock value for deterministic callers and tests; normal
requests use `Date.now()`. Equal scores use stable artifact identity fields as
explicit tie-breakers, so an upstream list's order cannot change a shortlist.

The recommendation result also includes an `exclusions` count by reason. Counts
include candidates rejected during Hugging Face normalization, but never expose
the rejected artifact metadata. GGUF invalid-size exclusions are counted per
file because each file is a separately recommendable artifact; MLX invalid-size
exclusions are counted once per repository snapshot because MLX downloads the
complete repository. The
UI only exposes reasons with a non-zero count and offers safe next actions for
disk, memory, context, unsupported-format, unsupported-artifact, and invalid-size
constraints. Invalid sizes, incomplete files, and known non-chat tasks remain
excluded and are never shown as installable artifacts.

### Pace and memory language

`expectedPace` compares a chip profile's conservative lower-bound published
memory bandwidth with the estimated memory footprint and returns `Fast`,
`Moderate`, or `Slow`. A chip selector does not identify GPU tier, so Max-family
profiles use the slowest bandwidth among supported configurations rather than
overstating pace for lower-tier variants.
This is deliberately qualitative, never a tokens-per-second claim. Memory
statuses are `Comfortable`, `Tight memory`, and `Likely slow`; the latter two
add operational notes. All fit language is best-effort rather than a strict
guarantee, because installed apps, import workflows, thermals, and other active
workloads can change the result.

## Catalogue lifecycle

`retrieveCatalogue` makes four server-side Hugging Face `full=true` list
requests: 20 popular and 20 recently updated repositories filtered by the GGUF
format, plus the same
two 20-repository samples from `mlx-community`. The interleaved sample gives
newer repositories a chance to enter the bounded detail crawl without making
refresh latency unbounded.
Because those list responses contain filenames but not reliable byte sizes, it
then obtains each selected repository's `blobs=true` metadata with a bounded
global concurrency of six in-flight requests across both formats. Each upstream response is capped at 8 MiB and each repository is capped at 20,000 metadata files before normalization. A repository that disappears or
fails during that second step is excluded; its unverified files are never
recommended. The detail response also supplies optional model configuration and
GGUF context metadata used to verify the selected context preset. If more than half of detail requests fail overall, more than half
fail within either format, or no verified repository remains for a format, the
refresh is treated as materially incomplete and fails atomically rather than
replacing the last valid catalogue with a severely truncated one. Each request has a 12-second
timeout, while a complete refresh has a 30-second deadline that aborts all
outstanding work. A refresh-controller abort fails the complete refresh
atomically so the last valid local catalogue can be served as stale. An empty
usable catalogue also fails the full refresh.

Next.js Cache Components' `use cache` directive wraps the complete production
refresh with a six-hour revalidation interval. `CatalogueCache` holds the last
valid normalized catalogue in each process for six hours. A cold local cache
blocks only for the shared refresh budget; without a successful catalogue, the
error is propagated. Once a catalogue has expired, callers immediately receive
the prior catalogue with `stale: true` while one shared background refresh runs.
A successful background refresh replaces the cache and clears the retry backoff.
A stale response schedules that refresh through Next.js `after()` so supported
serverless hosts can finish the work after sending the response instead of
discarding an unawaited promise.
A failed refresh—or a framework-cache call that resolves only to an already
stale catalogue—is consumed internally, keeps the prior catalogue stale, and
waits five minutes before the next refresh attempt, avoiding repeated upstream
calls during an outage. Cold failures also honour the same backoff before
returning another unavailable response.
If a cold or completed refresh yields a catalogue already older than six hours,
it is returned with `stale: true`; freshness never claims that an old catalogue
is current. If no valid catalogue has ever been acquired, the error is propagated:

| Entry point | Invalid configuration | No catalogue available |
| --- | --- | --- |
| GET page | Inline, field-specific form errors | Inline temporary catalogue error |
| `POST /api/recommendations` | `400` with `errors` and `fieldErrors` | `503` with `error` |

No application persistence layer, analytics, account service, or client-side
catalogue request is part of this design. The framework cache is an optimization;
the process-local cache remains the source of stale-fallback behavior.

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
version-controlled Husky hooks in `.husky/`. Both hooks explicitly use
`mise exec node@24` so they do not inherit an incompatible shell Node version.
`pre-commit` runs linting. `pre-push` runs `npm run verify:prepush` (lint,
unit tests, and a production build); the longer Playwright/axe suite remains in
`npm test` and the full `npm run verify` release check. The individual commands
remain available, and Git's standard `--no-verify` option can bypass a hook
when explicitly needed. GitHub Actions is the repository verification gate: it
runs on pull requests and pushes to `main`, using Node 24 with npm caching, and
executes a production-dependency audit, linting, coverage-gated unit tests, the
production build (as part of the accessibility suite), and the Playwright/axe
checks. Husky remains local feedback; Git hooks can
still be bypassed, but the CI checks cannot be bypassed through `--no-verify`.

`npm test` includes
both the Node test suite and the Playwright/axe accessibility suite; the latter
builds the app, allocates an ephemeral localhost port, and starts a local
production Next.js server. That child process imports a test-only Node fetch
mock that returns Hugging Face list and per-repository blob-metadata responses,
so browser checks exercise the production retrieval and normalization path
without external network access. Production code has no fixture switch or
catalogue environment variable. Cleanup explicitly terminates and waits for the
production server.

`npm run test:unit` uses Node's built-in experimental test coverage report for
the exercised server and domain modules. It enforces whole-number gates of 98%
lines, 92% branches, and 97% functions; a regression below any threshold fails
the command. Consequently, `npm run test:unit`,
`npm run verify:prepush`, `npm test`, and `npm run verify` print and enforce
this coverage report. Browser-rendered pages and components are outside this
unit-coverage scope.

Use Node 24.x (`.nvmrc` is provided). The toolchain uses ESLint 9.39.1,
`eslint-config-next` 16.3.0, `tsx` 4.23.9, and TypeScript 7.0.2. TypeScript
7 currently has no compiler API, so its official `@typescript/native` package
supplies `tsc` while the `typescript` dependency aliases the TypeScript 6
compatibility API required by Next and typescript-eslint. ESLint's official
compatibility adapter keeps Next's configured rules working in flat config.

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
`docs/images/recommended-results.png` is captured from the fetch-mocked
production retrieval path, not from a live catalogue. See
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
