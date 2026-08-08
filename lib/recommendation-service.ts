import { getCatalogue } from "./catalogue";
import { rankArtifactsWithExplanations, type ExclusionSummary, type MacConfig, type Recommendation } from "./recommendations";

export type RecommendationResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary; refreshedAt: string; stale: boolean };

export function mergeExclusions(ranking: ExclusionSummary, catalogue: Partial<ExclusionSummary> | undefined): ExclusionSummary {
  if (!catalogue) return ranking;
  for (const reason of Object.keys(ranking) as (keyof ExclusionSummary)[]) ranking[reason] += catalogue[reason] ?? 0;
  return ranking;
}

export async function getRecommendations(config: MacConfig): Promise<RecommendationResult> {
  const cached = await getCatalogue();
  const ranked = rankArtifactsWithExplanations(cached.catalogue.items, config);
  mergeExclusions(ranked.exclusions, cached.catalogue.exclusions);
  return { ...ranked, refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale };
}
