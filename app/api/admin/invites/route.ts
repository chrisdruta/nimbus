import { type NextRequest } from "next/server";
import { withAdmin, BadRequestError } from "@/lib/route-helpers";
import { createInvite, inviteStatus, listInvites, type InviteRow } from "@/lib/invites";

export const runtime = "nodejs";

function toApi(invite: InviteRow) {
  return {
    id: invite.id,
    note: invite.note,
    status: inviteStatus(invite),
    url: new URL(`/invite/${invite.code}`, process.env.APP_URL).toString(),
    createdAt: invite.created_at.toISOString(),
    expiresAt: invite.expires_at.toISOString(),
    usedAt: invite.used_at?.toISOString() ?? null,
    usedByUsername: invite.used_by_username,
  };
}

export async function GET() {
  return withAdmin(async () => (await listInvites()).map(toApi));
}

export async function POST(req: NextRequest) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as {
      note?: unknown;
    } | null;
    const note = body?.note;
    if (note !== undefined && typeof note !== "string") {
      throw new BadRequestError("note must be a string");
    }
    return toApi(await createInvite(note?.trim() || null));
  });
}
