"use client";

import { useEffect, useState } from "react";
import { eraseLocalData } from "@/lib/local-data";

/** Client-side sweep behind the ?bye= farewell redirect. Clear-Site-Data
 * on the redirect handles HTTPS browsers; this covers HTTP dev and doubles
 * as visible confirmation that the device forgot the account. */
export function FarewellSweeper() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    void eraseLocalData().then(() => setDone(true));
  }, []);
  if (!done) return null;
  return <p className="text-xs text-muted">local data cleared</p>;
}
