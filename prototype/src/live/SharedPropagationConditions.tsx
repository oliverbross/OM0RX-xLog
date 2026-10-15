import { useEffect, useRef, useState } from "react";
import Conditions from "./Conditions";
import { connectPropagation, type PropagationProjection } from "./propagationSession";

type Props = { compact?: boolean; request?: (method: string) => Promise<any>; weatherKey?: string; includeWeather?: boolean };
const noWeather = async () => { throw new Error("Weather is not available in this view."); };
/** Both embedded and detached views render the same native projection. The
 * local clock only marks cached data; it never polls or starts a fetch. */
export default function SharedPropagationConditions({ compact = false, request = noWeather, weatherKey = "", includeWeather = true }: Props) {
  const [state, setState] = useState<PropagationProjection | null>(null), [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now()), [refreshing, setRefreshing] = useState(false);
  const connection = useRef<ReturnType<typeof connectPropagation> | null>(null), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const session = connectPropagation(value => { setState(value); setClock(Date.now()); setError(""); }, setError); connection.current = session;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => { mounted.current = false; connection.current = null; session.dispose(); clearInterval(timer); };
  }, []);
  const refresh = async () => {
    if (refreshing || state?.pending) return;
    setRefreshing(true);
    try { await connection.current?.refresh(); }
    finally { if (mounted.current) { setClock(Date.now()); setRefreshing(false); } }
  };
  const source = state?.snapshot;
  const stale = !!source && (source.stale || !!error || !!state?.error || clock - source.received_at * 1000 > 600_000 || clock - source.received_at * 1000 < -1000);
  return <Conditions compact={compact} propagation={source ? { ...source, stale } : null} request={request} weatherKey={weatherKey}
    includeWeather={includeWeather} onRefreshPropagation={() => void refresh()} propagationPending={refreshing || !!state?.pending}
    propagationError={error || state?.error || ""} />;
}
