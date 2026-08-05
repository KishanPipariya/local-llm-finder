# Mac Local LLM Finder

A privacy-first single-page finder for current local chat and coding models that fit a Mac. It queries Hugging Face server-side, caches the normalized catalogue for six hours, and makes no attempt to store submitted Mac configurations.

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

The API endpoint is `POST /api/recommendations`. It fetches public Hugging Face Hub data on demand and falls back to the last valid in-memory catalogue if a refresh fails.
