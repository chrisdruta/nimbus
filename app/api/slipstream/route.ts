import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/route-helpers";
import { parseHeartbeat } from "@/lib/slipstream";
import { upsertSlipstream } from "@/lib/server/slipstream-store";
import type { SharedWire } from "@/lib/shared-queue";

export const runtime = "nodejs";

/** Host heartbeat. POST (not PUT) so navigator.sendBeacon can deliver the
 * final playing:false beat on pagehide. There is no DELETE: playing:false
 * plus the staleness window cover pause, unload, and crash identically.
 *
 * While hosting a shared session the beat carries sharedRev/controlSeq and
 * the response doubles as the host's state poll: `shared` embeds the queue
 * only when the host's revision is behind, and a control intent only when
 * one arrived since the host's last applied seq — no separate poll loop. */
export async function POST(req: NextRequest) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const body = await readJsonBody(req, 32 * 1024);
    const hb = parseHeartbeat(body);
    if (!hb) throw new BadRequestError("malformed heartbeat");
    const state = await upsertSlipstream(session.userId, hb);
    if (!state) return { ok: true };
    const shared: SharedWire = {
      revision: state.revision,
      controlSeq: state.controlSeq,
      ...(state.revision !== hb.sharedRev ? { queue: state.queue } : {}),
      ...(state.control && state.controlSeq > (hb.controlSeq ?? 0)
        ? { control: state.control }
        : {}),
    };
    return { ok: true, shared };
  });
}
