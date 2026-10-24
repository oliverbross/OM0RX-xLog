import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { clusterBandColors, clusterModeColors, clusterStatusCode, clusterStatusColors, paletteColor, specialTagColors } from "./clusterPalette";
import { boundColumnWidth, compactClusterColumns, compactClusterHeader, defaultWorkspacePreferences, readWorkspacePreferences, type CompactColumn } from "./operatorWorkspacePreferences";
import { useSettingsSaveToast } from "./SettingsSaveToast";
import { formatSpotAge, spotAgeColor, useSpotAgeClock } from "./spotAge";
import { countryDisplay } from "./countryDisplay";
import { clusterFilterChoices, defaultClusterFilter, normalizeClusterFilter, type ClusterFilter } from "./clusterFilters";
import SpecialFilterOptions from "./SpecialFilterOptions";
import { useLogbookCapacity } from "./logbookCapacity";
import { contestBandMapMultiplierLabel, contestBandMapSpotColor, contestBandMapSpotPending, contestBandMapSpotWorked, contestNeededMultiplierCount } from "./BandMaps";
import "./ClusterPanel.css";

export { clusterFilterChoices, defaultClusterFilter, type ClusterFilter } from "./clusterFilters";

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
export type LiveClusterSpot = {
  id: string; receivedAt: number; clusterName: string; spotter: string;
  spotterContinent?: string | null;
  frequencyKHz: number; frequencyText: string; callsign: string; comment: string;
  band: string; mode: string; country: string; adif?: number | null;
  continent: string; cqZone?: number | null; ituZone?: number | null;
  callStatus: string; dxccStatus: string; workedBefore?: number | null;
  specialTags: string[]; score: number; contestPoints?: number | null; contestDupe?: boolean | null;
  contestMultiplierCount?: number | null; contestCountryMultiplier?: boolean | null; contestZoneMultiplier?: boolean | null;
  scoreReasons: string[];
  aggregateCount: number; aggregateSpotters: string[]; source: string;
  statusHex: string; bandHex: string; modeHex: string;
  marked?: boolean;
  activation?: { sourceEpoch: string; spotVersion: string };
};
type Connection = { serverID: string; serverName: string; phase: string; error?: string | null };
type ConsoleEntry = { receivedAt: number; source: string; text: string; isCommand: boolean };
type Snapshot = { connectedClusters: number; loadedSpots: number; contactCount: number;
  contactRevision: number; logbookDataLoaded: boolean; countryDataLoaded: boolean; connections: Connection[];
  spots: LiveClusterSpot[]; console: ConsoleEntry[] };
type Server = { id: string; name: string; host: string; port: number; callsign: string; enabled: boolean };
type Rule = { id: string; name: string; keywords: string[]; referenceFormat: string; advancedPattern: string; enabled: boolean };
type Filter = ClusterFilter;
export type ClusterPalette = { status: Record<string, string>; band: Record<string, string>; mode: Record<string, string> };
type Palette = ClusterPalette;
type CommandPreset = { id: string; name: string; command: string };
type Configuration = { servers: Server[]; connectOnStartup: boolean; requestRecentSpotsOnConnect: boolean;
  reconnect: boolean; requestSkimmer: boolean;
  showWorkedBandModeSpots: boolean; hideWSPRSpots: boolean; maximumSpots: number; specialRules: Rule[];
  palette: Palette; filter: Filter; commandPresets: CommandPreset[]; forwardSpotsToFlex: boolean; radioSpotColorPolicy?: "callsign" | "dxcc" };
type Forwarding = { accepted_count: number; status: string };
type Response = { configuration?: Configuration; snapshot?: Snapshot; password_servers?: string[];
  password_storage_available?: boolean; flex_forwarding_available?: boolean;
  forwarding?: Forwarding; snapshot_truncated?: boolean };
type HistoryRow = { id: string; date: string; call: string; band: string; mode: string;
  rstSent: string; rstReceived: string; grid: string; lotwSent: string; lotwReceived: string; confirmed: boolean };
type History = { call: string; previous_count: number; previous: HistoryRow[]; adif?: number | null;
  country: string; cq_zone?: number | null; grid: string; dxcc_contact_count: number;
  matrix: { band: string; mode: string; worked: boolean; confirmed: boolean }[] };
type Props = { snapshot: unknown; onRequest: Request; onSelect: (spot: LiveClusterSpot) => void;
  passive?: boolean; presentationOnly?: boolean; contestPresentation?: boolean; onUndock?: () => void; onDock?: () => void; passwordControlsEnabled?: boolean; selectedSpotId?: string | null; taskOnly?: boolean;
  settingsOnly?: boolean; preferenceStorageKey?: string; onSpotContextMenu?: (spot: LiveClusterSpot,
    event: ReactMouseEvent<HTMLElement>|ReactKeyboardEvent<HTMLElement>) => void; contestBands?: readonly string[];
  contestCurrentBand?: string | null; contestBandPreferenceKey?: string; radioFrequencyHz?: number | null;
  contestWorkedFilter?: readonly string[]; onContestWorkedFilterReset?: () => void };

const { bands, modes, callStatuses, dxccStatuses } = clusterFilterChoices;
const formatDate = (value?: number | null) => value == null ? "—" : new Date((value + 978_307_200) * 1000).toLocaleString();
export const isRbnSource = (source: string) => source.trim().toLowerCase() === "rbl";
export const clusterSpotTags = (spot: Pick<LiveClusterSpot, "source" | "specialTags">): string[] =>
  [...new Set([...(isRbnSource(spot.source) ? ["RBN"] : []), ...spot.specialTags])];
export const clusterRowTint = (status: string, configured?: Record<string, string>): string | undefined =>
  status === "Unknown" ? undefined : `${paletteColor(status, configured, clusterStatusColors)}1F`;
const emptyFilter: Filter = defaultClusterFilter();
export const fullClusterColumnsKey = "xlog.integration.full-cluster-columns.v1";
const defaultColumns = () => ({ ...defaultWorkspacePreferences(), columns: compactClusterColumns.map(([id]) => id) });
const contestClusterColumns = [
  ["age", "For", 55], ["points", "Pts", 48], ["band", "Band", 55], ["frequency", "MHz", 95],
  ["callsign", "Callsign", 125], ["mode", "Mode", 58], ["country", "Country", 145], ["zone", "CQ", 48],
  ["spotter", "Spotter", 105], ["mults", "Mults", 58], ["comment", "Comment", 260],
] as const;
type ContestClusterColumn = typeof contestClusterColumns[number][0];
type ContestSort = { column: ContestClusterColumn; descending: boolean };
const defaultContestOrder=()=>contestClusterColumns.map(([id])=>id);
function readContestTablePreferences(key:string):{order:ContestClusterColumn[];sort:ContestSort[]}{
  const fallback={order:defaultContestOrder(),sort:[{column:"age" as const,descending:true}]};
  try{
    const value=JSON.parse(localStorage.getItem(key)??"null");
    if(!value||value.version!==1)return fallback;
    const valid=(id:unknown):id is ContestClusterColumn=>contestClusterColumns.some(([column])=>column===id);
    const order:ContestClusterColumn[]=Array.isArray(value.order)?value.order.filter(valid):[];
    const unique=[...new Set(order)];
    const sort:ContestSort[]=Array.isArray(value.sort)?value.sort.filter((item:ContestSort)=>item&&valid(item.column)&&typeof item.descending==="boolean").slice(0,2):[];
    return {order:[...unique,...defaultContestOrder().filter(id=>!unique.includes(id))],sort:sort.length?sort:fallback.sort};
  }catch{return fallback;}
}
function contestSortValue(spot:LiveClusterSpot,column:ContestClusterColumn):string|number|null{
  switch(column){
    case "age":return spot.receivedAt;
    case "frequency":return spot.frequencyKHz;
    case "points":return spot.contestPoints??null;
    case "zone":return spot.cqZone??null;
    case "mults":return contestNeededMultiplierCount(spot);
    default:return spot[column];
  }
}
function sortContestSpots(spots:LiveClusterSpot[],sort:ContestSort[]):LiveClusterSpot[]{
  return [...spots].sort((left,right)=>{
    for(const {column,descending} of sort){
      const a=contestSortValue(left,column),b=contestSortValue(right,column);
      if(a===null||b===null){if(a!==b)return a===null?1:-1;continue;}
      const compared=typeof a==="number"&&typeof b==="number"?a-b:String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"});
      if(compared)return descending?-compared:compared;
    }
    return left.callsign.localeCompare(right.callsign)||left.frequencyKHz-right.frequencyKHz||left.id.localeCompare(right.id);
  });
}
type ContestBandFilter = "all" | "160m" | "80m" | "40m" | "20m" | "15m" | "10m";
const contestBandFilters: readonly ContestBandFilter[] = ["all", "160m", "80m", "40m", "20m", "15m", "10m"];
const contestBandFilter = (value: string | null | undefined, available?: readonly string[]): ContestBandFilter | null =>
  contestBandFilters.includes(value as ContestBandFilter) && (value === "all" || !available?.length || available.includes(value!))
    ? value as ContestBandFilter : null;
