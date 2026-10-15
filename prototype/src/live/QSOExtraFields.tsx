import { useState, type SetStateAction } from "react";

type Data = Record<string, any>;
// QSO.adifRecord writes these from the native controls. Imported originals in
// extraFields must remain intact, but editing them would be silently ignored.
const nativeFields = new Set("CALL QSO_DATE TIME_ON BAND MODE SUBMODE FREQ RST_SENT RST_RCVD NAME GRIDSQUARE COUNTRY DXCC CONT CQZ ITUZ STATE CNTY QTH IOTA SOTA_REF POTA_REF WWFF_REF SIG SIG_INFO DARC_DOK COMMENT NOTES TX_PWR OPERATOR STATION_CALLSIGN MY_GRIDSQUARE PROP_MODE EMAIL QSL_SENT QSL_RCVD QSL_SENT_VIA QSL_VIA LOTW_QSL_SENT LOTW_QSL_RCVD".split(" "));
const reservedFields = new Set("EOH EOR ADX HEADER RECORDS RECORD APP USERDEF ADIF_VER CREATED_TIMESTAMP PROGRAMID PROGRAMVERSION".split(" "));

export function QSOExtraFields({ draft, setDraft, disabled, name, setName }: {
  draft: Data; setDraft: (value: SetStateAction<Data | null>) => void; disabled: boolean;
  name: string; setName: (value: string) => void;
}) {
  const [error, setError] = useState("");
  const fields = Object.entries(draft.extraFields ?? {}).filter(([key]) => !nativeFields.has(key.toUpperCase()));
  function add() {
    if (disabled) return;
    const key = name.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(key) || reservedFields.has(key)) { setError("Use an ADIF field name containing letters, digits or underscores, without a document marker."); return; }
    if (nativeFields.has(key)) { setError(`${key} is edited using the contact controls above.`); return; }
    if (Object.keys(draft.extraFields ?? {}).some(existing => existing.toUpperCase() === key)) { setError(`${key} already exists. Edit its value below.`); return; }
    setDraft(current => current ? { ...current, extraFields: { ...(current.extraFields ?? {}), [key]: "" } } : current);
    setName(""); setError("");
  }
  function remove(key: string) {
    if (disabled) return;
    setDraft(current => {
      if (!current) return current;
      const extraFields = { ...(current.extraFields ?? {}) }; delete extraFields[key];
      const metadata = current.adifFieldMetadata;
      if (!metadata?.extensions?.[key]) return { ...current, extraFields };
      const extensions = { ...metadata.extensions }; delete extensions[key];
      return { ...current, extraFields, adifFieldMetadata: { ...metadata, extensions } };
    });
  }
  return <div className="qso-adif-fields">
    <p>Core ADIF fields use the contact controls above. Other fields, including uncommon and application fields, can be added, edited or removed here. Removing a field takes effect on Update QSO.</p>
    <div className="qso-extra">{fields.map(([key, value]) => <div key={key}>
      <label><span>{key}</span><textarea aria-label={`ADIF ${key}`} value={String(value)} disabled={disabled} wrap="soft"
        onChange={event => { if (!disabled) setDraft(current => current ? { ...current, extraFields: { ...(current.extraFields ?? {}), [key]: event.target.value } } : current); }} /></label>
      <button type="button" disabled={disabled} aria-label={`Remove ADIF ${key}`} onClick={() => remove(key)}>Remove field</button>
    </div>)}</div>
    {!fields.length && <p>No additional ADIF fields in this QSO.</p>}
    <label>New ADIF field name<input aria-label="New ADIF field name" value={name} disabled={disabled} autoComplete="off" spellCheck={false}
      onChange={event => { if (!disabled) { setName(event.target.value); setError(""); } }}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); add(); } }} /></label>
    <button type="button" disabled={disabled || !name.trim()} onClick={add}>Add ADIF field</button>
    {name && <p>Add this field or clear its name before saving.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
