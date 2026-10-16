import { useEffect, useState } from "react";
import { defaultQSOFieldPreferences, qsoDetailsFieldsEvent, qsoDetailsFieldsKey, readQSOFieldPreferences, storeQSOFieldPreferences } from "./qsoEditorPreferences";

export function useQSOFieldPreferences() {
  const read = () => {
    try { return readQSOFieldPreferences(localStorage.getItem(qsoDetailsFieldsKey)); }
    catch { return defaultQSOFieldPreferences(); }
  };
  const [preference, setPreference] = useState(read);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setPreference(read());
    const storageChanged = (event: StorageEvent) => { if (event.key === qsoDetailsFieldsKey) refresh(); };
    window.addEventListener("storage", storageChanged);
    window.addEventListener(qsoDetailsFieldsEvent, refresh);
    return () => { window.removeEventListener("storage", storageChanged); window.removeEventListener(qsoDetailsFieldsEvent, refresh); };
  }, []);
  const save = (fields: string[]) => {
    try { setPreference(storeQSOFieldPreferences(fields)); setError(""); }
    catch { setError("QSO field choices could not be saved. Your previous selection is still active."); }
  };
  return { preference, save, error };
}
