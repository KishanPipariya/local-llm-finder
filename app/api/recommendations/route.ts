import { getCatalogue } from "@/lib/catalogue";
import { rankArtifacts, validateConfig } from "@/lib/recommendations";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const validation = validateConfig(await request.json().catch(() => null));
  if (!validation.valid) return Response.json({ errors: validation.errors }, { status: 400 });
  try {
    const cached = await getCatalogue();
    return Response.json({ recommendations: rankArtifacts(cached.catalogue.items, validation.data), refreshedAt: cached.catalogue.refreshedAt, stale: cached.stale });
  } catch {
    return Response.json({ error: "The model catalogue is temporarily unavailable. Please try again shortly." }, { status: 503 });
  }
}
