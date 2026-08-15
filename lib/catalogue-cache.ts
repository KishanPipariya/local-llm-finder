import type { Artifact, ExclusionSummary } from "./recommendations";

export type Catalogue = { items: Artifact[]; refreshedAt: string; exclusions?: Partial<ExclusionSummary> };
export type CatalogueState = Catalogue | undefined;
export type RefreshScheduler = (task: () => Promise<void>) => void;

export class CatalogueCache {
  private state: CatalogueState;
  private refreshInFlight: Promise<Catalogue> | undefined;
  private refreshScheduled = false;
  private retryAfter = 0;

  constructor(
    private readonly refresh: () => Promise<Catalogue>,
    private readonly maxAge = 6 * 60 * 60 * 1000,
    private readonly clock = () => Date.now(),
    private readonly retryDelay = 5 * 60 * 1000,
    private readonly schedule: RefreshScheduler = (task) => { void task(); },
  ) {}

  async get(): Promise<{ catalogue: Catalogue; stale: boolean }> {
    const now = this.clock();
    if (this.state && isFresh(this.state, now, this.maxAge)) return { catalogue: this.state, stale: false };
    if (this.state) {
      if (now >= this.retryAfter && !this.refreshInFlight && !this.refreshScheduled) this.scheduleRefresh();
      return { catalogue: this.state, stale: true };
    }

    if (now < this.retryAfter) throw new Error("Catalogue refresh is backing off after a failed attempt.");

    const catalogue = await this.startRefresh();
    return { catalogue, stale: !isFresh(catalogue, this.clock(), this.maxAge) };
  }

  private scheduleRefresh() {
    this.refreshScheduled = true;
    try {
      this.schedule(async () => {
        this.refreshScheduled = false;
        const now = this.clock();
        if (!this.state || isFresh(this.state, now, this.maxAge) || now < this.retryAfter || this.refreshInFlight) return;
        await this.startRefresh().then(() => undefined, () => undefined);
      });
    } catch (error) {
      this.refreshScheduled = false;
      throw error;
    }
  }

  private startRefresh(): Promise<Catalogue> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const previous = this.state;
        const catalogue = await this.refresh();
        // A framework cache may resolve with its stale value while it refreshes
        // in the background. Treat that as an incomplete refresh here so the
        // process-local retry backoff still protects the upstream catalogue.
        const fresh = isFresh(catalogue, this.clock(), this.maxAge);
        if (!fresh) {
          this.retryAfter = this.clock() + this.retryDelay;
          // Preserve the last known-good local value when one exists. On a
          // cold start, retain the framework-provided stale value so callers
          // still see an explicit stale result and the next attempt respects
          // the same backoff.
          if (previous) return previous;
          this.state = catalogue;
          return catalogue;
        }
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
