"use client";

import { useToast } from "@/components/ui/Toast";
import { IconCloud } from "@/components/ui/icons";
import type { AdminUser } from "./AdminView";

export function UsersCard({
  users,
  userLimit,
  onChanged,
}: {
  users: AdminUser[] | null;
  userLimit: number | null;
  onChanged: () => void;
}) {
  const toast = useToast();

  async function setDisabled(user: AdminUser, disabled: boolean) {
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled }),
    });
    if (!res.ok) {
      toast("couldn't update user", "error");
      return;
    }
    toast(disabled ? "user disabled" : "user enabled");
    onChanged();
  }

  async function remove(user: AdminUser) {
    if (
      !window.confirm(
        `Remove ${user.username ?? `user ${user.scUserId}`}? They'll need a fresh invite to return.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast("couldn't remove user", "error");
      return;
    }
    toast("user removed");
    onChanged();
  }

  return (
    <section className="rounded-xl border border-elem p-5">
      <h2 className="text-sm tracking-widest text-muted uppercase">Users</h2>
      <ul className="mt-4 flex flex-col gap-2">
        {users === null && <li className="text-sm text-muted">loading users…</li>}
        {users?.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"
          >
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-elem text-muted">
                <IconCloud size={14} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              {user.permalink ? (
                <a
                  href={user.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className={`block truncate font-medium hover:underline ${user.disabled ? "text-muted line-through" : ""}`}
                >
                  {user.username ?? `user ${user.scUserId}`}
                </a>
              ) : (
                <span className="block truncate font-medium">
                  {user.username ?? `user ${user.scUserId}`}
                </span>
              )}
              <span className="text-xs text-muted">
                joined {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>
            <span className="text-xs text-muted">
              {user.todayCount}
              {user.isOwner ? " plays today" : ` / ${userLimit ?? "—"} today`}
            </span>
            {user.isOwner ? (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                owner
              </span>
            ) : (
              <>
                <button
                  onClick={() => void setDisabled(user, !user.disabled)}
                  className="cursor-pointer text-xs text-muted transition hover:text-white"
                >
                  {user.disabled ? "enable" : "disable"}
                </button>
                <button
                  onClick={() => void remove(user)}
                  className="cursor-pointer text-xs text-muted transition hover:text-accent"
                >
                  remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
