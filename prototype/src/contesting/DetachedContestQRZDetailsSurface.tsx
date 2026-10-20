import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestSurfaceSnapshot,
  type ContestSurfaceContext } from "./contestSurfaceNative";
import type { ContestEntrySurfaceProjectionV2 } from "./contestSurfaceProtocol";
import "./DetachedContestQRZDetailsSurface.css";

type Profile = Record<string, unknown>;
type Sized = { width: number; height: number };
const DEFAULT_SIZE: Sized = { width: 520, height: 420 };
const AUTO_FIT_KEY = "xlog.contest.qrz-details.auto-fit-size.v1";
const validCall = /^[A-Z0-9/-]{3,32}$/;
const sameSize = (left: Sized, right: Sized) => Math.abs(left.width - right.width) < 0.5 && Math.abs(left.height - right.height) < 0.5;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? String(value) : null;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "QRZ details could not be loaded.";

export async function lookupContestQRZDetails(context: ContestSurfaceContext, call: string): Promise<Profile> {
  const value = await invoke("contest_qrz_details_lookup", { ...context, call });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The QRZ Details response could not be verified.");
  return value as Profile;
}

export function fittedQRZDetailsHeight(contentHeight: number, availableHeight: number, chromeHeight = 0): number {
  const measured = Math.ceil(Math.max(260, contentHeight + 24 + Math.max(0, chromeHeight)));
  return Math.min(measured, Math.max(260, Math.floor(availableHeight - 64)));
}

function useAutoFit(dependency: unknown) {
  const managed = useRef<Sized | null>(null), operatorSized = useRef(false);
  useEffect(() => {
    const fit = async () => {
      const appWindow = getCurrentWindow();
      const [inner, outer, scale] = await Promise.all([appWindow.innerSize(), appWindow.outerSize(), appWindow.scaleFactor()]);
      const logical = scale > 0 ? inner.toLogical(scale) : inner;
      if (!managed.current) {
        try {
          const stored = JSON.parse(localStorage.getItem(AUTO_FIT_KEY) ?? "null") as Partial<Sized> | null;
          managed.current = stored && Number.isFinite(stored.width) && Number.isFinite(stored.height)
            ? { width: Number(stored.width), height: Number(stored.height) } : null;
        } catch { managed.current = null; }
      }
      if (operatorSized.current || !sameSize(logical, DEFAULT_SIZE) && (!managed.current || !sameSize(logical, managed.current))) {
        operatorSized.current = true;
        return;
      }
      const chrome = scale > 0 ? (outer.height - inner.height) / scale : 0;
      const next = { width: logical.width, height: fittedQRZDetailsHeight(document.documentElement.scrollHeight, window.screen.availHeight, chrome) };
      managed.current = next;
      try { localStorage.setItem(AUTO_FIT_KEY, JSON.stringify(next)); } catch { /* geometry remains best effort */ }
      if (!sameSize(logical, next)) await appWindow.setSize(new LogicalSize(next.width, next.height));
    };
    const frame = window.requestAnimationFrame(() => void fit());
    return () => window.cancelAnimationFrame(frame);
  }, [dependency]);
}

export function ContestQRZDetailsSurface({ search = window.location.search,
  lookup = lookupContestQRZDetails }: { search?: string; lookup?: typeof lookupContestQRZDetails }) {
  const parsed = useMemo(() => contestSurfaceContextFromSearch(search), [search]);
  const context = useMemo<ContestSurfaceContext>(() => ({ operatingContext: parsed.operatingContext,
    sessionID: parsed.sessionID, workspaceGeneration: parsed.workspaceGeneration }),
    [parsed.operatingContext, parsed.sessionID, parsed.workspaceGeneration]);
  const [projection, setProjection] = useState<ContestEntrySurfaceProjectionV2 | null>(null);
  const [profile, setProfile] = useState<{ call: string; value: Profile } | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const snapshot = await readContestSurfaceSnapshot(context);
    if (snapshot.panelID !== "qrz-details" || snapshot.projection.status !== "ready" || snapshot.projection.schemaVersion !== 2)
      throw new Error("The contest draft is not available for QRZ Details.");
    if (snapshot.projectionRevision >= revision.current) {
      revision.current = snapshot.projectionRevision;
      setProjection(snapshot.projection);
    }
  }, [context]);
  useEffect(() => {
    let active = true, stop: (() => void) | undefined;
    const update = () => void refresh().catch(cause => { if (active) setError(errorMessage(cause)); });
    update();
    void onContestSurfaceWake(update).then(unlisten => { if (active) stop = unlisten; else unlisten(); })
      .catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; stop?.(); };
  }, [refresh]);
  const call = projection?.draft.callsign.trim().toUpperCase() ?? "";
  useEffect(() => {
    let active = true;
    setProfile(null); setError("");
    if (!validCall.test(call)) { setLoading(false); return () => { active = false; }; }
    setLoading(true);
    const timer = window.setTimeout(() => void lookup(context, call).then(value => {
      if (active && text(value.call)?.toUpperCase() === call) setProfile({ call, value });
      else if (active) setError("QRZ returned details for a different callsign.");
    }).catch(cause => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); }), 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [context, call, lookup]);
  useAutoFit(`${call}:${loading}:${error}:${profile?.call ?? ""}`);

  const value = profile?.call === call ? profile.value : null;
  const fields: Array<[string, string | null]> = value ? [
    ["Nickname", text(value.nickname)], ["QTH", text(value.qth)], ["State / province", text(value.state)], ["County", text(value.county)],
    ["Grid", text(value.gridSquare)], ["DXCC", number(value.dxcc)], ["Continent", text(value.continent)],
    ["CQ zone", number(value.cqZone)], ["ITU zone", number(value.ituZone)], ["IOTA", text(value.iota)],
    ["QSL manager", text(value.qslManager)], ["License", text(value.licenseClass)], ["Email", text(value.email)],
    ["Website", text(value.websiteURL)],
  ].filter((field): field is [string, string] => field[1] !== null) : [];

  return <main className="contest-qrz-details" aria-label="Contest QRZ Details">
    <header><div><p>CONTEST LOOKUP</p><h1>{call || "QRZ Details"}</h1></div>{value && <span>{text(value.source) ?? "xLog lookup"}</span>}</header>
    {!projection && !error && <p role="status">Loading the current contest callsign…</p>}
    {projection && !validCall.test(call) && <p role="status">Enter a complete callsign in the contest logging window.</p>}
    {loading && <p role="status">Looking up {call}…</p>}
    {error && <p className="contest-qrz-error" role="alert">{error}</p>}
    {value && <section aria-label={`${call} QRZ profile`}>
      <div className="contest-qrz-identity"><strong>{text(value.name) ?? call}</strong><span>{text(value.country) ?? "Country unavailable"}</span></div>
      {fields.length ? <dl>{fields.map(([label, detail]) => <div key={label}><dt>{label}</dt><dd>{detail}</dd></div>)}</dl>
        : <p role="status">No additional QRZ profile fields were returned.</p>}
      {text(value.lookup_warning) && <p className="contest-qrz-warning" role="status">{text(value.lookup_warning)}</p>}
    </section>}
  </main>;
}

export function DetachedContestQRZDetailsSurface() { return <ContestQRZDetailsSurface />; }
