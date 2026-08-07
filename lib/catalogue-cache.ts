import type { Artifact, ExclusionSummary } from "./recommendations";

export type Catalogue = { items: Artifact[]; refreshedAt: string; exclusions?: Partial<ExclusionSummary> };
export type CatalogueState = Catalogue | undefined;

export class CatalogueCache {
  private state: CatalogueState;
  private refreshInFlight: Promise<Catalogue> | undefined;
  private retryAfter = 0;

  constructor(
    private readonly refresh: () => Promise<Catalogue>,
    private readonly maxAge = 6 * 60 * 60 * 1000,
    private readonly clock = () => Date.now(),
    private readonly retryDelay = 5 * 60 * 1000,
  ) {}

  async get(): Promise<{ catalogue: Catalogue; stale: boolean }> {
    const now = this.clock();
    if (this.state && isFresh(this.state, now, this.maxAge)) return { catalogue: this.state, stale: false };
    if (this.state) {
      if (now >= this.retryAfter) void this.startRefresh().catch(() => undefined);
      return { catalogue: this.state, stale: true };
    }

    return { catalogue: await this.startRefresh(), stale: false };
  }

  private startRefresh(): Promise<Catalogue> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const catalogue = await this.refresh();
        this.state = catalogue;
        this.retryAfter = 0;
        return catalogue;
      } catch (error) {
        this.retryAfter = this.clock() + this.retryDelay;
        throw error;
      } finally {
        this.refreshInFlight = undefined;
      }
    })();
    return this.refreshInFlight;
  }
}

export function isFresh(catalogue: Catalogue, now = Date.now(), maxAge = 6 * 60 * 60 * 1000) {
  const refreshedAt = Date.parse(catalogue.refreshedAt);
  return Number.isFinite(refreshedAt) && now >= refreshedAt && now - refreshedAt <= maxAge;
}
