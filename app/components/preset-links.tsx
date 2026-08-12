const presets = [
  { name: "Everyday chat", detail: "M4 · 16 GB unified memory · 80 GB free · Ollama", href: "/?chip=m4&memoryGb=16&diskGb=80&workload=balanced&runtime=ollama&context=normal" },
  { name: "Help with coding", detail: "M3 Pro · 36 GB unified memory · 160 GB free · LM Studio", href: "/?chip=m3Pro&memoryGb=36&diskGb=160&workload=coding&runtime=lmStudio&context=normal" },
  { name: "Large code and documents", detail: "M4 Max · 64 GB unified memory · 320 GB free · MLX", href: "/?chip=m4Max&memoryGb=64&diskGb=320&workload=coding&runtime=mlx&context=long" },
] as const;

export function PresetLinks() {
  return <section className="presets" aria-labelledby="preset-title"><div><span className="eyebrow">Quick start</span><h2 id="preset-title">Start with your goal</h2><p>Choose the closest match to see the Mac and runtime assumptions before opening its shareable shortlist.</p></div><ul>{presets.map((preset) => <li key={preset.name}><a href={preset.href}><strong>{preset.name}</strong><span>{preset.detail}</span><b aria-hidden="true">→</b></a></li>)}</ul></section>;
}
