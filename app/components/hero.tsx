export function Hero() {
  return <header className="hero">
    <div className="hero-nav"><a className="brand" href="#finder" aria-label="Local LLM model finder">LOCAL / LLM</a><span className="pill">Mac model finder</span></div>
    <div className="hero-copy"><span className="eyebrow">Field notes / Apple Silicon</span><h1>Find a local model<br /><em>your Mac can actually run.</em></h1><p>Current chat and coding models, sized to your hardware.</p><ul className="privacy-promise" aria-label="Privacy promise"><li>No account</li><li>No analytics</li><li>No profile database</li></ul></div>
    <div className="signal-panel" aria-hidden="true"><span className="signal-index">01 / HARDWARE SIGNAL</span><span className="signal-chip">M</span><span className="signal-line signal-line-one" /><span className="signal-line signal-line-two" /><span className="signal-stat signal-stat-one">UNIFIED<br />MEMORY</span><span className="signal-stat signal-stat-two">LOCAL<br />ONLY</span><span className="signal-dot" /></div>
  </header>;
}
