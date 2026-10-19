import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Download, Radio, Trophy } from "lucide-react";
import BandMaps, { type BandMapSpot } from "../live/BandMaps";
import ClusterPanel from "../live/ClusterPanel";
import { useSharedCW } from "../live/useSharedCW";
import { ContestAssistancePanel, type ContestSCPPanelSurface, type SCPSelectionScope } from "./ContestAssistancePanel";
import { ContestCallHistoryPanel, type ContestHistoryPanelSurface } from "./ContestCallHistoryPanel";
import { ContestSetupPanel, newContestSetup, type ContestSetupDocument, type ContestSetupMacro } from "./ContestSetupPanel";
import { canonicalJSON, ContestMutationUncertain, ContestServerError, type ContestMutation } from "./client";
import { ContestEntryFields, ContestLogTable, ContestScoreSummary, ContestTextField, type ContestLogRow } from "./ContestPresentation";
import { nativeContestExportSave, type ContestExportSavePrepared } from "./contestExportSave";
import type { ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";
import { contestSurfacePanelIDs, type ContestSurfaceActionEnvelope, type ContestSurfacePanelID,
  type ContestSurfaceProjection, type ContestManualRow, type ContestManualContext } from "./contestSurfaceProtocol";
import type { ContestTransitionController } from "./ContestWorkspace";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";
import { openContestSurfaceWindow } from "./contestSurfaceNative";
import { openContestSetupService } from "./contestSetupServices";
import "./ContestWorkspace.css";

type Data = Record<string, any>;
type ContestFunctionKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Field = { id: string; label: string; accessibleName: string; value: string; visible: boolean; readOnly: boolean; enabled: boolean };
type Score = { qsos: number; points: number; countries: number; zones: number; multipliers?: number; total: number };
type Projection = {
  sessionID: string; engine: "not1mm-python"; pluginID: string; sourceRevision: string; referenceID: string;
  workspaceGeneration: string; revision: number; draftID: string; fields: Field[]; frequencyHz: number; mode: string; band: number;
  focus: string; tabNext: Record<string, string>; tabPrevious: Record<string, string>; run: boolean;
  functionKeys: Array<{ id: string; highlighted: boolean; label?: string; template?: string }>; dupe: boolean; countryResolved: boolean;
  history: string; score: Score; operator?: string; cwSpeedWpm?: number | null; callContext?: Partial<ContestManualContext> & {callsign?:string};
};
type Session = { sessionID: string; workspaceGeneration: string; name: string; pluginID: string; sourceRevision: string; revision: number };
type MutationResult = { projection: Projection; actions?: Data[]; messages?: string[]; replayed?: boolean; outputError?: string; effectiveMacros?: ContestSetupMacro[] };
type Props = {
  request: Request;
  serviceRequest: Request;
  stationTune: (frequencyHz: number, mode: string) => Promise<unknown>;
  operatingContext: string;
  workspaceGeneration: string;
  stationCall: string;
  radioFrequencyHz?: number;
  spots: BandMapSpot[];
  cluster: any;
  selectedSpotId?: string | null;
  onSelectedSpot?: (id: string) => void;
  registerTransition?: (controller: ContestTransitionController | null) => void;
  registerMenuRoute?: (handler: ((route: string) => boolean | Promise<boolean>) | null) => void;
  setupOnly?: boolean;
};

const activeSessionKey = "xlog.contesting.not1mm.active-session.v1";
const setupDraftKey = "xlog.contesting.not1mm.setup-draft.v1";
const logPageSize = 20;
const bandLabels: Record<string, string> = { "1.8": "160m", "3.5": "80m", "7": "40m", "14": "20m", "21": "15m", "28": "10m" };
const contestBands = ["160m", "80m", "40m", "20m", "15m", "10m"];
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : "Contest operation failed.";
const cqwwFrequency = (value: unknown): number | null => {
  const frequency = typeof value === "number" ? Math.round(value) : NaN;
  if (!Number.isSafeInteger(frequency)) return null;
  return [[1_800_000, 2_000_000], [3_500_000, 4_000_000], [7_000_000, 7_300_000],
    [14_000_000, 14_350_000], [21_000_000, 21_450_000], [28_000_000, 29_700_000]]
    .some(([low, high]) => frequency >= low && frequency <= high) ? frequency : null;
};
const manualFrequency = (value: string): number | null => {
  const mhz = Number(value.trim());
  return Number.isFinite(mhz) ? cqwwFrequency(mhz * 1_000_000) : null;
};

function restoredSetup(stationCall: string): ContestSetupDocument {
  const defaults = newContestSetup(stationCall);
  try {
    const raw = localStorage.getItem(setupDraftKey);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ContestSetupDocument>;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    return { ...defaults, ...saved,
      station: { ...defaults.station, ...(saved.station ?? {}) },
      settings: { ...defaults.settings, ...(saved.settings ?? {}) },
      preferences: { ...defaults.preferences, ...(saved.preferences ?? {}) },
      network: { ...defaults.network, ...(saved.network ?? {}) },
      macros: Array.isArray(saved.macros) ? saved.macros : defaults.macros };
  } catch { return defaults; }
}

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The contest host returned an invalid response.");
  const frame = value as Data;
  if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") throw new Error("The contest host response could not be correlated.");
  if (!frame.ok) throw new ContestServerError(typeof frame.error?.code === "string" ? frame.error.code : "contest_rejected",
    typeof frame.error?.message === "string" ? frame.error.message : "The contest host rejected the operation.",
    frame.error?.outcome === "uncertain" ? "uncertain" : "confirmed");
  if (!frame.result || typeof frame.result !== "object" || Array.isArray(frame.result)) throw new Error("The contest host returned no result.");
  return frame.result as T;
}

async function payloadDigest(payload: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJSON(payload)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function projectionFields(projection: Projection | null) {
  return Object.fromEntries((projection?.fields ?? []).map(field => [field.id, field.value]));
}

function sameFields(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => (left[key] ?? "") === (right[key] ?? ""));
}

function logRows(rows: Data[]): ContestLogRow[] {
  return rows.map(row => ({
    qsoID: String(row.ID ?? ""), workedAt: `${String(row.TS ?? "").replace(" ", "T")}Z`, callsign: String(row.Call ?? ""),
    band: bandLabels[String(row.Band)] ?? String(row.Band ?? ""), mode: String(row.Mode ?? "CW"),
    sentExchange: String(row.SentNr ?? ""), receivedExchange: String(row.ZN ?? row.Exchange1 ?? ""),
    points: Number(row.Points ?? 0), multiplierLabels: [String(row.CountryPrefix ?? ""), row.ZN ? `Zone ${row.ZN}` : ""].filter(Boolean),
  }));
}
function manualRows(rows: Data[]): ContestManualRow[] {
  return rows.map(row => ({ qsoID: String(row.ID ?? ""), TS: String(row.TS ?? ""), Call: String(row.Call ?? ""),
    Freq: String(row.Freq ?? ""), SNT: String(row.SNT ?? ""), RCV: String(row.RCV ?? ""), ZN: String(row.ZN ?? ""),
    SentNr: String(row.SentNr ?? ""), prefix: String(row.WPXPrefix || row.CountryPrefix || ""), Points: String(row.Points ?? "") }));
}

