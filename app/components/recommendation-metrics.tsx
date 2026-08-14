import type { Recommendation } from "@/lib/recommendations";

export function RecommendationMetrics({ model }: { model: Recommendation }) {
  const context = model.explanation.fit.context;
  const contextLabel = context.maxTokens === undefined
    ? `${context.label} (${context.requestedTokens.toLocaleString()} tokens; model limit not verified)`
    : `${context.label} (${context.requestedTokens.toLocaleString()} tokens; model limit ${context.maxTokens.toLocaleString()})`;
  return <><dl><div><dt>Download size</dt><dd>{model.sizeGb} GB</dd></div><div><dt>Estimated memory needed</dt><dd>{model.memoryGb} GB</dd></div><div><dt>Expected pace</dt><dd>{model.pace}<span className="visually-hidden">, qualitative estimate</span></dd></div></dl><section className="fit-breakdown" aria-label={`Why ${model.title} is estimated to fit`}><h4>Estimated setup check</h4><ul><li>Context: {contextLabel}.</li><li>Disk headroom: {model.explanation.fit.disk.headroomBytes / 1e9 >= 1 ? `${(model.explanation.fit.disk.headroomBytes / 1e9).toFixed(1)} GB` : `${Math.round(model.explanation.fit.disk.headroomBytes / 1e6)} MB`} after download.</li><li>Memory headroom: {model.explanation.fit.memory.headroomGb.toFixed(1)} GB from the conservative estimate.</li><li>Runtime: {model.explanation.fit.runtimes.join(", ")}.</li></ul></section></>;
}
