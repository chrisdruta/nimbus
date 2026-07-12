import { redirect } from "next/navigation";
import { isOwner, readSession } from "@/lib/session";
import { AdminView } from "@/components/admin/AdminView";

export default async function AdminPage() {
  const session = await readSession();
  if (!session || !isOwner(session.scUserId)) redirect("/library");
  return <AdminView />;
}
