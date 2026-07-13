import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/route-helpers";
import { parseHeartbeat } from "@/lib/slipstream";
import { upsertSlipstream } from "@/lib/slipstream-store";

export const runtime = "nodejs";

/** Host heartbeat. POST (not PUT) so navigator.sendBeacon can deliver the
 * final playing:false beat on pagehide. There is no DELETE: playing:false
 * plus the staleness window cover pause, unload, and crash identically. */
export async function POST(req: NextRequest) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const body = await readJsonBody(req, 32 * 1024);
    const hb = parseHeartbeat(body);
    if (!hb) throw new BadRequestError("malformed heartbeat");
    await upsertSlipstream(session.userId, hb);
    return { ok: true };
  });
}
