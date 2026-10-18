import { Activity, BarChart3, Trophy } from "lucide-react";
import type { ContestScore, ContestStatistics } from "./types";

type ScoreView = Pick<ContestScore, "qsos" | "points" | "multipliers" | "claimedScore" | "multiplierLabels" | "multiplierDisplayLabels" | "sourceVerification">;
type RateView = Pick<ContestStatistics, "revision" | "asOfUTC" | "currentHourQSOs" | "operatorStyles" | "trailing60Minutes" | "latest10" | "latest100">;
type StatisticsView = Pick<ContestStatistics, "revision" | "asOfUTC" | "fullLogQSOs" | "loggedQSOs" | "duplicateQSOs" | "invalidQSOs" | "bands" | "total">;

const value = (number: number | null | undefined, suffix = "") => number === null || number === undefined ? "—" : `${Number.isInteger(number) ? number : number.toFixed(1)}${suffix}`;

export function ContestRatePanel({ statistics, error }: { statistics: RateView | null; error?: string }) {
  return <section className="contest-score contest-rate" aria-label="Contest rate">
    <h2><Activity size={15}/> Rate</h2>
    {!statistics ? <p className="contest-source">{error || "Rate unavailable."}</p> : <>
      <dl><div><dt>Trailing 60</dt><dd>{value(statistics.trailing60Minutes.qsosPerHour, " Q/h")}</dd></div>
        <div><dt>Latest 10</dt><dd>{value(statistics.latest10?.qsosPerHour, " Q/h")}</dd></div>
        <div><dt>Latest 100</dt><dd>{value(statistics.latest100?.qsosPerHour, " Q/h")}</dd></div>
        <div><dt>Current hour</dt><dd>{statistics.currentHourQSOs}</dd></div>
        <div><dt>Run / S&amp;P / unknown</dt><dd>{statistics.operatorStyles.total.run} / {statistics.operatorStyles.total.searchAndPounce} / {statistics.operatorStyles.total.unknown}</dd></div></dl>
      <p className="contest-source">Current hour Run / S&amp;P / unknown: {statistics.operatorStyles.currentHour.run} / {statistics.operatorStyles.currentHour.searchAndPounce} / {statistics.operatorStyles.currentHour.unknown}</p>
      {error && <p className="contest-source" role="status">Refresh unavailable · showing {new Date(statistics.asOfUTC).toISOString().slice(11,19)} UTC</p>}
      <p className="contest-source">As of {new Date(statistics.asOfUTC).toISOString().replace("T", " ").slice(0,19)} UTC · revision {statistics.revision}</p>
    </>}
  </section>;
}

export function ContestStatisticsPanel({ score, statistics, error }: { score: ScoreView | null; statistics: StatisticsView | null; error?: string }) {
  return <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score &amp; statistics</h2>
    <dl><div><dt>Claimed score</dt><dd>{score?.claimedScore.toLocaleString() ?? "—"}</dd></div><div><dt>QSOs</dt><dd>{score?.qsos ?? "—"}</dd></div>
      <div><dt>Points</dt><dd>{score?.points ?? "—"}</dd></div><div><dt>Multipliers</dt><dd>{score?.multipliers ?? "—"}</dd></div></dl>
    <div className="contest-multipliers">{score?.multiplierLabels.length ? (score.multiplierDisplayLabels?.length ? score.multiplierDisplayLabels : score.multiplierLabels).map(x => <span key={x}>{x}</span>) : <p>No multipliers recorded.</p>}</div>
    <p className={`contest-source is-${score?.sourceVerification ?? "unverified"}`}>Score source: {score?.sourceVerification ?? "unavailable"}</p>
    <h3><BarChart3 size={14}/> Band statistics</h3>
    {!statistics ? <p className="contest-source">{error || "Statistics unavailable."}</p> : <table><thead><tr><th>Band</th><th>Log</th><th>Accepted</th><th>Calls</th><th>CW</th><th>Phone</th><th>Digital</th><th>Other</th><th>WPX</th><th>Points</th></tr></thead>
      <tbody>{[...statistics.bands, statistics.total].map(row => <tr key={row.band}><th>{row.band === "total" ? "Total" : row.band}</th><td>{row.loggedQSOs}</td><td>{row.acceptedQSOs}</td><td>{row.distinctCallsigns}</td>
        <td>{row.modes.cw}</td><td>{row.modes.phone}</td><td>{row.modes.digital}</td><td>{row.modes.other}</td><td>{row.distinctWPXPrefixes}</td><td>{row.creditedPoints}</td></tr>)}</tbody></table>}
    {statistics && <>{error && <p className="contest-source" role="status">Refresh unavailable · showing {new Date(statistics.asOfUTC).toISOString().slice(11,19)} UTC</p>}
      <p className="contest-source">Full log {statistics.fullLogQSOs} · as-of log {statistics.loggedQSOs} · duplicates {statistics.duplicateQSOs} · invalid {statistics.invalidQSOs}</p>
      <p className="contest-source">As of {new Date(statistics.asOfUTC).toISOString().replace("T", " ").slice(0,19)} UTC · revision {statistics.revision}</p></>}
  </aside>;
}
