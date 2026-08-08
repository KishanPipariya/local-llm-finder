const presets = [
  { name: "Everyday", detail: "M4 · 16 GB · balanced · Ollama", href: "/?chip=m4&memoryGb=16&diskGb=80&workload=balanced&runtime=ollama&context=normal" },
  { name: "Developer", detail: "M3 Pro · 36 GB · coding · LM Studio", href: "/?chip=m3Pro&memoryGb=36&diskGb=160&workload=coding&runtime=lmStudio&context=normal" },
  { name: "High-capacity", detail: "M4 Max · 64 GB · coding · MLX", href: "/?chip=m4Max&memoryGb=64&diskGb=320&workload=coding&runtime=mlx&context=long" },
] as const;

export function PresetLinks() {
  return <section className="presets" aria-labelledby="preset-title"><div><span className="eyebrow">Quick start</span><h2 id="preset-title">Try a preset</h2><p>Open a complete, shareable Mac profile and see its server-rendered shortlist.</p></div><ul>{presets.map((preset) => <li key={preset.name}><a href={preset.href}><strong>{preset.name}</strong><span>{preset.detail}</span><b aria-hidden="true">→</b></a></li>)}</ul></section>;
}
