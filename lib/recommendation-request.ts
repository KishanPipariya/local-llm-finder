import { validateConfig, type MacConfig } from "./hardware";

export type PostResult<T> = { status: 200; body: T } | { status: 400; body: { errors: string[]; fieldErrors: Record<string, string | undefined> } } | { status: 503; body: { error: string } };

/** Keeps the POST boundary deliberately small and makes validation parity explicit. */
export async function handleRecommendationPost<T>(request: Request, get: (config: MacConfig) => Promise<T>, unavailableMessage: string): Promise<PostResult<T>> {
  const validation = validateConfig(await request.json().catch(() => null));
  if (!validation.valid) return { status: 400, body: { errors: validation.errors, fieldErrors: validation.fieldErrors } };
  try {
    return { status: 200, body: await get(validation.data) };
  } catch {
    return { status: 503, body: { error: unavailableMessage } };
  }
}
