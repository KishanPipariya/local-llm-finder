import { getRecommendations } from "@/lib/recommendation-service";
import { validateConfig } from "@/lib/recommendations";

export const runtime = "nodejs";

export function createPostHandler(get = getRecommendations) {
  return async function POST(request: Request) {
    const validation = validateConfig(await request.json().catch(() => null));
    if (!validation.valid) return Response.json({ errors: validation.errors, fieldErrors: validation.fieldErrors }, { status: 400 });
    try {
      return Response.json(await get(validation.data));
    } catch {
      return Response.json({ error: "The model catalogue is temporarily unavailable. Please try again shortly." }, { status: 503 });
    }
  };
}

export const POST = createPostHandler();
