import type { ContestSetupDocument, ContestSetupMacro } from "./ContestSetupPanel";
import { contestCapabilities, contestExchangeSample, contestPreflight, contestReadinessEvidence, type ContestPreflightContext } from "./contestReadiness";
import "./ContestReadinessPanel.css";

export function ContestReadinessPanel({ document, context, macros }: { document: ContestSetupDocument; context?: ContestPreflightContext; macros?: ContestSetupMacro[] }) {
  return <details className="contest-readiness"><summary>Readiness and preflight · {context?.practice ? "Practice" : "review before operating"}</summary>
    <p>{document.settings.OperatorCategory} · {document.settings.BandCategory} · {document.settings.ModeCategory} · {document.settings.PowerCategory}</p>
    <p>Sample sent/logged fields: {contestExchangeSample(document)}. This is a field example; no message is sent.</p>
    <p>Evidence: {contestReadinessEvidence.date} · {contestReadinessEvidence.scope}.</p>
    {document.pluginID === "cqws" && <p role="alert">CQWS scoring remains partial/unverified for Brazilian UF branches. RTC score posting is restricted.</p>}
    <dl>{[...contestCapabilities(document.pluginID, document.settings), ...contestPreflight(document, context, macros)].map(item => <div key={item.label}><dt>{item.label} <strong>{item.status}</strong></dt><dd>{item.detail}</dd></div>)}</dl>
    <p><a href={`https://github.com/oliverbross/OM0RX-xLog/blob/main/docs/contesting/ALL_CONTESTS_READINESS.md#${document.pluginID}`} target="_blank" rel="noreferrer">xLog definition notes and accepted evidence</a> · <a href="https://github.com/oliverbross/OM0RX-xLog/blob/main/docs/contesting/PILOT_SPONSOR_RULE_AUDIT.md" target="_blank" rel="noreferrer">Rule sources and edition limits</a></p>
    <p>Accepted evidence covers its stated fixtures. Verify the current organizer rules, category and physical station before operating. Rules/reference updates remain deliberate; historical sessions retain their policy.</p>
  </details>;
}
