import { getCatalogue } from "./catalogue";
import { rankArtifacts, type MacConfig, type Recommendation } from "./recommendations";

export type RecommendationResult = { recommendations: Recommendation[]; refreshedAt: string; stale: boolean };

export async function getRecommendations(config: MacConfig): Promise<RecommendationResult> {
  const cached = await getCatalogue();
  return { recommendations: rankArtifacts(cached.catalogue.items, config), refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale };
}