function multiplierMatrix(title: string, values: Data[], busy: boolean) {
  const rows = new Map<string, Record<string, number>>();
  for (const item of values) {
    const label = String(item.value ?? "").trim() || "Unknown";
    const band = bandLabels[String(item.band)] ?? String(item.band ?? "");
    if (!contestBands.includes(band)) continue;
    const counts = rows.get(label) ?? Object.fromEntries(contestBands.map(value => [value, 0]));
    counts[band] = Number(item.qsos ?? 0); rows.set(label, counts);
  }
  return { schemaVersion: 1 as const, status: "ready" as const, title, bands: contestBands,
    rows: [...rows.entries()].map(([label, counts]) => ({ label, counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0) })), total: rows.size, busy };
}

export function Not1MMContestWorkspace({ request, serviceRequest, stationTune, operatingContext, workspaceGeneration, stationCall, radioFrequencyHz, spots, cluster,
  selectedSpotId, onSelectedSpot, registerTransition, registerMenuRoute, setupOnly = false }: Props) {
  const [catalog, setCatalog] = useState<Data[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null), projectionRef = useRef<Projection | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({}), fieldsRef = useRef<Record<string, string>>({});
  const [rows, setRows] = useState<Data[]>([]), [score, setScore] = useState<Score | null>(null), [matrices, setMatrices] = useState<Data>({ countries: [], zones: [] });
  const [rates, setRates] = useState<Data | null>(null);
  const [partial, setPartial] = useState<{sessionID:string;revision:number;query:string;rows:Data[]} | null>(null);
  const [manager, setManager] = useState(true), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [retiring, setRetiring] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [create, setCreate] = useState({ name: "CQ WW CW", cqZone: "15" });
  const [setup, setSetup] = useState<ContestSetupDocument>(() => restoredSetup(stationCall));
  const [effectiveMacros, setEffectiveMacros] = useState<ContestSetupMacro[] | undefined>();
  const [manualFrequencyMHz, setManualFrequencyMHz] = useState("");
  const [editing, setEditing] = useState<Data | null>(null), [editCall, setEditCall] = useState(""), [editZone, setEditZone] = useState("");
  const [editTimestamp, setEditTimestamp] = useState(""), [editFrequencyMHz, setEditFrequencyMHz] = useState("");
  const [editOperator, setEditOperator] = useState(""), [editSent, setEditSent] = useState(""), [editReceived, setEditReceived] = useState("");
  const [editSentExchange, setEditSentExchange] = useState("");
  const [correctionReason, setCorrectionReason] = useState("Operator correction"), [deletionReason, setDeletionReason] = useState("Operator deletion");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logOffset, setLogOffset] = useState(0), [logTotal, setLogTotal] = useState(0);
  const [scpSurface, setSCPSurface] = useState<ContestSCPPanelSurface | null>(null);
  const [historySurface, setHistorySurface] = useState<ContestHistoryPanelSurface | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusRef = useRef("callsign");
  const editVersionRef = useRef(0);
  const flushDraftRef = useRef<() => Promise<Projection | null>>(async () => projectionRef.current);
  const cw = useSharedCW(projection?.sessionID ?? "not1mm-no-session", retiring);
  projectionRef.current = projection; fieldsRef.current = fields;
  const observedFrequencyHz = cqwwFrequency(radioFrequencyHz);
  const fallbackFrequencyHz = manualFrequency(manualFrequencyMHz);
  const operationFrequencyHz = observedFrequencyHz ?? fallbackFrequencyHz;
  const rememberSetup = (document: ContestSetupDocument) => {
    setSetup(document);
    try { localStorage.setItem(setupDraftKey, JSON.stringify(document)); } catch { /* storage is optional */ }
  };

  const result = async <T,>(method: string, params: Record<string, unknown> = {}) => unwrap<T>(await request(method, params));
  const partialQuery = (fields.callsign ?? "").trim().toUpperCase();
  useEffect(() => {
    let cancelled = false;
    if (!projection || !/^[A-Z0-9/]{1,32}$/.test(partialQuery)) { setPartial(null); return; }
    const {sessionID, revision} = projection;
    void result<Data>("contest_check_partial", {sessionID, expectedRevision:revision, query:partialQuery, limit:500})
      .then(value => { if (!cancelled) setPartial({sessionID, revision, query:partialQuery, rows:Array.isArray(value.rows)?value.rows:[]}); })
      .catch(() => { if (!cancelled) setPartial(null); });
    return () => { cancelled = true; };
  }, [projection?.sessionID, projection?.revision, partialQuery, request]);
  const acceptProjection = (next: Projection, inputVersion?: number) => {
    projectionRef.current = next; focusRef.current = next.focus; setProjection(next);
    const values = inputVersion !== undefined && editVersionRef.current !== inputVersion
      ? fieldsRef.current : projectionFields(next);
    fieldsRef.current = values; setFields(values);
  };
  const refresh = async (sessionID: string, next?: Projection, offset = 0) => {
    const [log, scoreResult, rateResult] = await Promise.all([
      result<Data>("contest_log_page", { sessionID, expectedRevision: (next ?? projectionRef.current)?.revision,
        offset, limit: logPageSize }),
      result<Data>("contest_score", { sessionID }),
      result<Data>("contest_rates", { sessionID }),
    ]);
    if (next && projectionRef.current?.sessionID !== next.sessionID) return;
    setRows(Array.isArray(log.rows) ? log.rows : []); setLogOffset(Number(log.offset ?? offset)); setLogTotal(Number(log.total ?? 0));
    setScore(scoreResult.score as Score); setMatrices(scoreResult.matrices ?? { countries: [], zones: [] });
    setRates(rateResult);
  };
  const openSession = async (session: Session) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (projectionRef.current?.sessionID !== session.sessionID) await flushDraftRef.current();
      const opened = await result<{ projection: Projection }>("contest_open", {
        sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      });
      const setupResult = await result<{ setup: ContestSetupDocument; effectiveMacros?: ContestSetupMacro[] }>("contest_setup_get", { sessionID: session.sessionID });
      setEffectiveMacros(setupResult.effectiveMacros);
      setManualFrequencyMHz((opened.projection.frequencyHz / 1_000_000).toFixed(6));
      acceptProjection(opened.projection); rememberSetup(setupResult.setup); await refresh(session.sessionID, opened.projection);
      localStorage.setItem(activeSessionKey, session.sessionID); if (!setupOnly) setManager(false); setEditing(null);
      await cw.controller.refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([result<Data>("contest_catalog"), result<{ sessions: Session[] }>("contest_sessions")]).then(([available, list]) => {
      if (!active) return;
      setCatalog(Array.isArray(available.plugins) ? available.plugins : []); setSessions(list.sessions);
      const stored = localStorage.getItem(activeSessionKey);
      const saved = stored ? list.sessions.find(session => session.sessionID === stored) : undefined;
      if (saved) void openSession(saved);
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!registerTransition) return;
    registerTransition({
      freeze: () => setRetiring(true), resume: () => setRetiring(false),
      prepare: async () => {
        if (busyRef.current || editing) throw new Error("Finish the current contest edit before changing operating module.");
        await flushDraftRef.current();
        await cw.controller.stop();
      },
    });
    return () => registerTransition(null);
  }, [registerTransition, editing, cw.controller]);

  const mutate = async (method: string, base: Projection, extra: Record<string, unknown> = {}) => {
    const operationID = crypto.randomUUID();
    const payload = { sessionID: base.sessionID, operationID, expectedRevision: base.revision, draftID: base.draftID, ...extra };
    try { return await result<MutationResult>(method, payload); }
    catch (cause) {
      const durableMethods = new Set<ContestMutation["method"]>(["contest_draft_apply", "contest_qso_commit", "contest_qso_correct", "contest_qso_delete"]);
      const uncertain = !(cause instanceof ContestServerError) || cause.outcome === "uncertain";
      if (uncertain && durableMethods.has(method as ContestMutation["method"])) {
        const operation: ContestMutation = { method: method as ContestMutation["method"], payload,
          scope: { sessionID: base.sessionID, workspaceGeneration: base.workspaceGeneration, requestID: operationID,
            expectedRevision: base.revision, draftID: base.draftID, payloadDigest: await payloadDigest(payload),
            operationTimestamp: new Date().toISOString() } };
        throw new ContestMutationUncertain(operation, cause);
      }
      throw cause;
    }
  };
  const flushDraft = async (supplied = projectionRef.current): Promise<Projection | null> => {
    if (!supplied) return null;
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid CQ WW frequency before continuing.");
    const values = { ...fieldsRef.current }, inputVersion = editVersionRef.current;
    if (sameFields(values, projectionFields(supplied)) && operationFrequencyHz === supplied.frequencyHz) return supplied;
    const changed = await mutate("contest_draft_apply", supplied, { fields: values, frequencyHz: operationFrequencyHz });
    acceptProjection(changed.projection, inputVersion);
    return changed.projection;
  };
  flushDraftRef.current = () => flushDraft();
  const runMutation = async (operation: (base: Projection) => Promise<MutationResult>, refreshViews = true,
    flushBuffered = true, preserveConcurrentEdits = false, throwFailures = false) => {
    let base = projectionRef.current;
    if (!base || busyRef.current || retiring) {
      if (throwFailures) throw new Error(!base ? "Open a contest session before editing it." : "The contest owner is busy.");
      return null;
    }
    const inputVersion = editVersionRef.current;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (flushBuffered) base = await flushDraft(base);
      if (!base) throw new Error("Open a contest session before editing it.");
      const changed = await operation(base);
      acceptProjection(changed.projection, preserveConcurrentEdits ? inputVersion : undefined);
      if (refreshViews) await refresh(changed.projection.sessionID, changed.projection);
      for (const item of changed.messages ?? []) setNotice(item);
      if (changed.actions?.length) throw new Error("Contest output requires native operation admission; no renderer output was sent.");
      if (changed.outputError) setError(changed.outputError);
      return changed.projection;
    } catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; return null; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const hostAction = (method: string, extra: Record<string, unknown> = {}) => runMutation(async base => {
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid CQ WW frequency before using ESM.");
    const operationID = crypto.randomUUID();
    const native = await cw.controller.executeContest({ operation: method === "contest_esm" ? "esm" : "function_key",
      operationID, sessionID: base.sessionID, expectedContestRevision: base.revision, draftID: base.draftID,
      fields: fieldsRef.current, frequencyHz: operationFrequencyHz, ...extra });
    const changed = native?.contestResult as (MutationResult & { operationID?: string }) | undefined;
    if (!changed?.projection || changed.operationID !== operationID) throw new Error(native?.error || "Contest CW operation was not confirmed. Use Stop and reopen the session before deciding what to do next.");
    return { ...changed, actions: [], outputError: native?.error || undefined };
  }, true, false);

  useEffect(() => {
    if (!projection || editing) return;
    fieldRefs.current[projection.focus]?.focus();
  }, [projection?.focus, projection?.draftID, editing]);

  useEffect(() => {
    if (!projection || observedFrequencyHz === null || projection.frequencyHz === observedFrequencyHz || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: fieldsRef.current, frequencyHz: observedFrequencyHz,
    }), false, false, true);
  }, [observedFrequencyHz, projection?.sessionID, projection?.frequencyHz, retiring]);

  const createSession = async (document: ContestSetupDocument) => {
    const contestCall = String(document.station.Call || stationCall).trim().toUpperCase();
    if (!contestCall) throw new Error("Configure the xLog station callsign before creating a contest.");
    if (operationFrequencyHz === null) throw new Error("Connect the selected radio or enter a valid CQ WW frequency before creating a contest.");
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await flushDraftRef.current();
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(workspaceGeneration))
        throw new Error("The current xLog workspace identity is unavailable. Reopen the workspace before creating a contest.");
      const sessionID = crypto.randomUUID();
      const created = await result<MutationResult>("contest_create", { sessionID, workspaceGeneration,
        operationID: crypto.randomUUID(), expectedRevision: 0,
        pluginID: document.pluginID, name: document.name.trim() || "CQ WW CW", station: { ...document.station, Call: contestCall },
        operator: document.operator.trim().toUpperCase() || contestCall, frequencyHz: operationFrequencyHz,
        settings: document.settings });
      const saved = await mutate("contest_setup_save", created.projection, { setup: document }) as MutationResult & { setup: ContestSetupDocument; effectiveMacros?: ContestSetupMacro[] };
      setEffectiveMacros(saved.effectiveMacros);
      acceptProjection(saved.projection); rememberSetup(saved.setup); await refresh(sessionID, saved.projection);
      const list = await result<{ sessions: Session[] }>("contest_sessions"); setSessions(list.sessions);
      localStorage.setItem(activeSessionKey, sessionID); if (!setupOnly) setManager(false);
    } catch (cause) { setError(errorMessage(cause)); throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveSetup = async (document: ContestSetupDocument) => {
    if (!projectionRef.current) { rememberSetup(document); return; }
    let savedMacros: ContestSetupMacro[] | undefined;
    const saved = await runMutation(async base => {
      const response = await mutate("contest_setup_save", base, { setup: document });
      savedMacros = response.effectiveMacros;
      return response;
    },
      false, true, false, true);
    if (saved) { rememberSetup(document); setEffectiveMacros(savedMacros); }
  };

  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") { event.preventDefault(); void cw.controller.stop(); return; }
    if (!projection || busy || retiring) return;
    if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) { event.preventDefault(); void hostAction("contest_function_key", { key: event.key }); return; }
    if (event.key === "Enter") { event.preventDefault(); void hostAction("contest_esm", { field: focusRef.current }); return; }
    if (event.key === "Tab") {
      const target = event.target as HTMLInputElement, current = target.dataset.contestField;
      const next = current && (event.shiftKey ? projection.tabPrevious[current] : projection.tabNext[current]);
      if (next && fieldRefs.current[next]) { event.preventDefault(); fieldRefs.current[next]?.focus(); }
    }
  };
  const chooseSpot = async (spot: BandMapSpot) => {
    const frequencyHz = Math.round(Number(spot.frequencyKHz) * 1000);
    if (cqwwFrequency(frequencyHz) === null) return;
    const next = await runMutation(async base => {
      await stationTune(frequencyHz, "CW");
      return mutate("contest_draft_apply", base, {
        fields: { ...fieldsRef.current, callsign: String(spot.callsign ?? "").toUpperCase() }, frequencyHz,
      });
    }, false, false);
    if (!next) return;
    setManualFrequencyMHz((frequencyHz / 1_000_000).toFixed(6));
    onSelectedSpot?.(String(spot.id));
    setNotice(`Loaded ${spot.callsign} after the selected radio confirmed one tune.`);
  };

  const exportCabrillo = async () => {
    const active = projectionRef.current;
    if (!active || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const prepared = await result<ContestExportSavePrepared & { filename?: string }>("contest_export_prepare", { sessionID: active.sessionID });
      const saved = await nativeContestExportSave(prepared);
      if (saved.status === "saved") setNotice(`Saved ${saved.filename}.`);
      else if (saved.status === "cancelled") setNotice("Cabrillo save cancelled.");
      else setError(saved.message);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const beginEdit = async (qsoID: string, throwFailures = false) => {
    const active = projectionRef.current;
    const partialRows = partial?.sessionID===active?.sessionID && partial?.revision===active?.revision && partial?.query===(fieldsRef.current.callsign??"").trim().toUpperCase()?partial?.rows:[];
    const row = [...rows,...(partialRows??[])].find(item => String(item.ID) === qsoID);
    if (!row) { if (throwFailures) throw new Error("The selected contact is no longer in this log or its partial matches."); return; }
    if (busyRef.current || retiring) { if (throwFailures) throw new Error("The contest owner is busy."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      await flushDraftRef.current();
      setEditing(row); setEditCall(String(row.Call ?? "")); setEditZone(String(row.ZN ?? ""));
      setEditTimestamp(String(row.TS ?? "")); setEditFrequencyMHz((Number(row.Freq ?? 0) / 1000).toFixed(6));
      setEditOperator(String(row.Operator ?? "")); setEditSent(String(row.SNT ?? "")); setEditReceived(String(row.RCV ?? ""));
      setEditSentExchange(String(row.SentNr ?? "")); setCorrectionReason("Operator correction");
      setDeletionReason("Operator deletion"); setConfirmDelete(false);
    } catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCorrection = async (reason: string, throwFailures = false) => { if (!editing) return null;
    const frequencyHz = manualFrequency(editFrequencyMHz);
    if (frequencyHz === null) throw new Error("Enter a valid CQ WW frequency before saving the correction.");
    const next = await runMutation(base => mutate("contest_qso_correct", base, { qsoID: editing.ID,
      timestamp: editTimestamp, frequencyHz, operator: editOperator,
      fields: { callsign: editCall.toUpperCase(), sent: editSent, receive: editReceived,
        other_1: editSentExchange, other_2: editZone }, reason }), true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const correct = (event: FormEvent) => { event.preventDefault();
    void saveCorrection(correctionReason).catch(cause => setError(errorMessage(cause))); };
  const deleteQSO = async (reason: string, throwFailures = false) => { if (!editing) return null;
    const next = await runMutation(base => mutate("contest_qso_delete", base, { qsoID: editing.ID, reason }),
      true, true, false, throwFailures);
    if (next) { setEditing(null); setConfirmDelete(false); }
    return next;
  };
  const remove = () => { if (!editing || !confirm(`Delete ${editing.Call} from this contest?`)) return;
    void deleteQSO(deletionReason).catch(cause => setError(errorMessage(cause))); };

  const scoreView = score ? { claimedScore: score.total, qsos: score.qsos, points: score.points,
    multipliers: score.countries + score.zones, multiplierLabels: [`${score.countries} countries`, `${score.zones} zones`],
    multiplierDisplayLabels: [`${score.countries} countries`, `${score.zones} zones`], sourceVerification: "verified" as const } : null;
  const visibleFields = projection?.fields.filter(field => field.visible) ?? [];
  const changeField = (field: string, value: string) => {
    editVersionRef.current += 1;
    const next = { ...fieldsRef.current, [field]: value };
    fieldsRef.current = next; setFields(next);
  };
  const focusField = (field: string) => {
    focusRef.current = field;
    if (projectionRef.current?.focus === field || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_focus", base, { field }), false, true, true);
  };
  const syncManualFrequency = () => {
    if (observedFrequencyHz !== null || fallbackFrequencyHz === null || busyRef.current || retiring) return;
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: fieldsRef.current, frequencyHz: fallbackFrequencyHz,
    }), false, false, true);
  };
  const loadLogPage = async (offset: number, throwFailures = false) => {
    const active = projectionRef.current;
    if (!active || busyRef.current || offset < 0) {
      if (throwFailures) throw new Error(!active ? "Open a contest session before paging its log." : "The contest owner is busy.");
      return;
    }
    busyRef.current = true; setBusy(true); setError("");
    try { await refresh(active.sessionID, active, offset); }
    catch (cause) { setError(errorMessage(cause)); if (throwFailures) throw cause; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const detachedAvailable = !!projection && projection.workspaceGeneration === workspaceGeneration;
  const activeSessionName = sessions.find(session => session.sessionID === projection?.sessionID)?.name || create.name.trim() || "CQ WW CW";
  const unavailableProjection = { schemaVersion: 1, status: "unavailable" } as const;
  const surfaceProjections = useMemo(() => {
    const unavailable = Object.fromEntries(contestSurfacePanelIDs.map(panelID => [panelID, unavailableProjection])) as
      Record<ContestSurfacePanelID, ContestSurfaceProjection>;
    if (!projection || !detachedAvailable) return unavailable;
    const currentFields = fields;
    const frequencyHz = operationFrequencyHz;
    const receivedZone = projection.fields.find(field => field.id === "other_2");
    const sentZone = projection.fields.find(field => field.id === "other_1");
    const editedFrequencyHz = editing ? manualFrequency(editFrequencyMHz) : null;
    const callContext = projection.callContext?.callsign === partialQuery ? projection.callContext : undefined;
    unavailable["active-qso"] = {
      schemaVersion: 2, status: "ready",
      manual: {operator:projection.operator ?? "", cwSpeedWpm:projection.cwSpeedWpm ?? null,
        country:callContext?.country ?? null, cqZone:callContext?.cqZone ?? null, ituZone:callContext?.ituZone ?? null,
        headingDegrees:callContext?.headingDegrees ?? null, longPathHeadingDegrees:callContext?.longPathHeadingDegrees ?? null,
        distanceKm:callContext?.distanceKm ?? null, qsos:projection.score.qsos, multipliers:projection.score.multipliers ?? projection.score.countries + projection.score.zones, total:projection.score.total},
      session: { name: activeSessionName, ruleName: "CQ WW CW", mode: "CW" },
      draft: {
        draftID: projection.draftID, revision: projection.revision, callsign: currentFields.callsign ?? "",
        sentReport: currentFields.sent ?? "", receivedReport: currentFields.receive ?? "",
        receivedFields: [{ id: "other_2", label: receivedZone?.label ?? "Received CQ zone",
          value: currentFields.other_2 ?? "", required: true, maximumUTF8Bytes: 8 }],
        frequencyHz, frequencyText: frequencyHz === null ? "" : String(frequencyHz),
        frequencyError: frequencyHz === null ? "Enter a valid CQ WW frequency." : "",
        band: bandLabels[String(projection.band)] ?? String(projection.band), mode: projection.mode,
        dupe: { state: projection.dupe ? "duplicate" : "clear", reason: projection.dupe ? "Worked on this band." : "Clear on this band." },
        validation: { errors: [], warnings: projection.countryResolved ? [] : ["Country is unresolved; scoring credit may be zero."] },
        reservedSerial: null,
      },
      descriptor: {
        bands: [bandLabels[String(projection.band)] ?? String(projection.band)], modes: ["CW"],
        sentFields: [{ id: "other_1", label: sentZone?.label ?? "Sent CQ zone", value: currentFields.other_1 ?? "",
          required: true, maximumUTF8Bytes: 8 }],
        serial: { requirement: "none", allocatedFieldID: null, reservedSerial: null },
      },
      operator: {
        output: "xlog-native", armed: cw.state.armed, style: projection.run ? "run" : "search-and-pounce",
        status: cw.state.pending ? "waiting" : cw.state.error ? "uncertain" : cw.state.armed ? "armed" : "disarmed",
        pending: cw.state.pending ? "send" : null,
        focusedField: projection.focus === "callsign" ? "callsign" : projection.focus === "other_2" ? "exchange" : null,
        functionKeys: projection.functionKeys.map(item => ({ key: item.id as ContestFunctionKey, macro: item.label ?? item.id })),
        readiness: { canSendCQ: cw.state.armed, canSendCall: cw.state.armed, canSendDuplicate: cw.state.armed,
          canReserveCall: false, canReserveCommit: false, canCommit: true },
        trace: [],
      },
      busy: busy || retiring,
      dirty: !sameFields(currentFields, projectionFields(projection)) || frequencyHz !== projection.frequencyHz,
      uncertain: false,
    };
    unavailable.logbook = {
      schemaVersion: 1, status: "ready", sessionRevision: projection.revision,
      page: { offset: logOffset, limit: logPageSize, total: logTotal, rows: logRows(rows) },
      manualRows:manualRows(rows), partialRows:manualRows(partial?.sessionID===projection.sessionID && partial.revision===projection.revision && partial.query===partialQuery?partial.rows:[]),
      editing: editing ? {
        qsoID: String(editing.ID ?? ""), workedAt: editTimestamp, operator: editOperator, callsign: editCall,
        band: bandLabels[String(editing.Band)] ?? String(editing.Band ?? ""), mode: String(editing.Mode ?? "CW"),
        sentReport: editSent, receivedReport: editReceived,
        receivedFields: [
          { id: "other_1", label: "Sent CQ zone", value: editSentExchange, required: true, maximumUTF8Bytes: 8 },
          { id: "other_2", label: "Received CQ zone", value: editZone, required: true, maximumUTF8Bytes: 8 },
        ],
        frequencyHz: editedFrequencyHz, editFrequencyText: editedFrequencyHz === null ? "" : String(editedFrequencyHz),
        frequencyError: editedFrequencyHz === null ? "Enter a valid CQ WW frequency." : "",
        correctionReason, confirmDelete, deletionReason,
      } : null,
      busy: busy || retiring,
    };
    unavailable["callsign-intelligence"] = {
      schemaVersion: 1, status: "ready", draftID: projection.draftID, draftRevision: projection.revision,
      inputCallsign: currentFields.callsign ?? "",
      loggedCalls:[...new Set((partial?.sessionID===projection.sessionID && partial.revision===projection.revision && partial.query===partialQuery?partial.rows:[]).map(row=>String(row.Call??"")).filter(Boolean))],
      clusterCalls:partialQuery ? [...new Set(spots.map(spot=>String(spot.callsign??"").trim().toUpperCase()).filter(call=>call.includes(partialQuery)))].slice(0,500) : [],
      scp: { source: scpSurface?.source ?? null, candidates: scpSurface?.candidates ?? [] },
      history: { source: historySurface?.source ?? null, rows: historySurface?.rows ?? [] },
      busy: !!scpSurface?.busy || !!historySurface?.busy,
    };
    unavailable.propagation = { schemaVersion: 1, status: "ready", score: scoreView, busy: busy || retiring };
    unavailable.monitor = { schemaVersion: 1, status: "ready",
      lastHourQsoPerHour: rates?.lastHourQsoPerHour ?? null, last10QsoPerHour: rates?.last10QsoPerHour ?? null,
      last100QsoPerHour: rates?.last100QsoPerHour ?? null, sinceMinuteQsoPerHour: rates?.sinceMinuteQsoPerHour ?? null,
      runQso: Number(rates?.runQso ?? 0), searchAndPounceQso: Number(rates?.searchAndPounceQso ?? 0),
      hourRunQso: Number(rates?.hourRunQso ?? 0), hourSearchAndPounceQso: Number(rates?.hourSearchAndPounceQso ?? 0), busy: busy || retiring };
    unavailable.awards = multiplierMatrix("DXCC", Array.isArray(matrices.countries) ? matrices.countries : [], busy || retiring);
    unavailable["chaser-dx"] = multiplierMatrix("CQ Zones", Array.isArray(matrices.zones) ? matrices.zones : [], busy || retiring);
    return unavailable;
  }, [projection, detachedAvailable, activeSessionName, fields, operationFrequencyHz, rows, logOffset, logTotal, editing,
    editCall, editTimestamp, editFrequencyMHz, editOperator, editSent, editReceived, editSentExchange, editZone, correctionReason, confirmDelete, deletionReason,
    busy, retiring, scpSurface, historySurface, cw.state.armed, cw.state.pending, cw.state.error, rates, matrices, partial, partialQuery, spots]);

  const surfaceContext = detachedAvailable && projection ? {
    operatingContext, sessionID: projection.sessionID, workspaceGeneration: projection.workspaceGeneration,
  } : null;
  const handleSurfaceAction = async (action: ContestSurfaceActionEnvelope) => {
    const active = projectionRef.current;
    if (!active || !detachedAvailable || action.sessionID !== active.sessionID ||
        action.workspaceGeneration !== active.workspaceGeneration || action.operatingContext !== operatingContext)
      throw new Error("This detached panel no longer belongs to the active contest session.");
    if (action.action === "entry_operator_key" && action.params.key === "Escape") {
      await cw.controller.stop(); return;
    }
    if (busyRef.current || retiring) throw new Error("The contest owner is busy.");
    if (action.action.startsWith("entry_") || action.action.startsWith("assistance_")) {
      if (!("draftID" in action.params) || action.params.draftID !== active.draftID ||
          action.params.expectedDraftRevision !== active.revision)
        throw new Error("The contest entry changed before this action reached the owner.");
    }
    const persistFields = async (fieldID: string, value: string) => {
      const next = { ...fieldsRef.current, [fieldID]: value };
      fieldsRef.current = next; setFields(next); editVersionRef.current += 1;
      await runMutation(base => mutate("contest_draft_apply", base, { fields: next,
        frequencyHz: operationFrequencyHz ?? base.frequencyHz }), false, false, false, true);
    };
    const requireEditing = (qsoID: string) => {
      if (!editing || String(editing.ID ?? "") !== qsoID) throw new Error("Open this contact in the shared log editor first.");
    };
    switch (action.action) {
      case "entry_set_text": {
        const fieldID = { callsign: "callsign", sentReport: "sent", receivedReport: "receive" }[action.params.field];
        await persistFields(fieldID, action.params.field === "callsign" ? action.params.value.toUpperCase() : action.params.value); return;
      }
      case "entry_set_exchange":
        if (action.params.fieldID !== "other_2") throw new Error("This CQ WW entry field is not editable here.");
        await persistFields("other_2", action.params.value.toUpperCase()); return;
      case "entry_set_frequency_text": {
        if (observedFrequencyHz !== null) throw new Error("Frequency follows the selected xLog radio and cannot be edited here.");
        const frequencyHz = /^\d+$/.test(action.params.value) ? cqwwFrequency(Number(action.params.value)) : null;
        if (frequencyHz === null) throw new Error("Enter a valid CQ WW frequency in Hz.");
        setManualFrequencyMHz((frequencyHz / 1_000_000).toFixed(6));
        await runMutation(base => mutate("contest_draft_apply", base, { fields: fieldsRef.current, frequencyHz }), false, false, false, true);
        return;
      }
      case "entry_set_band":
        if (action.params.value !== (bandLabels[String(active.band)] ?? String(active.band)))
          throw new Error("Band follows the admitted contest frequency.");
        return;
      case "entry_set_mode":
        if (action.params.value !== active.mode) throw new Error("CQ WW CW mode cannot be changed in this session.");
        return;
      case "entry_reserve_serial": throw new Error("CQ WW CW does not allocate a serial number.");
      case "entry_commit":
        await runMutation(base => mutate("contest_qso_commit", base, { fields: fieldsRef.current, frequencyHz: base.frequencyHz }),
          true, true, false, true); return;
      case "entry_operator_arm":
        if (action.params.armed) await cw.controller.arm(); else await cw.controller.stop();
        return;
      case "entry_operator_style":
        await runMutation(base => mutate("contest_run_state", base, { run: action.params.value === "run" }), false,
          true, false, true);
        return;
      case "entry_set_cw_speed": {
        await serviceRequest("station_radio_control", { control: "set_cw_speed", words_per_minute: action.params.value });
        const document = { ...setup, preferences: { ...setup.preferences, cwSpeed: action.params.value } };
        const saved = await mutate("contest_setup_save", active, { setup: document }) as MutationResult & { setup: ContestSetupDocument };
        acceptProjection(saved.projection); setSetup(saved.setup); return;
      }
      case "entry_operator_key":
        if (action.params.key === "Enter") {
          await hostAction("contest_esm", { field: action.params.focusedField === "exchange" ? "other_2" : "callsign" }); return;
        }
        await hostAction("contest_function_key", { key: action.params.key }); return;
      case "assistance_query": await persistFields("callsign", action.params.inputCallsign.toUpperCase()); return;
      case "assistance_select":
        if (action.params.kind === "scp" && scpSurface) await scpSurface.selectCandidate(action.params.candidateID);
        else if (action.params.kind === "history" && historySurface) await historySurface.selectCandidate(action.params.candidateID);
        else throw new Error("The callsign candidate set is unavailable.");
        return;
      case "log_page": await loadLogPage(action.params.offset, true); return;
      case "log_edit_begin": await beginEdit(action.params.qsoID, true); return;
      case "log_edit_cancel": requireEditing(action.params.qsoID); setEditing(null); setConfirmDelete(false); return;
      case "log_edit_set_text":
        requireEditing(action.params.qsoID);
        if (action.params.field === "callsign") setEditCall(action.params.value.toUpperCase());
        else if (action.params.field === "sentReport") setEditSent(action.params.value);
        else if (action.params.field === "receivedReport") setEditReceived(action.params.value);
        else if (action.params.field === "timestamp") setEditTimestamp(action.params.value);
        else if (action.params.field === "operator") setEditOperator(action.params.value.toUpperCase());
        else if (action.params.field === "correctionReason") setCorrectionReason(action.params.value);
        else setDeletionReason(action.params.value);
        return;
      case "log_edit_set_exchange":
        requireEditing(action.params.qsoID);
        if (action.params.fieldID === "other_1") setEditSentExchange(action.params.value);
        else if (action.params.fieldID === "other_2") setEditZone(action.params.value);
        else throw new Error("This CQ WW log field is not editable here.");
        return;
      case "log_edit_set_frequency_text": {
        requireEditing(action.params.qsoID);
        const frequencyHz = /^\d+$/.test(action.params.value) ? cqwwFrequency(Number(action.params.value)) : null;
        if (frequencyHz === null) throw new Error("Enter a valid CQ WW frequency in Hz.");
        setEditFrequencyMHz((frequencyHz / 1_000_000).toFixed(6)); return;
      }
      case "log_edit_set_band":
        requireEditing(action.params.qsoID);
        if (action.params.value !== (bandLabels[String(editing?.Band)] ?? String(editing?.Band ?? "")))
          throw new Error("Band follows the corrected contact frequency.");
        return;
      case "log_edit_confirm_delete": requireEditing(action.params.qsoID); setConfirmDelete(action.params.confirmed); return;
      case "log_edit_save":
        requireEditing(action.params.qsoID);
        if (action.params.expectedSessionRevision !== active.revision) throw new Error("The contest log changed before this correction was saved.");
        if (!correctionReason.trim()) throw new Error("Enter a correction reason.");
        await saveCorrection(correctionReason.trim(), true); return;
      case "log_edit_delete":
        requireEditing(action.params.qsoID);
        if (action.params.expectedSessionRevision !== active.revision) throw new Error("The contest log changed before this deletion was saved.");
        if (!confirmDelete) throw new Error("Confirm deletion before removing this contact.");
        if (!deletionReason.trim()) throw new Error("Enter a deletion reason.");
        await deleteQSO(deletionReason.trim(), true); return;
    }
  };
  const reportSurfaceError = useCallback((message: string) => setError(message), []);
  useContestSurfaceOwner({ context: surfaceContext, projections: surfaceProjections, handle: handleSurfaceAction, report: reportSurfaceError });

  useEffect(() => {
    if (!registerMenuRoute) return;
    const handle = async (route: string) => {
      if (route === "contest-setup") {
        await flushDraftRef.current();
        setManager(true);
        return true;
      }
      const panelID = route.startsWith("contest-window-") ? route.slice("contest-window-".length) as ContestSurfacePanelID : null;
      if (!panelID || !contestSurfacePanelIDs.includes(panelID)) return false;
      const active = projectionRef.current;
      if (!active || !detachedAvailable || !surfaceContext) {
        setManager(true);
        setError("Open a contest session before opening its windows.");
        return true;
      }
      await flushDraftRef.current();
      await openContestSurfaceWindow(surfaceContext, panelID);
      return true;
    };
    registerMenuRoute(handle);
    return () => registerMenuRoute(null);
  }, [registerMenuRoute, detachedAvailable, surfaceContext?.operatingContext, surfaceContext?.sessionID,
    surfaceContext?.workspaceGeneration]);

  const applyAssistanceCallsign = (callsign: string, selection: SCPSelectionScope) => {
    const active = projectionRef.current;
    if (!active || busyRef.current || retiring || selection.ownerLeaseID !== 0 ||
        selection.sessionID !== active.sessionID || selection.workspaceGeneration !== active.workspaceGeneration ||
        selection.draftID !== active.draftID || selection.inputCallsign !== (fieldsRef.current.callsign ?? "").trim().toUpperCase()) {
      setError("The callsign suggestion no longer belongs to the active Not1MM draft.");
      return;
    }
    const nextFields = { ...fieldsRef.current, callsign };
    editVersionRef.current += 1; fieldsRef.current = nextFields; setFields(nextFields);
    void runMutation(base => mutate("contest_draft_apply", base, {
      fields: nextFields, frequencyHz: operationFrequencyHz ?? base.frequencyHz,
    }), false, false);
  };

  const cwPanel = () => projection && <section className="contest-operator" aria-label="CW controls"><header><div><strong>ESM and CW</strong><p>Not1MM chooses the F-key action; xLog owns the armed output lease.</p></div><span>{cw.state.message}</span></header><div className="contest-operator-controls"><button type="button" disabled={busy || cw.state.pending} onClick={() => void cw.controller.arm()}>Arm CW</button><button type="button" className="contest-danger-secondary" onClick={() => void cw.controller.stop()}>Stop</button><span className={cw.state.armed ? "is-armed" : ""}>{cw.state.armed ? "Armed" : "Disarmed"}</span></div>{cw.state.error && <p className="contest-alert is-error">{cw.state.error}</p>}<div className="contest-operator-keys">{projection.functionKeys.map(key => <button type="button" key={key.id} disabled={busy || retiring} className={key.highlighted ? "contest-primary" : undefined} onClick={() => void hostAction("contest_function_key", { key: key.id })}>{key.id}</button>)}</div></section>;
  const entryPanel: ReactNode = projection && <form className="contest-entry" aria-label="CQ WW CW entry" onSubmit={event => { event.preventDefault(); void runMutation(base => mutate("contest_qso_commit", base, { fields: fieldsRef.current, frequencyHz: base.frequencyHz })); }} onKeyDown={keyDown}>
    <header><div><h2><Radio size={15}/> CQ WW CW · Not1MM</h2><p>Actual pinned Python plugin · {projection.run ? "Run" : "Search & Pounce"}</p></div><span>{busy ? "Working…" : "Ready"}</span></header>
    <ContestEntryFields callsign={visibleFields.slice(0, 1).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} className="contest-call" autoComplete="off" data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } reports={visibleFields.slice(1, 3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value)}/>) } exchange={visibleFields.slice(3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => focusField(field.id)} onChange={event => changeField(field.id, event.target.value.toUpperCase())}/>) } />
    <div className="contest-entry-context"><div><span>Frequency</span>{observedFrequencyHz !== null
      ? <strong>{(observedFrequencyHz / 1e6).toFixed(6)} MHz · radio observed</strong>
      : <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
          value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)} onBlur={syncManualFrequency}/>}</div><div><span>Band / mode</span><strong>{bandLabels[String(projection.band)] ?? projection.band} · {projection.mode}</strong></div><div><span>Operating style</span><button type="button" disabled={busy || retiring} onClick={() => void runMutation(base => mutate("contest_run_state", base, { run: !base.run }), false)}>{projection.run ? "Run" : "S&P"}</button></div></div>
    <div className={`contest-validation ${projection.dupe ? "is-duplicate" : "is-clear"}`}><strong>{projection.dupe ? "Duplicate" : "Dupe check"}</strong><span>{projection.countryResolved ? "Country resolved by xLog CTY data." : "Unknown country is retained; scoring credit may be zero."}</span></div>
    {cwPanel()}
    <footer><button type="button" disabled={busy || retiring} onClick={() => void hostAction("contest_esm", { field: focusRef.current })}>Enter / ESM</button><button className="contest-primary" type="submit" disabled={busy || retiring}>Log Now</button></footer>
  </form>;
  const scorePanel = <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score</h2><ContestScoreSummary score={scoreView}/></aside>;
  const historySession = projection ? { sessionID: projection.sessionID, workspaceGeneration: projection.workspaceGeneration,
    revision: projection.revision, referenceDataVersion: projection.referenceID,
    rule: { identity: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11",
      sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" } } } as unknown as ContestSessionSummary : null;
  const historyDraft = projection ? { draftID: projection.draftID, revision: projection.revision,
    fields: { callsign: fields.callsign ?? "" } } as unknown as ContestDraftSnapshot : null;
  const checkPanel = <section className="contest-score" aria-label="Check Partial"><h2>Check Partial</h2>{projection && <ContestAssistancePanel
    request={request as ContestRequest} ownerLeaseID={0} sessionID={projection.sessionID} workspaceGeneration={projection.workspaceGeneration}
    draftID={projection.draftID} callsign={fields.callsign ?? ""} disabled={busy || retiring}
    onSelect={applyAssistanceCallsign} onSurfaceChange={setSCPSurface}/>} {historySession && historyDraft && <ContestCallHistoryPanel
    request={request as ContestRequest} ownerLeaseID={0} session={historySession} draft={historyDraft}
    disabled={busy || retiring} ready={!busy} onSurfaceChange={setHistorySurface}
    onApply={async (_selection, projectionIDs) => {
      if (projectionIDs.length) throw new Error("Applying xLog call-history fields to a Not1MM draft is not available yet.");
      setNotice("Call-history row selected for review; no Not1MM exchange field was changed.");
    }}/>}<p className="contest-source">{projection?.history || "Type a call to query Not1MM call history."}</p><p>{projection?.dupe ? "Worked on this band" : projection?.countryResolved ? "Country resolved · not a duplicate" : "No country match yet"}</p></section>;
  const matrixPanel = <section className="contest-score" aria-label="Country and zone matrices"><h2>Countries / zones</h2><div className="contest-multipliers">{[...(matrices.countries ?? []), ...(matrices.zones ?? [])].map((item: Data, index: number) => <span key={`${item.value}-${item.band}-${index}`}>{item.value || "Unknown"} · {bandLabels[String(item.band)] ?? item.band} · {item.qsos}</span>)}</div></section>;
  const logPanel = <section className="contest-log"><header><div><h2><BookOpen size={15}/> Contest log</h2><p>{logTotal} contacts in the Python-owned DXLOG store.</p></div><button type="button" disabled={busy} onClick={() => void exportCabrillo()}><Download size={14}/>Export Cabrillo</button></header>{editing && <form className="contest-qso-editor" onSubmit={correct}><h2>Edit {editing.Call}</h2><div className="contest-qso-fields"><ContestTextField label="Callsign" value={editCall} onChange={event => setEditCall(event.target.value.toUpperCase())}/><ContestTextField label="UTC timestamp" value={editTimestamp} onChange={event => setEditTimestamp(event.target.value)}/><ContestTextField label="Frequency MHz" inputMode="decimal" value={editFrequencyMHz} onChange={event => setEditFrequencyMHz(event.target.value)}/><ContestTextField label="Operator" value={editOperator} onChange={event => setEditOperator(event.target.value.toUpperCase())}/><ContestTextField label="Sent report" value={editSent} onChange={event => setEditSent(event.target.value)}/><ContestTextField label="Received report" value={editReceived} onChange={event => setEditReceived(event.target.value)}/><ContestTextField label="Sent CQ zone" inputMode="numeric" value={editSentExchange} onChange={event => setEditSentExchange(event.target.value)}/><ContestTextField label="Received CQ zone" inputMode="numeric" value={editZone} onChange={event => setEditZone(event.target.value)}/></div><footer><button className="contest-danger" type="button" onClick={remove}>Delete</button><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="contest-primary" type="submit">Save correction</button></footer></form>}<ContestLogTable rows={logRows(rows)} disabled={busy || retiring} onEdit={beginEdit}/><footer><button type="button" disabled={busy || logOffset === 0} onClick={() => void loadLogPage(Math.max(0, logOffset - logPageSize))}>Newer</button><span>{logTotal ? `${logOffset + 1}–${logOffset + rows.length} of ${logTotal}` : "No contacts"}</span><button type="button" disabled={busy || logOffset + rows.length >= logTotal} onClick={() => void loadLogPage(logOffset + logPageSize)}>Older</button></footer></section>;
  const bandMapPanel = <BandMaps spots={spots} radioFrequencyHz={radioFrequencyHz} compact onSelect={spot => void chooseSpot(spot)} selectionHint="Select a spot to load the active Not1MM draft and tune the selected xLog radio once."/>;
  const clusterPanel = <ClusterPanel passive snapshot={cluster} selectedSpotId={selectedSpotId ?? undefined} onRequest={serviceRequest} onSelect={spot => void chooseSpot(spot as BandMapSpot)}/>;
  const showSetup = setupOnly || manager;
  return <main className="contest-workspace">
    <header className="contest-header"><div><h1>{setupOnly ? "Contest Setup" : "Contest Manager / Desk"}</h1><p>{projection
      ? `${sessions.find(session => session.sessionID === projection.sessionID)?.name ?? projection.pluginID} · actual Not1MM Python plugin · xLog station services`
      : "Actual Not1MM Python plugins · xLog station services"}</p></div><div className="contest-header-actions">{!setupOnly && projection && <button type="button" disabled={busy} onClick={() => {
      if (manager) { setManager(false); return; }
      busyRef.current = true; setBusy(true); setError("");
      void flushDraftRef.current().then(() => setManager(true)).catch(cause => setError(errorMessage(cause)))
        .finally(() => { busyRef.current = false; setBusy(false); });
    }}>{manager ? "Back to desk" : "Select contest"}</button>}</div></header>
    {error && <p className="contest-alert is-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></p>}
    {notice && <p className="contest-alert" role="status">{notice}</p>}
    {showSetup && observedFrequencyHz === null && <div className="contest-entry-context">
      <ContestTextField label="Manual frequency MHz" inputMode="decimal" disabled={busy || retiring}
        value={manualFrequencyMHz} onChange={event => setManualFrequencyMHz(event.target.value)}/>
    </div>}
    {showSetup ? <ContestSetupPanel value={setup} effectiveMacros={effectiveMacros} sessions={sessions} activeSessionID={projection?.sessionID}
      catalog={catalog.map(item => ({ id: String(item.id), name: String(item.name) }))} busy={busy || retiring}
      onSave={saveSetup} onCreate={createSession} onOpen={session => openSession(session as Session)} onOpenSettings={openContestSetupService}
      onOpenCallHistory={() => { if (!surfaceContext) { setError("Open a contest before opening Call History."); return; }
        if (!setupOnly) setManager(false); void openContestSurfaceWindow(surfaceContext, "callsign-intelligence"); }}/>
      : projection ? <><section className="contest-snapshot" aria-label="Contest identity"><div><span>Station</span><strong>{stationCall}</strong></div><div><span>Engine</span><strong>Not1MM Python</strong></div><div><span>Plugin</span><strong>{projection.pluginID}</strong></div><div><span>Revision</span><strong>{projection.revision}</strong></div><div><span>Source</span><small>{projection.sourceRevision.slice(0, 12)} · {projection.referenceID}</small></div></section>{detachedAvailable
        ? <section className="contest-welcome"><h2>Contest windows are ready</h2><p>Use the Contest menu to open and position Main Logging, Check Partial, Stats, Rates, Logbook, Band Map, Cluster, Rotator, DXCC, Zone and Remote VFO windows.</p></section>
        : <section className="contest-welcome"><h2>Preserved contest session</h2><p>This session predates detached contest windows for the current xLog workspace. Its Python/SQLite log is preserved; create a current-workspace contest before opening independent windows.</p></section>}</> : <section className="contest-welcome"><h2>Open a contest session</h2></section>}
    <div hidden aria-hidden="true">{checkPanel}</div>
  </main>;
}

export default Not1MMContestWorkspace;
