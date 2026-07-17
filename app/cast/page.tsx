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

// Pre-bundle boot probe, plain DOM on purpose: if the app bundle fails
// to even parse on a TV's runtime, React (and any React-rendered error
// UI) never exists — this inline script still runs and paints the
// failure on screen. ReceiverApp advances the stage marker as it boots;
// "boot:html" lingering on the TV means our JS never executed.
const probe = `
window.__nimbusCastStage = function (s) {
  var el = document.getElementById("cast-stage-probe");
  if (el) el.textContent = s;
};
window.addEventListener("error", function (e) {
  var el = document.getElementById("cast-error-probe");
  if (el && !el.textContent) {
    el.textContent =
      (e.message || "error") + " @ " + (e.filename || "?") + ":" + (e.lineno || 0);
  }
});
window.addEventListener("unhandledrejection", function (e) {
  var el = document.getElementById("cast-error-probe");
  if (el && !el.textContent) el.textContent = "rejection: " + String(e.reason);
});
`;

export default function CastPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: probe }} />
      <div
        id="cast-error-probe"
        style={{
          position: "fixed",
          insetInline: 8,
          top: 8,
          zIndex: 50,
          textAlign: "center",
          fontFamily: "monospace",
          fontSize: 14,
          color: "#f87171",
        }}
      />
      <div
        id="cast-stage-probe"
        style={{
          position: "fixed",
          right: 8,
          bottom: 8,
          zIndex: 50,
          fontFamily: "monospace",
          fontSize: 12,
          color: "#777",
        }}
      >
        boot:html
      </div>
      <ReceiverApp />
    </>
  );
}
