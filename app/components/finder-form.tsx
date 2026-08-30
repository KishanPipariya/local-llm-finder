"use client";

import { useState, type MouseEvent } from "react";
import { HardwareSelector } from "@/app/components/hardware-selector";
import { chipProfiles, type Chip, type ConfigField, type ConfigFieldErrors, type ContextPreset, type Runtime } from "@/lib/hardware";

type FormConfig = { chip?: string; memoryGb?: number; diskGb?: number; workload?: string; runtime?: string; context?: string };
type RuntimeChoice = Runtime | "any";
const fieldTargets: Record<ConfigField, string> = { chip: "chip", memoryGb: "memoryGb", diskGb: "diskGb", workload: "workload-chat", runtime: "runtime-ollama", context: "context-small" };
const contextConsequences = { small: "Good for a short chat or one small file.", normal: "Good for chat and a few files.", long: "Reserves more memory for large repositories and documents." } as const;
const runtimeDescriptions = { ollama: "The simplest starting point: install one app and run a short command.", lmStudio: "A desktop app with a visual model browser and chat window.", mlx: "Apple-silicon-native terminal tools that require uv and uvx.", llamaCpp: "A lightweight command-line runtime with flexible local controls.", any: "Keep GGUF and MLX options in the same shortlist without filtering to one app." } as const;
const workloadOptions = [["chat", "Ask questions and write"], ["coding", "Write and understand code"], ["balanced", "Balanced · not sure"]] as const;
const contextOptions = [["small", "Short · 4K", "A short conversation or one small file"], ["normal", "Normal · 16K", "Chat and a few files · recommended"], ["long", "Long · 32K", "Large documents or repositories"]] as const;
const runtimeOptions = [["ollama", "Ollama · recommended"], ["lmStudio", "LM Studio"], ["mlx", "MLX"], ["llamaCpp", "llama.cpp"], ["any", "Any compatible format"]] as const;

function validInitialMemory(chip: Chip, memoryGb: number) {
  const options = chipProfiles[chip].memoryOptionsGb as readonly number[];
  return options.includes(memoryGb) ? memoryGb : options[0];
}

