import { FinderForm } from "@/app/components/finder-form";
import { Results } from "@/app/components/results";
import { getRecommendations } from "@/lib/recommendation-service";
import { catalogueUnavailableMessage, parseFinderRequest, type FinderSearchParams } from "@/lib/request";
import type { MacConfig } from "@/lib/recommendations";

const initial: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };

export default async function Home({ searchParams }: { searchParams: Promise<FinderSearchParams> }) {
  const params = await searchParams;
  const { submitted, candidate, validation: submittedValidation } = parseFinderRequest(params);
  const validation = submittedValidation ?? { valid: true as const, data: initial };
  let result;
  let catalogueError = "";
  if (submitted && validation.valid) {
    try { result = await getRecommendations(validation.data); }
    catch { catalogueError = catalogueUnavailableMessage; }
  }
  return <main>
    <a className="skip-link" href="#finder">Skip to the model finder</a>
    <header className="hero">
      <div className="hero-nav"><a className="brand" href="#finder" aria-label="Local LLM model finder">LOCAL / LLM</a><span className="pill">Mac model finder</span></div>
      <div className="hero-copy"><span className="eyebrow">Field notes / Apple Silicon</span><h1>Find a local model<br/><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware. No account, no tracking, no saved configuration.</p></div>
      <div className="signal-panel" aria-hidden="true"><span className="signal-index">01 / HARDWARE SIGNAL</span><span className="signal-chip">M</span><span className="signal-line signal-line-one"/><span className="signal-line signal-line-two"/><span className="signal-stat signal-stat-one">UNIFIED<br/>MEMORY</span><span className="signal-stat signal-stat-two">LOCAL<br/>ONLY</span><span className="signal-dot"/></div>
    </header>
    <FinderForm config={validation.valid ? validation.data : candidate} submitted={submitted} errors={validation.valid ? [] : validation.errors} fieldErrors={validation.valid ? {} : validation.fieldErrors} catalogueError={catalogueError} />
    {result && <Results result={result} />}
    <footer><span>Compatibility is an estimate, not a benchmark.</span><span><abbr title="GPT-Generated Unified Format">GGUF</abbr> for Ollama, LM Studio, and llama.cpp · <abbr title="Machine Learning eXchange">MLX</abbr> for Apple Silicon</span></footer>
  </main>;
}
