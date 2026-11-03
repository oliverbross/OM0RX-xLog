/** One source-time policy for every current own-call RBN presentation. */
export const ownRbnWindowSeconds = 600;
export const ownRbnWindowMilliseconds = ownRbnWindowSeconds * 1000;
export const ownRbnRefreshMilliseconds = 120_000;
export const ownRbnClockMilliseconds = 10_000;
export function currentOwnRbnSourceTime(time: number, now = Date.now()) {
  return Number.isFinite(time) && time >= now - ownRbnWindowMilliseconds && time <= now + 60_000;
}