const defaultContestBand = (current: string | null | undefined, available?: readonly string[]): ContestBandFilter =>
  contestBandFilter(current, available) ?? (available?.length === 1 ? contestBandFilter(available[0], available) : null) ?? "all";
function storedContestBand(key: string, available?: readonly string[]): ContestBandFilter | null {
  try { return contestBandFilter(localStorage.getItem(key), available); }
  catch { return null; }
}
const defaultContestColumnWidths = () => Object.fromEntries(contestClusterColumns.map(([id, , width]) => [id, width])) as Record<ContestClusterColumn, number>;
function readContestColumnWidths(raw: string | null): Record<ContestClusterColumn, number> {
  const widths = defaultContestColumnWidths();
  if (!raw || raw.length > 4096) return widths;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || value.version !== 1) return widths;
    for (const [id] of contestClusterColumns) {
      const width = value.widths?.[id];
      if (typeof width === "number" && Number.isFinite(width)) widths[id] = boundColumnWidth(width);
    }
  } catch { /* Damaged preferences never block the contest cluster. */ }
  return widths;
}
function ColumnWidthInput({ label, width, disabled, onCommit }: { label: string; width: number; disabled: boolean; onCommit: (width: number) => void }) {
  const [draft, setDraft] = useState(String(width));
  useEffect(() => { setDraft(String(width)); }, [width]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? boundColumnWidth(parsed) : width;
    setDraft(String(next)); onCommit(next);
  };
  return <input type="number" aria-label={`${label} column width`} min={48} max={480} step={10} disabled={disabled}
    value={draft} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}
