// Production editor with synthetic state. No worker, logbook, QRZ or device access.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import QSOEditor from "../../src/live/QSOEditor";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
const params = new URLSearchParams(location.search);
const photo = params.get("photo") ?? "landscape";
const notes = `First line\n  ${"LongUnbrokenNote".repeat(60)}\nLast line  `;
function Fixture() {
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "synthetic", call: "N0CALL/P",
    start: "2026-10-13T12:10:09Z", frequencyHz: 14287000, band: "20m", mode: "SSB", rstSent: "59", rstReceived: "59", notes });
  return <div className="live" style={{ padding: 16 }}><p>Synthetic QSO context · local test image · no live data</p>
    <div className="sidebar-foot" style={{ width: 200, marginBottom: 16 }}><button>Monitor</button><strong className="teal">N0CALL/P</strong><span>JN88TQ</span></div>
    <QSOEditor draft={draft} setDraft={setDraft} save={noop} clear={noop} busy={false} previous={[]}
      lookup={{ call: "N0CALL/P", name: "Synthetic Operator With A Longer Display Name", country: "Synthetic Country With A Longer Display Name", source: "QRZ XML", gridSquare: "JN88TQ",
        imageURL: photo === "none" ? undefined : `https://example.com/xlog-fixture-${photo}.svg` }}
      follow={false} setFollow={noop} />
  </div>;
}
async function start() {
  // Registration cannot escape this fixture directory or affect the application.
  await navigator.serviceWorker.register("./qso-context-image-worker.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
  createRoot(document.getElementById("root")!).render(<Fixture />);
}
void start();
