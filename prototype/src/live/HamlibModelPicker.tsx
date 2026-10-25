import { useEffect, useMemo, useRef, useState } from "react";
import { hamlibManufacturers, loadHamlibCatalogue, type HamlibModel } from "./hamlibCatalogue";
import { stationSessionRequest, type RadioID } from "./stationSession";

/** Shared filtering UI; browsing never changes the selected hardware. */
export function HamlibModelPicker({ device, models, loading, selected, onSelect, labelPrefix, manufacturerFilter, plainLabels = false }: {
  device: "radio" | "rotor"; models: HamlibModel[]; loading: boolean; selected?: number;
  onSelect: (id: number) => void; labelPrefix?: string;
  manufacturerFilter?: string; plainLabels?: boolean;
}) {
  const [search, setSearch] = useState(""), [manufacturer, setManufacturer] = useState("");
  const manufacturers = useMemo(() => hamlibManufacturers(models), [models]);
  const filter = manufacturerFilter ?? manufacturer;
  const filtered = useMemo(() => models.filter(model => (!filter || model.manufacturer.toLowerCase() === filter.toLowerCase())
    && model.search.includes(search.trim().toLowerCase())), [models, filter, search]);
  const selectedModel = models.find(model => model.id === selected);
  const outside = !!selected && !filtered.some(model => model.id === selected);
  const label = labelPrefix ?? (device === "radio" ? "Radio" : "Rotor");
  return <>
    {manufacturerFilter === undefined && <label>Manufacturer<select aria-label={`${label} manufacturer`} value={manufacturer} onChange={event => setManufacturer(event.target.value)}><option value="">All manufacturers</option>{manufacturers.map(group => <option key={group.key} value={group.key}>{group.name} · {group.count}</option>)}</select></label>}
    <label>Find model<input aria-label={labelPrefix ? `${labelPrefix} search` : `Find ${device} model`} value={search} onChange={event => setSearch(event.target.value)} placeholder={plainLabels ? "Search model name" : "Model name, ID or maturity"} /></label>
    <label>Model<select aria-label={`${label} model`} required value={selected || ""} onChange={event => onSelect(Number(event.target.value))}><option value="">Choose model…</option>{outside && <option value={selected}>{selectedModel ? plainLabels ? `${selectedModel.model} (saved selection)` : `${selectedModel.manufacturer} ${selectedModel.model} · ${selectedModel.id} · ${selectedModel.maturity} (selected; outside filter)` : plainLabels ? "Saved model (catalogue unavailable)" : `Saved model ${selected} · not in this catalogue`}</option>}{filtered.map(model => <option key={model.id} value={model.id}>{plainLabels ? model.model : `${model.manufacturer} ${model.model} · ${model.id} · ${model.maturity}`}</option>)}</select></label>
    <p className="live-station-helper" role="status">{loading ? "Loading bundled device catalogue…" : plainLabels ? `${filtered.length} matching models` : `${filtered.length} matching ${device} models · ${models.length} listed. Catalogue support is not physical-device verification.`}</p>
  </>;
}

/** Mount is passive. Only this explicit button requests the fixed native list. */
export function SharedHamlibModelBrowser({ radioId, selected, onSelect }: { radioId: RadioID; selected?: number; onSelect: (id: number) => void }) {
  const [models, setModels] = useState<HamlibModel[]>([]), [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false), [failed, setFailed] = useState(false);
  const sequence = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { sequence.current++; }, []);
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true; const current = ++sequence.current;
    setLoading(true); setAttempted(true); setFailed(false);
    try {
      const next = await loadHamlibCatalogue(() => stationSessionRequest<{ models: unknown[] }>(radioId, { action: "hamlib_catalogue" }), "radio", true);
      if (sequence.current === current) { setModels(next); setFailed(!next.length); }
    } catch { if (sequence.current === current) { setModels([]); setFailed(true); } }
    finally { inFlight.current = false; if (sequence.current === current) setLoading(false); }
  };
  return <div aria-label="Shared Hamlib radio model browser">
    <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading radio models…" : attempted ? "Reload radio model catalogue" : "Load radio model catalogue"}</button>
    {!!models.length && <HamlibModelPicker device="radio" models={models} loading={loading} selected={selected} onSelect={onSelect} labelPrefix="Shared Hamlib catalogue" />}
    {failed && <p role="status">Bundled radio model catalogue is unavailable. Retry loading or enter a known model ID manually; manual entry does not verify backend support.</p>}
    <p>Choosing a model changes this draft only. Save setup before connecting.</p>
  </div>;
}
