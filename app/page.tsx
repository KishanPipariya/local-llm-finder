"use client";

import { FormEvent, useState } from "react";
import { chipProfiles, chips, type Chip, type MacConfig, type Recommendation } from "@/lib/recommendations";

const initial: MacConfig = { chip: "m4", memoryGb: 16, diskGb: 80, workload: "balanced" };
type ResponseData = { recommendations: Recommendation[]; refreshedAt: string; stale: boolean };

export default function Home() {
  const [config, setConfig] = useState(initial);
  const [diskGbInput, setDiskGbInput] = useState(String(initial.diskGb));
  const [result, setResult] = useState<ResponseData>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const update = <K extends keyof MacConfig>(key: K, value: MacConfig[K]) => setConfig((p) => ({ ...p, [key]: value }));
  const updateChip = (chip: Chip) => setConfig((previous) => {
    const memoryOptionsGb = chipProfiles[chip].memoryOptionsGb;
    return { ...previous, chip, memoryGb: (memoryOptionsGb as readonly number[]).includes(previous.memoryGb) ? previous.memoryGb : memoryOptionsGb[0] };
  });
  const updateDiskGb = (value: string) => {
    const normalized = value.replace(/^0+(?=\d)/, "");
    setDiskGbInput(normalized);
    update("diskGb", normalized === "" ? 0 : Number(normalized));
  };
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try { const response = await fetch("/api/recommendations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(config) }); const data = await response.json(); if (!response.ok) throw new Error(data.errors?.join(" ") || data.error || "Unable to find models."); setResult(data); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to find models."); }
    finally { setLoading(false); }
  }
  return <main>
    <header className="hero"><a className="brand" href="#finder">LOCAL / LLM</a><span className="pill">Mac model finder</span><h1>Find a local model<br/><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware. No account, no tracking, no saved configuration.</p></header>
    <section className="finder" id="finder" aria-labelledby="finder-title"><div className="section-intro"><span className="eyebrow">01 — Your machine</span><h2 id="finder-title">Build your Mac profile</h2><p>We use these details only to calculate this recommendation. Nothing leaves this session except the request needed to fetch results.</p></div>
      <form onSubmit={submit} noValidate>
        <div className="fields"><label>Apple chip<select value={config.chip} onChange={(e) => updateChip(e.target.value as Chip)}>{chips.map((chip) => <option key={chip.id} value={chip.id}>{chip.name}</option>)}</select></label><label>Unified memory (GB)<select value={config.memoryGb} onChange={(e) => update("memoryGb", Number(e.target.value))}>{chipProfiles[config.chip].memoryOptionsGb.map((memoryGb) => <option key={memoryGb} value={memoryGb}>{memoryGb} GB</option>)}</select></label><label>Free disk space (GB)<input required min="1" max="4000" type="number" value={diskGbInput} onChange={(e) => updateDiskGb(e.target.value)}/></label></div>
        <fieldset><legend>What will you do most?</legend><div className="choices workload"><label><input type="radio" checked={config.workload === "chat"} onChange={() => update("workload", "chat")}/><span>General chat</span></label><label><input type="radio" checked={config.workload === "coding"} onChange={() => update("workload", "coding")}/><span>Coding</span></label><label><input type="radio" checked={config.workload === "balanced"} onChange={() => update("workload", "balanced")}/><span>Balanced</span></label></div></fieldset>
        <button disabled={loading}>{loading ? "Checking current models…" : "Find compatible models"}<b>→</b></button>{error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>
    {result && <section className="results" aria-live="polite" aria-labelledby="results-title"><div className="results-head"><div><span className="eyebrow">02 — Your shortlist</span><h2 id="results-title">{result.recommendations.length ? "Best fits right now" : "No models fit this profile"}</h2></div><p>Catalogue refreshed {new Date(result.refreshedAt).toLocaleString()}. {result.stale && <strong>Showing the last successful catalogue — it may be stale.</strong>}</p></div>
      {result.recommendations.length === 0 && <p className="empty">Try freeing disk space or selecting a Mac with more unified memory. Models with unknown artifact sizes are intentionally excluded.</p>}
      <p className="pace-note">Expected pace is a qualitative estimate from chip memory bandwidth and model footprint—not a tokens-per-second benchmark. Runtime, context length, thermals, and other apps also matter.</p>
      <div className="cards">{result.recommendations.map((m) => <article className="card" key={`${m.id}-${m.format}`}><div className="card-top"><span className={`status ${m.performance.toLowerCase().replace(" ", "-")}`}>{m.performance}</span><span>{m.format.toUpperCase()}{m.quantization ? ` · ${m.quantization}` : ""}</span></div><h3>{m.title}</h3><p>{m.why}</p><dl><div><dt>Download</dt><dd>{m.sizeGb} GB</dd></div><div><dt>Memory estimate</dt><dd>{m.memoryGb} GB</dd></div><div><dt>Expected pace</dt><dd>{m.pace}</dd></div></dl><div className="runtimes">{m.runtimes.map((r) => <span key={r}>{r}</span>)}</div>{m.notes.map((n) => <p className="note" key={n}>{n}</p>)}<a href={m.sourceUrl} target="_blank" rel="noreferrer">View on Hugging Face ↗</a><details><summary>Installation guidance</summary>{m.guidance.map((g) => <div className="guide" key={g.runtime}><b>{g.runtime}</b><code>{g.command}</code></div>)}</details></article>)}</div>
    </section>}
    <footer><span>Compatibility is an estimate, not a benchmark.</span><span>GGUF for Ollama, LM Studio & llama.cpp · MLX for Apple Silicon</span></footer>
  </main>;
}
