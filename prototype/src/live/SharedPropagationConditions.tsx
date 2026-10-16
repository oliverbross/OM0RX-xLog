import { useEffect, useState } from "react";
import Conditions from "./Conditions";
import { connectPropagation, type PropagationProjection } from "./propagationSession";
import { usePropagationRefreshPreference } from "./propagationPreferences";

type Props = { compact?: boolean; request?: (method: string) => Promise<any>; weatherKey?: string; includeWeather?: boolean };
const noWeather = async () => { throw new Error("Weather is not available in this view."); };
/** Both embedded and detached views render the same native projection. The
 * local clock only marks cached data; it never polls or starts a fetch. */
export default function SharedPropagationConditions({ compact = false, request = noWeather, weatherKey = "", includeWeather = true }: Props) {
  const [state, setState] = useState<PropagationProjection | null>(null), [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const { minutes } = usePropagationRefreshPreference();
  useEffect(() => {
    const session = connectPropagation(value => { setState(value); setClock(Date.now()); setError(""); }, setError);
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => { session.dispose(); clearInterval(timer); };
  }, []);
  const source = state?.snapshot;
  const stale = !!source && (source.stale || !!error || !!state?.error || clock - source.received_at * 1000 > minutes * 60_000 || clock - source.received_at * 1000 < -1000);
  return <Conditions compact={compact} propagation={source ? { ...source, stale } : null} request={request} weatherKey={weatherKey}
    includeWeather={includeWeather}
    propagationError={error || state?.error || ""} />;
}
