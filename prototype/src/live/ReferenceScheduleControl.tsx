import { useEffect, useRef, useState } from "react";
import { migrateReferenceSchedule, referenceAutoCheckChanged, type ReferenceRequest } from "./referenceSchedule";
import { useSettingsSaveToast } from "./SettingsSaveToast";

export default function ReferenceScheduleControl({ request, visible }: { request: ReferenceRequest; visible: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saveToast = useSettingsSaveToast();
  const revision = useRef(0);
  const alive = useRef(true);
  const saveFlight = useRef<Promise<any> | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const current = ++revision.current;
    setEnabled(null); setMessage("");
    void Promise.resolve().then(async () => {
      // Reopening during a save must read the preference after that save settles.
      if (saveFlight.current) { try { await saveFlight.current; } catch { /* Load authoritative status below. */ } }
      if (disposed) return;
      return request("reference_status");
    }).then(async response => {
      if (disposed || current !== revision.current) return;
      if (typeof response?.automatic_check !== "boolean" && response?.automatic_check !== null) throw new Error("Reference preference was not reported.");
      const value = typeof response.automatic_check === "boolean" ? response.automatic_check : await migrateReferenceSchedule(request);
      if (!disposed && current === revision.current) setEnabled(value);
    }).catch(() => {
      if (!disposed && current === revision.current) setMessage("Automatic check preference is unavailable. Reopen Reference data to retry.");
    });
    return () => { disposed = true; };
  }, [request, visible]);

  const save = async (value: boolean) => {
    if (busy || enabled === null) return;
    const current = ++revision.current;
    setBusy(true); setMessage("");
    const operation = Promise.resolve().then(() => request("reference_configure", { enabled: value }));
    saveFlight.current = operation;
    try {
      const result = await operation;
      if (typeof result?.automatic_check !== "boolean") throw new Error("Preference was not confirmed.");
      if (!alive.current || current !== revision.current) return;
      setEnabled(result.automatic_check);
      window.dispatchEvent(new Event(referenceAutoCheckChanged));
      saveToast.show("Reference update preference saved");
    } catch {
      if (alive.current && current === revision.current) setMessage("Could not confirm automatic reference checks were saved. Showing the last confirmed preference.");
    } finally {
      if (saveFlight.current === operation) saveFlight.current = null;
      if (alive.current) setBusy(false);
    }
  };
  return <section hidden={!visible}><label><input type="checkbox" checked={enabled === true} disabled={enabled === null || busy} onChange={event => void save(event.target.checked)} />Automatically check reference databases</label>
    <p>Checks run after startup, on return to the app and hourly when due. Validated cached data remains available on failure. This preference saves immediately; it never synchronizes QSOs.</p>
    {message && <p role="alert">{message}</p>}{saveToast.toast}
  </section>;
}
