import { withUser } from "@/lib/route-helpers";
import { listActiveSlipstreams } from "@/lib/slipstream-store";

export const runtime = "nodejs";

/** Live feed: everyone currently playing with a fresh heartbeat. Includes
 * the caller — the client renders an inert "(you)" row via `you`. */
export async function GET() {
  return withUser(async (session) => ({
    slipstreams: await listActiveSlipstreams(),
    you: session.userId,
  }));
}
