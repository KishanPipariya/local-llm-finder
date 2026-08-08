import type { RecommendationResult } from "@/lib/recommendation-service";
import { RecommendationCard } from "./recommendation-card";
import { ResultsHeader } from "./results-header";

const exclusionDetails = [
  ["insufficientDisk", "insufficient disk", "Free storage or choose a smaller quantization."],
  ["insufficientMemory", "insufficient unified memory", "Choose a smaller model or quantization, and close other apps."],
  ["invalidSize", "unknown or implausible artifact size", "These files are intentionally not presented as installable."],
  ["unsupportedFormat", "unsupported format", "Choose GGUF for Ollama, LM Studio, or llama.cpp, or MLX for MLX."],
] as const;

export function Results({ result }: { result: RecommendationResult }) {
  return <section className="results" id="results" aria-labelledby="results-title">
    <ResultsHeader result={result} />
    {result.recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}
    <p className="catalogue-scope">Catalogue scope: this is a live set of Ollama Library families with registry-verified native pulls, plus Hugging Face GGUF and MLX artifacts, ranked with metadata-derived fit estimates. It does not verify model quality or real-world performance.</p>
    <p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p>
    <div className="cards">{result.recommendations.map((model, index) => <RecommendationCard key={`${model.id}-${model.format}`} model={model} isTopPick={index === 0} />)}</div>
    {Object.values(result.exclusions).some(Boolean) && <details className="exclusions"><summary>Why not larger models?</summary><p>These catalogue artifacts were excluded from the shortlist; they are not recommendations.</p><ul>{exclusionDetails.filter(([reason]) => result.exclusions[reason] > 0).map(([reason, label, action]) => <li key={reason}><b>{result.exclusions[reason]}</b> with {label}. {action}</li>)}</ul></details>}
  </section>;
}
