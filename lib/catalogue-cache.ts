import type { Artifact } from "./recommendations";

export type Catalogue = { items: Artifact[]; refreshedAt: string };
export type CatalogueState = Catalogue | undefined;

export async function cachedCatalogue(state: CatalogueState, refresh: () => Promise<Catalogue>, now = Date.now(), maxAge = 6 * 60 * 60 * 1000): Promise<{ catalogue: Catalogue; stale: boolean }> {
  if (state && now - Date.parse(state.refreshedAt) <= maxAge) return { catalogue: state, stale: false };
  try { return { catalogue: await refresh(), stale: false }; }
  catch (error) { if (state) return { catalogue: state, stale: true }; throw error; }
}
