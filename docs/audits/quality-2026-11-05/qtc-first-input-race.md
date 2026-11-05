# QTC first-input reset

The original 1.5.19 Windows gate, source
`72a5926c2878ceedf70789ff4bae619ae5e14511`, failed one of 5,223 frontend tests
in [run 42008808018](https://github.com/oliverbross/OM0RX-xLog/actions/runs/42008808018).
The QTC-only dupe review test could not find its DL1ABC marker after the first
checkbox click. Build/Windows packaging did not run after that frontend failure.
The complete log and original rendered DOM are retained privately. Missing
`checked` markup alone does not establish the checkbox's live property value.

A new real-React regression observes the first committed QTC checkbox and
clicks it immediately, without sleeping or mocking effect scheduling. Before
the application fix, the actual `input.checked` property became false instead
of remaining true. This reproduces lost input independently of the original
missing-marker assertion. The unchanged production BandMaps source hash was
`f53048db3d9a36c2f547fa125f5a78ed22eb8f06224b787e95b84ed0d4d23f7b`.
The baseline log SHA-256 is
`c0c45f027080c03eccdf65ad31e4210aabdad097d1bd38191693de0f1e1330fb`.
That initial failure occurs before any review action. An intermediate new
fixture also copied an extra field into the strict native action receipt;
the receipt mock was corrected to its actual `requestID`/`status` contract.
That separate fixture mistake and its failed log remain retained.

`BandMaps` initialized QTC-only state to false and repeated the namespace reset
in a passive effect. That effect could erase the first accepted click. The
repair moves the same false reset and namespace dependency to a layout effect,
so the identity reset completes before paint. QTC marker selection still uses
the existing fenced, silent review action. Ordinary spot selection, output
authority and station supervision are unchanged.

Regression coverage checks the actual checkbox property, a worked-QSO QTC
marker, the exact context/session/workspace/draft/revision review envelope and
absence of spot selection/output. A replacement-namespace case also preserves
the reset boundary. The original failing test remains in the suite. No test
deadline or assertion is relaxed. New application bytes require a successor
version; the 1.5.19 failure is retained rather than overwritten by a retry.

Validation after the layout reset: both new cases passed; the complete
BandMaps and DetachedContestSurface suites passed **257/257** tests (57 + 200)
with Vitest 5.0.3 and `--maxWorkers=1`. TypeScript and `git diff --check` passed.
The replacement-namespace case covers preserved reset/review behavior; its
baseline's invalid mock receipt is not independent proof of lost namespace
input. The original first-commit property failure is the red-to-green proof.
Affected-suite log SHA-256:
`8a8c3172518ab2649b2eb70735bd36b99a1402e67602a5e0ea92a55d141813ad`.
These are source-level tests; successor native package checks remain required.
