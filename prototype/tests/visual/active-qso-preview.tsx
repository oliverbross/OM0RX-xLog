// Memory-only presentation fixture. No worker, logbook, credentials or equipment.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DeskQSO } from "../../src/live/OperatorDesk";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
const request = async (_method: string, params?: Record<string, any>) => ({ ...params, last_worked_at: "2026-01-02T23:55:00Z" });
function Preview({ width }: { width: number }) {
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "synthetic-draft", call: "I/DG5VV/P",
    start: "2026-10-13T01:00:00Z", frequencyHz: 14025000, band: "20m", mode: "CW", rstSent: "599", rstReceived: "599" });
  return <div className="live" data-preview-width={width} style={{ width, maxWidth: "100%" }}><DeskQSO draft={draft} setDraft={setDraft}
    save={noop} clear={noop} busy={false} lookup={null} previous={[]} request={request} refresh={0} onEditor={noop}
    onReadRadio={async () => {}} follow={false} setFollow={noop} rotor={null} autoRotor={false} setAutoRotor={noop} onManualRotor={noop} /></div>;
}
createRoot(document.getElementById("root")!).render(<main style={{ display: "flex", flexWrap: "wrap", alignItems: "start", gap: 16, padding: 16 }}>
  <p style={{ width: "100%" }}>Synthetic Active QSO presentation · no station or logbook access</p><Preview width={795} /><Preview width={336} />
</main>);
