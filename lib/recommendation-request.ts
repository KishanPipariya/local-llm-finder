import { validateConfig, type MacConfig } from "./hardware";
import { isCatalogueUnavailableError } from "./recommendation-service";

export type PostResult<T> = { status: 200; body: T } | { status: 400; body: { errors: string[]; fieldErrors: Record<string, string | undefined> } } | { status: 503; body: { error: string } };

const MAX_REQUEST_BYTES = 32 * 1024;

async function readJson(request: Request): Promise<unknown> {
  try {
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null && Number.isSafeInteger(Number(declaredLength)) && Number(declaredLength) > MAX_REQUEST_BYTES) return null;
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
          await reader.cancel();
          return null;
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
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Keeps the POST boundary deliberately small and makes validation parity explicit. */
export async function handleRecommendationPost<T>(request: Request, get: (config: MacConfig) => Promise<T>, unavailableMessage: string): Promise<PostResult<T>> {
  const validation = validateConfig(await readJson(request));
  if (!validation.valid) return { status: 400, body: { errors: validation.errors, fieldErrors: validation.fieldErrors } };
  try {
    return { status: 200, body: await get(validation.data) };
  } catch (error) {
    if (isCatalogueUnavailableError(error)) return { status: 503, body: { error: unavailableMessage } };
    throw error;
  }
}
