# Super Check Partial operator browser acceptance

This acceptance is an opt-in, headless development gate for the Contesting Test
profile. It drives the production `ContestWorkspace`, `ContestAssistancePanel`,
typed callsign-assistance client, mutation owner, `LiveWorker`, contest store,
SCP importer/cache, scoring, and export pipeline. It does not stage or launch an
application bundle and does not exercise the native macOS or `rfd` file chooser.

The browser receives no file path. Its Import action calls a loopback-only test
endpoint, and the Swift test host maps the closed selectors `valid` and
`invalid` to files it owns under the fresh acceptance root. The host then sends
the same private worker import request used by the native chooser. The panel
still validates the framed import reply and confirms the announced digest with
the production status request.

The deterministic valid corpus covers exact, prefix, and partial-call ranking,
duplicate removal, and more than 20 eligible candidates. The expected 20 rows
are derived independently from equal-length, equal-score source records and
their source order. Returning 20 candidates does not make `isPartial` true:
that flag means the 100,000-record evaluation budget stopped before the end of
the catalog. This small corpus must report the complete unique record count as
`evaluatedRecordCount` and `isPartial: false`.

The browser scenarios check debounce admission, invalid replacement retention,
authoritative selection, cancellation, live callsign/session response races,
reserved-serial preservation, structured received-field preservation,
one selected contact through log and score, both in-memory export formats, and
cache restoration after a fully awaited worker restart. Delivery gates hold an
already returned real worker frame and record its frame identity; they do not
invent search or selection results. Generation replacement is confined to the
private acceptance root. The generation check proves that the real service
rejects the old generation and that route replacement retires the old browser
consumer before its held reply is released. It does not claim that an already
mounted assistance panel independently discovers an external generation
change without that product lifecycle transition.

Run the outer guard from a clean reviewed commit:

```sh
node prototype/scripts/run-contest-scp-operator-browser-acceptance.mjs \
  --expected-head <commit> \
  --output <new-private-output-directory> \
  --scratch-path <absolute-private-swiftpm-scratch>
```

The outer runner compiles the real XCTest host, proves response and shutdown
stall recovery by terminating and reaping its owned process group, then runs
the scenario. Evidence records source state, host and runner hashes, browser
actions, complete framed exchanges, lifecycle operations, corpus identity,
exports, screenshots, private-root inventory, and sampled metadata for the two
protected normal database families. Bounded raw stdout and stderr from the
build, scenario, and both forced-stall probes are saved beside the outer
manifest with byte counts and SHA-256 digests. These metadata samples can show that the
named files did not change during the run; they are not an operating-system
audit of every possible external read or write.

Passing this gate is not packaged application, native chooser, save-dialog,
real radio, network, RF, audio, PTT, hardware, provider-authenticity, or sponsor
submission acceptance.

The first clean committed run at `ad89ca5940854305be71c72216449c272910c51d`
was preserved as failed evidence under
`/Users/oliver/.codex/acceptance/contest-scp-operator-clean-ad89ca5`. It exposed
two distinct issues: repeated authoritative validation messages used their text
as React keys, and the acceptance driver attempted manager navigation while an
autosave still disabled the button. The bounded browser and XCTest process
groups were reaped with no lingering PIDs. The product now gives validation
rows positional presentation keys, while the driver waits for the same enabled
state a user must observe before navigation. The driver deadline and the
zero-console-error assertion remain unchanged.

A fresh dirty-development recovery run used scratch
`/Users/oliver/.codex/build/contest-scp-operator-repair-dev1` and evidence root
`/Users/oliver/.codex/acceptance/contest-scp-operator-repair-dev1`. It completed
115 worker frames, six lifecycle frames, and two in-memory exports. Both forced
stall probes reaped their owned process groups without lingering PIDs, and the
sampled protected database metadata was unchanged. The run is repair evidence,
not a clean committed acceptance: its manifest records the four reviewed dirty
paths and tracked diff SHA-256
`6da570a0bf55cbb1b8f6c57e742ea35d44d0fc13ca45e1c0c8d8f3121be67cac`.
A clean committed rerun remains required after review and commit.
