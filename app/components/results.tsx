import type { RecommendationResult } from "@/lib/recommendation-service";
import { RecommendationCard } from "./recommendation-card";

export function Results({ result }: { result: RecommendationResult }) {
  return <section className="results" id="results" aria-labelledby="results-title">
    <div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title" tabIndex={-1} autoFocus>{result.recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue refreshed {new Date(result.refreshedAt).toLocaleString()}. {result.stale && <strong role="status">Showing the last successful catalogue; it may be stale.</strong>}</p></div>
    {result.recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}
    <p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p>
    <div className="cards">{result.recommendations.map((model) => <RecommendationCard key={`${model.id}-${model.format}`} model={model} />)}</div>
  </section>;
}
