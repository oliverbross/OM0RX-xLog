# Country snapshots and reviewed corrections

Country answers use the literal call and the observation's UTC date. An entity
position is an approximation, not proof of a portable station's position. A home
callbook profile stays separate from the operating position. Unknown, ambiguous,
missing-date and maritime/aeronautical results remain visible rather than being
filled with a guessed home entity. Contest scoring retains its own pinned
reference interpretation.

Open Settings → Reference and use **Read country snapshot** to inspect the active
provider, coverage and revision. To replace it, supply an absolute path to a
reviewed normalized JSON pack, or an HTTPS URL, and choose the corresponding
validate/import or check/download action. Reading this panel does not start a
download. The bundle, import and download share one validator. Invalid data leaves
the previous usable answers available. **Restore previous country snapshot**
restores reference answers; it does not reverse contact edits.

In Logbook, open **PJ country preview**, then **Review country fields**. **Read
country field differences** compares the complete current filter/search selection
at each contact's QSO date, with bounded pages and complete counts. Contact Details
offers the same review for that contact. Reading and cancelling do not edit QSOs.
Unknown-origin imports and recorded overrides are protected until the operator
explicitly selects a change.

Select contacts for review, then select the individual country fields to change.
Nothing is selected automatically. Inspect the retained value, proposed value,
reason and dependent-field warnings. An entity change can require an explicit
decision about state/county. An existing IOTA dependency requires separate location
review. Calls, QSO times, band/mode, confirmations, activities and own-station
snapshots are outside the country patch.

Apply uses the reviewed contact revisions and country snapshot. A changed contact,
workspace or reference requires a fresh review. A retry of the same selection
retrieves the existing receipt. Keep/cancel retires the review without editing
contacts. A successful correction offers receipt-based recovery, which refuses to
overwrite a later edit. Reference bytes and correction receipts are retained by
the existing workspace backup/restore. External voice recordings remain subject
to the voice-library backup policy; saving profile metadata does not copy them.

The bundled derivative is attributed to OK1RR and pinned to the source revision
shown in the country audit. Its coverage and enumerated exclusions are explicit;
it does not claim complete CQRLOG parser parity. Dataset updates do not silently
rewrite historical QSOs.
