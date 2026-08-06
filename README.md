# Mac Local LLM Finder

A simple way to find local chat and coding models that suit your Apple Silicon Mac. Choose your Mac's chip, unified memory, and available storage, and the finder suggests models you can run on your own computer.

Your Mac configuration is used only to produce the suggestions—it is not saved. The recommendations help you compare likely compatibility, storage needs, and expected pace. They are estimates, so real-world results can vary with your setup and the way you use a model.

## How it works

1. Select your Mac's configuration.
2. Choose whether you want a chat model or a coding model.
3. Review the suggested local models and their installation guidance.

## Run locally

You need Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) after the development server starts.

For project internals, development checks, and architecture details, see [codewiki.md](codewiki.md).