export function FinderForm({ config, submitted, fieldErrors, catalogueError }: { config: FormConfig; submitted: boolean; fieldErrors: ConfigFieldErrors; catalogueError: string }) {
  const initialChip: Chip = typeof config.chip === "string" && config.chip in chipProfiles ? config.chip as Chip : "m4";
  const [chip, setChip] = useState(initialChip);
  const [submittedChip, setSubmittedChip] = useState(fieldErrors.chip ? config.chip : undefined);
  const [memoryGb, setMemoryGb] = useState(fieldErrors.memoryGb ? config.memoryGb ?? Number.NaN : validInitialMemory(initialChip, config.memoryGb ?? 16));
  const [diskGb, setDiskGb] = useState(fieldErrors.diskGb ? Number.isFinite(config.diskGb) ? String(config.diskGb) : "" : String(config.diskGb ?? 80));
  const [workload, setWorkload] = useState<"chat" | "coding" | "balanced" | undefined>(fieldErrors.workload ? undefined : config.workload === "chat" || config.workload === "coding" ? config.workload : "balanced");
  const configuredRuntime = config.runtime === "ollama" || config.runtime === "lmStudio" || config.runtime === "mlx" || config.runtime === "llamaCpp" ? config.runtime : undefined;
  const [runtime, setRuntime] = useState<RuntimeChoice | undefined>(fieldErrors.runtime ? undefined : configuredRuntime ?? (submitted && config.runtime === undefined ? "any" : "ollama"));
  const configuredContext = config.context === "small" || config.context === "long" || config.context === "normal" ? config.context : undefined;
  const [context, setContext] = useState<ContextPreset | undefined>(fieldErrors.context ? undefined : configuredContext ?? "normal");
  const [hardwareStatus, setHardwareStatus] = useState("");
  const [visibleFieldErrors, setVisibleFieldErrors] = useState(fieldErrors);
  const profile = `${chipProfiles[chip].name} · ${Number.isFinite(memoryGb) ? `${memoryGb} GB` : "invalid memory"}`;
  const focusField = (field: ConfigField) => (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); document.getElementById(fieldTargets[field])?.focus(); };
  const clearFieldErrors = (...fields: ConfigField[]) => setVisibleFieldErrors((current) => {
    if (!fields.some((field) => current[field])) return current;
    const next = { ...current };
    for (const field of fields) delete next[field];
    return next;
  });
  const handleHardwareChange = (nextChip: Chip, nextMemoryGb: number, status: string) => {
    if (nextChip !== chip || submittedChip !== undefined) clearFieldErrors("chip", "memoryGb");
    else clearFieldErrors("memoryGb");
    setSubmittedChip(undefined);
    setChip(nextChip);
    setMemoryGb(nextMemoryGb);
    setHardwareStatus(status);
  };

  const runtimeLabel = runtime === undefined ? "Choose a runtime" : runtime === "any" ? "Any compatible format" : runtime === "lmStudio" ? "LM Studio" : runtime === "llamaCpp" ? "llama.cpp" : runtime === "mlx" ? "MLX" : "Ollama";

  return <section className="finder" id="finder" aria-labelledby="finder-title">
    <div className="section-intro">
      <span className="eyebrow">01 — Your machine</span>
      <h2 id="finder-title">Build your Mac profile</h2>
      <p>We use these details only to calculate this recommendation. They remain in the shareable page URL, but this app does not create a profile, cookie, or database record. Hosting request logs may retain the URL temporarily. <a href="/privacy">Privacy details</a>.</p>
    </div>
    <form method="get" aria-describedby="configuration-help">
      {submitted && Object.keys(visibleFieldErrors).length > 0 && <div className="error-summary" role="alert" tabIndex={-1} autoFocus>
        <h2>Check your Mac profile</h2>
        <p>Correct the following before finding models. Select an issue to move to that control.</p>
        <ul>{(Object.entries(visibleFieldErrors) as [ConfigField, string][]).map(([field, error]) => <li key={field}><a href={`#${fieldTargets[field]}`} onClick={focusField(field)}>{error}</a></li>)}</ul>
      </div>}
      <p id="configuration-help" className="form-help">Your choices stay in this page link; the app does not add a profile record or cookie.</p>

      <fieldset className="form-section hardware-section">
        <legend>Hardware</legend>
        <p className="section-help">Use Apple menu → About This Mac, plus the storage currently available in System Settings.</p>
        <details className="specs-helper">
          <summary>Find your Mac specs</summary>
          <div>
            <p><b>Chip</b> is the Apple chip name, such as M1, M3 Pro, or M4 Max.</p>
            <p><b>Unified memory</b> is the RAM shared by your Mac’s processor and graphics—not the amount currently in use.</p>
            <p><b>Available storage</b> is space free now for downloading a model, not your Mac’s total disk capacity.</p>
          </div>
        </details>
        <div className="fields">
          <HardwareSelector chip={chip} submittedChip={submittedChip} memoryGb={memoryGb} fieldErrors={visibleFieldErrors} status={hardwareStatus} onChange={handleHardwareChange}/>
          <label htmlFor="diskGb">Available storage (GB)
            <input id="diskGb" name="diskGb" required min="1" max="4000" step="any" type="number" value={diskGb} onChange={(event) => { clearFieldErrors("diskGb"); setDiskGb(event.target.value); }} aria-invalid={Boolean(visibleFieldErrors.diskGb)} aria-describedby={visibleFieldErrors.diskGb ? "disk-error" : "disk-help"}/>
            <small id="disk-help">Space free now for a model download—not total disk capacity.</small>
            {visibleFieldErrors.diskGb && <span className="field-error" id="disk-error">{visibleFieldErrors.diskGb}</span>}
          </label>
        </div>
        <aside className="profile-summary" aria-live="polite" aria-atomic="true">
          <span className="eyebrow">Profile ready</span>
          <p><b>{profile}</b><span>{diskGb || "0"} GB available storage</span><span>{workload === "chat" ? "Chat and writing" : workload === "coding" ? "Coding" : workload === "balanced" ? "Balanced use" : "Choose a workload"}</span><span>{context === "small" ? "Short context" : context === "normal" ? "Normal context" : context === "long" ? "Long context" : "Choose a context"}</span><span>{runtimeLabel}</span></p>
        </aside>
      </fieldset>

      <fieldset className="form-section" aria-describedby={visibleFieldErrors.workload ? "workload-error" : undefined} aria-invalid={Boolean(visibleFieldErrors.workload)}>
        <legend>What do you want to do?</legend>
        <p className="section-help">Pick the outcome you want most. <b>Not sure?</b> Choose Balanced.</p>
        <span className="control-label">Your main use</span>
        <div className="choices workload">{workloadOptions.map(([value, label]) => <label key={value}>
          <input id={`workload-${value}`} name="workload" type="radio" value={value} required={value === "chat"} checked={workload === value} onChange={() => { clearFieldErrors("workload"); setWorkload(value); }}/>
          <span>{label}</span>
        </label>)}</div>
        {visibleFieldErrors.workload && <span className="field-error" id="workload-error">{visibleFieldErrors.workload}</span>}
        <span className="control-label context-label">How much text or code at once?</span>
        <p className="section-help">Context is the room a model keeps for your conversation. {contextConsequences[context ?? "normal"]}</p>
        <div className="choices context">{contextOptions.map(([value, label, description]) => <label key={value}>
          <input id={`context-${value}`} name="context" type="radio" value={value} required={value === "small"} checked={context === value} onChange={() => { clearFieldErrors("context"); setContext(value); }}/>
          <span><b>{label}</b><small>{description}</small></span>
        </label>)}</div>
        {visibleFieldErrors.context && <span className="field-error" id="context-error">{visibleFieldErrors.context}</span>}
      </fieldset>

      <fieldset className="form-section" aria-describedby={visibleFieldErrors.runtime ? "runtime-error" : undefined} aria-invalid={Boolean(visibleFieldErrors.runtime)}>
        <legend>Preferred app to run models</legend>
        <p className="section-help"><b>Not sure?</b> Ollama is the recommended default. Choose Any compatible format to keep both GGUF and MLX options in the shortlist.</p>
        <div className="choices runtime">{runtimeOptions.map(([value, label]) => <label key={value}>
          <input id={`runtime-${value}`} name="runtime" type="radio" value={value} required={value === "ollama"} checked={runtime === value} onChange={() => { clearFieldErrors("runtime"); setRuntime(value); }}/>
          <span><b>{label}</b><small>{runtimeDescriptions[value]}</small></span>
        </label>)}</div>
        {visibleFieldErrors.runtime && <span className="field-error" id="runtime-error">{visibleFieldErrors.runtime}</span>}
      </fieldset>

      <button type="submit">Find models for {profile} <span aria-hidden="true">→</span></button>
      {catalogueError && <p className="error" role="alert">{catalogueError}</p>}
    </form>
  </section>;
}
