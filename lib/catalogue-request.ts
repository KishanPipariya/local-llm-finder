/** Shared upstream request limits. A refresh controller supplies the overall
 * deadline; each request also gets a short individual deadline. */
export const REQUEST_TIMEOUT_MS = 12_000;
export const REFRESH_TIMEOUT_MS = 30_000;
/**
 * Hugging Face metadata is upstream input. Keep one unusually large repository
 * from consuming unbounded memory while response.json() materializes it.
 */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export type FetchLike = typeof fetch;

export function requestSignal(refreshSignal: AbortSignal) {
  return AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), refreshSignal]);
}

async function readBoundedText(response: Response, source: string): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error(`${source} response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`);
  }
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`${source} response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchJson(url: string, fetcher: FetchLike, refreshSignal: AbortSignal, source: string): Promise<unknown> {
  const response = await fetcher(url, { signal: requestSignal(refreshSignal) });
  if (!response.ok) throw new Error(`${source} request failed (${response.status})`);
  return JSON.parse(await readBoundedText(response, source));
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
