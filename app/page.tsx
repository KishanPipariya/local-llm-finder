import { FinderForm } from "@/app/components/finder-form";
import { Results } from "@/app/components/results";
import { getRecommendations } from "@/lib/recommendation-service";
import { validateConfig, type MacConfig } from "@/lib/recommendations";

const initial: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };
type SearchParams = Record<string, string | string[] | undefined>;
const valueOf = (params: SearchParams, key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const submitted = ["chip", "memoryGb", "diskGb", "workload"].some((key) => valueOf(params, key) !== undefined);
  const candidate = { chip: valueOf(params, "chip") ?? initial.chip, memoryGb: Number(valueOf(params, "memoryGb") ?? initial.memoryGb), diskGb: Number(valueOf(params, "diskGb") ?? initial.diskGb), workload: valueOf(params, "workload") ?? initial.workload };
  const validation = submitted ? validateConfig(candidate) : { valid: true as const, data: initial };
  let result;
  let catalogueError = "";
  if (submitted && validation.valid) {
    try { result = await getRecommendations(validation.data); }
    catch { catalogueError = "The model catalogue is temporarily unavailable. Please try again shortly."; }
  }
  return <main>
    <a className="skip-link" href="#finder">Skip to the model finder</a>
    <header className="hero"><a className="brand" href="#finder" aria-label="Local LLM model finder">LOCAL / LLM</a><span className="pill">Mac model finder</span><h1>Find a local model<br/><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware. No account, no tracking, no saved configuration.</p></header>
    <FinderForm config={validation.valid ? validation.data : candidate} submitted={submitted} errors={validation.valid ? [] : validation.errors} fieldErrors={validation.valid ? {} : validation.fieldErrors} catalogueError={catalogueError} />
    {result && <Results result={result} />}
    <footer><span>Compatibility is an estimate, not a benchmark.</span><span><abbr title="GPT-Generated Unified Format">GGUF</abbr> for Ollama, LM Studio, and llama.cpp · <abbr title="Machine Learning eXchange">MLX</abbr> for Apple Silicon</span></footer>
  </main>;
}
