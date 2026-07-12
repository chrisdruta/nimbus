import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getUserAuth } from "@/lib/db";
import { ToastProvider } from "@/components/ui/Toast";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { AppShell } from "@/components/shell/AppShell";

export default async function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await readSession();
  if (!session) redirect("/");

  // Removed/disabled members get bounced instead of a shell full of 401s.
  const membership = await getUserAuth(session.userId);
  if (!membership || membership.disabled) redirect("/");

  return (
    <ToastProvider>
      <PlayerProvider>
        <AppShell>{children}</AppShell>
      </PlayerProvider>
    </ToastProvider>
  );
}
