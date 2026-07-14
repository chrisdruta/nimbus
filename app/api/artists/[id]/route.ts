import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { positiveSafeInteger, withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (session) => {
    const artistId = positiveSafeInteger((await params).id, "artist id");
    const { accessToken } = await getValidAccessToken(session.userId);
    const provider = getProvider();
    const [artist, followed] = await Promise.all([
      provider.getArtist(accessToken, artistId),
      provider.getArtistFollowed(accessToken, artistId),
    ]);
    return { artist, followed };
  });
}
