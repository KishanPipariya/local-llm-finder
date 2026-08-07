import type { RecommendationResult } from "@/lib/recommendation-service";
import { RecommendationCard } from "./recommendation-card";

const exclusionDetails = [
  ["insufficientDisk", "insufficient disk", "Free storage or choose a smaller quantization."],
  ["insufficientMemory", "insufficient unified memory", "Choose a smaller model or quantization, and close other apps."],
  ["invalidSize", "unknown or implausible artifact size", "These files are intentionally not presented as installable."],
  ["unsupportedFormat", "unsupported format", "Choose GGUF for Ollama, LM Studio, or llama.cpp, or MLX for MLX."],
] as const;

function catalogueTimestamp(refreshedAt: string) {
  const date = new Date(refreshedAt);
  if (!Number.isFinite(date.getTime())) return "an unknown time";
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

export function Results({ result }: { result: RecommendationResult }) {
  return <section className="results" id="results" aria-labelledby="results-title">
    <div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title" tabIndex={-1} autoFocus>{result.recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue last updated <time dateTime={result.refreshedAt}>{catalogueTimestamp(result.refreshedAt)}</time>. {result.stale ? <strong role="status">Using the last successful catalogue while a refresh is in progress or unavailable. Results may be out of date.</strong> : <span className="catalogue-current" role="status">Current catalogue · fixed conservative fit assumptions.</span>}</p></div>
    {result.recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}
    <p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p>
    <div className="cards">{result.recommendations.map((model, index) => <RecommendationCard key={`${model.id}-${model.format}`} model={model} isTopPick={index === 0} />)}</div>
    {Object.values(result.exclusions).some(Boolean) && <details className="exclusions"><summary>Why not larger models?</summary><p>These catalogue artifacts were excluded from the shortlist; they are not recommendations.</p><ul>{exclusionDetails.filter(([reason]) => result.exclusions[reason] > 0).map(([reason, label, action]) => <li key={reason}><b>{result.exclusions[reason]}</b> with {label}. {action}</li>)}</ul></details>}
  </section>;
}
