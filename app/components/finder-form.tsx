import { HardwareSelector } from "@/app/components/hardware-selector";
import { chipProfiles, type Chip, type ConfigFieldErrors } from "@/lib/recommendations";

type FormConfig = { chip?: string; memoryGb?: number; diskGb?: number; workload?: string };

export function FinderForm({ config, submitted, errors, fieldErrors, catalogueError }: { config: FormConfig; submitted: boolean; errors: string[]; fieldErrors: ConfigFieldErrors; catalogueError: string }) {
  const selectedChip: Chip = typeof config.chip === "string" && config.chip in chipProfiles ? config.chip as Chip : "m4";
  return <section className="finder" id="finder" aria-labelledby="finder-title"><div className="section-intro"><span className="eyebrow">01 — Your machine</span><h2 id="finder-title">Build your Mac profile</h2><p>We use these details only to calculate this recommendation. They are sent with this page request and are not saved.</p></div>
    <form method="get" aria-describedby="configuration-help">{submitted && errors.length > 0 && <div className="error-summary" role="alert" tabIndex={-1} autoFocus><h2>Check your Mac profile</h2><p>Correct the following before finding models:</p><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}<p id="configuration-help" className="form-help">Chip and unified-memory choices are checked against real Mac configurations.</p><div className="fields"><HardwareSelector chip={selectedChip} memoryGb={config.memoryGb ?? 16} fieldErrors={fieldErrors}/><label htmlFor="diskGb">Free disk space (GB)<input id="diskGb" name="diskGb" required min="1" max="4000" type="number" defaultValue={config.diskGb ?? 80} aria-invalid={Boolean(fieldErrors.diskGb)} aria-describedby={fieldErrors.diskGb ? "disk-error" : undefined}/>{fieldErrors.diskGb && <span className="field-error" id="disk-error">{fieldErrors.diskGb}</span>}</label></div>
      <fieldset aria-describedby={fieldErrors.workload ? "workload-error" : undefined} aria-invalid={Boolean(fieldErrors.workload)}><legend>What will you do most?</legend><div className="choices workload">{(["chat", "coding", "balanced"] as const).map((workload) => <label key={workload}><input name="workload" type="radio" value={workload} required={workload === "chat"} defaultChecked={(config.workload ?? "balanced") === workload}/><span>{workload === "chat" ? "General chat" : workload === "coding" ? "Coding" : "Balanced"}</span></label>)}</div>{fieldErrors.workload && <span className="field-error" id="workload-error">{fieldErrors.workload}</span>}</fieldset>
      <button type="submit">Find compatible models <span aria-hidden="true">→</span></button>{catalogueError && <p className="error" role="alert">{catalogueError}</p>}
    </form>
  </section>;
}
