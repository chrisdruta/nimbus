import { withUser } from "@/lib/server/route-helpers";
import { getTrackPlays } from "@/lib/server/plays";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => ({
    plays: await getTrackPlays(session.userId),
  }));
}
