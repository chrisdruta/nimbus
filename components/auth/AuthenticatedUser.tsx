"use client";

import { createContext, useContext, type ReactNode } from "react";

const UserIdContext = createContext<number | null>(null);

export function AuthenticatedUserProvider({
  userId,
  children,
}: {
  userId: number;
  children: ReactNode;
}) {
  return (
    <UserIdContext.Provider value={userId}>{children}</UserIdContext.Provider>
  );
}

export function useAuthenticatedUserId(): number {
  const userId = useContext(UserIdContext);
  if (userId === null) {
    throw new Error("useAuthenticatedUserId outside AuthenticatedUserProvider");
  }
  return userId;
}
