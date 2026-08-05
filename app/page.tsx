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
  return <article className="card" key={`${m.id}-${m.format}`}><div className="card-top"><span className={`status ${m.performance.toLowerCase().replace(" ", "-")}`}>{m.performance}</span><span>{m.format.toUpperCase()}{m.quantization ? ` · ${m.quantization}` : ""}</span></div><h3>{m.title}</h3><p>{m.why}</p><dl><div><dt>Download</dt><dd>{m.sizeGb} GB</dd></div><div><dt>Memory estimate</dt><dd>{m.memoryGb} GB</dd></div><div><dt>Expected pace</dt><dd>{m.pace}</dd></div></dl><div className="runtimes">{m.runtimes.map((r) => <span key={r}>{r}</span>)}</div>{m.notes.map((n) => <p className="note" key={n}>{n}</p>)}<a href={m.sourceUrl} target="_blank" rel="noreferrer">View on Hugging Face ↗</a><details><summary>Installation guidance</summary>{m.guidance.map((g) => <div className="guide" key={g.runtime}><b>{g.runtime}</b><code>{g.command}</code></div>)}</details></article>;
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const submitted = ["chip", "memoryGb", "diskGb", "workload"].some((key) => valueOf(params, key) !== undefined);
  const candidate = { chip: valueOf(params, "chip") ?? initial.chip, memoryGb: Number(valueOf(params, "memoryGb") ?? initial.memoryGb), diskGb: Number(valueOf(params, "diskGb") ?? initial.diskGb), workload: valueOf(params, "workload") ?? initial.workload };
  const validation = submitted ? validateConfig(candidate) : { valid: true as const, data: initial };
  const config = validation.valid ? validation.data : candidate;
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
    <header className="hero"><a className="brand" href="#finder">LOCAL / LLM</a><span className="pill">Mac model finder</span><h1>Find a local model<br/><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware. No account, no tracking, no saved configuration.</p></header>
    <section className="finder" id="finder" aria-labelledby="finder-title"><div className="section-intro"><span className="eyebrow">01 — Your machine</span><h2 id="finder-title">Build your Mac profile</h2><p>We use these details only to calculate this recommendation. They are sent with this page request and are not saved.</p></div>
      <form method="get" noValidate><div className="fields"><label>Apple chip<select name="chip" defaultValue={selectedChip}>{chips.map((chip) => <option key={chip.id} value={chip.id}>{chip.name}</option>)}</select></label><label>Unified memory (GB)<select name="memoryGb" defaultValue={String(config.memoryGb)}>{memoryOptions.map((memoryGb) => <option key={memoryGb} value={memoryGb}>{memoryGb} GB</option>)}</select></label><label>Free disk space (GB)<input name="diskGb" required min="1" max="4000" type="number" defaultValue={config.diskGb}/></label></div>
        <fieldset><legend>What will you do most?</legend><div className="choices workload"><label><input name="workload" type="radio" value="chat" defaultChecked={config.workload === "chat"}/><span>General chat</span></label><label><input name="workload" type="radio" value="coding" defaultChecked={config.workload === "coding"}/><span>Coding</span></label><label><input name="workload" type="radio" value="balanced" defaultChecked={config.workload === "balanced"}/><span>Balanced</span></label></div></fieldset>
        <button type="submit">Find compatible models <b>→</b></button>{submitted && !validation.valid && <p className="error" role="alert">{validation.errors.join(" ")}</p>}{catalogueError && <p className="error" role="alert">{catalogueError}</p>}
      </form>
    </section>
    {recommendations && <section className="results" id="results" aria-live="polite" aria-labelledby="results-title"><div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title">{recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue refreshed {new Date(refreshedAt!).toLocaleString()}. {stale && <strong>Showing the last successful catalogue — it may be stale.</strong>}</p></div>{recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}<p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p><div className="cards">{recommendations.map(resultCard)}</div></section>}
    <footer><span>Compatibility is an estimate, not a benchmark.</span><span>GGUF for Ollama, LM Studio & llama.cpp · MLX for Apple Silicon</span></footer>
  </main>;
}
