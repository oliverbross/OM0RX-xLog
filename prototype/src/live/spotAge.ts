import { useEffect, useState } from "react";

const appleReferenceUnixSeconds = 978_307_200;

export function formatSpotAge(receivedAt: number, now = Date.now()): string {
  const receivedAtMilliseconds = (receivedAt + appleReferenceUnixSeconds) * 1000;
  if (!Number.isFinite(receivedAtMilliseconds) || !Number.isFinite(now)) return "—";
  const minutes = Math.max(0, Math.floor((now - receivedAtMilliseconds) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function useSpotAgeClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
