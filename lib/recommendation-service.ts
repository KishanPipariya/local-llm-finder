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
  const merged = { ...ranking };
  if (!catalogue) return merged;
  for (const reason of Object.keys(merged) as (keyof ExclusionSummary)[]) merged[reason] += catalogue[reason] ?? 0;
  return merged;
}

export async function getRecommendations(config: MacConfig, getCatalogueFn = getCatalogue, now?: number): Promise<RecommendationResult> {
  let cached;
  try {
    cached = await getCatalogueFn();
  } catch (error) {
    throw new CatalogueUnavailableError(undefined, { cause: error });
  }
  const ranked = rankArtifactsWithExplanations(cached.catalogue.items, config, now ?? Date.now());
  const exclusions = mergeExclusions(ranked.exclusions, cached.catalogue.exclusions);
  return { ...ranked, exclusions, refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale };
}
