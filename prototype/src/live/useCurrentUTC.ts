import { useEffect, useState } from "react";

export function useCurrentUTC(enabled: boolean, identity: unknown): string {
  const [current, setCurrent] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!enabled) return;
    const update = () => setCurrent(new Date().toISOString());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, identity]);
  return current;
}
