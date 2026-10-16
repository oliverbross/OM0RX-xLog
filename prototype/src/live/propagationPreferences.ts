import { useEffect, useState } from "react";

export const propagationRefreshKey = "xlog.propagation.refresh-minutes.v1";
const changedEvent = "xlog:propagation-refresh-preference";
export const propagationRefreshMinutes = [5, 10, 15, 30, 60] as const;
export function readPropagationRefreshMinutes(): number {
  try {
    const value = Number(localStorage.getItem(propagationRefreshKey));
    return propagationRefreshMinutes.some(minutes => minutes === value) ? value : 10;
  } catch { return 10; }
}
export function usePropagationRefreshPreference() {
  const [minutes, setMinutes] = useState(readPropagationRefreshMinutes);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setMinutes(readPropagationRefreshMinutes());
    const stored = (event: StorageEvent) => { if (event.key === propagationRefreshKey) refresh(); };
    window.addEventListener("storage", stored);
    window.addEventListener(changedEvent, refresh);
    return () => { window.removeEventListener("storage", stored); window.removeEventListener(changedEvent, refresh); };
  }, []);
  const save = (value: number) => {
    if (!propagationRefreshMinutes.some(minutes => minutes === value)) return;
    try {
      localStorage.setItem(propagationRefreshKey, String(value)); setMinutes(value); setError("");
      window.dispatchEvent(new Event(changedEvent));
    } catch { setError("The propagation refresh interval could not be saved."); }
  };
  return { minutes, save, error };
}
