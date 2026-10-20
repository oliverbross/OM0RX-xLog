import type { InputHTMLAttributes, ReactNode, Ref } from "react";

/** Presentation only: the docked owner and detached receipt controller retain
 * their existing mutation, keyboard, focus and recovery responsibilities. */
export function ContestTextField({ label, inputRef, className, children, ...input }: {
  label: string; inputRef?: Ref<HTMLInputElement>; className?: string; children?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return <label className={className}><span className="contest-field-label">{label}</span><input ref={inputRef} {...input}/>{children}</label>;
}

export function ContestEntryFields({ detached = false, callsign, reports, exchange }: {
  detached?: boolean; callsign: ReactNode; reports: ReactNode; exchange: ReactNode;
}) {
  return detached ? <>{callsign}<div className="contest-surface-row">{reports}</div>{exchange}</>
    : <div className="contest-entry-fields">{callsign}{reports}{exchange}</div>;
}

export type ContestCandidate = { id: string; label: ReactNode; detail?: ReactNode; className?: string };
export function ContestCandidates({ candidates, disabled, onSelect, className, strongLabel = true }: {
  candidates: ContestCandidate[]; disabled: boolean; onSelect: (id: string) => void; className?: string; strongLabel?: boolean;
}) {
  const buttons = candidates.map(candidate => <button type="button" key={candidate.id}
    className={candidate.className} disabled={disabled} onClick={() => onSelect(candidate.id)}>
    {strongLabel ? <strong>{candidate.label}</strong> : candidate.label}{candidate.detail !== undefined && <span>{candidate.detail}</span>}
  </button>);
  return className ? <div className={className}>{buttons}</div> : <>{buttons}</>;
}

type Score = { claimedScore: number; qsos: number; points: number; multipliers: number;
  multiplierLabels: string[]; multiplierDisplayLabels?: string[]; sourceVerification: string };
export function ContestScoreSummary({ score, detached = false }: { score: Score | null; detached?: boolean }) {
  const labels = detached ? score?.multiplierDisplayLabels ?? []
    : score?.multiplierLabels.length ? (score.multiplierDisplayLabels?.length ? score.multiplierDisplayLabels : score.multiplierLabels) : [];
  if (detached && !score) return <p>No score available.</p>;
  return <><dl>{[
    ["Claimed score", score?.claimedScore.toLocaleString() ?? "—"], ["QSOs", score?.qsos ?? "—"],
    ["Points", score?.points ?? "—"], ["Multipliers", score?.multipliers ?? "—"],
  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className={detached ? "contest-surface-results" : "contest-multipliers"}>
      {labels.length ? labels.map((label, index) => <span key={`${score?.multiplierLabels[index] ?? label}-${index}`}>{label}</span>)
        : !detached && <p>No multipliers recorded.</p>}</div>
    <p className={detached ? undefined : `contest-source is-${score?.sourceVerification ?? "unverified"}`}>
      Score source: {score?.sourceVerification ?? "unavailable"}</p></>;
}

export type ContestLogRow = { qsoID: string; workedAt: string; callsign: string; band: string; mode: string;
  sentExchange: string; receivedExchange: string; points: number; multiplierLabels: string[] };
export function ContestLogTable({ rows, disabled, onEdit, detached = false, editIcon }: {
  rows: ContestLogRow[]; disabled: boolean; onEdit: (qsoID: string) => void; detached?: boolean; editIcon?: ReactNode;
}) {
  const columns: { title: ReactNode; label: string; cell: (row: ContestLogRow) => ReactNode }[] = [
    { title: "UTC", label: "UTC", cell: row => detached
      ? new Date(row.workedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })
      : new Date(row.workedAt).toISOString().slice(0, 16).replace("T", " ") },
    { title: "Call", label: "Call", cell: row => detached
      ? <button type="button" disabled={disabled} onClick={() => onEdit(row.qsoID)}>{row.callsign}</button>
      : <strong>{row.callsign}</strong> },
    { title: "Band", label: "Band", cell: row => row.band },
    ...(detached ? [
      { title: "Mode", label: "Mode", cell: (row: ContestLogRow) => row.mode },
      { title: "Exchange", label: "Received", cell: (row: ContestLogRow) => row.receivedExchange },
    ] : [
      { title: "Sent", label: "Sent", cell: (row: ContestLogRow) => row.sentExchange },
      { title: "Received", label: "Received", cell: (row: ContestLogRow) => row.receivedExchange },
    ]),
    { title: "Pts", label: "Points", cell: row => row.points },
    ...(!detached ? [
      { title: "Mult", label: "Multiplier", cell: (row: ContestLogRow) => row.multiplierLabels.join(", ") || "—" },
      { title: <span className="contest-visually-hidden">Actions</span>, label: "Actions", cell: (row: ContestLogRow) =>
        <button type="button" disabled={disabled} aria-label={`Edit ${row.callsign}`} onClick={() => onEdit(row.qsoID)}>{editIcon}Edit</button> },
    ] : []),
  ];
  return <table><thead><tr>{columns.map(column => <th key={column.label}>{column.title}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(row => <tr key={row.qsoID}>{columns.map(column =>
      <td key={column.label} data-label={column.label}>{column.cell(row)}</td>)}</tr>)
      : !detached && <tr><td colSpan={columns.length}>No QSOs in this contest.</td></tr>}</tbody></table>;
}
