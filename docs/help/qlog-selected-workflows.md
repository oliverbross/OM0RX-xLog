# Logging, chasing and portable workflows

The selected QLog-inspired additions extend the existing native logbook, draft,
radio and settings owners. They do not submit logs, transmit or move a rotor
automatically.

- **Logbook → Saved filters:** open **Filter contacts**, choose Match all/any,
  add typed conditions, then Apply. Quick search is ANDed with the group; values
  within One of are ORed. Save current, Update selected, Clone, Rename and Delete
  include the complete definition. Legacy quick searches retain their existing
  `%`/`_` wildcard meaning. Structured text is literal and Unicode normalized.
  Reference equality/one-of matches whole reference tokens, including multi-park
  records; a bare POTA park also matches its qualified location reference.
- **UTC periods:** Today, Previous day, This year and Last N UTC days resolve at
  Apply. Last N days includes today and the preceding N−1 UTC calendar days.
  Absolute timestamp ranges include their endpoints. Export filtered uses that
  same frozen definition/time; a subsequent edit cannot change an opened export.
  Missing power/status is unknown, distinct from 0 watts or an explicit N.
- **Awards → Local progress and supporting contacts:** choose the programme,
  recorded station context, role/category, band and mode. Each unit opens exact
  paged native evidence; Back retains the matrix position and filters. Contact
  buttons inspect the stored QSO without changing the live draft. Unclassified
  contacts are separately inspectable. Use saved contact filters to restrict the
  population. WAC/WPX/IOTA/POTA/SOTA/WWFF have useful local progress; sponsor
  eligibility/credit remains separately labelled. Directory-unverified references
  remain visible. SOTA chaser base estimates require dated summit/association
  inputs; missing points/bonus/operation evidence is unavailable, not zero.
- **Window → Alerts:** geography conditions use AND across fields and OR within a field;
  missing evidence does not match a selected condition. Preview is read-only.
  Review spot retains the historical match reason and exact source identity.
  Tune & load is available only through the current admitted cluster workflow.
- **Settings → Logbook → Nearby spotted callsigns:** opt in for Live QSO entries. Suggestions use fresh selected
  RX telemetry, including split operation. Use callsign accepts an empty callsign
  only; it never tunes, transmits, logs or replaces typed input. Several nearby
  calls remain a choice. Main and detached live entries share native admission.
- **Settings → Display → Shortcuts:** assign supported Normal Logging commands,
  capture a chord, inspect conflicts, reset one/all, and use shortcut help.
  Native lifecycle, Stop/Escape, CW and contest bindings keep their own contexts.
- **Settings → General → Station equipment:** manage antenna profiles, archive them, choose
  manual/per-band preferences or explicitly enable automatic software selection.
  Automatic proposals use fresh selected TX context. Overlapping profiles need a
  preference; stale/unknown bands do not choose arbitrarily. A profile is metadata,
  not observed physical switch state. Captured profiles and offsets stay with the
  current draft/QSO. Explicit rotor targets use the captured inverse offset once.
- **Settings → General → Portable operating defaults:** save a preset with on-air station and
  operator, transmitting locator/location/subdivision, optional recorded own DXCC,
  programme references, power and antenna. Start/end sets future blank-contact
  defaults; explicitly apply to change a current draft. Home settings stay intact.
  The banner and captured metadata make an active context visible after restart.
- **Logbook → Export POTA logs:** select contacts, a structured filter, or the
  active portable session. Freeze and preview. One physical QSO with two own and
  three contacted parks remains one local row and produces two files of three
  records. Review assignments, location and explicit exclusions before saving a
  new staged `.pota` directory with ADI files and a manifest. Club/group output
  requires both identities. Files preserve portable callsigns and UTC timestamps;
  no upload, timestamp adjustment, local deletion or sync-state change occurs.
- **World Map → Heard me:** optional passive receiver layer shares the existing
  RBN feed. Source-time age, exact monitored call, locator-centre provenance,
  unknown SNR/location and unlocated counts remain visible. Updates preserve the
  viewport and do not identify a particular transmitting radio/antenna.
  Current RBN reports expire after ten minutes across map, sidebar and HF pickups,
  even during fetch failure. The sidebar's operator-spot history window remains
  configurable separately.
- **Band Maps → Guides:** select source-attributed Region 1/3 guides, clone as
  custom, edit labelled ranges/markers or import/export JSON. Desk/detached choices
  are separate. Legacy appearance stays selected on upgrade. Beacon markers are
  optional and do not assert live reception. Inspecting ranges is passive; explicit
  marker Tune uses the current station owner while preserving Follow Radio and
  sending no rotor command. Visual guides never change mode inference/permission.

Settings and definitions travel through existing revisioned preferences and
backups. Old saved searches and the single legacy antenna migrate compatibly;
historical QSOs are not retagged. Before rollback, retain a pre-upgrade backup.
An older binary can ignore new settings or drop structured-only searches when it
saves preferences; full rollback of preferences requires the retained backup.
No change here authorizes a production installation or external submission.
