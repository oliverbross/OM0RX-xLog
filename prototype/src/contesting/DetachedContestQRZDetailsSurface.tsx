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
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Callsign details could not be loaded.";

export async function lookupContestQRZDetails(context: ContestSurfaceContext, call: string): Promise<Profile> {
  const value = await invoke("contest_qrz_details_lookup", { ...context, call });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The callsign details response could not be verified.");
  return value as Profile;
}

export function fittedQRZDetailsHeight(contentHeight: number, availableHeight: number, contentScale = 1, chromeHeight = 0): number {
  const scale = Number.isFinite(contentScale) && contentScale > 0 ? contentScale : 1;
  const measured = Math.ceil(Math.max(260, (contentHeight + 24) * scale + Math.max(0, chromeHeight)));
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
      const logicalInnerHeight = logical.height;
      const chrome = scale > 0 ? (outer.height - inner.height) / scale : 0;
      const contentScale = window.innerHeight > 0 ? logicalInnerHeight / window.innerHeight : 1;
      const next = { width: logical.width, height: fittedQRZDetailsHeight(document.documentElement.scrollHeight, window.screen.availHeight, contentScale, chrome) };
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
    if (snapshot.panelID !== "qrz-details" || snapshot.projection.status !== "ready" || snapshot.projection.schemaVersion !== 2 ||
        !("draft" in snapshot.projection))
      throw new Error("The contest draft is not available for callsign details.");
    if (snapshot.projectionRevision >= revision.current) {
      revision.current = snapshot.projectionRevision;
      setProjection(snapshot.projection);
    }
  }, [context]);
  useEffect(() => {
    let active = true, stop: (() => void) | undefined;
    const update = () => void refresh().catch(cause => { if (active) setError(errorMessage(cause)); });
    update();
    void onContestSurfaceWake(changedPanelID => {
      if (changedPanelID === null || changedPanelID === "qrz-details") update();
    }).then(unlisten => { if (active) stop = unlisten; else unlisten(); })
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
      else if (active) setError("The lookup service returned details for a different callsign.");
    }).catch(cause => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); }), 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [context, call, lookup]);
  useAutoFit(`${call}:${loading}:${error}:${profile?.call ?? ""}`);

  const value = profile?.call === call ? profile.value : null;
  const fields: Array<[string, string | null, string]> = value ? [
    ["Name", text(value.name) ?? text(value.nickname), "name"],
    ["Country", text(value.country), "country"],
    ["QTH", text(value.qth), "qth"],
    ["Grid", text(value.gridSquare), "grid"],
    ["Continent", text(value.continent), "continent"],
    ["ITU zone", number(value.ituZone), "itu-zone"],
    ["CQ zone", number(value.cqZone), "cq-zone"],
  ] : [];

  return <main className="contest-qrz-details" aria-label="Contest Callsign Details">
    <header><div><p>Callsign</p><h1>{call || "Callsign Details"}</h1></div></header>
    {!projection && !error && <p role="status">Loading the current contest callsign…</p>}
    {projection && !validCall.test(call) && <p role="status">Enter a complete callsign in the contest logging window.</p>}
    {loading && <p role="status">Looking up {call}…</p>}
    {error && <p className="contest-qrz-error" role="alert">{error}</p>}
    {value && <section aria-label={`${call} callsign profile`}>
      <dl>{fields.map(([label, detail, field]) => <div key={label} data-field={field}><dt>{label}</dt><dd>{detail ?? "—"}</dd></div>)}</dl>
    </section>}
  </main>;
}

export function DetachedContestQRZDetailsSurface() { return <ContestQRZDetailsSurface />; }
