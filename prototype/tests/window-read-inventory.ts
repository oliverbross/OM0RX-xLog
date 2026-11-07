/** Review inventory, checked against the owning native registry by its test.
 * Readiness describes authority/data origin, not permission to reuse controls. */
export const normalWindowReads = [
  { id: "about", policy: "static", initial: "Application version and links; no worker read" },
  { id: "hm-control", policy: "retained-native", initial: "hm_control_snapshot (separate HTML entry)" },
  { id: "operating-goals", policy: "explicit-query", initial: "Form immediately; evaluation only after operator submits targets" },
  { id: "previous-qsos", policy: "draft-scoped-local", initial: "Canonical draft, then bounded cluster_history for its callsign" },
  { id: "callsign-intelligence", policy: "draft-scoped-local", initial: "Canonical draft, keyed lookup cache, bounded local history and preferences" },
  { id: "log-qso", policy: "canonical-editor", initial: "Canonical draft/receipt first; lookup and previous QSOs are secondary" },
  { id: "spot-history", policy: "bounded-local", initial: "Archive page, then same-watermark statistics; visible status poll 5s" },
  { id: "monitor", policy: "retained-native", initial: "monitor_context_snapshot plus map_context_snapshot; freshness fences retained" },
  { id: "world-map", policy: "retained-native", initial: "map_context_snapshot; metadata and spots already held by native owner" },
  { id: "dxpedition-map", policy: "retained-then-feed", initial: "opportunities_dxpedition_snapshot and map context, then automatic public feeds" },
  { id: "band-maps", policy: "retained-native", initial: "map_context_snapshot; metadata and spots already held by native owner" },
  { id: "dx-cluster", policy: "retained-native", initial: "Shared cluster projection/session; no independent connection owner" },
  { id: "logbook", policy: "bounded-local", initial: "First 20 rows paint before additional bounded page frames; main idle prewarm" },
  { id: "awards", policy: "revision-cached-local", initial: "logbook_stats and paged logbook_catalog; shared worker aggregate caches" },
  { id: "settings", policy: "canonical-editor", initial: "Current Settings/rotor/layout sessions; no generic settings result cache" },
  { id: "chaser-dx", policy: "retained-then-feed", initial: "Retained opportunities_snapshot, then admitted feeds; hidden timers paused" },
  { id: "hf-propagation-live", policy: "retained-then-feed", initial: "Bounded retained public reports, then admitted public feeds; hidden timers paused" },
  { id: "station-control", policy: "live-owner", initial: "Retained monitor context and radio session; no control cache" },
  { id: "cw", policy: "live-owner", initial: "cw_session_request snapshot; native lease and output authority remain live" },
  { id: "rotor", policy: "live-owner", initial: "rotor_telemetry_snapshot and automatic/manual owner state; no motion cache" },
  { id: "station-status", policy: "retained-native", initial: "station_status_snapshot; epoch/revision/provider and age checked" },
  { id: "connection-doctor", policy: "retained-native", initial: "connection_doctor_snapshot; passive saved observation only" },
  { id: "propagation", policy: "retained-then-feed", initial: "Shared propagation projection/ensure; native TTL and singleflight own fetches" },
  { id: "station-identity", policy: "retained-native", initial: "station_identity_snapshot; no credential/settings request or poller" },
  { id: "alerts", policy: "retained-native", initial: "alerts_snapshot; retained reports with explicit current/unavailable state" },
  { id: "antenna", policy: "retained-native", initial: "antenna_snapshot; read-only configured profile with revision fences" },
] as const;

export const contestWindowReads = [
  "active-qso", "call-history", "qrz-details", "group-chat", "band-maps", "world-map",
  "callsign-intelligence", "monitor", "score-reporting", "messages", "propagation", "awards", "chaser-dx",
  "rotor", "station-control", "logbook", "edit-contact", "dx-cluster",
] as const;

export const contestDialogViews = [
  "contest-setup", "contest-setup-operator", "contest-setup-station", "contest-setup-configuration",
  "contest-setup-macros", "contest-setup-keys", "contest-setup-rover", "contest-setup-about",
  "contest-setup-digital", "contest-log-transfer", "contest-log-review", "contest-analytics", "contest-recorder",
] as const;
