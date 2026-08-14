import type { Recommendation } from "@/lib/recommendations";
import { RecommendationMetrics } from "./recommendation-metrics";

const formatBytes = (bytes: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(bytes);

export function RecommendationCard({ model, isTopPick = false }: { model: Recommendation; isTopPick?: boolean }) {
  const headingId = `model-${model.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${model.format}`;
  const source = "Hugging Face";
  const sourceItem = model.filename ?? model.title;
  const primaryRuntime = model.guidance.find((guide) => guide.runtime === "Ollama")?.runtime ?? model.guidance[0]?.runtime ?? model.runtimes[0];
  return <article className={`card${isTopPick ? " top-pick" : ""}`} aria-labelledby={headingId}>
    <div className="card-top">{isTopPick ? <span className="top-pick-label">Top pick</span> : <span className={`status ${model.performance.toLowerCase().replace(" ", "-")}`}><span className="visually-hidden">Memory fit: </span>{model.performance}</span>}<span><abbr title={model.format === "gguf" ? "GPT-Generated Unified Format" : "Machine Learning eXchange"}>{model.format.toUpperCase()}</abbr>{model.quantization ? ` · ${model.quantization}` : ""}</span></div>
    {isTopPick && <span className={`status ${model.performance.toLowerCase().replace(" ", "-")}`}><span className="visually-hidden">Memory fit: </span>{model.performance}</span>}
    <h3 id={headingId}>{model.title}</h3>{isTopPick && <p className="decision-intro"><b>Best fit for your setup.</b> {model.why}</p>}{!isTopPick && <p>{model.why}</p>}
    <RecommendationMetrics model={model} />
    <div className="runtimes" aria-label="Compatible runtimes">{model.runtimes.map((runtime) => <span key={runtime}>{runtime}</span>)}</div>
    {model.filename && <p className="artifact-file">File: <code>{model.filename}</code></p>}
    {model.notes.map((note) => <p className="note" key={note}>{note}</p>)}
    {isTopPick && <a className="install-cta" href={model.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Install with ${primaryRuntime}: open ${sourceItem} on ${source} in a new tab`}>Install with {primaryRuntime} <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in a new tab)</span></a>}
    {!isTopPick && <p className="alternative-guidance">Choose instead if you prefer this model’s {model.explanation.fit.workload.category} focus or its download and pace trade-off.</p>}
    <a href={model.sourceUrl} target="_blank" rel="noreferrer" aria-label={`View ${sourceItem} on ${source} (opens in a new tab)`}>View {sourceItem} on {source} <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in a new tab)</span></a>
    <details className="disclosure recipe"><summary>Installation guidance</summary><div className="disclosure-content">{model.guidance.map((guide) => <div className="guide" key={guide.runtime}><b>{guide.runtime}</b><code>{guide.command}</code></div>)}</div></details>
    <details className="disclosure technical-details"><summary>Technical details and ranking factors</summary><div className="disclosure-content"><dl><div><dt>Exact artifact size</dt><dd>{formatBytes(model.sizeBytes)} bytes</dd></div><div><dt>Model family</dt><dd>{model.explanation.familyKey}</dd></div></dl><p>Memory assumption: {model.explanation.fit.memory.assumption}</p><p>Family deduplication keeps the highest-ranked artifact for this normalized model family.</p><ul>{model.explanation.rankingFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul></div></details>
  </article>;
}
