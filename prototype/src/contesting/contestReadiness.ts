import matrix from "../../../docs/contesting/ALL_CONTESTS_READINESS.json";
import type { ContestSetupDocument, ContestSetupMacro } from "./ContestSetupPanel";
import { contestSchedule, contestUTC } from "./contestSchedule";

export type ReadinessStatus = "ACCEPTED" | "LIMITED" | "NOT APPLICABLE" | "UNVERIFIED";
type MatrixRow = { id: string; coreStatus: string; settings: Record<string, string>; serialPolicy: string;
  supportedExports: string[]; optionalFeatures: Record<string, string>; multiplierDimensionsAndScope: string;
  entryFields: { id: string; visible: boolean; example: string }[] };
export type ContestPreflightContext = { practice?: boolean; selectedRadio?: string; backup?: string;
  referenceID?: string; scoringRevision?: string | null; historyReference?: string; scpReference?: string };
export type ReadinessItem = { label: string; status: ReadinessStatus; detail: string };
const rows = matrix.plugins as unknown as MatrixRow[];
const status = (value?: string): ReadinessStatus => value === "PASS" ? "ACCEPTED" : value === "NOT APPLICABLE" ? value : "UNVERIFIED";
const present = (value: unknown) => String(value ?? "").trim();

export function contestCapabilities(pluginID: string, settings?: ContestSetupDocument["settings"]): ReadinessItem[] {
  const row = rows.find(item => item.id === pluginID);
  if (!row) return [{ label: "Definition evidence", status: "UNVERIFIED", detail: "No entry in the accepted readiness matrix." }];
  return [
    { label: "Core logging and export", status: pluginID === "cqws" ? "LIMITED" : status(row.coreStatus), detail: `${row.supportedExports.join(", ")}; ${row.serialPolicy}.` },
    ...(settings ? [{ label: "Selected category coverage", status: "UNVERIFIED" as const, detail: `Qualified fixture: ${["OperatorCategory", "BandCategory", "ModeCategory", "PowerCategory", "OverlayCategory"].map(key => row.settings[key] || "unspecified").join(" / ")}. Category combinations beyond the recorded fixture require their own evidence.` }] : []),
    { label: "Installed workflow", status: "UNVERIFIED", detail: "Catalogue fixtures exercised Python/UI transport; installed and physical acceptance have separate evidence." },
    ...[["Multiplier acquisition", "analyticsMultiplierAcquisition"], ["Score history", "analyticsScoreHistory"], ["Finite Needed", "analyticsFiniteNeeded"], ["Candidate Needed", "analyticsCandidateNeeded"]].map(([label, key]) => ({ label, status: status(row.optionalFeatures[key]), detail: row.multiplierDimensionsAndScope })),
    { label: "Current sponsor rules", status: status(row.optionalFeatures.currentSponsorRules), detail: "Fixture success does not certify the selected category or current rule edition." },
    { label: "Output provider", status: status(row.optionalFeatures.hardwareAcceptance), detail: "Optional keyer/modem absence does not prevent manual logging." },
  ];
}

