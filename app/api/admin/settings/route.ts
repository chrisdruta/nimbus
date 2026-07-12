import { type NextRequest } from "next/server";
import { withAdmin, BadRequestError } from "@/lib/route-helpers";
import { updateSettings, type AppSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** SoundCloud's hard client-id cap — never allow configuring past it. */
const SC_CLIENT_DAILY_CAP = 15000;

function limitField(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BadRequestError(`${name} must be a non-negative integer`);
  }
  return value as number;
}

export async function PATCH(req: NextRequest) {
  return withAdmin(async () => {
    const body = (await req.json().catch(() => null)) as Partial<
      Record<keyof AppSettings, unknown>
    > | null;
    if (!body) throw new BadRequestError("missing JSON body");

    const patch: Partial<AppSettings> = {
      userDailyPlayLimit: limitField(body.userDailyPlayLimit, "userDailyPlayLimit"),
      globalDailyPlayLimit: limitField(
        body.globalDailyPlayLimit,
        "globalDailyPlayLimit",
      ),
    };
    if (
      patch.userDailyPlayLimit === undefined &&
      patch.globalDailyPlayLimit === undefined
    ) {
      throw new BadRequestError("nothing to update");
    }
    if ((patch.globalDailyPlayLimit ?? 0) > SC_CLIENT_DAILY_CAP) {
      throw new BadRequestError(
        `globalDailyPlayLimit cannot exceed SoundCloud's ${SC_CLIENT_DAILY_CAP}/day cap`,
      );
    }
    return updateSettings(patch);
  });
}
