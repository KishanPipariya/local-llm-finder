/** Shared upstream request limits. A refresh controller supplies the overall
 * deadline; each request also gets a short individual deadline. */
export const REQUEST_TIMEOUT_MS = 12_000;
export const REFRESH_TIMEOUT_MS = 30_000;

export type FetchLike = typeof fetch;

export function requestSignal(refreshSignal: AbortSignal) {
  return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), refreshSignal]);
}

export async function fetchJson(url: string, fetcher: FetchLike, refreshSignal: AbortSignal, source: string): Promise<unknown> {
  const response = await fetcher(url, { signal: requestSignal(refreshSignal) });
  if (!response.ok) throw new Error(`${source} request failed (${response.status})`);
  return response.json();
}

export async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}
