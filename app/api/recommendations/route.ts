import { getRecommendations } from "@/lib/recommendation-service";
import { catalogueUnavailableMessage } from "@/lib/request";
import { handleRecommendationPost } from "@/lib/recommendation-request";
import type { MacConfig } from "@/lib/hardware";

type PostHandler = (request: Request) => Promise<Response>;
type RecommendationGetter<T> = (config: MacConfig) => Promise<T>;

export function createPostHandler(): PostHandler;
export function createPostHandler<T>(get: RecommendationGetter<T>): PostHandler;
export function createPostHandler(get: RecommendationGetter<unknown> = getRecommendations): PostHandler {
  return async function POST(request: Request) {
    const result = await handleRecommendationPost(request, get, catalogueUnavailableMessage);
    return Response.json(result.body, { status: result.status });
  };
}

export const POST = createPostHandler();
