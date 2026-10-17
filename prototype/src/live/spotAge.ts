import { useEffect, useState } from "react";

const appleReferenceUnixSeconds = 978_307_200;
const oldestColourAgeSeconds = 60 * 60;
const ageColourStops = [
  [0, [22, 101, 52]],
  [5 * 60, [77, 124, 15]],
  [15 * 60, [133, 77, 14]],
  [30 * 60, [154, 52, 18]],
  [oldestColourAgeSeconds, [153, 27, 27]],
] as const;

export function spotAgeSeconds(receivedAt: number, now = Date.now()): number {
  const receivedAtMilliseconds = (receivedAt + appleReferenceUnixSeconds) * 1000;
  if (!Number.isFinite(receivedAtMilliseconds) || !Number.isFinite(now)) return 0;
  return Math.max(0, (now - receivedAtMilliseconds) / 1000);
}

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

export function spotAgeColor(receivedAt: number, now = Date.now()): string {
  if (!Number.isFinite(receivedAt) || !Number.isFinite(now)) return "#334155";
  const age = Math.min(oldestColourAgeSeconds, spotAgeSeconds(receivedAt, now));
  const upperIndex = ageColourStops.findIndex(([seconds]) => seconds >= age);
  if (upperIndex <= 0) return rgb(ageColourStops[0][1]);
  const [lowerSeconds, lowerColour] = ageColourStops[upperIndex - 1];
  const [upperSeconds, upperColour] = ageColourStops[upperIndex];
  const progress = (age - lowerSeconds) / (upperSeconds - lowerSeconds);
  return rgb(lowerColour.map((channel, index) => Math.round(channel + (upperColour[index] - channel) * progress)));
}

function rgb(colour: readonly number[]): string {
  return `#${colour.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function useSpotAgeClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
