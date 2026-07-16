import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import {
  cursorParam,
  positiveSafeInteger,
  withUser,
} from "@/lib/server/route-helpers";

export const runtime = "nodejs";

// Discovery only — no quota; play starts are the sole quota consumer.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    const trackId = positiveSafeInteger(id, "track id");
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getRelatedTracks(
      accessToken,
      trackId,
      cursor,
    );
    return { tracks: page.items, nextCursor: page.nextCursor };
  });
}
