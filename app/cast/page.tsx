import type { Metadata } from "next";
import { ReceiverApp } from "@/components/cast/ReceiverApp";

// The Cast Web Receiver page. Loaded by the Chromecast itself (no session,
// no auth — it receives signed CDN URLs over the device-local Cast
// channel), which is why it lives outside the (shell) route group and is
// excluded from the CSP proxy. `?debug=1` runs it in any browser with the
// CAF SDK stubbed out for development.
export const metadata: Metadata = {
  title: "nimbus cast",
  robots: { index: false },
};

export default function CastPage() {
  return <ReceiverApp />;
}
