import { withUser } from "@/lib/route-helpers";
import { getTrackPlays } from "@/lib/plays";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => ({
    plays: await getTrackPlays(session.userId),
  }));
}
