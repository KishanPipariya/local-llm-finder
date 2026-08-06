import { getCatalogue } from "./catalogue";
import { rankArtifactsWithExplanations, type ExclusionSummary, type MacConfig, type Recommendation } from "./recommendations";

export type RecommendationResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary; refreshedAt: string; stale: boolean };

export async function getRecommendations(config: MacConfig): Promise<RecommendationResult> {
  const cached = await getCatalogue();
  const ranked = rankArtifactsWithExplanations(cached.catalogue.items, config);
  for (const [reason, count] of Object.entries(cached.catalogue.exclusions ?? {})) ranked.exclusions[reason as keyof ExclusionSummary] += count ?? 0;
  return { ...ranked, refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale };
}
