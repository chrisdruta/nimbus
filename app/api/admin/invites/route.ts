import { type NextRequest } from "next/server";
import {
  withAdmin,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/route-helpers";
import {
  createInvite,
  inviteStatus,
  listInvites,
  type CreatedInvite,
  type InviteRow,
} from "@/lib/server/invites";

export const runtime = "nodejs";

// Codes are stored hashed, so the link is only constructible here, in the
// creation response — the list shape deliberately has no url.
function toApi(invite: InviteRow) {
  return {
    id: invite.id,
    note: invite.note,
    status: inviteStatus(invite),
    createdAt: invite.created_at.toISOString(),
    expiresAt: invite.expires_at.toISOString(),
    usedAt: invite.used_at?.toISOString() ?? null,
    usedByUsername: invite.used_by_username,
  };
}

function toCreatedApi(invite: CreatedInvite) {
  return {
    ...toApi(invite),
    url: new URL(`/invite/${invite.code}`, process.env.APP_URL).toString(),
  };
}

export async function GET() {
  return withAdmin(async () => (await listInvites()).map(toApi));
}

export async function POST(req: NextRequest) {
  return withAdmin(async () => {
    requireSameOrigin(req);
    const body = (await readJsonBody(req)) as {
      note?: unknown;
    } | null;
    const note = body?.note;
    if (note !== undefined && typeof note !== "string") {
      throw new BadRequestError("note must be a string");
    }
    if (note && note.length > 500)
      throw new BadRequestError("note is too long");
    return toCreatedApi(await createInvite(note?.trim() || null));
  });
}
