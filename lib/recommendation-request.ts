import { validateConfig, type MacConfig } from "./hardware";
import { isCatalogueUnavailableError } from "./recommendation-service";

export type PostResult<T> = { status: 200; body: T } | { status: 400; body: { errors: string[]; fieldErrors: Record<string, string | undefined> } } | { status: 503; body: { error: string } };

const MAX_REQUEST_BYTES = 32 * 1024;
export const REQUEST_BODY_TIMEOUT_MS = 5_000;

function readWithSignal(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Request body read aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readJson(request: Request, timeoutMs: number): Promise<unknown> {
  try {
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > MAX_REQUEST_BYTES) return null;
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const readSignal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    try {
      while (true) {
        const { done, value } = await readWithSignal(reader, readSignal);
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Keeps the POST boundary deliberately small and makes validation parity explicit. */
export async function handleRecommendationPost<T>(request: Request, get: (config: MacConfig) => Promise<T>, unavailableMessage: string, requestBodyTimeoutMs = REQUEST_BODY_TIMEOUT_MS): Promise<PostResult<T>> {
  const validation = validateConfig(await readJson(request, requestBodyTimeoutMs));
  if (!validation.valid) return { status: 400, body: { errors: validation.errors, fieldErrors: validation.fieldErrors } };
  try {
    return { status: 200, body: await get(validation.data) };
  } catch (error) {
    if (isCatalogueUnavailableError(error)) return { status: 503, body: { error: unavailableMessage } };
    throw error;
  }
}
