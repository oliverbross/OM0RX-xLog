import { useCallback, useEffect, useRef, useState } from "react";

type ToastTone = "success" | "error";
type ToastState = { id: number; message: string; tone: ToastTone };

/** Non-blocking save feedback that never reserves layout space. */
export function useSettingsSaveToast() {
  const [notice, setNotice] = useState<ToastState | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    if (timer.current !== null) clearTimeout(timer.current);
    setNotice({ id: ++sequence.current, message, tone });
    timer.current = setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, tone === "success" ? 1_500 : 5_000);
  }, []);

  return {
    show,
    toast: notice === null ? null : <div key={notice.id} className={`settings-save-toast settings-save-toast-${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
      {notice.message}
    </div>,
  };
}
