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

type Cancelable = { cancel(reason?: unknown): Promise<void> };

function cancelWithoutWaiting(cancelable: Cancelable, reason?: unknown) {
  // Cancellation is cleanup, not part of the response deadline. A stream source
  // is allowed to return a promise here, so never let a stuck cleanup operation
  // defeat the byte or time bound that caused it.
  try { void cancelable.cancel(reason).catch(() => undefined); } catch { /* Best-effort cleanup. */ }
}

export function requestSignal(refreshSignal: AbortSignal, requestTimeoutMs = REQUEST_TIMEOUT_MS) {
  return AbortSignal.any([AbortSignal.timeout(requestTimeoutMs), refreshSignal]);
}

function readWithSignal(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Upstream response read aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readBoundedText(response: Response, source: string, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    if (response.body) cancelWithoutWaiting(response.body);
    throw new Error(`${source} response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`);
  }
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        cancelWithoutWaiting(reader);
        throw new Error(`${source} response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`);
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelWithoutWaiting(reader, error);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* Cancellation will release pending reads. */ }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchJson(url: string, fetcher: FetchLike, refreshSignal: AbortSignal, source: string, requestTimeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const signal = requestSignal(refreshSignal, requestTimeoutMs);
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`${source} request failed (${response.status})`);
  return JSON.parse(await readBoundedText(response, source, signal));
}

export async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Concurrency limit must be a positive safe integer");
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
