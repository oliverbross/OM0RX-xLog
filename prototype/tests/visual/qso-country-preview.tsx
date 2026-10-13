// Isolated actual-component presentation. All history is synthetic, in memory;
// no native transport, account, image, network lookup, logbook or radio access.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QSOEditor from "../../src/live/QSOEditor";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
function Fixture() {
  const [status, setStatus] = useState("confirmed");
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "synthetic-qso", call: "EA8/N0CALL/P",
    start: "2026-10-14T12:00:00Z", frequencyHz: 14025000, band: "20m", mode: "CW", rstSent: "599", rstReceived: "599" });
  const country = "A deliberately long synthetic country name for responsive evidence";
  const lookup = status === "unresolved" ? null : { call: status === "stale" ? "OTHER" : "EA8/N0CALL/P", country, dxcc: 281 };
  const request = useMemo(() => async (method: string) => {
    if (method === "logbook_matrix") return { cells: [] };
    if (method !== "cluster_history") throw new Error(`Synthetic fixture does not support ${method}`);
    if (status === "pending") return new Promise(() => {});
    if (status === "error") throw new Error("Synthetic unavailable history");
    return { history: { call: status === "mismatch" ? "OTHER" : "EA8/N0CALL/P", adif: 281, matrix: [],
      dxcc_contact_count: status === "new" ? 0 : 9120, dxcc_confirmed_count: status === "confirmed" ? 7087 : 0 } };
  }, [status]);
  return <main className="live" style={{ padding: 16 }}><p>Synthetic QSO country identity · no native or device access</p>
    <label>Status fixture <select aria-label="Synthetic DXCC state" value={status} onChange={event => setStatus(event.target.value)}>
      {["confirmed", "worked", "new", "pending", "error", "mismatch", "unresolved", "stale"].map(value => <option key={value}>{value}</option>)}
    </select></label>
    <QSOEditor draft={draft} setDraft={setDraft} save={noop} clear={noop} busy={false} lookup={lookup} previous={[]}
      follow={false} setFollow={noop} request={request} radioControls={false} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
