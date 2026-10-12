---
version: 1
slug: "prototype-src-live-syncpanel-tsx"
primary_target: "prototype/src/live/SyncPanel.tsx"
related_targets: ["prototype/src/live/SyncPanel.css"]
---

## Direction contract

THESIS: Extend the existing Sync workspace with a field comparison that lets the operator retain local edits and choose selected remote values.

OWN-WORLD: Inherit the established navy console, system typography, restrained teal actions and amber attention states. Existing controls and table density remain the visual authority.

STORY: Read the conflict, compare local and Wavelog values, choose a source for each changed field, then save the merged contact locally. Synchronization remains a separate explicit action.

FIRST VIEWPORT: Manual sync and its single-writer confirmation lead. A compact conflict list opens into aligned Field, Local and Wavelog columns; selected values are indicated by radio controls. The merge-save action follows the comparison. Pending outbox remains below.

FORM: Precisely requested extension of the existing operate surface; no concept seed or replacement visual world. The distinguishing interaction is choosing sources while retaining a visible comparison.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Scope: New SyncPanel component/CSS/tests and service projection/resolution. Preserve the existing design system. Integrated browser inspection belongs to the parent task after wiring.
