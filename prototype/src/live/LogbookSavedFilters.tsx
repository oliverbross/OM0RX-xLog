import { useEffect, useState } from "react";
import { duplicateSavedLogbookFilter, parseSavedLogbookFilterSnapshot, validateSavedLogbookFilterName,
  validateSavedLogbookFilterQuery, type SavedLogbookFilterSnapshot } from "./savedLogbookFilters";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;

export function LogbookSavedFilters({ onRequest, currentQuery, onApply, disabled = false }: {
  onRequest: Request;
  currentQuery: string;
  onApply: (query: string) => void;
  disabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SavedLogbookFilterSnapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true; setBusy(true); setMessage("");
    void onRequest("workspace_preferences_load").then(value => {
      if (active) setSnapshot(parseSavedLogbookFilterSnapshot(value));
    }).catch(cause => { if (active) setMessage(cause instanceof Error ? cause.message : "Saved Logbook filters are unavailable."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [onRequest]);
  const chosen = snapshot?.filters.find(filter => filter.name === selected);
  const messageIsSuccess = message === "Filter saved." || message === "Filter cloned." || message === "Filter renamed." ||
    message === "Filter deleted." || message.startsWith("Applied ");

  async function mutate(action: "save" | "clone" | "rename" | "delete") {
    if (!snapshot || busy || disabled) return;
    setMessage("");
    try {
      const params: Record<string, unknown> = { generation: snapshot.generation, expected: snapshot.filters, action };
      if (action === "save") {
        params.name = validateSavedLogbookFilterName(name);
        params.query = validateSavedLogbookFilterQuery(currentQuery.trim());
        if (duplicateSavedLogbookFilter(snapshot.filters, params.name as string)) throw new Error("A filter with that name already exists.");
      } else if (action === "delete") {
        if (!chosen) throw new Error("Choose a saved filter first.");
        params.source = chosen.name;
      } else {
        if (!chosen) throw new Error("Choose a saved filter first.");
        params.source = chosen.name;
        params.name = validateSavedLogbookFilterName(name);
        if (duplicateSavedLogbookFilter(snapshot.filters, params.name as string, action === "rename" ? chosen.name : undefined))
          throw new Error("A filter with that name already exists.");
      }
      setBusy(true);
      const response = await onRequest("workspace_logbook_filters_apply", params);
      const next = parseSavedLogbookFilterSnapshot(response);
      setSnapshot(next);
      if (selected && !next.filters.some(filter => filter.name === selected)) { setSelected(""); setName(""); }
      if (response?.status === "workspace_changed") throw new Error("The workspace changed. Review the saved filters and try again.");
      if (response?.status === "conflict") throw new Error("Saved filters changed in another window. Review the refreshed list and try again.");
      if (response?.status !== "applied") throw new Error("The saved filter change was not confirmed.");
      if (action === "delete") { setSelected(""); setName(""); }
      else { const nextName = String(params.name); setSelected(nextName); setName(nextName); }
      setMessage(action === "save" ? "Filter saved." : action === "clone" ? "Filter cloned." : action === "rename" ? "Filter renamed." : "Filter deleted.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The saved filter could not be changed."); }
    finally { setBusy(false); }
  }

  return <section className="live-logbook-saved-filters" aria-label="Saved Logbook filters">
    <div className="live-logbook-filter-row">
      <label>Saved filter <select aria-label="Saved Logbook filter" disabled={busy || disabled || !snapshot}
        value={selected} onChange={event => { const value = event.target.value; setSelected(value); setName(value); setMessage(""); }}>
        <option value="">Choose filter</option>
        {snapshot?.filters.map(filter => <option key={filter.name} value={filter.name}>{filter.name}</option>)}
      </select></label>
      <button type="button" disabled={busy || disabled || !chosen} onClick={() => {
        if (!chosen) return; onApply(chosen.query); setMessage(`Applied ${chosen.name}.`);
      }}>Apply</button>
      <label>Filter name <input aria-label="Saved filter name" maxLength={48} disabled={busy || disabled}
        value={name} onChange={event => { setName(event.target.value); setMessage(""); }} /></label>
      <button type="button" disabled={busy || disabled || !snapshot} onClick={() => void mutate("save")}>Save current</button>
      <button type="button" disabled={busy || disabled || !chosen} onClick={() => void mutate("clone")}>Clone</button>
      <button type="button" disabled={busy || disabled || !chosen} onClick={() => void mutate("rename")}>Rename</button>
      <button type="button" disabled={busy || disabled || !chosen} onClick={() => void mutate("delete")}>Delete filter</button>
    </div>
    <p className={message && !messageIsSuccess ? "error" : ""}
      role={message && !messageIsSuccess ? "alert" : "status"}>{busy ? "Loading saved filters…" : message || "Saved filters reuse the same callsign, name, country or note search."}</p>
  </section>;
}
