import { useEffect, useState } from "react";

export type ClusterAppearance = "modern" | "classic";
export const clusterAppearanceKey = "xlog.display.cluster-appearance.v1";
const clusterAppearanceEvent = "xlog:cluster-appearance";

export function readClusterAppearance(storage?: Pick<Storage, "getItem">): ClusterAppearance {
  try { return (storage ?? localStorage).getItem(clusterAppearanceKey) === "classic" ? "classic" : "modern"; }
  catch { return "modern"; }
}

export function useClusterAppearancePreference() {
  const [appearance, setAppearance] = useState<ClusterAppearance>(readClusterAppearance);
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => setAppearance(readClusterAppearance());
    const stored = (event: StorageEvent) => { if (event.key === clusterAppearanceKey || event.key === null) refresh(); };
    window.addEventListener("storage", stored);
    window.addEventListener(clusterAppearanceEvent, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", stored);
      window.removeEventListener(clusterAppearanceEvent, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const save = (value: ClusterAppearance) => {
    if (value !== "modern" && value !== "classic") return;
    try {
      localStorage.setItem(clusterAppearanceKey, value); setAppearance(value); setError("");
      window.dispatchEvent(new Event(clusterAppearanceEvent));
    } catch { setError("Could not save the cluster appearance. Your previous style is still active; try again."); }
  };
  return { appearance, save, error };
}
