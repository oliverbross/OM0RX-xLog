import { useEffect, useState } from "react";

/** A hidden tool keeps its last projection without spending its refresh budget. */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    changed();
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return visible;
}
