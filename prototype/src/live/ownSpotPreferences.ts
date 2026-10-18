import { useEffect, useState } from "react";

export const ownSpotWindowKey = "xlog.own-spots.window-minutes.v1";
const changedEvent = "xlog:own-spots-window-preference";
export const ownSpotWindowMinutes = [5, 10, 15, 30, 60] as const;

export function readOwnSpotWindowMinutes(): number {
  try {
    const value = Number(localStorage.getItem(ownSpotWindowKey));
    return ownSpotWindowMinutes.some(minutes => minutes === value) ? value : 15;
  } catch { return 15; }
}

export function useOwnSpotWindowPreference() {
  const [minutes, setMinutes] = useState(readOwnSpotWindowMinutes);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setMinutes(readOwnSpotWindowMinutes());
    const stored = (event: StorageEvent) => { if (event.key === ownSpotWindowKey) refresh(); };
    window.addEventListener("storage", stored);
    window.addEventListener(changedEvent, refresh);
    return () => { window.removeEventListener("storage", stored); window.removeEventListener(changedEvent, refresh); };
  }, []);
  const save = (value: number) => {
    if (!ownSpotWindowMinutes.some(minutes => minutes === value)) return;
    try {
      localStorage.setItem(ownSpotWindowKey, String(value)); setMinutes(value); setError("");
      window.dispatchEvent(new Event(changedEvent));
    } catch { setError("The RBN / Spotted display time could not be saved."); }
  };
  return { minutes, save, error };
}
