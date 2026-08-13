import type { RecommendationResult } from "@/lib/recommendation-service";
import { chipProfiles, type MacConfig } from "@/lib/hardware";
import { RecommendationCard } from "./recommendation-card";
import { ResultsHeader } from "./results-header";

const exclusionDetails = [
  ["insufficientDisk", "insufficient disk", "Free storage or choose a smaller quantization."],
  ["insufficientMemory", "insufficient unified memory", "Choose a smaller model or quantization, and close other apps."],
  ["invalidSize", "unknown or implausible artifact size", "These files are intentionally not presented as installable."],
  ["unsupportedFormat", "unsupported format", "Choose GGUF for Ollama, LM Studio, or llama.cpp, or MLX for MLX."],
] as const;

const runtimeLabels = { ollama: "Ollama", lmStudio: "LM Studio", llamaCpp: "llama.cpp", mlx: "MLX" } as const;
const workloadLabels = { chat: "questions and writing", coding: "coding", balanced: "balanced use" } as const;
const contextLabels = { small: "short conversations", normal: "typical conversations", long: "long conversations" } as const;

function editProfileHref(config: MacConfig) {
  const query = new URLSearchParams(Object.entries(config).map(([key, value]) => [key, String(value)]));
  return `/?${query.toString()}#finder`;
}

function SetupSummary({ config }: { config: MacConfig }) {
  const context = config.context ?? "normal";
  const runtime = config.runtime ?? "ollama";
  return <section className="setup-summary" aria-labelledby="setup-summary-title"><div><span className="eyebrow">Your setup</span><h3 id="setup-summary-title">{chipProfiles[config.chip].name} · {config.memoryGb} GB unified memory</h3><p>{config.diskGb} GB free disk · {workloadLabels[config.workload]} · {contextLabels[context]} · {runtimeLabels[runtime]}</p></div><a href={editProfileHref(config)}>Edit profile <span aria-hidden="true">→</span></a></section>;
}

export function Results({ result, config }: { result: RecommendationResult; config: MacConfig }) {
  return <section className="results" id="results" aria-labelledby="results-title">
    <ResultsHeader result={result} />
    <SetupSummary config={config} />
    {result.recommendations.length === 0 ? <section className="no-results" aria-labelledby="recovery-title"><h3 id="recovery-title">Try a different setup</h3><p>No available model fits these conservative memory, disk, runtime, and context checks together.</p><ul><li>Free more disk space, then try again.</li><li>Choose <b>Short</b> context if you do not need large documents or repositories in one conversation.</li><li>Use a Mac with more unified memory for larger models.</li><li>Choose another runtime if you can use its compatible model format.</li></ul><a href={editProfileHref(config)}>Edit this profile to try again <span aria-hidden="true">→</span></a></section> : <><div className="cards top-pick-grid"><RecommendationCard model={result.recommendations[0]} isTopPick /></div>{result.recommendations.length > 1 && <section className="alternatives" aria-labelledby="alternatives-title"><h3 id="alternatives-title">Alternatives</h3><p>Choose one instead when its workload focus, download size, or pace feels like a better match for you.</p><div className="cards">{result.recommendations.slice(1).map((model) => <RecommendationCard key={`${model.id}-${model.format}`} model={model} />)}</div></section>}</>}
    <details className="how-results-work"><summary>How these results work</summary><div><p>Catalogue scope: this is a live set of Hugging Face GGUF and MLX artifacts, ranked with metadata-derived fit estimates. GGUF files can be imported into Ollama, LM Studio, or llama.cpp. It does not verify model quality or real-world performance.</p><p>Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p></div></details>
    {Object.values(result.exclusions).some(Boolean) && <details className="exclusions"><summary>Why not larger models?</summary><p>These catalogue artifacts were excluded from the shortlist; they are not recommendations.</p><ul>{exclusionDetails.filter(([reason]) => result.exclusions[reason] > 0).map(([reason, label, action]) => <li key={reason}><b>{result.exclusions[reason]}</b> with {label}. {action}</li>)}</ul></details>}
  </section>;
}
