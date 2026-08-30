# Mac Local LLM Finder

[Try the live app](https://local-llm-finder-m7qb.vercel.app/) to find current
chat and coding models that fit your Apple Silicon Mac.

![Recommended local models](docs/images/recommended-results.png)

Choose your Mac chip, unified memory, available storage, workload, and preferred
runtime. The finder checks current models from Hugging Face and returns a
conservative shortlist with download links and installation guidance.

It supports:

- GGUF models for Ollama, LM Studio, and llama.cpp
- MLX models for MLX
- Shareable result links that work without JavaScript
- Memory, storage, and qualitative pace estimates

Estimates are a starting point, not a guarantee that every model will run well
on every setup.

## Privacy

Your hardware choices are not saved to an account or application database. They
are included in the page URL so results can be shared, which means they may
briefly appear in hosting-provider request logs. See the app's privacy page for
the full details.

Model catalogue requests are made by the server. If Hugging Face is temporarily
unavailable, the app can use its most recent cached catalogue and labels those
results as stale.

## Run locally

You need [Node.js 24](https://nodejs.org/) and npm.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). If you use `nvm`, the
included `.nvmrc` selects the expected Node.js version.

## JSON API

`POST /api/recommendations` accepts the same choices as the form:

```json
{
  "chip": "m4",
  "memoryGb": 16,
  "diskGb": 80,
  "workload": "balanced",
  "runtime": "ollama",
  "context": "normal"
}
```

Successful responses contain `recommendations`, `exclusions`, and a `stale`
flag. Invalid configurations return `400`; an unavailable catalogue with no
cached result returns `503`. This is a same-origin app endpoint, not a versioned
public API.

## Development and deployment

Run all release checks with:

```bash
npm run verify
```

To check a deployed instance:

```bash
npm run smoke:deploy -- https://your-deployment.example
```

Useful project documentation:

- [Architecture and implementation notes](codewiki.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Public release checklist](docs/public-release-checklist.md)
- [Platform settings guide](docs/platform-release-settings.md)

## Similar tools

You may also want to explore [Ollama](https://ollama.com/),
[LM Studio](https://lmstudio.ai/), [Hugging Face](https://huggingface.co/models),
or Apple's [MLX](https://ml-explore.github.io/mlx/build/html/index.html).

## License

Mac Local LLM Finder is available under the [MIT License](LICENSE).
