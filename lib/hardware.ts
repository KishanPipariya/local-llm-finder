export type ChipProfile = {
  name: string;
  memoryOptionsGb: readonly number[];
  bandwidthGbps: number;
};

export const chipProfiles = {
  m1: { name: "M1", memoryOptionsGb: [8, 16], bandwidthGbps: 68 },
  m1Pro: { name: "M1 Pro", memoryOptionsGb: [16, 32], bandwidthGbps: 200 },
  m1Max: { name: "M1 Max", memoryOptionsGb: [32, 64], bandwidthGbps: 400 },
  m1Ultra: { name: "M1 Ultra", memoryOptionsGb: [64, 128], bandwidthGbps: 800 },
  m2: { name: "M2", memoryOptionsGb: [8, 16, 24], bandwidthGbps: 100 },
  m2Pro: { name: "M2 Pro", memoryOptionsGb: [16, 32], bandwidthGbps: 200 },
  m2Max: { name: "M2 Max", memoryOptionsGb: [32, 64, 96], bandwidthGbps: 400 },
  m2Ultra: { name: "M2 Ultra", memoryOptionsGb: [64, 128, 192], bandwidthGbps: 800 },
  m3: { name: "M3", memoryOptionsGb: [8, 16, 24], bandwidthGbps: 100 },
  m3Pro: { name: "M3 Pro", memoryOptionsGb: [18, 36], bandwidthGbps: 150 },
  m3Max: { name: "M3 Max", memoryOptionsGb: [36, 48, 64, 96, 128], bandwidthGbps: 300 },
  m3Ultra: { name: "M3 Ultra", memoryOptionsGb: [96, 256, 512], bandwidthGbps: 819 },
  m4: { name: "M4", memoryOptionsGb: [16, 24, 32], bandwidthGbps: 120 },
  m4Pro: { name: "M4 Pro", memoryOptionsGb: [24, 48, 64], bandwidthGbps: 273 },
  m4Max: { name: "M4 Max", memoryOptionsGb: [36, 48, 64, 128], bandwidthGbps: 410 },
  m5: { name: "M5", memoryOptionsGb: [16, 24, 32], bandwidthGbps: 153 },
  m5Pro: { name: "M5 Pro", memoryOptionsGb: [24, 48, 64], bandwidthGbps: 307 },
  m5Max: { name: "M5 Max", memoryOptionsGb: [36, 48, 64, 128], bandwidthGbps: 460 },
} as const satisfies Record<string, ChipProfile>;

export type Chip = keyof typeof chipProfiles;
export type Runtime = "ollama" | "lmStudio" | "llamaCpp" | "mlx";
export type ContextPreset = "small" | "normal" | "long";
export type ConfigField = "chip" | "memoryGb" | "diskGb" | "workload" | "runtime" | "context";
export type ConfigFieldErrors = Partial<Record<ConfigField, string>>;
export type MacConfig = { chip: Chip; memoryGb: number; diskGb: number; workload: "chat" | "coding" | "balanced"; runtime?: Runtime; context?: ContextPreset };

export const chips = Object.entries(chipProfiles).map(([id, profile]) => ({ id: id as Chip, ...profile }));
export const allMemoryOptionsGb = [...new Set(chips.flatMap((chip) => chip.memoryOptionsGb))].sort((a, b) => a - b);
export const runtimes: readonly Runtime[] = ["llamaCpp", "mlx", "lmStudio", "ollama"];
export const contextPresets: readonly ContextPreset[] = ["small", "normal", "long"];
const workloads = ["chat", "coding", "balanced"] as const;

export function validateConfig(value: unknown): { valid: true; data: MacConfig } | { valid: false; errors: string[]; fieldErrors: ConfigFieldErrors } {
  const v = value as Partial<MacConfig>;
  const fieldErrors: ConfigFieldErrors = {};
  const profile = v && typeof v.chip === "string" ? chipProfiles[v.chip as Chip] : undefined;
  if (!profile) fieldErrors.chip = "Choose a supported Apple chip.";
  if (!(profile?.memoryOptionsGb as readonly number[] | undefined)?.includes(v?.memoryGb ?? Number.NaN)) fieldErrors.memoryGb = "Choose a memory configuration supported by that chip.";
  if (!Number.isFinite(v?.diskGb) || (v.diskGb ?? 0) < 1 || (v.diskGb ?? 0) > 4000) fieldErrors.diskGb = "Free disk space must be between 1 and 4,000 GB.";
  if (!workloads.includes(v?.workload as typeof workloads[number])) fieldErrors.workload = "Choose a workload.";
  if (v?.runtime !== undefined && !runtimes.includes(v.runtime as Runtime)) fieldErrors.runtime = "Choose a supported runtime.";
  if (v?.context !== undefined && !contextPresets.includes(v.context as ContextPreset)) fieldErrors.context = "Choose a context preset.";
  const errors = Object.values(fieldErrors);
  return errors.length ? { valid: false, errors, fieldErrors } : { valid: true, data: v as MacConfig };
}
