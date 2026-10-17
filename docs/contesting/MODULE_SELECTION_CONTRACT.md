# Exclusive Normal Logging / Contesting operation

Planning checkpoint against `c0ac00ff05968d3fb90484643e22732451170121`.
Implementation and acceptance remain open. This fulfils a required part of the
approved programme; it is not an additional permission gate.

## Required result

The operator chooses Normal Logging or Contesting. Only the chosen module may
own operator edits, QSO commits, spot-to-draft actions and station output.
Both modules retain their durable drafts and recovery information. Shared
station services, reference data, visual components and mutation owners are
reused. A different operating module is not a different radio connection or
a second transmit owner.

The operating choice is independent of the runtime profile. The Contesting
Test profile must continue to disable external I/O whichever module is chosen.
Enabling production contest storage is a separate reviewed change after the
latest installed main source is runtime-accepted.

## Existing behavior and reuse points

- `prototype/src/LiveApp.tsx` currently selects the contest view and hides the
  normal desk. Its `displayedSeparateWindows` flag changes presentation; it
  does not prove detached normal editors or their native commands are retired.
- The existing normal draft/contact/mutation sessions expose pending,
  uncertain, dirty and conflict states. `protectOperatorDraftClose` already
  prevents closing a normal editor while those states need attention.
- `prototype/src/contesting/sessionOwner.ts` retains drafts and uncertain
  mutations and supplies lease/admission invalidation. Reuse that ownership
  rather than adding another independent contest save queue.
- `close_main_window` validates the editor transition and destroys the main
  window only. It does not close every detached window or constitute an
  awaited application-wide shutdown.
- Native exit handlers revoke or stop the existing station, CW, rotor and
  worker owners. Several calls are best effort, so requesting exit alone is
  not proof that an exclusive transition completed successfully.

## Implementation order

### Read-only main-source refresh, 18 October 2026

The canonical checkout was verified clean at
`e741010453b9026be55ba0f657cc5aa188dd28d6`, currently on
`codex/dual-radio-settings` tracking the corresponding origin branch. The main
chat still holds its installed 1.2.18 runtime acceptance. This is an integration
audit, not permission to merge that unaccepted baseline. Resolve the accepted
installed commit explicitly when the hold clears; the local branch named
`main` is not a substitute for the actual installed-source coordinate.

Comparison with the shared contest baseline
`e42376db0bd65c1b2b5668692a52ed12cd802536` adds these transition requirements:

- `LiveApp.tsx` now debounces spot selection and retains the latest queued spot
  while activation or draft recovery finishes. Module retirement must cancel
  or fence the debounce, queued selection and deferred drain/recovery callbacks.
  A queued normal-log spot must not execute after entering Contesting or after
  returning to a new Normal Logging context.
- Follow Radio admission now reconciles a retained radio-read journal before
  enabling follow. Preserve that recovery path and its reservation check; a
  module switch cannot erase the journal or bypass it merely by closing a UI.
- Native spot activation, observed radio state and remote simplex tuning have
  changed together. Integrate the accepted source as a reviewed whole and rerun
  its ownership/readback tests alongside module-switch tests; do not transplant
  only the visible React changes.
- Normal QSO creation and editing now apply mode-aware signal-report defaults.
  Preserve those normal-log changes while contest reports remain governed by
  the contest descriptor and frozen QSO values, including report-free NAQP.

The source audit caused no canonical edits, package/install action, station
command or changes to the active module. All implementation gates below remain
open until the main baseline is runtime-accepted.

### Transition implementation

1. Audit the latest runtime-accepted main source before changing shared native
   ownership. Record its exact installed-source and build provenance.
2. Reuse the existing editor-close and owner-revocation mechanisms to define
   one authoritative module transition. Reject new operator actions once the
   transition starts. Dirty text must first be durably retained; unresolved
   saves, serials, station actions or recovery states must keep the current
   module available for reconciliation rather than disappear.
3. Prefer a deliberate close/restart boundary for the initial module switch
   if it can provide verified retirement of all module windows and owners.
   Do not add an in-process hot switch merely for convenience. Neither a
   hidden view nor destruction of the main window is sufficient.
4. Bind operator requests to the active module and a fresh runtime context.
   Native/worker admission must reject inactive-module and stale-context
   writes, including delayed callbacks after switching away and back. Keep
   existing rule identities, workspace generations, receipts and consumed
   serials intact; the operating context has a separate lifetime.
5. Reconstruct the chosen module from its durable state. Reopen no inactive
   operator surfaces. Clear armed/repeating output intent; never resume a
   simulated or physical send merely because a module was selected.
6. Expose the choice using existing xLog controls and menu styling. Keep the
   selected module visible and explain any specific recovery state preventing
   a switch. Verify keyboard focus, detached-window behavior and draft return.

## Acceptance gates

- Normal → Contesting → Normal retains normal draft text, contest draft text,
  session selection, reservations and exact pending receipt identities.
- Delayed draft replies, spot activations, shortcuts, double-clicks and
  callbacks from destroyed windows cannot write into either replacement
  context. Include switching away and back, not only a single transition.
- In-flight, uncertain and rejected mutations have explicit recovery paths;
  a switch cannot silently discard or retry them.
- All inactive normal QSO and CW surfaces are closed or made non-operating by
  authoritative admission, not simply hidden by CSS or navigation.
- A failed close/shutdown/restart does not report success or start a second
  operating owner. Stop/recovery remain reachable where necessary.
- Synthetic tests prove both module directions with all external I/O disabled.
  Packaged three-platform and station-owner behavior require their own proof
  after canonical integration; source and browser checks do not satisfy them.
