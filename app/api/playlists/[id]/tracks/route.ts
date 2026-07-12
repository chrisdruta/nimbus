import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  return withUser(async (session) => {
    const playlistId = Number(id);
    if (!Number.isInteger(playlistId)) throw new Error(`bad playlist id: ${id}`);
    const { accessToken } = await getValidAccessToken(session.userId);
    const page = await getProvider().getPlaylistTracks(
      accessToken,
      playlistId,
      cursor,
    );
    return { tracks: page.items, nextCursor: page.nextCursor };
  });
}
