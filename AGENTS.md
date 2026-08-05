# AGENTS.md

## Project

Mac Local LLM Finder is a privacy-first Next.js app that recommends current local
chat and coding models for a selected Apple Silicon Mac configuration.

- Do not persist submitted hardware configurations.
- Preserve the server-rendered GET form flow; recommendations must work without
  client-side JavaScript.
- The `POST /api/recommendations` endpoint must remain behaviorally consistent
  with the form flow.

## Stack and commands

- Node.js 22.x; use npm.
- Next.js App Router, React, TypeScript (strict), and plain CSS in
  `app/globals.css`.
- Run before handing off relevant changes:

  ```bash
  npm test
  npm run lint
  npm run build
  ```

## Architecture

- `app/page.tsx`: server-rendered finder UI and GET-query handling.
- `app/api/recommendations/route.ts`: JSON API; return `400` for invalid input
  and `503` when the catalogue cannot be obtained.
- `lib/recommendations.ts`: pure domain logic for supported Mac configurations,
  memory estimates, runtime eligibility, ranking, and installation guidance.
- `lib/catalogue.ts`: Hugging Face retrieval and normalization.
- `lib/catalogue-cache.ts`: cache freshness and stale-fallback behavior.
- `tests/recommendations.test.ts`: Node built-in test coverage for domain logic
  and cache behavior.

## Behavioral requirements

- Validate chip and unified-memory combinations against `chipProfiles`; do not
  accept impossible hardware configurations.
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

## Change guidance

- Add or update focused tests whenever changing validation, ranking, memory
  estimates, cache behavior, normalization, or API error handling.
- Avoid adding analytics, account integrations, databases, or environment
  variables unless the product requirement explicitly changes.
- Keep UI changes accessible: semantic form controls, visible keyboard focus,
  readable errors, and responsive layouts.
- Prefer small, typed changes; do not weaken TypeScript or lint rules to bypass
  an issue.
