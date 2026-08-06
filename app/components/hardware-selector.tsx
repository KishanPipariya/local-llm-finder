"use client";

import { useSyncExternalStore, useState, type ChangeEvent } from "react";
import { chipProfiles, chips, type Chip, type ConfigFieldErrors } from "@/lib/recommendations";

const allMemoryOptions = [...new Set(chips.flatMap((chip) => chip.memoryOptionsGb))].sort((a, b) => a - b);
const subscribeToHydration = () => () => {};
const getClientHydrationState = () => true;
const getServerHydrationState = () => false;

function closestMemoryOption(memoryGb: number, options: readonly number[]) {
  return options.reduce((closest, option) => {
    const distance = Math.abs(option - memoryGb);
    const closestDistance = Math.abs(closest - memoryGb);
    return distance < closestDistance || (distance === closestDistance && option < closest) ? option : closest;
  });
}

export function HardwareSelector({ chip, memoryGb, fieldErrors }: { chip: Chip; memoryGb: number; fieldErrors: ConfigFieldErrors }) {
  const [selectedChip, setSelectedChip] = useState(chip);
  const [selectedMemoryGb, setSelectedMemoryGb] = useState(memoryGb);
  const isInteractive = useSyncExternalStore(subscribeToHydration, getClientHydrationState, getServerHydrationState);
  const [status, setStatus] = useState("");
  const memoryOptions = isInteractive ? chipProfiles[selectedChip].memoryOptionsGb : allMemoryOptions;
  const renderedMemoryGb = isInteractive ? closestMemoryOption(selectedMemoryGb, memoryOptions) : selectedMemoryGb;

  function handleChipChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextChip = event.target.value as Chip;
    const nextMemoryGb = closestMemoryOption(renderedMemoryGb, chipProfiles[nextChip].memoryOptionsGb);
    setSelectedChip(nextChip);
    setSelectedMemoryGb(nextMemoryGb);
    setStatus(nextMemoryGb === selectedMemoryGb ? "" : `Unified memory adjusted to ${nextMemoryGb} GB for ${chipProfiles[nextChip].name}.`);
  }

  return <>
    <label htmlFor="chip">Apple chip
      <select id="chip" name="chip" required value={selectedChip} onChange={handleChipChange} aria-invalid={Boolean(fieldErrors.chip)} aria-describedby={fieldErrors.chip ? "chip-error" : undefined}>
        {chips.map((chipOption) => <option key={chipOption.id} value={chipOption.id}>{chipOption.name}</option>)}
      </select>
      {fieldErrors.chip && <span className="field-error" id="chip-error">{fieldErrors.chip}</span>}
    </label>
    <label htmlFor="memoryGb">Unified memory (GB)
      <select id="memoryGb" name="memoryGb" required value={renderedMemoryGb} onChange={(event) => { setSelectedMemoryGb(Number(event.target.value)); setStatus(""); }} aria-invalid={Boolean(fieldErrors.memoryGb)} aria-describedby={fieldErrors.memoryGb ? "memory-error" : undefined}>
        {memoryOptions.map((memoryOption) => <option key={memoryOption} value={memoryOption}>{memoryOption} GB</option>)}
      </select>
      {fieldErrors.memoryGb && <span className="field-error" id="memory-error">{fieldErrors.memoryGb}</span>}
    </label>
    <p className="sr-only" aria-live="polite">{status}</p>
  </>;
}
