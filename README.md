# Mac Local LLM Finder

A privacy-first finder for current local chat and coding models that fit a Mac. It queries Hugging Face server-side, caches the normalized catalogue for six hours, and makes no attempt to store submitted Mac configurations. The finder is a server-rendered GET form, so it returns recommendations even when JavaScript is disabled.

## Deploy on Vercel

Import this repository in Vercel, leave the framework preset as **Next.js**, and deploy. No environment variables, database, or account integrations are required.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
npm run build
npm test
```

The API endpoint is `POST /api/recommendations`. Submit an exact Apple SoC (`chip`, such as `m4Pro`) with one of that chip's supported unified-memory options. Results include a qualitative `pace` estimate based on published family memory bandwidth and model footprint; it is not a tokens-per-second benchmark. The server-rendered form and API share the same catalogue service, which fetches public Hugging Face Hub data on demand and falls back to the last valid in-memory catalogue if a refresh fails.
