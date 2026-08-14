import { getCatalogue } from "./catalogue";
import { rankArtifactsWithExplanations, type ExclusionSummary, type Recommendation } from "./recommendations";
import type { MacConfig } from "./hardware";

export type RecommendationResult = { recommendations: Recommendation[]; exclusions: ExclusionSummary; refreshedAt: string; stale: boolean };

export class CatalogueUnavailableError extends Error {
  constructor(message = "The model catalogue is unavailable.", options?: ErrorOptions) {
    super(message, options);
    this.name = "CatalogueUnavailableError";
  }
}

export function isCatalogueUnavailableError(error: unknown): error is CatalogueUnavailableError {
  return error instanceof CatalogueUnavailableError;
}

export function mergeExclusions(ranking: ExclusionSummary, catalogue: Partial<ExclusionSummary> | undefined): ExclusionSummary {
  if (!catalogue) return ranking;
  for (const reason of Object.keys(ranking) as (keyof ExclusionSummary)[]) ranking[reason] += catalogue[reason] ?? 0;
  return ranking;
}

export async function getRecommendations(config: MacConfig): Promise<RecommendationResult> {
  let cached;
  try {
    cached = await getCatalogue();
  } catch (error) {
    throw new CatalogueUnavailableError(undefined, { cause: error });
  }
  const ranked = rankArtifactsWithExplanations(cached.catalogue.items, config);
  mergeExclusions(ranked.exclusions, cached.catalogue.exclusions);
  return { ...ranked, refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale };
}
