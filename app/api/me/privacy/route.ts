import { type NextRequest } from "next/server";
import {
  withUser,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/route-helpers";
import {
  getPrivateListening,
  setPrivateListening,
} from "@/lib/server/slipstream-store";

export const runtime = "nodejs";

export async function GET() {
  return withUser(async (session) => ({
    privateListening: await getPrivateListening(session.userId),
  }));
}

export async function PUT(req: NextRequest) {
  return withUser(async (session) => {
    requireSameOrigin(req);
    const body = (await readJsonBody(req)) as {
      privateListening?: unknown;
    } | null;
    if (typeof body?.privateListening !== "boolean") {
      throw new BadRequestError("privateListening must be a boolean");
    }
    await setPrivateListening(session.userId, body.privateListening);
    return { privateListening: body.privateListening };
  });
}
