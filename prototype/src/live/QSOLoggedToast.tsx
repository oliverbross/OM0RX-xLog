import { useCallback, useEffect, useRef, useState } from "react";
import "./QSOLoggedToast.css";

/** Trigger only after a verified successful log operation, never for recovery. */
export function useQSOLoggedToast() {
  const [receipt, setReceipt] = useState<number | null>(null);
  const sequence = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current !== null) clearTimeout(timer.current); };
  }, []);
  const show = useCallback(() => {
    if (!mounted.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setReceipt(++sequence.current);
    timer.current = setTimeout(() => { timer.current = null; setReceipt(null); }, 1000);
  }, []);
  return { show, toast: receipt === null ? null : <div key={receipt} className="qso-logged-toast" role="status" aria-live="polite" aria-atomic="true">QSO logged</div> };
}
