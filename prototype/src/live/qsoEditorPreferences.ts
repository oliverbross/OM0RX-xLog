import { qsoDetailFieldKeys } from "./qsoFields";

export const qsoDetailsFieldsKey = "xlog.integration.qso-details-fields.v1";
export const qsoDetailsFieldsEvent = "xlog:qso-details-fields-changed";

export type QSOFieldPreferences = { version: 1; fields: string[] };

export function defaultQSOFieldPreferences(): QSOFieldPreferences {
  return { version: 1, fields: [...qsoDetailFieldKeys] };
}

export function readQSOFieldPreferences(raw: string | null): QSOFieldPreferences {
  const fallback = defaultQSOFieldPreferences();
  if (!raw || raw.length > 8192) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.fields)) return fallback;
    const requested = new Set(value.fields.filter((field: unknown): field is string => typeof field === "string"));
    return { version: 1, fields: qsoDetailFieldKeys.filter(field => requested.has(field)) };
  } catch { return fallback; }
}

export function storeQSOFieldPreferences(fields: string[], storage: Storage = localStorage): QSOFieldPreferences {
  const requested = new Set(fields);
  const value: QSOFieldPreferences = { version: 1, fields: qsoDetailFieldKeys.filter(field => requested.has(field)) };
  const serialized = JSON.stringify(value);
  storage.setItem(qsoDetailsFieldsKey, serialized);
  if (storage.getItem(qsoDetailsFieldsKey) !== serialized) throw new Error("QSO field choices could not be saved.");
  window.dispatchEvent(new CustomEvent(qsoDetailsFieldsEvent, { detail: value }));
  return value;
}
