import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { positiveSafeInteger, withUser } from "@/lib/route-helpers";

export const runtime = "nodejs";

/** The viewer's relationship to a track: liked, artist followed. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    const trackId = positiveSafeInteger(id, "track id");
    const { accessToken } = await getValidAccessToken(session.userId);
    return getProvider().getTrackSocial(accessToken, trackId);
  });
}