export function ClusterPanel({ snapshot, onRequest, onSelect, passive = false, presentationOnly = false, contestPresentation = false, onUndock, onDock, passwordControlsEnabled = true, selectedSpotId, taskOnly = false, settingsOnly = false,
  preferenceStorageKey = fullClusterColumnsKey, onSpotContextMenu, contestBands, contestCurrentBand, contestBandPreferenceKey, radioFrequencyHz,
  contestWorkedFilter,onContestWorkedFilterReset }: Props) {
  const saveToast = useSettingsSaveToast();
  const ageClock = useSpotAgeClock();
  const panelId = useId();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnPreferences, setColumnPreferences] = useState(() => {
    const fallback = presentationOnly ? defaultWorkspacePreferences() : defaultColumns();
    try { const raw = localStorage.getItem(preferenceStorageKey); return raw ? readWorkspacePreferences(raw) : fallback; }
    catch { return fallback; }
  });
  const columnDrag = useRef<{ id: CompactColumn; x: number; width: number; scale: number } | null>(null);
  const visibleColumns = new Set(columnPreferences.columns);
  const totalColumnWidth = columnPreferences.columns.reduce((sum, id) => sum + columnPreferences.widths[id], 0);
  const resizeColumn = (id: CompactColumn, width: number) => {
    if (Number.isFinite(width)) setColumnPreferences(current => ({ ...current, widths: { ...current.widths, [id]: boundColumnWidth(width) } }));
  };
  useEffect(() => {
    try { localStorage.setItem(preferenceStorageKey, JSON.stringify(columnPreferences)); } catch { /* Keep usable in memory if storage is unavailable. */ }
  }, [columnPreferences, preferenceStorageKey]);
  const [consoleOpen, setConsoleOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(settingsOnly);
  const requestRef = useRef(onRequest);
  const filterVersion = useRef(0);
  const lastRemoteFilter = useRef("");
  const lastRemoteConfiguration = useRef("");
  const draftBaseConfiguration = useRef<Configuration | null>(null);
  const historyVersion = useRef(0);
  const historyRevision = useRef<number | null>(null);
  const [live, setLive] = useState<Snapshot | null>((snapshot as Response | null)?.snapshot ?? null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [passwordServers, setPasswordServers] = useState<string[]>([]);
  const [passwordStorageAvailable, setPasswordStorageAvailable] = useState((snapshot as Response | null)?.password_storage_available !== false);
  const [, setForwardingAvailable] = useState((snapshot as Response | null)?.flex_forwarding_available !== false);
  const canEditPasswords = passwordControlsEnabled && passwordStorageAvailable;
  const passwordUnavailableReason = !passwordStorageAvailable ? "Secure password storage is unavailable on this platform" : "Dock back to manage passwords";
  const [savedServerIDs, setSavedServerIDs] = useState<string[]>([]);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [activePicker, setActivePicker] = useState<keyof Filter | null>(null);
  const [command, setCommand] = useState("");
  const [commandTarget, setCommandTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [historySpot, setHistorySpot] = useState<LiveClusterSpot | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<LiveClusterSpot | null>(null);
  const contestColumnStorageKey = `${preferenceStorageKey}.cqwwColumns`;
  const contestTableStorageKey=`${preferenceStorageKey}.cqwwTable`;
  const [contestTable,setContestTable]=useState(()=>readContestTablePreferences(contestTableStorageKey));
  const contestColumns=contestTable.order.map(id=>contestClusterColumns.find(([column])=>column===id)!);
  const reorderedColumn=useRef<ContestClusterColumn|null>(null);
  const moveContestColumn=(from:ContestClusterColumn,to:ContestClusterColumn)=>setContestTable(current=>{
    const order=current.order.filter(id=>id!==from);order.splice(current.order.indexOf(to),0,from);return {...current,order};
  });
  const sortContestColumn=(column:ContestClusterColumn,secondary:boolean)=>{
    setContestTable(current=>{
      const old=current.sort.find(item=>item.column===column),next={column,descending:old?!old.descending:column==="age"};
      return {...current,sort:secondary&&current.sort[0].column!==column?[current.sort[0],next]:[next]};
    });setSpotPage(0);
  };
  useEffect(()=>{if(contestPresentation)try{localStorage.setItem(contestTableStorageKey,JSON.stringify({version:1,...contestTable}));}catch{/* Retain in memory. */}},[contestTable,contestTableStorageKey,contestPresentation]);
  const [contestColumnWidths, setContestColumnWidths] = useState(() => {
    try { return readContestColumnWidths(localStorage.getItem(contestColumnStorageKey)); }
    catch { return defaultContestColumnWidths(); }
  });
  const contestColumnDrag = useRef<{ id: ContestClusterColumn; x: number; width: number; scale: number } | null>(null);
  const contestTotalColumnWidth = contestClusterColumns.reduce((sum, [id]) => sum + contestColumnWidths[id], 0);
  const resizeContestColumn = (id: ContestClusterColumn, width: number) => {
    if (Number.isFinite(width)) setContestColumnWidths(current => ({ ...current, [id]: boundColumnWidth(width) }));
  };
  const showWorkedStorageKey = `${preferenceStorageKey}.showWorked`;
  const [storedShowWorked, setShowWorked] = useState(() => {
    if (!contestPresentation) return true;
    try { return localStorage.getItem(showWorkedStorageKey) === "true"; } catch { return false; }
  });
  const showWorked=contestPresentation&&contestWorkedFilter?.length?contestWorkedFilter.includes("Worked before"):storedShowWorked;
  const [contestOpportunities,setContestOpportunities]=useState<"all"|"mults">("all");
  const workedFilterSignature=contestWorkedFilter?.join("|")??"";
  useEffect(()=>{
    if(!contestPresentation||!contestWorkedFilter?.length)return;
    const includesWorked=contestWorkedFilter.includes("Worked before");setShowWorked(includesWorked);
    if(includesWorked)setContestOpportunities("all");
  },[contestPresentation,workedFilterSignature]);
  const contestBandStorageKey = contestBandPreferenceKey ?? `${preferenceStorageKey}.cqwwBand`;
  const initialStoredContestBand = useRef(storedContestBand(contestBandStorageKey, contestBands));
  const contestBandWasChosen = useRef(initialStoredContestBand.current !== null);
  const previousContestBandStorageKey = useRef(contestBandStorageKey);
  const [contestBand, setContestBand] = useState<ContestBandFilter>(() =>
    initialStoredContestBand.current ?? defaultContestBand(contestCurrentBand, contestBands));
  const contestBandOptions=contestBandFilters.filter(band=>band==="all"||!contestBands?.length||contestBands.includes(band));
  const [, setForwarding] = useState<Forwarding | null>(null);
  const [snapshotTruncated, setSnapshotTruncated] = useState(false);
  const tableArea = useRef<HTMLDivElement>(null);
  const [spotPage, setSpotPage] = useState(0);
  const contestBandSpots=(live?.spots??[]).filter(spot=>contestBand==="all"||spot.band===contestBand);
  const contestNeededSpots=contestBandSpots.filter(spot=>!contestBandMapSpotWorked(spot));
  const contestSummary=contestNeededSpots.reduce((summary,spot)=>{
    const multiplierCount=contestNeededMultiplierCount(spot);
    if(multiplierCount===0)summary.qsos+=1;
    if(multiplierCount!==null&&multiplierCount>0)summary.mults+=1;
    if(spot.contestCountryMultiplier===true)summary.countries+=1;
    if(spot.contestZoneMultiplier===true)summary.zones+=1;
    const band=summary.bands.get(spot.band)??{qsos:0,mults:0};
    if(multiplierCount===0)band.qsos+=1;
    if(multiplierCount!==null&&multiplierCount>0)band.mults+=1;
    summary.bands.set(spot.band,band);return summary;
  },{qsos:0,mults:0,countries:0,zones:0,bands:new Map<string,{qsos:number;mults:number}>()});
  const filteredSpots = contestPresentation
    ? contestOpportunities==="mults"?contestNeededSpots.filter(spot=>(contestNeededMultiplierCount(spot)??0)>0)
      : showWorked?contestBandSpots:contestNeededSpots
    : live?.spots ?? [];
  const presentedSpots=useMemo(()=>contestPresentation?sortContestSpots(filteredSpots,contestTable.sort):filteredSpots,[contestPresentation,filteredSpots,contestTable.sort]);
  const currentVfoSpot=typeof radioFrequencyHz==="number"&&Number.isFinite(radioFrequencyHz)
    ?presentedSpots.filter(spot=>Math.abs(spot.frequencyKHz*1000-radioFrequencyHz)<=500)
      .sort((a,b)=>Math.abs(a.frequencyKHz*1000-radioFrequencyHz)-Math.abs(b.frequencyKHz*1000-radioFrequencyHz)||b.receivedAt-a.receivedAt)[0]?.id:null;
  const pageSize = useLogbookCapacity(tableArea, presentationOnly ? presentedSpots.length : 0);
  const spotCount = presentedSpots.length;
  const pageCount = Math.max(1, Math.ceil(spotCount / pageSize));
  const currentSpotPage = presentationOnly ? Math.min(spotPage, pageCount - 1) : 0;
  const firstSpotIndex = currentSpotPage * pageSize;
  const visibleSpots = presentationOnly ? presentedSpots.slice(firstSpotIndex, firstSpotIndex + pageSize) : presentedSpots;

  useEffect(() => {
    const next = snapshot as Response | null;
    if (next?.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
    if (next?.snapshot) setLive(next.snapshot);
    if (next?.configuration) {
      const remoteConfiguration = JSON.stringify(next.configuration);
      const localConfiguration = configuration ? JSON.stringify(configuration) : "";
      if (!configuration || localConfiguration === lastRemoteConfiguration.current || localConfiguration === remoteConfiguration) {
        setConfiguration(next.configuration);
        draftBaseConfiguration.current = next.configuration;
        setSavedServerIDs(next.configuration.servers.map(server => server.id));
        setPasswordServers(next.password_servers ?? []);
      }
      lastRemoteConfiguration.current = remoteConfiguration;
      const remoteFilter = JSON.stringify(next.configuration.filter);
      if (remoteFilter !== lastRemoteFilter.current) {
        lastRemoteFilter.current = remoteFilter;
        setFilter(normalizeClusterFilter(next.configuration.filter));
      }
    }
    if (next?.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
  }, [snapshot]);
  useEffect(() => { requestRef.current = onRequest; }, [onRequest]);
  useEffect(() => {
    if (!contestPresentation) return;
    try { localStorage.setItem(showWorkedStorageKey, String(showWorked)); } catch { /* Keep usable in memory if storage is unavailable. */ }
  }, [contestPresentation, showWorked, showWorkedStorageKey]);
  useEffect(()=>{
    const current=defaultContestBand(contestCurrentBand,contestBands);
    if(previousContestBandStorageKey.current!==contestBandStorageKey){
      previousContestBandStorageKey.current=contestBandStorageKey;
      const stored=storedContestBand(contestBandStorageKey,contestBands);
      contestBandWasChosen.current=stored!==null;
      setContestBand(stored??current);
      setSpotPage(0);
      return;
    }
    if(!contestBandWasChosen.current){
      try{if(localStorage.getItem(contestBandStorageKey)!==null&&storedContestBand(contestBandStorageKey,contestBands)===null)
        localStorage.removeItem(contestBandStorageKey);}catch{/* An unavailable preference store must not block spots. */}
    }
    if(!contestBandOptions.includes(contestBand)){
      contestBandWasChosen.current=false;
      try{localStorage.removeItem(contestBandStorageKey);}catch{/* An unavailable preference store must not block spots. */}
      setContestBand(current);return;
    }
    if(!contestBandWasChosen.current&&contestBand!==current)setContestBand(current);
  },[contestBand,contestBandOptions,contestCurrentBand,contestBands,contestBandStorageKey]);
  useEffect(() => {
    if (!contestPresentation) return;
    try { localStorage.setItem(contestColumnStorageKey, JSON.stringify({ version: 1, widths: contestColumnWidths })); }
    catch { /* Keep usable in memory if storage is unavailable. */ }
  }, [contestColumnStorageKey, contestColumnWidths, contestPresentation]);
  useEffect(() => {
    if (spotPage !== currentSpotPage) setSpotPage(currentSpotPage);
  }, [currentSpotPage, spotPage]);
  useEffect(() => {
    if (selectedSpotId === undefined) return;
    setSelectedSpot(live?.spots.find(spot => spot.id === selectedSpotId) ?? null);
  }, [selectedSpotId, live?.spots]);
  useEffect(() => {
    if (passive) return;
    let active = true;
    requestRef.current("cluster_snapshot", {}).then((raw) => {
      if (!active) return;
      const next = raw as Response;
      if (next.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
      if (next.flex_forwarding_available != null) setForwardingAvailable(next.flex_forwarding_available);
      if (next.configuration) { setConfiguration(next.configuration); draftBaseConfiguration.current = next.configuration; lastRemoteConfiguration.current = JSON.stringify(next.configuration); setFilter(normalizeClusterFilter(next.configuration.filter)); setSavedServerIDs(next.configuration.servers.map((s) => s.id)); }
      if (next.snapshot) setLive(next.snapshot);
      setPasswordServers(next.password_servers ?? []);
      if (next.forwarding) setForwarding(next.forwarding);
      if (next.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
    }).catch(() => { if (active) setError("Cluster state is unavailable. Check the worker and retry."); });
    const timer = window.setInterval(() => {
      requestRef.current("cluster_snapshot", {}).then((raw) => {
        if (active && (raw as Response).password_storage_available != null) setPasswordStorageAvailable((raw as Response).password_storage_available!);
        if (active && (raw as Response).flex_forwarding_available != null) setForwardingAvailable((raw as Response).flex_forwarding_available!);
        if (active && (raw as Response).snapshot) {
          setLive((raw as Response).snapshot ?? null);
          if ((raw as Response).forwarding) setForwarding((raw as Response).forwarding ?? null);
          if ((raw as Response).snapshot_truncated != null) setSnapshotTruncated((raw as Response).snapshot_truncated ?? false);
        }
      }).catch(() => {});
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [passive]);

  const accept = (raw: unknown) => {
    const next = raw as Response;
    if (next.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
    if (next.flex_forwarding_available != null) setForwardingAvailable(next.flex_forwarding_available);
    if (next.configuration) { setConfiguration(next.configuration); draftBaseConfiguration.current = next.configuration; lastRemoteConfiguration.current = JSON.stringify(next.configuration); }
    if (next.snapshot) setLive(next.snapshot);
    if (next.password_servers) setPasswordServers(next.password_servers);
    if (next.forwarding) setForwarding(next.forwarding);
    if (next.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
  };
  const request = async (method: string, params: Record<string, unknown> = {}, success = ""): Promise<boolean> => {
    setBusy(true); setError(""); setMessage("");
    try {
      accept(await onRequest(method, params));
      if (success) method === "cluster_password_set" ? saveToast.show(success) : setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cluster request failed. Check settings and retry.");
      return false;
    } finally { setBusy(false); }
  };
  const changeFilter = (next: Filter) => {
    setFilter(next);
    setConfiguration(current => current ? { ...current, filter: next } : current);
    const version = ++filterVersion.current;
    onRequest("cluster_filter", { filter: next }).then((raw) => {
      if (version === filterVersion.current && (raw as Response).snapshot) setLive((raw as Response).snapshot ?? null);
    }).catch(() => { if (version === filterVersion.current) setError("Could not apply cluster filters."); });
  };
  const saveConfig = async () => {
    if (!configuration) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const base = draftBaseConfiguration.current;
      if (!base) throw new Error("Current cluster settings are unavailable. Refresh and retry.");
      accept(await onRequest("cluster_configure", { configuration, base_configuration: base }));
      setSavedServerIDs(configuration.servers.map((server) => server.id));
      saveToast.show("Cluster settings saved. Received spots retained.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cluster settings could not be saved. Check settings and retry.");
    } finally { setBusy(false); }
  };
  const updateServer = (id: string, patch: Partial<Server>) => {
    setConfiguration((current) => current && ({ ...current, servers: current.servers.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  };
  const openHistory = async (spot: LiveClusterSpot) => {
    const version = ++historyVersion.current;
    setHistorySpot(spot);
    setError("");
    try {
      const result = await onRequest("cluster_history", { call: spot.callsign,
        ...(spot.adif ? { adif: spot.adif } : {}) }) as { history?: History };
      if (version === historyVersion.current && result.history) setHistory(result.history);
    } catch { if (version === historyVersion.current) setError("Previous QSOs are unavailable. Open the integrated logbook workspace first."); }
  };
  useEffect(() => {
    const revision = live?.contactRevision;
    if (revision == null) return;
    if (historyRevision.current != null && revision !== historyRevision.current && historySpot) {
      void openHistory(historySpot);
    }
    historyRevision.current = revision;
  }, [live?.contactRevision, historySpot]);
  const allConnections = live?.connections ?? [];
  const connected = live?.connectedClusters ?? 0;
  const specialNames = ["RBN", ...(configuration?.specialRules.filter((r) => r.enabled && r.name.toUpperCase() !== "RBN").map((r) => r.name) ?? [])];
  const filterOptions: Partial<Record<keyof Filter, string[]>> = {
    bands, modes, continents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
    spotterContinents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
    callStatuses, dxccStatuses, specials: specialNames,
    sources: ["cluster", "rbl"], worked: ["Worked before", "Not worked"],
  };
  const filterLabels: Partial<Record<keyof Filter, string>> = {
    bands: "Bands", modes: "Modes", continents: "DX continent", spotterContinents: "Spotter continent", callStatuses: "Call status",
    dxccStatuses: "DXCC status", specials: "Special", sources: "Source", worked: "Worked",
  };

  if (settingsOnly) return <section className="live-cluster" aria-label="DX Cluster settings">
    {error && <p className="live-cluster-error" role="alert">{error}</p>}
    {message && <p className="live-cluster-message" role="status">{message}</p>}{saveToast.toast}
    {renderToolbarPanels()}
  </section>;

  return <section className={`live-cluster${presentationOnly ? " is-contest-terminal" : ""}${contestPresentation ? " is-cqww-contest" : ""}`} aria-label="Live DX Cluster">
    <header className="live-cluster-head">
      <div>{!taskOnly && <h2>DX Cluster</h2>}<p>{contestPresentation
        ? <span aria-label="CQ WW opportunity totals">QSO {contestSummary.qsos} · Mults {contestSummary.mults} · Country {contestSummary.countries} · Zone {contestSummary.zones}</span>
        : presentationOnly ? `${connected} live · ${spotCount} shown / ${live?.loadedSpots ?? 0} received` : `${connected} live · ${live?.spots.length ?? 0} shown / ${live?.loadedSpots ?? 0} received · ${live?.contactCount ?? 0} log contacts`}</p></div>
      {contestPresentation && <div className="live-cluster-contest-controls"><label>Band <select aria-label="CQ WW band" value={contestBand}
        onChange={event=>{const next=event.currentTarget.value as ContestBandFilter;contestBandWasChosen.current=true;setContestBand(next);setSpotPage(0);
          try{localStorage.setItem(contestBandStorageKey,next);}catch{/* Keep the explicit choice in memory when storage is unavailable. */}}}>{contestBandOptions.map(band=><option key={band} value={band}>{band==="all"?"All":band.replace("m","")}</option>)}</select></label>
        <label>Show <select aria-label="CQ WW opportunities" value={contestOpportunities}
        onChange={event=>{setContestOpportunities(event.currentTarget.value as "all"|"mults");setSpotPage(0);}}><option value="all">Needed Qs + Mults</option><option value="mults">Mults only</option></select></label>
        <label className="live-cluster-show-worked"><input type="checkbox" checked={showWorked} disabled={contestOpportunities==="mults"}
          onChange={event => {setShowWorked(event.currentTarget.checked);onContestWorkedFilterReset?.();setSpotPage(0);}} /> Show worked</label>
        <details className="contest-cluster-filter-details"><summary>Filter details</summary><div aria-label="Contest cluster filter counts">
          <p>Counts start after upstream cluster filters and expiry.</p><dl>
            <dt>Supplied rows</dt><dd>{live?.spots.length??0}</dd>
            <dt>Outside selected band</dt><dd>{(live?.spots.length??0)-contestBandSpots.length}</dd>
            <dt>Worked hidden</dt><dd>{showWorked&&contestOpportunities!=="mults"?0:contestBandSpots.length-contestNeededSpots.length}</dd>
            <dt>Not a requested multiplier</dt><dd>{contestOpportunities==="mults"?contestNeededSpots.length-presentedSpots.length:0}</dd>
            <dt>Matching rows</dt><dd>{presentedSpots.length}</dd><dt>On this page</dt><dd>{visibleSpots.length}</dd>
          </dl></div></details></div>}
      {!presentationOnly && <div className="live-cluster-actions">
        <div className="live-cluster-connection-summary" role="status" aria-label="Cluster connections">{allConnections.length ? allConnections.map(connection => {
          const phase = connection.phase.toLowerCase(), label = phase.charAt(0).toUpperCase() + phase.slice(1);
          return <span key={connection.serverID} className={phase === "connected" ? "live-cluster-connected" : "live-cluster-disconnected"}><i className={`phase-${phase}`} />{connection.serverName} · {label}{connection.error && <small className="live-cluster-connection-error"> · {connection.error}</small>}</span>;
        }) : <span className={connected ? "live-cluster-connected" : "live-cluster-disconnected"}>{connected ? `${connected} cluster${connected === 1 ? "" : "s"} · Connected` : "Disconnected"}</span>}</div>
        <button type="button" disabled={busy || !configuration?.servers.some((s) => s.enabled)} onClick={() => void request("cluster_connect", {}, "Connecting to configured clusters…")}>Connect</button>
        <button type="button" disabled={busy || !live?.connections?.length} onClick={() => void request("cluster_disconnect", {}, "Disconnected")}>Disconnect</button>
        <button type="button" disabled={busy} onClick={() => void request("cluster_snapshot")}>Refresh</button>
        <button type="button" aria-expanded={consoleOpen} aria-controls={`${panelId}-console`} onClick={() => setConsoleOpen(value => !value)}>Console</button>
        <button type="button" aria-expanded={settingsOpen} aria-controls={`${panelId}-settings`} onClick={() => setSettingsOpen(value => !value)}>Settings</button>
        {onUndock && <button type="button" onClick={onUndock}>Undock</button>}
        {onDock && <button type="button" onClick={onDock}>Dock back</button>}
      </div>}
    </header>
    {contestPresentation&&contestSummary.bands.size>0&&<div className="live-cluster-contest-band-summary" aria-label="CQ WW opportunities by band">
      {[...contestSummary.bands].sort(([left],[right])=>Number.parseInt(right)-Number.parseInt(left)).map(([band,total])=><span key={band}><strong>{band}</strong> {total.qsos} Q / {total.mults} M</span>)}
    </div>}
    {!presentationOnly && !live?.logbookDataLoaded && <p className="live-cluster-note">No integrated logbook is open; worked and confirmed status remains Unknown.</p>}
    {!presentationOnly && !live?.countryDataLoaded && <p className="live-cluster-note">Country reference data is unavailable; DXCC status stays Unknown.</p>}
    {!presentationOnly && snapshotTruncated && <p className="live-cluster-note">The live snapshot exceeded the worker limit; older console lines or spots are hidden. Narrow filters to view more.</p>}
    {error && <p className="live-cluster-error" role="alert">{error}</p>}
    {message && <p className="live-cluster-message" role="status">{message}</p>}{saveToast.toast}
    {!presentationOnly && renderToolbarPanels()}

    {!presentationOnly && <div className="live-cluster-filter-container"><div className="live-cluster-filterrail" aria-label="Spot filters">
      <input aria-label="Search spots" placeholder="Callsign, country or note" value={filter.query} maxLength={128}
        onChange={(event) => changeFilter({ ...filter, query: event.target.value })} />
      {(Object.keys(filterLabels) as (keyof Filter)[]).map((key) => {
        const values = (filter[key] as string[] | undefined) ?? [];
        const excludedCount = key === "specials" ? (filter.excludedSpecials ?? []).length : 0;
        return <button type="button" key={key} data-filter={key} aria-expanded={activePicker === key}
          onClick={() => setActivePicker(activePicker === key ? null : key)}>
          {filterLabels[key]}{key === "specials" && (values.length || excludedCount) ? ` · +${values.length} / −${excludedCount}`
            : values.length && !(key === "sources" && values.length === 2) ? ` · ${values.length}` : ""}
        </button>;
      })}
      <select data-filter="sort" aria-label="Sort spots" value={filter.sort} onChange={(event) => changeFilter({ ...filter, sort: event.target.value })}>
        <option value="newest">Newest</option><option value="score">Score</option><option value="frequency">Frequency</option><option value="callsign">Callsign</option>
      </select>
      <button type="button" onClick={() => changeFilter(emptyFilter)}>Clear filters</button>
      <button type="button" aria-expanded={columnsOpen} aria-controls={`${panelId}-columns`} onClick={() => setColumnsOpen(value => !value)}>Columns</button>
    </div>
    {activePicker && filterOptions[activePicker] && <div className="live-cluster-picker" role="group" aria-label={filterLabels[activePicker]}>
      <div><strong>{filterLabels[activePicker]}</strong><button type="button" onClick={() => setActivePicker(null)}>Done</button></div>
      {activePicker === "sources" && <p className="live-cluster-picker-note" role="note">RBN reception is controlled in Cluster settings. Source visibility also follows the selected band and mode filters.</p>}
      <div className="live-cluster-picker-options">
        {activePicker === "specials" ? <SpecialFilterOptions filter={filter} options={filterOptions.specials ?? []} onChange={changeFilter} />
          : filterOptions[activePicker]?.map((option) => {
          const selected = filter[activePicker] as string[];
          return <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => {
            const next = event.target.checked ? [...selected, option] : selected.filter((value) => value !== option);
            changeFilter({ ...filter, [activePicker]: next });
          }} />{option === "rbl" ? "RBN / Skimmer" : option === "cluster" ? "DX Cluster" : option}</label>;
        })}
      </div>
      <button type="button" onClick={() => changeFilter(activePicker === "specials"
        ? { ...filter, specials: [], excludedSpecials: [] }
        : { ...filter, [activePicker]: activePicker === "sources" ? ["cluster", "rbl"] : [] })}>All</button>
    </div>}</div>}

    {!presentationOnly && columnsOpen && <section id={`${panelId}-columns`} className="live-cluster-columns" aria-label="Full cluster columns">
      <div className="live-cluster-column-fields">{compactClusterColumns.map(([id, label]) => <div key={id}>
        <label><input type="checkbox" aria-label={`Show ${label} column`} checked={visibleColumns.has(id)} disabled={visibleColumns.size === 1 && visibleColumns.has(id)}
          onChange={event => { const checked = event.target.checked; setColumnPreferences(current => ({ ...current, columns: compactClusterColumns.map(([key]) => key).filter(key => key === id ? checked : current.columns.includes(key)) })); }} />{label}</label>
        <ColumnWidthInput label={label} width={columnPreferences.widths[id]} disabled={!visibleColumns.has(id)} onCommit={width => resizeColumn(id, width)} />
      </div>)}</div>
      <div className="live-cluster-column-actions"><span>Drag column edges or use arrow keys. Widths scale to fit the window.</span><button type="button" onClick={() => setColumnPreferences(defaultColumns())}>Reset columns</button><button type="button" onClick={() => setColumnsOpen(false)}>Done</button></div>
    </section>}
    <div ref={tableArea} className="table-scroll live-cluster-table">{contestPresentation ? <table className="live-cluster-contest-table" aria-label="CQ WW contest cluster spots"><colgroup>
      {contestColumns.map(([id])=><col key={id} className={`contest-col-${id}`} style={{width:`${contestColumnWidths[id]/contestTotalColumnWidth*100}%`}}/>)}
    </colgroup><thead><tr>{contestColumns.map(([id,label])=>{const sortIndex=contestTable.sort.findIndex(item=>item.column===id),sort=contestTable.sort[sortIndex];return <th key={id}
      className={`contest-col-${id}`} aria-sort={sortIndex===0?(sort.descending?"descending":"ascending"):undefined}
      draggable onDragStart={event=>{reorderedColumn.current=id;event.dataTransfer.setData("text/plain",id);}}
      onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(reorderedColumn.current)moveContestColumn(reorderedColumn.current,id);reorderedColumn.current=null;}}
      onDragEnd={()=>{reorderedColumn.current=null;}}>
      <button type="button" className="contest-column-sort" aria-label={`Sort by ${label}`} title="Click to sort; Shift-click for secondary sort. Drag to reorder, or use Alt+Left/Right."
        onClick={event=>sortContestColumn(id,event.shiftKey)} onKeyDown={event=>{
          if(event.altKey&&(event.key==="ArrowLeft"||event.key==="ArrowRight")){event.preventDefault();const index=contestTable.order.indexOf(id)+(event.key==="ArrowRight"?1:-1);const target=contestTable.order[index];if(target)moveContestColumn(id,target);}
        }}>{label}{sort&&<small aria-label={`${sortIndex===0?"Primary":"Secondary"} ${sort.descending?"descending":"ascending"} sort`}> {sort.descending?"▼":"▲"}{sortIndex+1}</small>}</button>
      <span className="live-cluster-column-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${label} column`}
        aria-valuemin={48} aria-valuemax={480} aria-valuenow={contestColumnWidths[id]}
        onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);contestColumnDrag.current={id,x:event.clientX,width:contestColumnWidths[id],scale:contestColumnWidths[id]/Math.max(1,event.currentTarget.parentElement!.getBoundingClientRect().width)};}}
        onPointerMove={event=>{const drag=contestColumnDrag.current;if(drag?.id===id)resizeContestColumn(id,drag.width+(event.clientX-drag.x)*drag.scale);}}
        onPointerUp={()=>{contestColumnDrag.current=null;}} onPointerCancel={()=>{contestColumnDrag.current=null;}} onLostPointerCapture={()=>{contestColumnDrag.current=null;}}
        onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();resizeContestColumn(id,event.key==="Home"?48:event.key==="End"?480:contestColumnWidths[id]+(event.key==="ArrowRight"?10:-10));}}/>
    </th>;})}</tr></thead>
    <tbody>{visibleSpots.map((spot,index)=><tr key={spot.id} tabIndex={0}
      className={`${(selectedSpotId ?? selectedSpot?.id) === spot.id ? "is-selected" : ""}${spot.id===currentVfoSpot?" is-current-vfo":""}${spot.marked ? " is-marked" : ""} ${index % 2 ? "is-odd" : "is-even"}`}
      onClick={()=>{setSelectedSpot(spot);onSelect(spot);}} onContextMenu={event=>onSpotContextMenu?.(spot,event)}
      onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelectedSpot(spot);onSelect(spot);}
        else if(event.key==="ContextMenu"||event.shiftKey&&event.key==="F10")onSpotContextMenu?.(spot,event);}}
      aria-label={`${spot.callsign}${spot.marked?" marked":""} spot`} title="Load this spot into the contest draft and tune the selected radio">
      {contestColumns.map(([id])=>{
        switch(id){
        case "age":return <td key={id} className="mono live-cluster-age" title={`Received ${formatDate(spot.receivedAt)}`}>{formatSpotAge(spot.receivedAt,ageClock)}</td>;
        case "points":return <td key={id}><span className="live-cluster-score">{spot.contestPoints??"—"}</span></td>;
        case "band":return <td key={id}>{spot.band}</td>;
        case "frequency":return <td key={id} className="cyan mono">{spot.id===currentVfoSpot&&<span className="contest-vfo-indicator" aria-label="Current VFO">▶ </span>}{(spot.frequencyKHz/1000).toFixed(6)}</td>;
        case "callsign":return <td key={id} className="contest-col-callsign"><span className={`live-cluster-call${contestBandMapSpotPending(spot)?" is-pending":""}`} title={contestBandMapSpotPending(spot)?"Classification pending":undefined} style={{color:contestBandMapSpotColor(spot)}}>{spot.marked&&<span className="live-cluster-mark" aria-label="Marked">★ </span>}{spot.callsign}</span></td>;
        case "mode":return <td key={id}>{spot.mode}</td>;
        case "country":return <td key={id} className="contest-col-country" title={countryDisplay(spot.country)}>{countryDisplay(spot.country)}</td>;
        case "zone":return <td key={id}>{spot.cqZone??"—"}</td>;
        case "spotter":return <td key={id} className="contest-col-spotter" title={`${isRbnSource(spot.source)?"RBN":"DX Cluster"} · ${spot.clusterName}`}>{spot.aggregateCount>1?`${spot.spotter} +${spot.aggregateCount-1}`:spot.spotter}</td>;
        case "mults":return <td key={id} title={spot.contestCountryMultiplier===true&&spot.contestZoneMultiplier===true?"Needed country and CQ zone multipliers":
        spot.contestCountryMultiplier===true?"Needed country multiplier":spot.contestZoneMultiplier===true?"Needed CQ zone multiplier":
        spot.contestCountryMultiplier===false&&spot.contestZoneMultiplier===false?"No needed multiplier":"Multiplier classification unavailable"}>
        {contestBandMapMultiplierLabel(spot)}</td>;
        case "comment":return <td key={id} className="contest-col-comment" title={spot.comment}>{spot.comment||"—"}</td>;
        }
      })}
    </tr>)}</tbody></table> : <table aria-label="Live cluster spots"><colgroup>{columnPreferences.columns.map(id => <col key={id} style={{ width: `${columnPreferences.widths[id] / totalColumnWidth * 100}%` }} />)}</colgroup><thead><tr>
      {compactClusterColumns.filter(([id]) => visibleColumns.has(id)).map(([id, label]) => <th key={id} aria-label={id === "callStatus" || id === "dxccStatus" ? label : undefined}
        className={id === "callStatus" || id === "dxccStatus" ? "live-cluster-status-column" : undefined}><span title={label}>{compactClusterHeader(id)}</span>
        <span className="live-cluster-column-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${label} column`} aria-valuemin={48} aria-valuemax={480} aria-valuenow={columnPreferences.widths[id]}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); columnDrag.current = { id, x: event.clientX, width: columnPreferences.widths[id], scale: columnPreferences.widths[id] / Math.max(1, event.currentTarget.parentElement!.getBoundingClientRect().width) }; }}
          onPointerMove={event => { const drag = columnDrag.current; if (drag?.id === id) resizeColumn(id, drag.width + (event.clientX - drag.x) * drag.scale); }}
          onPointerUp={() => { columnDrag.current = null; }} onPointerCancel={() => { columnDrag.current = null; }} onLostPointerCapture={() => { columnDrag.current = null; }}
          onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); resizeColumn(id, event.key === "Home" ? 48 : event.key === "End" ? 480 : columnPreferences.widths[id] + (event.key === "ArrowRight" ? 10 : -10)); }} />
      </th>)}
    </tr></thead><tbody>{visibleSpots.map((spot, index) => { const displayedScore=presentationOnly?spot.contestPoints:spot.score; return <tr key={spot.id}
      tabIndex={0}
      className={`${(selectedSpotId ?? selectedSpot?.id) === spot.id ? "is-selected" : ""}${spot.marked ? " is-marked" : ""} ${index % 2 ? "is-odd" : "is-even"}`}
      style={{ backgroundColor: presentationOnly || (selectedSpotId ?? selectedSpot?.id) === spot.id ? undefined : clusterRowTint(spot.dxccStatus, configuration?.palette.status) }}
      onClick={() => { setSelectedSpot(spot); onSelect(spot); }} onContextMenu={event => onSpotContextMenu?.(spot, event)}
      onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();setSelectedSpot(spot);onSelect(spot);}
        else if(event.key==="ContextMenu"||event.shiftKey&&event.key==="F10")onSpotContextMenu?.(spot,event);}}
      aria-label={`${spot.callsign}${spot.marked?" marked":""} spot`}
      title={presentationOnly ? "Load this spot into the contest draft and tune the selected radio" : "Load this spot into the logger and tune through xCat"}>
      <td hidden={!visibleColumns.has("time")} className="mono live-cluster-age live-cluster-age-strip"
        style={{ backgroundColor: presentationOnly ? undefined : spotAgeColor(spot.receivedAt, ageClock) }} title={`Received ${formatDate(spot.receivedAt)}`}>{formatSpotAge(spot.receivedAt, ageClock)}</td>
      <td hidden={!visibleColumns.has("score")}><span className={`live-cluster-score ${(displayedScore??0) >= 80 ? "priority" : (displayedScore??0) >= 55 ? "high" : (displayedScore??0) >= 30 ? "medium" : "low"}`}>{displayedScore??"—"}</span></td>
      <td hidden={!visibleColumns.has("band")}><span className="live-cluster-category" style={{ color: paletteColor(spot.band, configuration?.palette.band, clusterBandColors) }}>{spot.band}</span></td>
      <td hidden={!visibleColumns.has("frequency")} className="cyan mono">{(spot.frequencyKHz / 1000).toFixed(6)}</td>
      <td hidden={!visibleColumns.has("callsign")}>{presentationOnly ? <span className="live-cluster-call">{spot.marked && <span className="live-cluster-mark" aria-label="Marked">★ </span>}{spot.callsign}</span>
        : <button type="button" className="call-button live-cluster-call" onClick={(event) => { event.stopPropagation(); void openHistory(spot); }} title="Show previous QSOs">{spot.callsign}</button>}</td>
      <td hidden={!visibleColumns.has("mode")}><span className="live-cluster-category" style={{ color: paletteColor(spot.mode, configuration?.palette.mode, clusterModeColors) }}>{spot.mode}</span></td>
      <td hidden={!visibleColumns.has("country")} title={countryDisplay(spot.country)}>{countryDisplay(spot.country)}</td><td hidden={!visibleColumns.has("cq")}>{spot.cqZone ?? "—"}</td>
      <td hidden={!visibleColumns.has("spotter")} title={`${isRbnSource(spot.source) ? "RBN" : "DX Cluster"} · ${spot.clusterName}`}>{spot.aggregateCount > 1 ? `${spot.spotter} +${spot.aggregateCount - 1}` : spot.spotter}</td>
      <td hidden={!visibleColumns.has("callStatus")} title={spot.callStatus} className="live-cluster-status live-cluster-status-column" style={{ color: paletteColor(spot.callStatus, configuration?.palette.status, clusterStatusColors) }}>{clusterStatusCode(spot.callStatus)}</td>
      <td hidden={!visibleColumns.has("dxccStatus")} title={spot.dxccStatus} className="live-cluster-status live-cluster-status-column" style={{ color: paletteColor(spot.dxccStatus, configuration?.palette.status, clusterStatusColors) }}>{clusterStatusCode(spot.dxccStatus)}</td>
      <td hidden={!visibleColumns.has("special")} className="live-cluster-special">{clusterSpotTags(spot).length
        ? clusterSpotTags(spot).slice(0, 2).map(tag => <span className="live-cluster-special-tag" style={specialTagColors(tag)} key={tag}>{tag}</span>)
        : "—"}</td>
      <td hidden={!visibleColumns.has("workedBefore")} title={formatDate(spot.workedBefore)} className="live-cluster-worked-before">{spot.workedBefore == null ? "—" : `✓ ${formatDate(spot.workedBefore)}`}</td>
      <td hidden={!visibleColumns.has("comment")} title={spot.comment}>{spot.comment || "—"}</td>
    </tr>;})}</tbody></table>}
      {!spotCount && <p className="empty">{contestPresentation && (live?.spots.length??0)>0 ? "No needed CQ WW spots. Enable Show worked to include duplicates." : presentationOnly ? connected ? "No shared cluster spots are available." : "No shared spots. Use Connect above to receive live spots." : connected ? "No live spots match the current filters." : configuration?.servers.some(server => server.enabled) ? "Your cluster is configured. Use Connect to resume live spots; the radio can remain offline." : "Configure a cluster, then connect to receive live spots."}</p>}
    </div>
    {presentationOnly && <footer className={`live-cluster-terminal-status ${connected ? "is-connected" : "is-disconnected"}`}>
      <span role="status" aria-label="Contest cluster connection">{connected ? `Connected · ${connected} cluster${connected === 1 ? "" : "s"}` : "Disconnected"}</span>
      <nav aria-label="Cluster pages"><button type="button" disabled={currentSpotPage === 0} onClick={() => setSpotPage(currentSpotPage - 1)}>Previous</button>
        <output aria-label="Cluster page">{spotCount ? `${firstSpotIndex + 1}–${Math.min(firstSpotIndex + pageSize, spotCount)} of ${spotCount}` : "0 spots"}</output>
        <button type="button" disabled={currentSpotPage + 1 >= pageCount} onClick={() => setSpotPage(currentSpotPage + 1)}>Next</button></nav>
    </footer>}
    {selectedSpot && <div className="live-cluster-inspector" aria-label="Selected spot details">
      <div><strong>{selectedSpot.callsign}</strong><span>{countryDisplay(selectedSpot.country)}</span></div>
      <div><small>Frequency</small><span>{(selectedSpot.frequencyKHz / 1000).toFixed(6)} MHz</span></div>
      <div><small>Path</small><span>{selectedSpot.spotter} · {selectedSpot.clusterName}</span></div>
      <div><small>Priority</small><span>{selectedSpot.score} · {selectedSpot.scoreReasons.join(", ") || "No score reasons"}</span></div>
      <div><small>Comment</small><span>{selectedSpot.comment || "No cluster comment"}</span></div>
    </div>}

    {history && <aside className="live-cluster-history" aria-label={`Previous QSOs for ${history.call}`}>
      <div><h3>Previous QSOs · {history.call}</h3><button type="button" onClick={() => { historyVersion.current += 1; setHistory(null); setHistorySpot(null); }}>Close</button></div>
      <p>{history.previous_count ? `${history.previous_count} contact${history.previous_count === 1 ? "" : "s"} worked before` : "Not worked before"}</p>
      <p>DXCC {history.country} · ADIF {history.adif ?? "—"} · CQ {history.cq_zone ?? "—"} · Grid {history.grid || "Unknown"}</p>
      {history.previous.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Call</th><th>Band</th><th>Mode</th><th>RST sent</th><th>RST received</th><th>LoTW sent</th><th>LoTW received</th></tr></thead><tbody>
        {history.previous.map((qso) => <tr key={qso.id}><td>{new Date(qso.date).toLocaleString()}</td><td>{qso.call}</td><td>{qso.band}</td><td>{qso.mode}</td><td>{qso.rstSent || "—"}</td><td>{qso.rstReceived || "—"}</td><td>{qso.lotwSent || "—"}</td><td>{qso.lotwReceived || "—"}</td></tr>)}
      </tbody></table></div> : <p className="empty">No previous contact with this callsign in the integrated logbook.</p>}
      {history.previous_count > 20 && <p>Most recent 20 QSOs shown.</p>}
      {history.adif && <div className="live-cluster-matrix"><h4>DXCC band / mode history · ADIF {history.adif}</h4>
        <p>{history.dxcc_contact_count} integrated logbook contacts with this entity</p>
        <div className="table-scroll"><table><thead><tr><th>Mode</th>{bands.map((band) => <th key={band}>{band}</th>)}</tr></thead><tbody>
          {modes.map((mode) => <tr key={mode}><th>{mode}</th>{bands.map((band) => {
            const cell = history.matrix.find((item) => item.band === band && item.mode === mode);
            return <td key={band} className={cell?.confirmed ? "live-cluster-confirmed" : cell ? "live-cluster-worked" : ""}>{cell ? cell.confirmed ? "Confirmed" : "Worked" : "—"}</td>;
          })}</tr>)}
        </tbody></table></div>
      </div>}
    </aside>}

  </section>;

  // Local render helper keeps console/configuration inputs mounted while placing
  // their controlled panels next to the toolbar, ahead of the tall spot table.
  function renderToolbarPanels() {
    return <div className="live-cluster-toolbar-panels">
    <section className="live-cluster-console" id={`${panelId}-console`} hidden={!consoleOpen} aria-labelledby={`${panelId}-console-title`}><h3 id={`${panelId}-console-title`}>Cluster console · {live?.console.length ?? 0} lines</h3>
      <div className="live-cluster-console-controls">
        <select aria-label="Command target" value={commandTarget} onChange={(event) => setCommandTarget(event.target.value)}><option value="">All connected clusters</option>{configuration?.servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select>
        <select aria-label="Command preset" onChange={(event) => { if (event.target.value) setCommand(event.target.value); }} defaultValue=""><option value="">Command preset</option>{configuration?.commandPresets.map((preset) => <option key={preset.id} value={preset.command}>{preset.name}</option>)}</select>
        <input aria-label="Cluster command" value={command} maxLength={160} onChange={(event) => setCommand(event.target.value)} placeholder="Cluster command" />
        <button type="button" disabled={busy || !connected || !command.trim()} onClick={() => { void request("cluster_command", { command, ...(commandTarget ? { server_id: commandTarget } : {}) }, "Command sent"); setCommand(""); }}>Send</button>
        <button type="button" disabled={busy || !live?.console.length} onClick={() => void request("cluster_console_clear")}>Clear</button>
        <button type="button" disabled={!live?.console.length} onClick={() => { void navigator.clipboard.writeText((live?.console ?? []).map((line) => `${formatDate(line.receivedAt)} · ${line.source} · ${line.text}`).join("\n")).then(() => setMessage("Transcript copied")).catch(() => setError("Could not copy the transcript.")); }}>Copy</button>
      </div>
      <div className="live-cluster-transcript" role="log" aria-live="polite">{live?.console.length ? live.console.map((line, index) => <p key={`${line.receivedAt}-${index}`}><time>{formatDate(line.receivedAt)}</time><b>{line.source}</b><span>{line.text}</span></p>) : <p>No cluster replies yet.</p>}</div>
    </section>

    <section className="live-cluster-settings" id={`${panelId}-settings`} hidden={!settingsOpen} aria-labelledby={`${panelId}-settings-title`}><h3 id={`${panelId}-settings-title`}>Cluster settings</h3>
      {configuration && <div className="live-cluster-settings-body">
        <div className="live-cluster-setting-row"><label>Maximum visible spots <select value={configuration.maximumSpots} onChange={(event) => setConfiguration({ ...configuration, maximumSpots: Number(event.target.value) })}>{[50, 100, 200, 500].map((count) => <option key={count}>{count}</option>)}</select></label>
          <label><input type="checkbox" checked={configuration.connectOnStartup} onChange={(event) => setConfiguration({ ...configuration, connectOnStartup: event.target.checked })} /> Connect automatically when xLog starts</label>
          <label><input type="checkbox" checked={configuration.requestRecentSpotsOnConnect} onChange={(event) => setConfiguration({ ...configuration, requestRecentSpotsOnConnect: event.target.checked })} /> Request 100 recent DX spots after connecting</label>
          <label><input type="checkbox" checked={configuration.reconnect} onChange={(event) => setConfiguration({ ...configuration, reconnect: event.target.checked })} /> Reconnect automatically after an interruption</label>
        <label><input type="checkbox" checked={configuration.requestSkimmer} onChange={(event) =>
          setConfiguration({ ...configuration, requestSkimmer: event.target.checked })} /> Request RBN / Skimmer</label>
          <label><input type="checkbox" checked={configuration.showWorkedBandModeSpots} onChange={(event) => setConfiguration({ ...configuration, showWorkedBandModeSpots: event.target.checked })} /> Show already-worked combinations</label>
          <label><input type="checkbox" checked={configuration.hideWSPRSpots} onChange={(event) => setConfiguration({ ...configuration, hideWSPRSpots: event.target.checked })} /> Hide WSPR spots</label></div>
        <p>The recent-spots option sends <code>sh/dx/100</code> after each successful connection.</p>
        <p>Radio spot destinations and colours are configured in Settings → Radio spots.</p>
        <h3>Servers</h3><p>Configured servers connect together. Saving settings disconnects active sessions.</p>
        {configuration.servers.map((server) => <div className="live-cluster-server" key={server.id}>
          <label><input type="checkbox" checked={server.enabled} onChange={(event) => updateServer(server.id, { enabled: event.target.checked })} /> Enabled</label>
          <label>Name<input aria-label={`${server.name} name`} value={server.name} maxLength={80} onChange={(event) => updateServer(server.id, { name: event.target.value })} /></label>
          <label>Host<input aria-label={`${server.name} host`} value={server.host} maxLength={253} onChange={(event) => updateServer(server.id, { host: event.target.value })} /></label>
          <label>Port<input aria-label={`${server.name} port`} type="number" min="1" max="65535" value={server.port} onChange={(event) => updateServer(server.id, { port: Number(event.target.value) })} /></label>
          <label>Login callsign<input aria-label={`${server.name} callsign`} value={server.callsign} maxLength={24} onChange={(event) => updateServer(server.id, { callsign: event.target.value.toUpperCase() })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, servers: configuration.servers.filter((item) => item.id !== server.id) })}>Remove</button>
          <label className="live-cluster-password">Password · {passwordServers.includes(server.id) ? "saved securely" : "none"}<input type="password" autoComplete="new-password" disabled={!canEditPasswords} value={passwordDrafts[server.id] ?? ""} maxLength={256} onChange={(event) => setPasswordDrafts({ ...passwordDrafts, [server.id]: event.target.value })} /></label>
          <button type="button" disabled={!canEditPasswords || busy || !passwordDrafts[server.id] || !savedServerIDs.includes(server.id)} title={!canEditPasswords ? passwordUnavailableReason : !savedServerIDs.includes(server.id) ? "Save cluster settings first" : undefined} onClick={() => { void request("cluster_password_set", { server_id: server.id, password: passwordDrafts[server.id] }, "Password saved securely"); setPasswordDrafts((drafts) => ({ ...drafts, [server.id]: "" })); }}>Save password</button>
          <button type="button" disabled={!canEditPasswords || busy || !passwordServers.includes(server.id)} title={!canEditPasswords ? passwordUnavailableReason : undefined} onClick={() => void request("cluster_password_set", { server_id: server.id, password: "" }, "Password removed")}>Remove password</button>
        </div>)}
        {!passwordStorageAvailable ? <p>Secure password storage is not yet available on this platform. Callsign-only clusters can still connect.</p> : !passwordControlsEnabled && <p>Manage passwords in the main workspace.</p>}
        <button type="button" disabled={configuration.servers.length >= 16} onClick={() => setConfiguration({ ...configuration, servers: [...configuration.servers, { id: crypto.randomUUID(), name: "", host: "", port: 7300, callsign: "", enabled: true }] })}>Add server</button>
        <details><summary>Command presets</summary><div className="live-cluster-rules"><p>Saved commands are stored with cluster settings. Do not put passwords or tokens in presets.</p>{configuration.commandPresets.map((preset) => <div key={preset.id}>
          <label>Name<input value={preset.name} maxLength={80} onChange={(event) => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.map((item) => item.id === preset.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>Command<input value={preset.command} maxLength={160} onChange={(event) => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.map((item) => item.id === preset.id ? { ...item, command: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.filter((item) => item.id !== preset.id) })}>Remove</button>
        </div>)}<button type="button" disabled={configuration.commandPresets.length >= 32} onClick={() => setConfiguration({ ...configuration, commandPresets: [...configuration.commandPresets, { id: crypto.randomUUID(), name: "", command: "" }] })}>Add command preset</button></div></details>
        <details><summary>Special station rules</summary><div className="live-cluster-rules">{configuration.specialRules.map((rule) => <div key={rule.id}>
          <label><input type="checkbox" checked={rule.enabled} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} /> Enabled</label>
          <label>Name<input value={rule.name} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>Keywords<input value={rule.keywords.join(", ")} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, keywords: event.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : item) })} /></label>
          <label>Reference format<select value={rule.referenceFormat} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, referenceFormat: event.target.value } : item) })}>{["none", "pota", "sota", "iota", "wwff", "bunker", "castle"].map((format) => <option key={format}>{format}</option>)}</select></label>
          <label>Expert pattern<input value={rule.advancedPattern} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, advancedPattern: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, specialRules: configuration.specialRules.filter((item) => item.id !== rule.id) })}>Remove rule</button>
        </div>)}<button type="button" disabled={configuration.specialRules.length >= 64} onClick={() => setConfiguration({ ...configuration, specialRules: [...configuration.specialRules, { id: crypto.randomUUID(), name: "", keywords: [], referenceFormat: "none", advancedPattern: "", enabled: true }] })}>Add special rule</button></div></details>
        <details><summary>Status, band and mode colours</summary>{(["status", "band", "mode"] as const).map((family) => <div className="live-cluster-colours" key={family}><h4>{family}</h4>{Object.entries(configuration.palette[family]).map(([name, colour]) => <label key={name}>{name}<input type="color" value={colour} onChange={(event) => setConfiguration({ ...configuration, palette: { ...configuration.palette, [family]: { ...configuration.palette[family], [name]: event.target.value } } })} /></label>)}</div>)}</details>
        <button type="button" disabled={busy} onClick={() => void saveConfig()}>Save cluster settings</button>
      </div>}
    </section>
    </div>;
  }
}

export default ClusterPanel;
