import { useEffect, useState } from "react";
import { TCIReceiveFilter } from "./TCIReceiveFilter";
import { TCISplitObservation } from "./TCISplitObservation";
type Data = Record<string, any>;
export function TCIObservation({ snapshot, now }: { snapshot: Data | null; now?: number }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (now !== undefined) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [now]);
  const radio = snapshot?.radio, current = now ?? clock;
  const recent = (stamp: unknown) => typeof stamp === "number" && Number.isFinite(stamp) && current - stamp * 1000 >= -1000 && current - stamp * 1000 <= 5000;
  const fresh = snapshot?.source === "direct_tci" && snapshot.available === true && radio?.connected === true && radio?.observed === true && snapshot.station?.radio_stale !== true && recent(snapshot.generated_at) && recent(radio.observed_at);
  const hz = radio?.receive_frequency_hz ?? radio?.frequency_hz;
  const frequency = typeof hz === "number" && Number.isFinite(hz) ? `${(hz / 1e6).toFixed(6)} MHz` : "Unavailable";
  return <><p role="status">{fresh ? "TCI observation current · receive controls require native checks." : "TCI observation unavailable or stale · retained values are read only."}</p>
    <p>{fresh ? "Observed receive" : "Retained receive"}: {frequency} · {radio?.mode || "Mode unavailable"}</p>
    <TCISplitObservation snapshot={snapshot} fresh={fresh} now={current} />
    <TCIReceiveFilter snapshot={snapshot} now={current} /></>;
}
