import { withAdmin } from "@/lib/server/route-helpers";
import { getGlobalUsage, nextUtcMidnight, utcDayKey } from "@/lib/server/quota";
import { getSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

export async function GET() {
  return withAdmin(async () => {
    const day = utcDayKey();
    const [globalUsed, settings] = await Promise.all([
      getGlobalUsage(day),
      getSettings(),
    ]);
    return {
      day,
      globalUsed,
      globalLimit: settings.globalDailyPlayLimit,
      userLimit: settings.userDailyPlayLimit,
      resetsAt: nextUtcMidnight().toISOString(),
    };
  });
}
