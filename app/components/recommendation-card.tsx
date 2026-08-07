import type { Recommendation } from "@/lib/recommendations";

const formatBytes = (bytes: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(bytes);

export function RecommendationCard({ model, isTopPick = false }: { model: Recommendation; isTopPick?: boolean }) {
  const headingId = `model-${model.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${model.format}`;
  return <article className={`card${isTopPick ? " top-pick" : ""}`} aria-labelledby={headingId}>
    <div className="card-top">{isTopPick ? <span className="top-pick-label">Top pick</span> : <span className={`status ${model.performance.toLowerCase().replace(" ", "-")}`}><span className="visually-hidden">Memory fit: </span>{model.performance}</span>}<span><abbr title={model.format === "gguf" ? "GPT-Generated Unified Format" : "Machine Learning eXchange"}>{model.format.toUpperCase()}</abbr>{model.quantization ? ` · ${model.quantization}` : ""}</span></div>
    {isTopPick && <span className={`status ${model.performance.toLowerCase().replace(" ", "-")}`}><span className="visually-hidden">Memory fit: </span>{model.performance}</span>}
    <h3 id={headingId}>{model.title}</h3><p>{model.why}</p>
    <dl><div><dt>Download size</dt><dd>{model.sizeGb} GB</dd></div><div><dt>Estimated memory needed</dt><dd>{model.memoryGb} GB</dd></div><div><dt>Expected pace</dt><dd>{model.pace}<span className="visually-hidden">, qualitative estimate</span></dd></div></dl>
    <section className="fit-breakdown" aria-label={`Why ${model.title} fits`}><h4>Setup check</h4><ul><li>Context: {model.explanation.fit.context.label}.</li><li>Disk headroom: {model.explanation.fit.disk.headroomBytes / 1e9 >= 1 ? `${(model.explanation.fit.disk.headroomBytes / 1e9).toFixed(1)} GB` : `${Math.round(model.explanation.fit.disk.headroomBytes / 1e6)} MB`} after download.</li><li>Memory headroom: {model.explanation.fit.memory.headroomGb.toFixed(1)} GB from the conservative estimate.</li><li>Runtime: {model.explanation.fit.runtimes.join(", ")}.</li></ul></section>
    <div className="runtimes" aria-label="Compatible runtimes">{model.runtimes.map((runtime) => <span key={runtime}>{runtime}</span>)}</div>
    {model.filename && <p className="artifact-file">File: <code>{model.filename}</code></p>}
    {model.notes.map((note) => <p className="note" key={note}>{note}</p>)}
    <a href={model.sourceUrl} target="_blank" rel="noreferrer" aria-label={`View ${model.filename ?? model.title} on Hugging Face (opens in a new tab)`}>View {model.filename ?? model.title} on Hugging Face <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in a new tab)</span></a>
    <details className="disclosure recipe"><summary>Installation guidance</summary><div className="disclosure-content">{model.guidance.map((guide) => <div className="guide" key={guide.runtime}><b>{guide.runtime}</b><code>{guide.command}</code></div>)}</div></details>
    <details className="disclosure technical-details"><summary>Technical details and ranking factors</summary><div className="disclosure-content"><dl><div><dt>Exact artifact size</dt><dd>{formatBytes(model.sizeBytes)} bytes</dd></div><div><dt>Model family</dt><dd>{model.explanation.familyKey}</dd></div></dl><p>Memory assumption: {model.explanation.fit.memory.assumption}</p><p>Family deduplication keeps the highest-ranked artifact for this normalized model family.</p><ul>{model.explanation.rankingFactors.map((factor) => <li key={factor}>{factor}</li>)}</ul></div></details>
  </article>;
}
