import { useEffect, useState } from "react";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
export function duplicateContactMode(mode: unknown, submode?: unknown): string {
  const value = (String(submode ?? "").trim() || String(mode ?? "").trim()).toUpperCase();
  return ({ USB: "SSB", LSB: "SSB", CWR: "CW", RTTYR: "RTTY" } as Record<string, string>)[value] ?? value;
}

/** Query the whole local history, never the bounded previous-contact page. */
export function useDuplicateContact(draft: Data | null, isEditing: boolean | undefined, request: Request, refresh: number) {
  const call = String(draft?.call ?? "").trim().toUpperCase();
  const band = String(draft?.band ?? "").trim().toLowerCase();
  const mode = duplicateContactMode(draft?.mode, draft?.submode);
  const exclude = isEditing ? draft?.id : undefined;
  const valid = /^[A-Z0-9/-]{2,32}$/.test(call) && /^[a-z0-9]{1,16}$/.test(band) && /^[A-Z0-9-]{1,16}$/.test(mode)
    && (!isEditing || typeof exclude === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(exclude));
  const key = JSON.stringify([call, band, mode, exclude, refresh]);
  const [result, setResult] = useState<{ key: string; date: string } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!valid) return;
    const timer = setTimeout(() => {
      void request("logbook_duplicate", { call, band, mode, ...(exclude ? { exclude_id: exclude } : {}) }).then(value => {
        const date = value?.last_worked_at;
        if (active && value?.call === call && value?.band === band && value?.mode === mode
          && typeof date === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(date) && Number.isFinite(Date.parse(date))
          && new Date(date).toISOString().slice(0, 10) === date.slice(0, 10))
          setResult({ key, date });
      }).catch(() => { /* Unavailable history must never manufacture a duplicate. */ });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [call, band, mode, exclude, key, request, valid]);
  return valid && result?.key === key ? new Date(result.date).toLocaleDateString("en-GB", {
    timeZone: "UTC", day: "2-digit", month: "2-digit", year: "2-digit",
  }) : null;
}
