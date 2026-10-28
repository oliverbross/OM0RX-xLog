from pathlib import Path
R=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
files=[R/'CODE_REVIEW.md',R/'REVIEW_COVERAGE.md',R/'docs/reviews/full-code-review-verification-2026-10-29/README.md']
replacements={
 'at12824393':'at `12824393`','at2710–2715':'at 2710–2715',
 'source at12824393':'source at `12824393`','diff4bd554a→12824393':'diff `4bd554a`→`12824393`',
 'serial2':'serial 2','grants3':'grants 3','grant2':'grant 2','grant3':'grant 3',
 'claims are12':'claims are 12','pinned-rule6':'pinned-rule 6','cursor2':'cursor 2',
 'logbook2003':'logbook 2,003','loaded2000':'loaded 2,000','exported2000':'exported 2,000',
 'official3.1.7':'official 3.1.7','score12':'score 12','produce6':'produce 6',
 'database contains2,003':'database contains 2,003','loads2,000':'loads 2,000',
 'writes\n2,000':'writes\n2,000','omitting3':'omitting 3','above2,000':'above 2,000',
 'ADIF3.1.7':'ADIF 3.1.7','the179':'the 179','contains181':'contains 181',
 'suite pass37':'suite pass 37','PASS12':'PASS 12','PASS37':'PASS 37','in4 suites,0.944s':'in 4 suites, 0.944s',
 'only8':'only 8','PASS41,19.224s':'PASS 41, 19.224s','whole537':'whole 537',
 'PASS1408':'PASS 1408','|3 expected':'| 3 expected',',6 passes':', 6 passes',
 'control,3 writer':'control, 3 writer',',2 modeled':', 2 modeled',',45 skipped':', 45 skipped',
 'the97-definition':'the 97-definition','Core/SQLite':'core/SQLite',
 'the cumulative depth of30':'the cumulative depth of 30',
 'increased87→100; partial79→93':'increased 87→100; partial 79→93',
 'scan-only1,435→1,410; unreviewed617→615':'scan-only 1,435→1,410; unreviewed 617→615',
 'The62':'The 62','frozen2,347':'frozen 2,347','join/matching571–764':'join/matching 571–764',
 'draft12/12':'draft 12/12','policy37/37':'policy 37/37','Python41/41':'Python 41/41',
 'frontend1408/1408':'frontend 1408/1408','has3 expected failures;6':'has 3 expected failures; 6',
 'main12824393':'main `12824393','f2f8;':'f2f8`;',
 'from4bd554a25951ddc995b4bef1715d3df12918a07b.':'from `4bd554a25951ddc995b4bef1715d3df12918a07b`.',
 'spanned28–29':'spanned 28–29','up to12 (2 High,9 Medium,1 Low)':'up to 12 (2 High, 9 Medium, 1 Low)',
 'exact2,347':'exact 2,347','counts,70':'counts, 70','paths,30':'paths, 30',
 'and97-contest':'and 97-contest','the41-test':'the 41-test','five1408-test':'five 1408-test',
 'outcome:3':'outcome: 3','failures,6 passes':'failures, 6 passes','passes,\n45':'passes,\n45',
 'exit0':'exit 0','ADX3.1.7':'ADX 3.1.7','stores1/announces2':'stores 1/announces 2',
 'stores2':'stores 2','announces2':'announces 2',
 'RemoteBackup(Owner|Scheduler|Authorization|RetentionReview)"` |':'RemoteBackup(Owner\\|Scheduler\\|Authorization\\|RetentionReview)"` |',
}
for p in files:
    s=p.read_text()
    for a,b in replacements.items():s=s.replace(a,b)
    if p.name=='CODE_REVIEW.md':
        s=s.replace('then\nordinary Quit/EOF without explicit disconnect.', 'then\nquit normally or reach worker EOF without explicit disconnect.')
        s=s.replace('before and after both Hosts reopen.','before and after both Hosts reopen.')
    if p.name=='REVIEW_COVERAGE.md':
        s=s.replace('Seal/path capture/materialization, staged SQLite verification, recovery/rollback/incomplete marker, local adapters, FTP/TLS/OneDrive boundary | Core authorization, scheduler, snapshot owner and retention/deletion coordinator now fully read; host/transport/retry/restore combinations remain partial; no personal backup/cloud operation',
        'Seal/path capture/materialization, staged SQLite verification, recovery/rollback/incomplete marker, local adapters, FTP/TLS/OneDrive boundary; core authorization, scheduler, snapshot owner and retention/deletion coordinator now fully read | Host/transport/retry/restore combinations remain partial; no personal backup/cloud operation')
        s=s.replace('537 tests and real Host probes | Continued setup/engine/new-state/exchange validators and overlay ranges; multipliers.py fully read. Full Host/upstream, analytics/message/strategy tails and remaining test assertions still open',
        'first-pass 537 tests and real Host probes; continued setup/engine/new-state/exchange validators and overlay ranges; multipliers.py fully read | Full Host/upstream, analytics/message/strategy tails and remaining test assertions still open')
        s=s.replace('`multipliers.py`, analytics/messages/strategy and remaining Swift rule/export/', 'remaining multiplier integration/test oracles, analytics/messages/strategy and Swift rule/export/')
        s=s.replace('protocols/controllers, settings journals, remaining import/export integration and independent schema oracles (codec source now full), detached\n   window transitions,', 'protocols/controllers, settings journals, remaining import/export integration and\n   independent schema oracles (codec source now full), detached window transitions,')
        s=s.replace('First-pass full outputs, including failures, remain in the original `checks/`; commands are in the evidence\nREADME', 'First-pass full outputs, including failures, remain in the original `checks/`;\ncommands are in the evidence README')
    p.write_text(s)
print('Polished report prose and table formatting')
