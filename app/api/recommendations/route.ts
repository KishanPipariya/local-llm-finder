import { getRecommendations } from "@/lib/recommendation-service";
import { catalogueUnavailableMessage } from "@/lib/request";
import { handleRecommendationPost } from "@/lib/recommendation-request";

export function createPostHandler(get = getRecommendations) {
  return async function POST(request: Request) {
    const result = await handleRecommendationPost(request, get, catalogueUnavailableMessage);
    return Response.json(result.body, { status: result.status });
  };
}

export const POST = createPostHandler();
