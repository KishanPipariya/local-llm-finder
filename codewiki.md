# Code Wiki — Mac Local LLM Finder

## Purpose

Mac Local LLM Finder is a privacy-first Next.js application that recommends
current local chat and coding models that fit a chosen Apple Silicon Mac. It
uses public Hugging Face data, keeps submitted hardware details only within the
request, and renders recommendations without requiring client-side JavaScript.

## Request and data flow

```text
Browser GET /?chip=…&memoryGb=…&diskGb=…&workload=…
  -> app/page.tsx validates the query
  -> lib/recommendation-service.ts obtains the catalogue and ranks artifacts
  -> server-rendered FinderForm and Results response

Browser POST /api/recommendations (same configuration JSON)
  -> app/api/recommendations/route.ts validates the body
  -> the same recommendation service
  -> JSON result, 400 validation error, or 503 catalogue error
```

`app/page.tsx` is intentionally a server component. Its query parameters make
the page request-time rendered. The form in `FinderForm` uses `method="get"`,
so the ordinary page flow remains functional when JavaScript is disabled.
`HardwareSelector` is a small progressive-enhancement client component: after
hydration it exposes only unified-memory options supported by the selected chip
and chooses the closest valid amount (ties go lower) when a chip change makes
the current amount impossible. The initial server-rendered HTML retains the
complete memory list, so no-JavaScript users keep the same server-validated
fallback flow.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/layout.tsx` | Root HTML layout and site metadata. |
| `app/page.tsx` | Parses GET query values, validates them, retrieves results, and renders page-level errors. |
| `app/components/finder-form.tsx` | Accessible configuration form and field-level validation messages. |
| `app/components/hardware-selector.tsx` | Client-side chip/memory filtering and accessible automatic-adjustment announcement. |
| `app/components/results.tsx` | Results heading, stale-catalogue notice, empty state, and pace disclaimer. |
| `app/components/recommendation-card.tsx` | Recommendation details, Hugging Face link, and runtime guidance. |
| `app/api/recommendations/route.ts` | Node.js POST JSON endpoint; exposes `createPostHandler` for testing. |
| `lib/recommendations.ts` | Pure validation, memory and pace estimates, eligibility, scoring, ranking, and guidance. |
| `lib/recommendation-service.ts` | Composition layer joining catalogue retrieval to ranking. |
| `lib/catalogue.ts` | Server-side Hugging Face requests and conversion to normalized artifacts. |
| `lib/catalogue-cache.ts` | Six-hour, process-local cache with request coalescing and stale fallback. |
| `tests/recommendations.test.ts` | Node tests for domain logic, normalization, cache behavior, and API statuses. |
| `tests/accessibility.test.ts` | Playwright and axe checks for keyboard use, validation, responsive reflow, and no-JavaScript behavior. |
| `docs/accessibility-release-checklist.md` | Manual release checks for public UI changes. |

## Core domain contracts

### Configuration validation

`validateConfig` accepts exactly four values:

- `chip`: a key in `chipProfiles`.
- `memoryGb`: one of that chip's published unified-memory options.
- `diskGb`: finite and between 1 and 4,000 GB.
- `workload`: `chat`, `coding`, or `balanced`.

It returns both an ordered error list and typed field errors. Both GET and POST
must use this function so they reject the same impossible Mac configurations.

### Artifact normalization and fit

`Artifact.sizeBytes` is the source of truth for capacity calculations;
`sizeGb` is display-only. Normalization excludes unknown, non-integer, and
smaller-than-100 MB artifacts.

- GGUF: select the smallest preferred 4-bit quantized `.gguf` file, otherwise
  the smallest valid GGUF file. It supports Ollama, LM Studio, and llama.cpp.
- MLX: add valid `config.json` and `.safetensors` file sizes. It supports MLX.
- Disk fit is strict: the exact byte size must be no greater than free disk.
- Memory estimate adds conservative file-mapping, runtime, and context overhead.
  A model is omitted when the estimate exceeds unified memory.
- Gated models remain eligible, but carry a sign-in and licence-acceptance note.

The ranking score combines model capacity, workload fit, a qualitative pace
factor, and download popularity. It keeps the highest-ranked representative of
each normalized model family and returns at most ten results.

### Pace and memory language

`expectedPace` compares a chip profile's published family memory bandwidth with
the estimated memory footprint and returns `Fast`, `Moderate`, or `Slow`.
This is deliberately qualitative, never a tokens-per-second claim. Memory
statuses are `Comfortable`, `Tight memory`, and `Likely slow`; the latter
two add operational notes.

## Catalogue lifecycle

`retrieveCatalogue` makes two server-side Hugging Face list requests: popular
GGUF repositories and repositories from `mlx-community`. It then loads model
details (up to four at once) to obtain artifact file sizes. Any individual
detail request may fall back to its list result; an empty usable catalogue fails
the full refresh.

`CatalogueCache` holds the last valid normalized catalogue in memory for six
hours. Concurrent callers share one refresh promise. If a later refresh fails
and a previous catalogue exists, it returns that catalogue with `stale: true`.
If no valid catalogue has ever been acquired, the error is propagated:

| Entry point | Invalid configuration | No catalogue available |
| --- | --- | --- |
| GET page | Inline, field-specific form errors | Inline temporary catalogue error |
| `POST /api/recommendations` | `400` with `errors` and `fieldErrors` | `503` with `error` |

No persistence layer, analytics, account service, or client-side Hugging Face
request is part of this design.

## Development and verification

Requires Node.js 22.x and npm.

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

Run all three verification commands for relevant changes. `npm test` includes
both the Node test suite and the Playwright/axe accessibility suite; the latter
starts a local Next.js development server on port 3199.

When changing visible finder UI, also follow
[`docs/accessibility-release-checklist.md`](docs/accessibility-release-checklist.md).

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
