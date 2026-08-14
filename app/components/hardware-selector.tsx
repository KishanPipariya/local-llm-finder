"use client";

import { useSyncExternalStore, type ChangeEvent } from "react";
import { allMemoryOptionsGb, chipProfiles, chips, type Chip, type ConfigFieldErrors } from "@/lib/hardware";

function closestMemoryOption(memoryGb: number, options: readonly number[]) {
  return options.reduce((closest, option) => {
    const distance = Math.abs(option - memoryGb);
    const closestDistance = Math.abs(closest - memoryGb);
    return distance < closestDistance || (distance === closestDistance && option < closest) ? option : closest;
  });
}

const noOpSubscribe = () => () => undefined;
const clientEnhancedSnapshot = () => true;
const serverEnhancedSnapshot = () => false;

export function HardwareSelector({ chip, memoryGb, fieldErrors, onChange, status }: { chip: Chip; memoryGb: number; fieldErrors: ConfigFieldErrors; onChange: (chip: Chip, memoryGb: number, status: string) => void; status: string }) {
  const memoryOptions = chipProfiles[chip].memoryOptionsGb as readonly number[];
  const enhanced = useSyncExternalStore(noOpSubscribe, clientEnhancedSnapshot, serverEnhancedSnapshot);
  const renderedMemoryOptions = enhanced ? memoryOptions : allMemoryOptionsGb;

  function handleChipChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextChip = event.target.value as Chip;
    const nextMemoryGb = closestMemoryOption(memoryGb, chipProfiles[nextChip].memoryOptionsGb as readonly number[]);
    onChange(nextChip, nextMemoryGb, nextMemoryGb === memoryGb ? "" : `Unified memory adjusted to ${nextMemoryGb} GB for ${chipProfiles[nextChip].name}.`);
  }

  return <>
    <label htmlFor="chip">Apple chip
      <select id="chip" name="chip" required value={chip} onChange={handleChipChange} aria-invalid={Boolean(fieldErrors.chip)} aria-describedby={fieldErrors.chip ? "chip-error" : undefined}>
        {chips.map((chipOption) => <option key={chipOption.id} value={chipOption.id}>{chipOption.name}</option>)}
      </select>
      {fieldErrors.chip && <span className="field-error" id="chip-error">{fieldErrors.chip}</span>}
    </label>
    <label htmlFor="memoryGb">Unified memory (GB)
      <select id="memoryGb" name="memoryGb" required value={memoryGb} onChange={(event) => onChange(chip, Number(event.target.value), "")} aria-invalid={Boolean(fieldErrors.memoryGb)} aria-describedby={fieldErrors.memoryGb ? "memory-error" : undefined}>
        {renderedMemoryOptions.map((memoryOption) => <option key={memoryOption} value={memoryOption}>{memoryOption} GB{!enhanced && ` (${chips.filter((chipOption) => (chipOption.memoryOptionsGb as readonly number[]).includes(memoryOption)).map((chipOption) => chipOption.name).join(", ")})`}</option>)}
      </select>
      {fieldErrors.memoryGb && <span className="field-error" id="memory-error">{fieldErrors.memoryGb}</span>}
    </label>
    <p className="sr-only" aria-live="polite">{status}</p>
  </>;
}
