import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/tokens";
import { withUser } from "@/lib/route-helpers";
import { consumePlayStart, refundPlayStart, utcDayKey } from "@/lib/quota";
import { recordTrackPlay } from "@/lib/plays";
import { isOwner } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    const trackId = Number(id);
    if (!Number.isInteger(trackId)) throw new Error(`bad track id: ${id}`);

    // Count the start before touching SoundCloud so an over-cap user never
    // consumes the real client-id budget; give it back if resolution fails.
    const day = utcDayKey();
    await consumePlayStart(session.userId, isOwner(session.scUserId));

    try {
      const { accessToken } = await getValidAccessToken(session.userId);
      // JSON with a short-lived CDN URL — the audio itself never crosses
      // this backend.
      const stream = await getProvider().resolveStream(accessToken, trackId);
      // Tally after success only (a refunded failure is not a play), and
      // best-effort — a DB hiccup must never fail a good play.
      await recordTrackPlay(session.userId, trackId).catch(() => {});
      return stream;
    } catch (err) {
      await refundPlayStart(session.userId, day).catch(() => {});
      throw err;
    }
  });
}
