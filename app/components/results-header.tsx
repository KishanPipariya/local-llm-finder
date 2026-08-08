import type { RecommendationResult } from "@/lib/recommendation-service";

function catalogueTimestamp(refreshedAt: string) {
  const date = new Date(refreshedAt);
  if (!Number.isFinite(date.getTime())) return "an unknown time";
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

export function ResultsHeader({ result }: { result: RecommendationResult }) {
  return <div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title" tabIndex={-1} autoFocus>{result.recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue last updated <time dateTime={result.refreshedAt}>{catalogueTimestamp(result.refreshedAt)}</time>. Source data refreshes at least daily. {result.stale ? <strong role="status">Using the last successful catalogue while a refresh is in progress or unavailable. Results may be out of date.</strong> : <span className="catalogue-current" role="status">Current catalogue · fixed conservative fit assumptions.</span>}</p></div>;
}
