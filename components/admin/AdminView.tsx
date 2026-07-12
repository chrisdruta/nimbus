"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { QuotaGauge } from "./QuotaGauge";
import { SettingsCard } from "./SettingsCard";
import { InvitesCard } from "./InvitesCard";
import { UsersCard } from "./UsersCard";

export interface AdminOverview {
  day: string;
  globalUsed: number;
  globalLimit: number;
  userLimit: number;
  resetsAt: string;
}

export interface AdminUser {
  id: number;
  scUserId: number;
  username: string | null;
  permalink: string | null;
  avatarUrl: string | null;
  disabled: boolean;
  createdAt: string;
  todayCount: number;
  isOwner: boolean;
}

export interface AdminInvite {
  id: number;
  note: string | null;
  status: "active" | "used" | "revoked" | "expired";
  url: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByUsername: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function AdminView() {
  const toast = useToast();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<AdminInvite[] | null>(null);

  const refresh = useCallback(() => {
    getJson<AdminOverview>("/api/admin/overview").then(setOverview).catch(() => {
      toast("couldn't load admin overview", "error");
    });
    getJson<AdminUser[]>("/api/admin/users").then(setUsers).catch(() => {
      toast("couldn't load users", "error");
    });
    getJson<AdminInvite[]>("/api/admin/invites").then(setInvites).catch(() => {
      toast("couldn't load invites", "error");
    });
  }, [toast]);

  useEffect(refresh, [refresh]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 pb-16">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <QuotaGauge overview={overview} />
      <SettingsCard overview={overview} onSaved={refresh} />
      <InvitesCard invites={invites} onChanged={refresh} />
      <UsersCard users={users} userLimit={overview?.userLimit ?? null} onChanged={refresh} />
    </div>
  );
}
