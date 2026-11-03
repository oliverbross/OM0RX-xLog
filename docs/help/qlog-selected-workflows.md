# Logging, chasing and portable workflows

The selected QLog-inspired additions extend the existing native logbook, draft,
radio and settings owners. They do not submit logs, transmit or move a rotor
automatically.

- **Operator Desk → Previous contacts:** matching previous contacts appear above
  the Logbook in every Traditional layout that shows the Logbook, including
  **Logbook above map**. The duplicate warning remains alongside the current QSO.
  Changing layouts retains the Logbook; entering another callsign refreshes the
  history without carrying the previous station's rows forward.
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
- **Awards → Active contact filters:** the active legacy text search and number
  of applied structured conditions stay visible. Applying a saved search such as
  `K1` restricts progress until cleared. **Clear all contact filters** clears both
  the text search and structured conditions and restores that programme/context's
  contact population. **Reset conditions** edits the condition builder only; it
  does not clear the legacy text search. Programme, context, band and mode remain
  separate selections. Opening supporting contacts and using Back preserves the
  matrix position and applied filters.
- **Awards → IOTA:** the same exact recorded own callsign and known own DXCC
  country combine recorded locations in one local progress view. For example,
  OM0RX with own DXCC 504 at two locations can show both contacted IOTA groups.
  Different countries and unknown historical country contexts stay separate;
  other programmes retain their own scope rules. Supporting contacts retain the
  original own grid, location and context. To narrow the view, open **Filter
  contacts**, add **Recorded own grid** or **Recorded own location**, then apply
  the condition; **Clear all contact filters** removes it. HF and VHF/UHF remain
  separate categories. Grouping does not establish land, personal-operation,
  licensing or remote-operation eligibility, and does not generate own-island
  credit or accepted sponsor matching.
- **Awards → POTA → activator:** UTC-day summaries separate physical rows,
  conservatively distinct countable contact events, unique programme log records,
  duplicate records, unresolved counting evidence and excluded rows. Ten supported
  contact events for the recorded station, park, subdivision and UTC day form a
  **local candidate**. Extra unknown rows stay visible without erasing a minimum
  already supported by ten known contacts; nine known plus unknown evidence stays
  incomplete. Individual records use the recorded station callsign, or the recorded
  operator if the station callsign is absent. Different operator-only identities
  stay separate; a recorded club station takes precedence without generating
  personal credit. SUBMODE takes precedence over MODE. Mode validation
  uses supported ADIF 3.1.8 modes and their enumerated submode relationships after
  existing alias normalization. Unsupported or incompatible submodes remain visible
  as unknown with an explanation and are excluded from the POTA export subset.
  Values containing spaces, such as JT9E FAST, retain their standard spelling.
  This mode-validation correction is a source follow-up after the retained 1.5.4
  package; it requires a later separately versioned package for installed use.
  Programme record uniqueness
  includes the contacted park and excludes QSO time, so changing only the time
  does not remove a duplicate. One physical contact with two own and three
  contacted parks remains one event per own park, with three programme records
  per park; six expanded records do not establish six physical contacts. If only
  park-record expansion reaches ten, the result is **conditional**: how those
  expanded records satisfy the ten-QSO activation minimum remains unresolved.
  Until clarified, use ten supported distinct contact events and review unknown
  inputs and exclusions. Known self contacts, recorded terrestrial-repeaters and
  future UTC dates are excluded separately from missing evidence; satellite
  contacts are permitted. Local counting does not verify park access/boundaries,
  licensing, relays, automation, account ownership or portal acceptance.
- **Window → Alerts:** edit geography in each rule: search and add DX or spotter
  entities, choose their continents, and choose CQ/ITU zones for the DX station.
  Save, reopen and use Preview to inspect matching and nonmatching reports. Empty
  selections remain unrestricted. Conditions use AND across fields and OR within
  a field; missing evidence does not match a selected condition. Preview is read-only.
  Review spot retains the historical match reason and exact source identity.
  Tune & load is available only through the current admitted cluster workflow.
- **Settings → Logbook → Nearby spotted callsign suggestions:** opt in for Live
  QSO entries. Suggestions use the selected radio slot’s fresh RX frequency and
  passband, including split operation. A slot change, reconnect or worker change
  invalidates an earlier suggestion; switching away and back does not revive it.
  Use callsign accepts an empty callsign only; it never tunes, transmits, logs or
  replaces typed input. Several nearby calls remain a choice. Main and detached
  live entries share native admission.
- **Settings → Display → Shortcuts:** assign supported Normal Logging commands,
  capture a chord, inspect conflicts, reset one/all, and use shortcut help.
  Native lifecycle, Stop/Escape, CW and contest bindings keep their own contexts.
- **Settings → General → Station equipment:** manage antenna profiles, archive them, choose
  manual/per-band preferences or explicitly enable automatic software selection.
  To clear the active choice, select **No selected profile** and Save settings.
  Definitions and captured historical profiles remain available; an unavailable
  saved profile can be cleared or replaced using the same selector.
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
  new staged `.pota` directory with ADI files and a manifest. Choose a new
  destination: publication refuses to replace an existing file or directory,
  including on Windows. Club/group output
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

The [bounded connected acceptance checklist](../planning/OM0RX-xLog_QLog_Implementation_Plan_2026-11-03.md#88-bounded-pota-mode-validation-and-remaining-operator-acceptance--4-november-2026)
covers selected RX, suggestion invalidation, live alert matching and shared own-call
RBN observations. Offline fixtures do not supply live-station acceptance.
