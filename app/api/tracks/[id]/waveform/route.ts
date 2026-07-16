import { type NextRequest } from "next/server";
import { getProvider } from "@/lib/provider";
import { getValidAccessToken } from "@/lib/server/tokens";
import { positiveSafeInteger, withUser } from "@/lib/server/route-helpers";
import { normalizeWaveform } from "@/lib/viz/trackshape";

export const runtime = "nodejs";

// Discovery only — no quota; play starts are the sole quota consumer.
// Returns the normalized track shape (raw provider samples stay here);
// `{ shape: null }` whenever the provider has no usable waveform.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser(async (session) => {
    const trackId = positiveSafeInteger(id, "track id");
    const { accessToken } = await getValidAccessToken(session.userId);
    const samples = await getProvider().getWaveform(accessToken, trackId);
    return { shape: samples ? normalizeWaveform(samples) : null };
  });
}
