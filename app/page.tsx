import { getCatalogue } from "@/lib/catalogue";
import { chipProfiles, chips, rankArtifacts, validateConfig, type MacConfig, type Recommendation } from "@/lib/recommendations";

const initial: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };
const memoryOptions = [...new Set(chips.flatMap((chip) => chip.memoryOptionsGb))].sort((a, b) => a - b);
type SearchParams = Record<string, string | string[] | undefined>;

function valueOf(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function resultCard(m: Recommendation) {
  const headingId = `model-${m.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${m.format}`;
  return <article className="card" key={`${m.id}-${m.format}`} aria-labelledby={headingId}>
    <div className="card-top"><span className={`status ${m.performance.toLowerCase().replace(" ", "-")}`}><span className="visually-hidden">Memory fit: </span>{m.performance}</span><span><abbr title={m.format === "gguf" ? "GPT-Generated Unified Format" : "Machine Learning eXchange"}>{m.format.toUpperCase()}</abbr>{m.quantization ? ` · ${m.quantization}` : ""}</span></div>
    <h3 id={headingId}>{m.title}</h3><p>{m.why}</p>
    <dl><div><dt>Download size</dt><dd>{m.sizeGb} GB</dd></div><div><dt>Estimated memory needed</dt><dd>{m.memoryGb} GB</dd></div><div><dt>Expected pace</dt><dd>{m.pace}<span className="visually-hidden">, qualitative estimate</span></dd></div></dl>
    <div className="runtimes" aria-label="Compatible runtimes">{m.runtimes.map((r) => <span key={r}>{r}</span>)}</div>
    {m.notes.map((n) => <p className="note" key={n}>{n}</p>)}
    <a href={m.sourceUrl} target="_blank" rel="noreferrer" aria-label={`View ${m.title} on Hugging Face (opens in a new tab)`}>View {m.title} on Hugging Face <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in a new tab)</span></a>
    <details><summary>Installation guidance for {m.title}</summary>{m.guidance.map((g) => <div className="guide" key={g.runtime}><b>{g.runtime} instructions</b><code>{g.command}</code></div>)}</details>
  </article>;
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const submitted = ["chip", "memoryGb", "diskGb", "workload"].some((key) => valueOf(params, key) !== undefined);
  const candidate = { chip: valueOf(params, "chip") ?? initial.chip, memoryGb: Number(valueOf(params, "memoryGb") ?? initial.memoryGb), diskGb: Number(valueOf(params, "diskGb") ?? initial.diskGb), workload: valueOf(params, "workload") ?? initial.workload };
  const validation = submitted ? validateConfig(candidate) : { valid: true as const, data: initial };
  const config = validation.valid ? validation.data : candidate;
  const fieldErrors = validation.valid ? {} : validation.fieldErrors;
  let recommendations: Recommendation[] | undefined;
  let refreshedAt: string | undefined;
  let stale = false;
  let catalogueError = "";
  if (submitted && validation.valid) {
    try { const cached = await getCatalogue(); recommendations = rankArtifacts(cached.catalogue.items, validation.data); refreshedAt = cached.catalogue.refreshedAt; stale = cached.stale; }
    catch { catalogueError = "The model catalogue is temporarily unavailable. Please try again shortly."; }
  }
  const selectedChip = typeof config.chip === "string" && config.chip in chipProfiles ? config.chip : initial.chip;

  return <main>
    <a className="skip-link" href="#finder">Skip to the model finder</a>
    <header className="hero"><a className="brand" href="#finder" aria-label="Local LLM model finder">LOCAL / LLM</a><span className="pill">Mac model finder</span><h1>Find a local model<br/><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware. No account, no tracking, no saved configuration.</p></header>
    <section className="finder" id="finder" aria-labelledby="finder-title"><div className="section-intro"><span className="eyebrow">01 — Your machine</span><h2 id="finder-title">Build your Mac profile</h2><p>We use these details only to calculate this recommendation. They are sent with this page request and are not saved.</p></div>
      <form method="get" aria-describedby="configuration-help">{submitted && !validation.valid && <div className="error-summary" role="alert" tabIndex={-1} autoFocus><h2>Check your Mac profile</h2><p>Correct the following before finding models:</p><ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}<p id="configuration-help" className="form-help">Chip and unified-memory choices are checked against real Mac configurations.</p><div className="fields"><label htmlFor="chip">Apple chip<select id="chip" name="chip" required defaultValue={selectedChip} aria-invalid={Boolean(fieldErrors.chip)} aria-describedby={fieldErrors.chip ? "chip-error" : undefined}>{chips.map((chip) => <option key={chip.id} value={chip.id}>{chip.name}</option>)}</select>{fieldErrors.chip && <span className="field-error" id="chip-error">{fieldErrors.chip}</span>}</label><label htmlFor="memoryGb">Unified memory (GB)<select id="memoryGb" name="memoryGb" required defaultValue={String(config.memoryGb)} aria-invalid={Boolean(fieldErrors.memoryGb)} aria-describedby={fieldErrors.memoryGb ? "memory-error" : undefined}>{memoryOptions.map((memoryGb) => <option key={memoryGb} value={memoryGb}>{memoryGb} GB</option>)}</select>{fieldErrors.memoryGb && <span className="field-error" id="memory-error">{fieldErrors.memoryGb}</span>}</label><label htmlFor="diskGb">Free disk space (GB)<input id="diskGb" name="diskGb" required min="1" max="4000" type="number" defaultValue={config.diskGb} aria-invalid={Boolean(fieldErrors.diskGb)} aria-describedby={fieldErrors.diskGb ? "disk-error" : undefined}/>{fieldErrors.diskGb && <span className="field-error" id="disk-error">{fieldErrors.diskGb}</span>}</label></div>
        <fieldset aria-describedby={fieldErrors.workload ? "workload-error" : undefined} aria-invalid={Boolean(fieldErrors.workload)}><legend>What will you do most?</legend><div className="choices workload"><label><input name="workload" type="radio" value="chat" required defaultChecked={config.workload === "chat"}/><span>General chat</span></label><label><input name="workload" type="radio" value="coding" defaultChecked={config.workload === "coding"}/><span>Coding</span></label><label><input name="workload" type="radio" value="balanced" defaultChecked={config.workload === "balanced"}/><span>Balanced</span></label></div>{fieldErrors.workload && <span className="field-error" id="workload-error">{fieldErrors.workload}</span>}</fieldset>
        <button type="submit">Find compatible models <span aria-hidden="true">→</span></button>{catalogueError && <p className="error" role="alert">{catalogueError}</p>}
      </form>
    </section>
    {recommendations && <section className="results" id="results" aria-labelledby="results-title"><div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title" tabIndex={-1} autoFocus>{recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue refreshed {new Date(refreshedAt!).toLocaleString()}. {stale && <strong role="status">Showing the last successful catalogue; it may be stale.</strong>}</p></div>{recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}<p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p><div className="cards">{recommendations.map(resultCard)}</div></section>}
    <footer><span>Compatibility is an estimate, not a benchmark.</span><span><abbr title="GPT-Generated Unified Format">GGUF</abbr> for Ollama, LM Studio, and llama.cpp · <abbr title="Machine Learning eXchange">MLX</abbr> for Apple Silicon</span></footer>
  </main>;
}
