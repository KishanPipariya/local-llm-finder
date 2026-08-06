import type { Artifact } from "./recommendations";

export type Catalogue = { items: Artifact[]; refreshedAt: string };
export type CatalogueState = Catalogue | undefined;

export class CatalogueCache {
  private state: CatalogueState;
  private refreshInFlight: Promise<Catalogue> | undefined;

  constructor(private readonly refresh: () => Promise<Catalogue>, private readonly maxAge = 6 * 60 * 60 * 1000, private readonly clock = () => Date.now()) {}

  async get(): Promise<{ catalogue: Catalogue; stale: boolean }> {
    const now = this.clock();
    if (this.state && isFresh(this.state, now, this.maxAge)) return { catalogue: this.state, stale: false };
    if (!this.refreshInFlight) this.refreshInFlight = this.refresh().finally(() => { this.refreshInFlight = undefined; });
    try {
      const catalogue = await this.refreshInFlight;
      this.state = catalogue;
      return { catalogue, stale: false };
    } catch (error) {
      if (this.state) return { catalogue: this.state, stale: true };
      throw error;
    }
  }
}

export function isFresh(catalogue: Catalogue, now = Date.now(), maxAge = 6 * 60 * 60 * 1000) {
  const refreshedAt = Date.parse(catalogue.refreshedAt);
  return Number.isFinite(refreshedAt) && now >= refreshedAt && now - refreshedAt <= maxAge;
}
