# Contributing

Thanks for helping improve Mac Local LLM Finder. Small, focused pull requests
are easiest to review. Please open an issue before adding a data source,
runtime, hardware family, dependency, or product integration.

Use the issue forms for bugs and feature requests. Report security or privacy
vulnerabilities privately as described in [SECURITY.md](SECURITY.md). By
participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up the project

You need Node.js 24.x and npm. The repository includes both `.nvmrc` and
`mise.toml`, so either version manager works:

```bash
nvm use
# or: mise install

npm ci
npm run setup:browsers
npm run dev
```

Open <http://localhost:3000>. The browser setup is needed for the accessibility
suite; it only needs to be repeated when Playwright's browser version changes.

The development app fetches public Hugging Face metadata server-side. Automated
tests use deterministic local fixtures and do not depend on that service.

## Find your way around

| Area | Main files | Focused check |
| --- | --- | --- |
| Form and page | `app/page.tsx`, `app/components/`, `app/globals.css` | `npm run test:a11y` |
| Validation and request parsing | `lib/hardware.ts`, `lib/request.ts`, `lib/recommendation-request.ts` | `node --import tsx --test tests/request.test.ts` |
| Ranking and fit estimates | `lib/recommendations.ts`, `lib/recommendation-service.ts` | `node --import tsx --test tests/recommendations.test.ts` |
| Catalogue retrieval and cache | `lib/catalogue*.ts` | `node --import tsx --test tests/catalogue.test.ts` |
| JSON endpoint | `app/api/recommendations/route.ts` | `node --import tsx --test tests/request.test.ts tests/recommendations.test.ts` |

See [codewiki.md](codewiki.md) for the complete architecture and data flow.

## Make a change

1. Create a branch from the latest `main`.
2. Keep the change scoped and add or update focused tests.
3. Run the smallest relevant check while iterating.
4. Run `npm run verify` before opening a pull request.
5. Explain the user impact and verification in the pull request template.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run the standalone TypeScript check. |
| `npm run test:unit` | Run unit tests with coverage thresholds. |
| `npm run test:unit:watch` | Rerun unit tests while files change. |
| `npm run test:a11y` | Build and run Playwright/axe browser tests. |
| `npm run verify` | Run every required local check. |

## Preserve the project contracts

- Hardware choices are request input only. Do not add accounts, analytics,
  cookies, browser storage, or a profile database.
- Keep recommendations working through the server-rendered GET form without
  client-side JavaScript.
- Keep GET and `POST /api/recommendations` validation and recommendation
  behavior aligned through the shared library functions.
- Treat Hugging Face content as untrusted. Preserve request bounds, safe path
  validation, and shell-safe installation commands.
- Keep fit estimates conservative and pace descriptions qualitative.
- Preserve keyboard operation, visible focus, usable validation messages, and
  layouts down to 320 CSS pixels.

Update `codewiki.md` when a change affects architecture, request flows,
validation, catalogue behavior, ranking, supported runtimes, installation
guidance, or development and deployment commands. Pure copy and styling changes
usually do not need a repository-map update.

## Troubleshooting

- **Wrong Node version:** run `nvm use` or `mise install`, then retry. Commands
  that require Node 24 print the detected version when it is wrong.
- **Chromium is missing:** run `npm run setup:browsers`. On Linux, Playwright
  may also require `npx playwright install --with-deps chromium`.
- **A Git hook fails:** run the printed npm command directly for full output.
  Hooks use `mise` when it is available and otherwise use the active Node
  installation; they do not require a particular version manager.
- **The live catalogue is unavailable:** continue with unit and accessibility
  tests, which use local fixtures. A production catalogue failure should still
  be investigated before release.
