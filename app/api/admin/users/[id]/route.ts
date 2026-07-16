import { type NextRequest } from "next/server";
import {
  withAdmin,
  BadRequestError,
  positiveSafeInteger,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/route-helpers";
import { deleteUser, getUserById, setUserDisabled } from "@/lib/server/db";
import { isOwner } from "@/lib/server/session";

export const runtime = "nodejs";

async function targetUser(id: string) {
  const userId = positiveSafeInteger(id, "user id");
  const user = await getUserById(userId);
  if (!user) throw new BadRequestError("no such user");
  if (isOwner(user.sc_user_id)) {
    throw new BadRequestError("the owner account cannot be modified");
  }
  return user;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withAdmin(async () => {
    requireSameOrigin(req);
    const body = (await readJsonBody(req)) as {
      disabled?: unknown;
    } | null;
    if (typeof body?.disabled !== "boolean") {
      throw new BadRequestError("body must be { disabled: boolean }");
    }
    const user = await targetUser(id);
    await setUserDisabled(user.id, body.disabled);
    return { id: user.id, disabled: body.disabled };
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withAdmin(async () => {
    requireSameOrigin(req);
    const user = await targetUser(id);
    await deleteUser(user.id);
    return { id: user.id, deleted: true };
  });
}
