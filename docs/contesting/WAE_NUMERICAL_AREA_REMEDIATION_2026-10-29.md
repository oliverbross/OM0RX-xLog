# WAE numerical-area correction and retained sessions

This is a scoring-definition patch, 1.0.1, for the already pinned DARC edition
2025-06-17 / 2026 event dates. It corrects Japanese calls with a digit in their
national prefix: JR4AAA, 7K4ABC and 7M4XYZ share JA4. An explicit portable area,
such as `/9`, continues to override the base call. It does not assert that every
current sponsor category or rule has been independently certified.

New WAE sessions use 1.0.1. Existing 1.0.0 sessions remain readable with contacts,
exchanges, drafts, QTC history and operation receipts retained. Reads and reopen
do not silently change their numerical score. Their old score is marked incomplete
with an instruction to review and use the existing **Recalculate** action. A new
Cabrillo claim from that legacy policy is blocked until explicit adoption; ADIF
interchange remains available.

After reviewing the retained log and keeping its normal recovery backup, the
operator can use **Recalculate** to adopt 1.0.1. Adoption, rebuild and the retry
receipt share the existing transaction. The draft and original contact identities
are preserved. Review the resulting multiplier/score change before preparing a
new submission; three qualifying 20m contacts in the example above yield 3 points,
weighted multiplier 2 and total 6. Historical receipts remain historical and are
not rewritten to pretend they used the new definition.

Definition 1.0.1 participates in multi-operator authority identity. An old-policy
peer must not silently reconcile under the new scoring policy. Coordinate the
software/definition adoption across the group and preserve old replica stores.
There is no automatic migration of bound replica sessions: establish a fresh,
matching 1.0.1 client session and reviewed baseline synchronization rather than
editing stored bindings or forcing an old cursor past the mismatch. Legacy 1.0.0
groups retain their old identity until the authority explicitly adopts 1.0.1.

Regression evidence covers CW/SSB/RTTY score/export, portable correction, reopen,
legacy read preservation, explicit adoption/replay, draft/contact preservation
and a changed authority digest. No production log, native UI, provider, actual
LAN group or sponsor submission was operated during remediation.
