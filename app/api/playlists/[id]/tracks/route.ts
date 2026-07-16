import { consumeProviderLimit } from "@/lib/server/rate-limit";
import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import {
  cursorParam,
  positiveSafeInteger,
  withUser,
} from "@/lib/server/route-helpers";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    consumeProviderLimit(session.userId);
    const cursor = cursorParam(req);
    const playlistId = positiveSafeInteger(id, "playlist id");
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getPlaylistTracks(
      accessToken,
      playlistId,
      cursor,
    );
    return { tracks: page.items, nextCursor: page.nextCursor };
  });
}