export function contestPreflight(document: ContestSetupDocument, context: ContestPreflightContext = {}, macros = document.macros, now = Date.now()): ReadinessItem[] {
  const settings = document.settings, schedule = contestSchedule(document.pluginID, settings);
  const startUTC = contestUTC(settings.StartDate), start = startUTC ? Date.parse(startUTC) : null;
  const end = schedule.contestEndAt ? Date.parse(schedule.contestEndAt) : null;
  const period = start !== null && end !== null && end > start;
  const exchange = ["cq_ww_cw", "cq_ww_ssb"].includes(document.pluginID) ? present(document.station.CQZone) : present(settings.SentExchange);
  const tokens = macros.flatMap((macro: ContestSetupMacro) => [...macro.template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]));
  // This checklist does not expand or execute macros; the host remains the token authority.
  const unknown = tokens.filter(token => !new Set(["MYCALL", "CALL", "RST", "EXCHANGE", "SENTNR", "PREVNR", "OTHER1", "OTHER2", "HISCALL", "SNT", "EXCH", "LOGIT", "RUN", "SANDP", "WIPE", ...Array.from({ length: 10 }, (_, index) => `VOICE${index + 1}`)]).has(token));
  const output = document.preferences.rtcEnabled === true || Object.entries(document.network).some(([key, value]) => /Enabled$|^n1mm(Radio|Contact|Lookup|Score)$/.test(key) && value === true);
  return [
    { label: "UTC / event period", status: period ? now < start! || now >= end! ? "LIMITED" : "ACCEPTED" : "UNVERIFIED", detail: period ? `${new Date(start!).toISOString()} to ${new Date(end!).toISOString()}${now < start! || now >= end! ? " · outside configured event period" : ""}` : "Configure the full event period in UTC; no system-clock accuracy is inferred." },
    { label: "Station location", status: /^[A-R]{2}\d{2}(?:[A-X]{2})?$/i.test(present(document.station.GridSquare)) ? "ACCEPTED" : "UNVERIFIED", detail: `Grid ${present(document.station.GridSquare) || "missing"}; CQ zone ${present(document.station.CQZone) || "missing"}; ITU zone ${present(document.station.IARUZone) || "missing"}. Confirm the physical station location.` },
    { label: "Sent exchange", status: exchange ? /^(?:599|59|5NN)\s/i.test(exchange) ? "LIMITED" : "ACCEPTED" : "UNVERIFIED", detail: exchange ? `Configured: ${exchange}. Signal report is a separate field; # denotes a session serial.` : "Sent exchange is empty. Check this definition's exchange requirements." },
    { label: "Message tokens", status: unknown.length ? "LIMITED" : macros.length ? "UNVERIFIED" : "NOT APPLICABLE", detail: unknown.length ? `Review tokens: ${[...new Set(unknown)].join(", ")}.` : macros.length ? "Templates are present. Use a no-output preview to verify the complete message and provider." : "No configured message bank was supplied; manual logging remains available." },
    { label: "Selected radio", status: "UNVERIFIED", detail: context.practice ? "Practice has no station/output authority." : context.selectedRadio || "No confirmed selected-radio receipt supplied; manual logging remains available." },
    { label: "Backup", status: "UNVERIFIED", detail: context.backup || "No current backup receipt supplied. Check backup settings before operating." },
    { label: "Requested output", status: context.practice ? "NOT APPLICABLE" : output ? "UNVERIFIED" : "NOT APPLICABLE", detail: context.practice ? "Practice: native output and public posting are disabled." : output ? "Output requested; confirm its provider and arming separately." : "No score/network posting requested in this setup." },
    { label: "Pinned references", status: "UNVERIFIED", detail: `CTY: ${context.referenceID || "unknown"}; scoring: ${context.scoringRevision === null ? "historical / unmarked" : context.scoringRevision || "unknown"}; history: ${context.historyReference || "unknown"}; SCP: ${context.scpReference || "unknown"}. Compatibility is not inferred from presence.` },
  ];
}

export const contestReadinessEvidence = { date: matrix.date, scope: matrix.scope };

export function contestExchangeSample(document: ContestSetupDocument) {
  const row = rows.find(item => item.id === document.pluginID);
  const report = row?.entryFields.find(field => field.id === "sent" && field.visible);
  const exchange = ["cq_ww_cw", "cq_ww_ssb"].includes(document.pluginID) ? present(document.station.CQZone) : present(document.settings.SentExchange);
  return `${report ? `Report ${document.settings.ModeCategory === "SSB" ? "59" : report.example || "599"} · ` : ""}exchange ${exchange.replace(/#/g, "001") || "not configured"}${exchange.includes("#") ? " (simulated serial)" : ""}`;
}
