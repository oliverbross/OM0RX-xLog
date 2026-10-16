type Data = Record<string, any>;

/** SPLIT_ENABLE is TRX-wide. The pinned official protocol has no TX-VFO report. */
export function TCISplitObservation({ snapshot, fresh, now }: { snapshot: Data | null; fresh: boolean; now: number }) {
  const split = snapshot?.radio?.split, stamp = snapshot?.tci?.split_observed_at;
  const known = snapshot?.source === "direct_tci" && typeof split === "boolean";
  const age = typeof stamp === "number" && Number.isFinite(stamp) ? now - stamp * 1000 : Infinity;
  const current = fresh && known && age >= -1000 && age <= 5000;
  const trx = snapshot?.tci?.trx, channel = snapshot?.tci?.channel;
  return <section aria-label="TCI split observation">
    <p>{Number.isSafeInteger(trx) && Number.isSafeInteger(channel) ? `Saved TRX ${trx} · receive channel ${channel}. ` : "Saved receiver unavailable. "}Split observation applies to the whole TRX.</p>
    <p>{known ? `${current ? "Observed" : "Retained"} split: ${split ? "On" : "Off"}${current ? "" : " · stale or unverified"}` : "Split: Unknown · no authoritative report"}</p>
    <p>TX VFO and transmit frequency: Unavailable · no authoritative report in the supported TCI specification.</p>
  </section>;
}
