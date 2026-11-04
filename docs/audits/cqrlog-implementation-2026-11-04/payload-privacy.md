# Bounded public-country-pack release inspection

The 1.5.10 candidate at `db7d4bb5` completed compilation and Developer ID signing,
then correctly stopped at the existing privacy guard: its 6,024,769-byte public
country pack exceeded the general 4 MiB JSON inspection limit. No archive was
published, first signed-worker/UI/100k gates were not run, and the installed app
was not changed. The exact failed signed copy and original false report remain
in `.build/releases/1.5.10/`; [candidate accounting](../../releases/v1.5.10-cqrlog-candidate.md)
records the executable hashes.

The scanner now grants only the exact `country-reference-pack.json` basename a
16 MiB read-plus-one bound, below the owning Swift validator's 32,000,000-byte
ceiling. Every parsed value still receives the complete recursive privacy check
before public-data qualification. The additional strict public schema rejects
unknown/duplicate keys, invalid source URLs, field/date/pattern/record bounds and
non-finite coordinates. The ordinary 4 MiB JSON limit is unchanged. The same
bounded inspection applies to ordinary files, gzip, ZIP and gzip members in ZIP;
it is not a filename exemption from inspection.

`python3 prototype/scripts/test-release-payload.py` passes **16/16**, with the
original 12 cases unchanged. Four new cases exercise the actual six-megabyte
resource, all four transports, late nested credential/QSO injections beyond
4 MiB, malformed/duplicate/oversized packs, invalid public shapes and wrong
filenames. Injections produce the actual private-setting/QSO reason. A malformed
test fixture was corrected to remove the closing JSON brace, rather than its
trailing newline; the final complete run supersedes that setup failure.
`py_compile` and scoped diff checks pass. Raw output is retained as
`/tmp/xlog-release-payload-public-pack-tests.log`, SHA-256
`261f7940abe9cf34404d143c4da8897696e3b972afcf3a7522a713a9a051a808`.

The corrected inspector was independently run over the retained, unmodified
signed 1.5.10 app: **3,546 files, zero findings, exit 0**. Its report is retained
separately from the original failure. This establishes the inspection repair;
it does not retrofit the unrun package/native gates. The corrected-source build
will use new version **1.5.11**, preserving exact candidate/source provenance.
