# AGENTS.md

## Project

Mac Local LLM Finder is a privacy-first Next.js app that recommends current local
chat and coding models for a selected Apple Silicon Mac configuration.

- Do not persist submitted hardware configurations.
- Preserve the server-rendered GET form flow; recommendations must work without
  client-side JavaScript.
- The `POST /api/recommendations` endpoint must remain behaviorally consistent
  with the form flow.

## Stack

- Node.js 24.x; use npm.
- Next.js App Router, React, TypeScript (strict), and plain CSS in
  `app/globals.css`.

## Verification

- During development, run the focused suite for the area changed.
- Before handing off changes, run:

  ```bash
  npm run verify
  ```

- `npm run verify` runs lint, unit tests, a production build, and the
  accessibility suite.
- UI or request-flow changes must include the accessibility suite.
- If a required check cannot run, report exactly which check failed to run and
  why.

## Architecture

- `app/page.tsx`: server-rendered GET flow and page composition.
- `app/api/recommendations/route.ts`: thin JSON API adapter; return `400` for
  invalid input and `503` when the catalogue cannot be obtained.
- `lib/hardware.ts`: chip profiles, configuration types, and shared validation.
- `lib/request.ts`: GET-query parsing.
- `lib/recommendation-request.ts`: bounded POST parsing and API error mapping.
- `lib/recommendation-service.ts`: shared catalogue-to-ranking orchestration
  used by GET and POST.
- `lib/recommendations.ts`: pure eligibility, memory and disk estimates,
  ranking, and installation guidance.
- `lib/catalogue.ts`: Hugging Face retrieval and normalization facade.
- `lib/catalogue-request.ts`: upstream timeouts, response-size limits, and
  concurrency helpers.
- `lib/catalogue-cache.ts`: cache freshness, request coalescing, retry behavior,
  and stale fallback.
- `tests/recommendations.test.ts`: domain, ranking, cache, and API-status tests.
- `tests/request.test.ts`: GET parsing and GET/POST validation-parity tests.
- `tests/catalogue.test.ts`: upstream-boundary and normalization tests.
- `tests/accessibility.test.ts`: Playwright and axe coverage for keyboard use,
  validation, responsive behavior, and operation without JavaScript.

## Behavioral requirements

- Validate chip and unified-memory combinations against `chipProfiles`; do not
  accept impossible hardware configurations.
- Treat the M1 through M5 family entries currently in `chipProfiles` as a
  verified hardware baseline. Do not recheck or change their supported unified
  memory configurations or conservative family-level memory-bandwidth values
  during routine work. Where a family has multiple chip bins, the baseline may
  intentionally use the lowest published bandwidth (for example, the Max
  families) so pace estimates remain conservative.
- Reverify that baseline only when the user explicitly requests a hardware-data
  audit or when correcting specific evidence that an entry is wrong. Verify
  newly added chip families beyond M5 against Apple's published specifications
  before adding them.
- Keep memory estimates conservative and disk-fit checks strict.
- Treat expected pace as a qualitative estimate based on memory bandwidth and
  model footprint, never as a tokens-per-second benchmark.
- Fetch the public Hugging Face catalogue server-side only.
- Retain the six-hour in-memory cache and return the last valid catalogue when a
  refresh fails; surface that result as stale.
- Exclude artifacts with unknown or implausibly small sizes, and retain gated
  model warnings.
- Support GGUF recommendations for Ollama, LM Studio, and llama.cpp, and MLX
  recommendations for MLX.
- MLX recommendations must be complete, self-contained model snapshots. Reject
  adapter-only, LoRA, QLoRA, and PEFT repositories even when they contain a
  `.safetensors` file; never treat adapter weights as a runnable base model.
- GET and POST must use `validateConfig` and `getRecommendations`; do not
  independently reimplement validation, catalogue handling, or ranking at
  either request boundary.
- Preserve equivalent successful recommendation data and validation behavior
  across GET and POST. Transport-specific response shapes and status codes may
  differ as documented.
- Treat all Hugging Face metadata, filenames, URLs, and response bodies as
  untrusted input.
- Preserve request timeouts, request and response size bounds, bounded
  concurrency, normalized metadata size/cardinality bounds, safe path
  validation, and shell-safe installation guidance.
- Installation commands must identify exact normalized artifacts; never turn
  arbitrary catalogue data into an unvalidated shell command.

## Change guidance

- Add or update focused tests whenever changing validation, ranking, memory
  estimates, cache behavior, normalization, or API error handling.
- Update `codewiki.md` in the same change when modifying module ownership or
  file layout; GET or POST request/data flows; validation, caching, ranking, or
  normalization contracts; supported runtimes, formats, or installation flows;
  or build, test, deployment, or operational commands.
- Pure presentation or copy changes do not require a repository-map update
  unless they change a documented accessibility or behavioral contract.
- Avoid adding analytics, account integrations, databases, or environment
  variables unless the product requirement explicitly changes.
- For form, component, or CSS changes, preserve keyboard operation, visible
  focus, linked and focusable validation summaries, operation without
  JavaScript, semantic native controls where practical, and usable layouts from
  320 CSS pixels upward. Update focused accessibility tests when changing these
  behaviors.
- Prefer small, typed changes; do not weaken TypeScript or lint rules to bypass
  an issue.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
