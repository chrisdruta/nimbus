import { type NextRequest } from "next/server";
import {
  withAdmin,
  BadRequestError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/route-helpers";
import { updateSettings, type AppSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** Leave concurrency headroom under SoundCloud's 15k hard client-id cap. */
const SC_SAFE_DAILY_CAP = 14000;

function limitField(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > SC_SAFE_DAILY_CAP
  ) {
    throw new BadRequestError(`${name} must be a non-negative integer`);
  }
  return value as number;
}

export async function PATCH(req: NextRequest) {
  return withAdmin(async () => {
    requireSameOrigin(req);
    const body = (await readJsonBody(req)) as Partial<
      Record<keyof AppSettings, unknown>
    > | null;
    if (!body) throw new BadRequestError("missing JSON body");

    const patch: Partial<AppSettings> = {
      userDailyPlayLimit: limitField(
        body.userDailyPlayLimit,
        "userDailyPlayLimit",
      ),
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
    if ((patch.globalDailyPlayLimit ?? 0) > SC_SAFE_DAILY_CAP) {
      throw new BadRequestError(
        `globalDailyPlayLimit cannot exceed the safe ${SC_SAFE_DAILY_CAP}/day cap`,
      );
    }
    return updateSettings(patch);
  });
}
