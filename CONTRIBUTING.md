# Contributing

Small, focused pull requests are welcome. Open an issue before proposing a new
data source, runtime, hardware family, dependency, or product integration.

## Development

Use Node.js 24.x and npm:

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run verify
```

Preserve the server-rendered GET flow, GET/POST validation parity, request-only
hardware configuration handling, conservative fit estimates, untrusted-input
boundaries, keyboard operation, and support from 320 CSS pixels upward. Update
focused tests and `codewiki.md` when changing a documented contract or module
responsibility. See `AGENTS.md` for the complete engineering constraints.
