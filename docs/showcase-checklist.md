# Showcase checklist

Before a live demo or recording:

1. Confirm Node 24 is active before release checks: run `mise exec node@24 -- node --version` (or `nvm use`, which reads `.nvmrc`). Then run `npm test`, `npm run lint`, and `npm run build`.
2. Open the deployed finder once shortly before presenting so its server-side catalogue cache can warm up.
3. Run `npm run smoke:deploy -- https://your-deployment.example`. It checks one server-rendered GET flow plus JSON API results for Ollama, LM Studio, llama.cpp, and MLX. Investigate a stale status before the demo; a 503, invalid response, or empty runtime shortlist fails the check.
4. Manually review each displayed installation path. Ollama cards must link to Ollama and use exactly `ollama pull <model:tag> && ollama run <model:tag>`; LM Studio and llama.cpp cards must retain their Hugging Face file guidance, and MLX cards their MLX guidance. This is a command-and-URL review only: no model download or execution is claimed.
5. Keep the checked-in [fixture-backed results screenshot](images/recommended-results.png) available as a fallback if the upstream public catalogue is temporarily unavailable.
