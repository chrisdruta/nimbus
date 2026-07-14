import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { cursorParam, positiveSafeInteger, withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (session) => {
    const artistId = positiveSafeInteger((await params).id, "artist id");
    const cursor = cursorParam(req);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getArtistTracks(
      accessToken,
      artistId,
      cursor,
    );
    return { tracks: page.items, nextCursor: page.nextCursor };
  });
}
