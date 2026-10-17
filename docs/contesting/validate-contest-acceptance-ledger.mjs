#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");
const ledgerArgument = process.argv.indexOf("--ledger");
if (ledgerArgument >= 0 && !process.argv[ledgerArgument + 1]) fail("--ledger requires a path");
const ledgerPath = resolve(ledgerArgument >= 0 ? process.argv[ledgerArgument + 1] : join(here, "contest-acceptance-ledger.json"));
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const argument = process.argv.indexOf("--contest-sw");
if (argument >= 0 && !process.argv[argument + 1]) fail("--contest-sw requires a path");
const upstreamRoot = resolve(argument >= 0 ? process.argv[argument + 1] : ledger.upstream.auditedCheckout);

function fail(message) {
  throw new Error(`contest acceptance ledger: ${message}`);
}

function requireThat(condition, message) {
  if (!condition) fail(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function decodeXML(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function fnv64(value) {
  let hash = 14_695_981_039_346_656_037n;
  for (const byte of Buffer.from(value, "utf8")) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1_099_511_628_211n);
  }
  return `bundled-cty-fnv64-${hash.toString(16).padStart(16, "0")}`;
}

const pythonExtractor = String.raw`
import ast
import json
import pathlib
import sys

wanted = {"name", "cabrillo_name", "mode", "EXCHANGE_HINT", "columns", "dupe_type"}
result = {}
for raw in sys.argv[1:]:
    path = pathlib.Path(raw)
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    values = {}
    dynamic = set()
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if isinstance(target, ast.Name) and target.id in wanted:
                try:
                    values[target.id] = ast.literal_eval(node.value)
                except Exception:
                    dynamic.add(target.id)
    fields = {}
    for key in wanted:
        if key in dynamic:
            fields[key] = {"status": "dynamic-unresolved", "value": None}
        elif key in values:
            fields[key] = {"status": "source-static", "value": values[key]}
        else:
            fields[key] = {"status": "absent", "value": None}
    result[path.stem] = fields
print(json.dumps(result, separators=(",", ":")))
`;

function pythonWithASTSupport() {
  const candidates = [process.env.CONTEST_LEDGER_PYTHON, "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "python3"]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import sys; print(int(sys.version_info >= (3, 10)))"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim() === "1") return candidate;
  }
  fail("Python 3.10 or newer is required for safe AST validation of the pinned plugins");
}

function extractPluginContracts(paths) {
  const result = spawnSync(pythonWithASTSupport(), ["-", ...paths], { input: pythonExtractor, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  requireThat(result.status === 0, `Python AST extraction failed: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function equalJSON(lhs, rhs) {
  return JSON.stringify(lhs) === JSON.stringify(rhs);
}

requireThat(ledger.schemaVersion === 1, "schemaVersion must be 1");
requireThat(ledger.upstream.commit === "7c8b499225a73f7f8f792246881bd7aefc05452f", "unexpected pinned source commit");
requireThat(ledger.upstream.pluginPythonFileCount === 95, "expected 95 Python files including the initializer");
requireThat(ledger.upstream.contestPluginCount === 94, "expected 94 contest plugins");
requireThat(ledger.upstream.selectorEntryCount === 94, "expected 94 selector entries");
requireThat(ledger.plugins.length === 94, `expected 94 ledger rows, found ${ledger.plugins.length}`);
requireThat(ledger.upstream.excluded.length === 1 && ledger.upstream.excluded[0].path === "not1mm/plugins/__init__.py",
  "only not1mm/plugins/__init__.py may be excluded");
requireThat(ledger.upstream.excluded[0].reason.length > 20, "initializer exclusion requires a reason");
const expectedPilotBoundary = "Exactly twelve xLog rule implementations are recorded: six source-derived pilots for CQ WW, CQ WPX, and Oceania DX in CW and SSB; two official-corrected SAC 2026 practice previews in CW and SSB; three official-rules NAQP 2026 plain-logging previews in CW, SSB, and RTTY; and one official-rules ARRL RTTY Roundup plain-logging preview. Evidence is scoped by field and is not current sponsor, application, package, submission, full-port, digital-output, or operator acceptance.";
const expectedOfficialCorrectionBoundary = "SAC CW and SSB use the published SAC 2026 rules as operational authority and deliberately correct identified pinned-source defects. They are official-corrected practice and scoring previews, not claims of exact upstream parity or submission readiness.";
const expectedNAQPAuthorityBoundary = "NAQP CW, SSB, and RTTY use the published NCJ 2026 rules and multiplier form as primary authority. The pinned Python plugins remain compatibility comparators with recorded gaps; their commit is not the NAQP rule sourceRevision. These are plain-logging previews, not claims of exact upstream parity, full operating support, sponsor certification, or submission readiness.";
const expectedARRLRTTYAuthorityBoundary = "ARRL RTTY Roundup uses the published ARRL Rules v3.0b plus pinned ARRL/RAC section and current DXCC authority as primary authority. The pinned Python plugin remains a compatibility comparator with recorded gaps; its commit is not the rule sourceRevision. This is a plain-logging preview with versioned Cabrillo and ADIF output, not a claim of full Run/S&P operation, real RTTY generation/keying, category/date/operating-time enforcement, sponsor certification, or submission readiness.";
requireThat(ledger.interpretation.pilotBoundary === expectedPilotBoundary,
  "pilot boundary must record exactly twelve bounded rule implementations");
requireThat(ledger.interpretation.officialCorrectionBoundary === expectedOfficialCorrectionBoundary,
  "official-corrected SAC boundary is missing");
requireThat(ledger.interpretation.naqpAuthorityBoundary === expectedNAQPAuthorityBoundary,
  "NAQP primary-authority boundary is missing");
requireThat(ledger.interpretation.arrlRTTYAuthorityBoundary === expectedARRLRTTYAuthorityBoundary,
  "ARRL RTTY primary-authority boundary is missing");

requireThat(existsSync(upstreamRoot), `upstream checkout does not exist: ${upstreamRoot}`);
const actualHead = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
requireThat(actualHead === ledger.upstream.commit, `upstream HEAD is ${actualHead}`);
const upstreamStatus = execFileSync("git", ["-C", upstreamRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
requireThat(upstreamStatus === "", "upstream checkout has local changes");

const pluginRoot = join(upstreamRoot, ledger.upstream.pluginRoot);
const upstreamFiles = readdirSync(pluginRoot).filter((name) => name.endsWith(".py")).sort();
requireThat(upstreamFiles.length === 95, `upstream has ${upstreamFiles.length} Python files`);
requireThat(upstreamFiles.filter((name) => name !== "__init__.py").length === 94, "upstream contest plugin count changed");
const contestFiles = upstreamFiles.filter((name) => name !== "__init__.py");
const extractedContracts = extractPluginContracts(contestFiles.map((name) => join(pluginRoot, name)));

const selectorXML = readFileSync(join(upstreamRoot, "not1mm/data/new_contest.ui"), "utf8");
requireThat(sha256(join(upstreamRoot, "not1mm/data/new_contest.ui")) === ledger.upstream.selectorSourceSha256,
  "selector source hash mismatch");
const selectorBlock = selectorXML.match(/<widget class="QComboBox" name="contest">([\s\S]*?)<\/widget>/)?.[1];
requireThat(selectorBlock, "contest selector widget is missing");
const selectorLabels = [...selectorBlock.matchAll(/<item>[\s\S]*?<string>([\s\S]*?)<\/string>[\s\S]*?<\/item>/g)]
  .map((match) => decodeXML(match[1].trim()));
requireThat(selectorLabels.length === 94, `selector contains ${selectorLabels.length} entries`);
const selectorIDs = selectorLabels.map((label) => label.toLowerCase().replaceAll(" ", "_"));

const pluginIDs = new Set();
const sourcePaths = new Set();
const sourceHashes = new Set();
const selectorLabelSet = new Set();
const allowedObservation = new Set(["source-static", "dynamic-unresolved", "absent"]);
const sourcePilotIDs = new Set(["cq_ww_cw", "cq_ww_ssb", "cq_wpx_cw", "cq_wpx_ssb", "oceania_dx_cw", "oceania_dx_ssb"]);
const practicePreviewIDs = new Set(["sac_cw", "sac_ssb"]);
const naqpPreviewIDs = new Set(["naqp_cw", "naqp_rtty", "naqp_ssb"]);
const arrlRTTYPreviewIDs = new Set(["arrl_rtty_ru"]);
const officialRulesPreviewIDs = new Set([...naqpPreviewIDs, ...arrlRTTYPreviewIDs]);
const implementedIDs = new Set([...sourcePilotIDs, ...practicePreviewIDs, ...officialRulesPreviewIDs]);
const naqpRulesSHA = "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8";
const arrlRTTYRulesSHA = "87c9f0032e6ce502b4ae94d47b397a9a34c49a3eafdb5a50fc226694696fe1ce";
const naqpAuthority = JSON.parse(readFileSync(join(repositoryRoot, "Tests/XContestCoreTests/SourceFixtures/naqp-2026-authority.json"), "utf8"));
const arrlRTTYAuthority = JSON.parse(readFileSync(join(repositoryRoot, "Tests/XContestCoreTests/SourceFixtures/arrl-rtty-roundup-authority.json"), "utf8"));
requireThat(implementedIDs.size === 12, "expected exactly twelve bounded rule implementations");
requireThat(naqpAuthority.rulesURL === "https://ncjweb.com/NAQP-Rules.pdf" && naqpAuthority.rulesSHA256 === naqpRulesSHA,
  "NAQP primary rules authority mismatch");
requireThat(naqpAuthority.multiplierFormURL === "https://ncjweb.com/NAQP-Paper-Log-Form.pdf" &&
  naqpAuthority.multiplierFormSHA256 === "6ea80c5118f0520f95762cc679ff3ee05154d74dc1817a681664e690a01f5a8d",
  "NAQP multiplier authority mismatch");
const arrlRulesAuthority = arrlRTTYAuthority.primaryAuthorities.find((item) => item.name === "ARRL RTTY Roundup Rules v3.0b");
requireThat(arrlRulesAuthority?.url === "https://contests.arrl.org/ContestRules/RTTY-RU-Rules.pdf" &&
  arrlRulesAuthority?.sha256 === arrlRTTYRulesSHA, "ARRL RTTY primary rules authority mismatch");
requireThat(arrlRTTYAuthority.sourceComparator?.revision === ledger.upstream.commit &&
  arrlRTTYAuthority.sourceComparator?.path === "not1mm/plugins/arrl_rtty_ru.py" &&
  arrlRTTYAuthority.sourceComparator?.fileSha256 === ledger.plugins.find((row) => row.pluginID === "arrl_rtty_ru")?.source.sha256,
  "ARRL RTTY compatibility comparator mismatch");
const ruleIdentities = {
  cq_ww_cw: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  cq_ww_ssb: { id: "cq-ww-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  cq_wpx_cw: { id: "cq-wpx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  cq_wpx_ssb: { id: "cq-wpx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  oceania_dx_cw: { id: "oceania-dx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  oceania_dx_ssb: { id: "oceania-dx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  sac_cw: { id: "sac-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: ledger.upstream.commit },
  sac_ssb: { id: "sac-ssb", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: ledger.upstream.commit },
  naqp_cw: { id: "naqp-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: naqpRulesSHA },
  naqp_rtty: { id: "naqp-rtty", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: naqpRulesSHA },
  naqp_ssb: { id: "naqp-ssb", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: naqpRulesSHA },
  arrl_rtty_ru: { id: "arrl-rtty-roundup", version: "1.0.0-3.0b-preview", edition: "rules-3.0b-preview", sourceRevision: arrlRTTYRulesSHA },
};
const implementationStatuses = {
  cq_ww_cw: "source-derived-pilot", cq_ww_ssb: "source-derived-pilot",
  cq_wpx_cw: "source-derived-pilot", cq_wpx_ssb: "source-derived-pilot",
  oceania_dx_cw: "source-derived-pilot", oceania_dx_ssb: "source-derived-pilot",
  sac_cw: "official-corrected-practice-preview", sac_ssb: "official-corrected-practice-preview",
  naqp_cw: "official-rules-plain-logging-preview", naqp_rtty: "official-rules-plain-logging-preview", naqp_ssb: "official-rules-plain-logging-preview",
  arrl_rtty_ru: "official-rules-plain-logging-preview",
};
const ruleAuditStatuses = {
  cq_ww_cw: "audited-gaps-open", cq_ww_ssb: "audited-gaps-open",
  cq_wpx_cw: "audited-gaps-open", cq_wpx_ssb: "audited-gaps-open",
  oceania_dx_cw: "audited-gaps-open", oceania_dx_ssb: "audited-gaps-open",
  sac_cw: "official-corrected-audited-gaps-open", sac_ssb: "official-corrected-audited-gaps-open",
  naqp_cw: "official-rules-audited-gaps-open", naqp_rtty: "official-rules-audited-gaps-open", naqp_ssb: "official-rules-audited-gaps-open",
  arrl_rtty_ru: "official-rules-audited-gaps-open",
};
const scoringStatuses = {
  cq_ww_cw: "source-derived-tested", cq_ww_ssb: "source-derived-tested",
  cq_wpx_cw: "source-derived-tested", cq_wpx_ssb: "source-derived-tested",
  oceania_dx_cw: "source-derived-tested", oceania_dx_ssb: "source-derived-tested",
  sac_cw: "official-corrected-practice-tested", sac_ssb: "official-corrected-practice-tested",
  naqp_cw: "official-rules-and-compatibility-tested", naqp_rtty: "official-rules-and-compatibility-tested", naqp_ssb: "official-rules-and-compatibility-tested",
  arrl_rtty_ru: "official-rules-and-compatibility-tested",
};
const independentScoringStatuses = {
  cq_ww_cw: "independent-fixture-recorded",
  cq_ww_ssb: "independent-fixture-recorded",
  cq_wpx_cw: "independent-fixture-recorded",
  cq_wpx_ssb: "independent-fixture-recorded",
  oceania_dx_cw: "independent-arithmetic-tested",
  oceania_dx_ssb: "independent-arithmetic-tested",
  sac_cw: "independent-arithmetic-tested",
  sac_ssb: "independent-arithmetic-tested",
  naqp_cw: "independent-arithmetic-tested",
  naqp_rtty: "independent-arithmetic-tested",
  naqp_ssb: "independent-arithmetic-tested",
  arrl_rtty_ru: "independent-arithmetic-tested",
};
const mutationRestartStatuses = {
  cq_ww_cw: "process-and-store-tested",
  cq_ww_ssb: "native-store-and-local-worker-tested",
  cq_wpx_cw: "process-and-store-tested",
  cq_wpx_ssb: "native-store-and-local-worker-tested",
  oceania_dx_cw: "native-store-and-local-worker-tested",
  oceania_dx_ssb: "native-store-and-local-worker-tested",
  sac_cw: "native-store-and-worker-tested",
  sac_ssb: "native-store-and-worker-tested",
  naqp_cw: "store-and-worker-lifecycle-tested",
  naqp_rtty: "store-and-worker-lifecycle-tested",
  naqp_ssb: "store-and-worker-lifecycle-tested",
  arrl_rtty_ru: "store-and-worker-lifecycle-tested",
};
const exportStatuses = {
  cq_ww_cw: "source-derived-tested", cq_ww_ssb: "source-derived-tested",
  cq_wpx_cw: "source-derived-tested", cq_wpx_ssb: "source-derived-tested",
  oceania_dx_cw: "source-derived-tested", oceania_dx_ssb: "source-derived-tested",
  sac_cw: "practice-preview-goldens-tested", sac_ssb: "practice-preview-goldens-tested",
  naqp_cw: "versioned-preview-goldens-tested", naqp_rtty: "versioned-preview-goldens-tested", naqp_ssb: "versioned-preview-goldens-tested",
  arrl_rtty_ru: "versioned-preview-goldens-tested",
};
const certifications = {
  cq_ww_cw: "source-derived preview; operator and sponsor acceptance remain pending",
  cq_ww_ssb: "source-derived preview; operator and sponsor acceptance remain pending",
  cq_wpx_cw: "source-derived preview; operator and sponsor acceptance remain pending",
  cq_wpx_ssb: "source-derived preview; operator and sponsor acceptance remain pending",
  oceania_dx_cw: "source-derived preview; operator and sponsor acceptance remain pending",
  oceania_dx_ssb: "source-derived preview; operator and sponsor acceptance remain pending",
  sac_cw: "official-corrected practice preview; operator, sponsor, and submission acceptance remain pending",
  sac_ssb: "official-corrected practice preview; operator, sponsor, and submission acceptance remain pending",
  naqp_cw: "official-rules plain-logging preview; operator, native-entry, sponsor, and submission acceptance remain pending",
  naqp_rtty: "official-rules plain-logging preview; operator, native-entry, sponsor, and submission acceptance remain pending",
  naqp_ssb: "official-rules plain-logging preview; operator, native-entry, sponsor, and submission acceptance remain pending",
  arrl_rtty_ru: "official-rules plain-logging preview; full operator, digital-output, sponsor, category/date, and submission acceptance remain pending",
};
const expectedPlatformNote = "Run 39053085696 at 38fd897a3ac7ac2a16cc8f1ceff131c83cfba628 passed on macOS, Linux, and Windows: 62 core tests per OS; 51 store/snapshot tests on macOS and Linux and 56 on Windows; 14 worker lifecycle and 13 assistance tests per OS; and 27 export-support and 18 Rust tests per OS. This is native source/test evidence only and does not prove GUI, operator, sponsor, package, save-dialog, radio, or submission acceptance.";
const expectedNAQPPlatformNote = "NAQP core 2ee72e1c364199bcb38c185ed7b3a20c46a2bc84 and export 5ee75eae4186d71d7f38ac49d5ae43a23cc2e45d passed their three-platform matrices. Structured entry d22107292532a8f77737b4fcf68134f547ca7be4 is integrated at c0ac00ff05968d3fb90484643e22732451170121; run 39062402856 passed all six native jobs at that integration. This partial evidence does not prove full operator, package, radio, sponsor, or submission acceptance.";
const expectedARRLRTTYPlatformNote = "ARRL station-resolved core/store policy 5f9344145cf185df510443118e730fcd9f1f3df1 completed its three-platform matrix. Export d7cfa55f0d95ee4d96d39af1039ed3e1c9abeb73 passed all six jobs at 89bff236cf58e917b19dced947f48c803de95b25 in run 39063447673, and stage 1 authority wire 3e3da866ed7fd9d200f518319d7d4badb133702c passed all six jobs in run 39064390063. Entry 003b30ab5ed79ac96e502859e772075e49be1a92 has accepted source and focused local evidence; its integrated native matrix remains pending. This partial evidence does not prove package, radio, digital-output, full operator, sponsor, or submission acceptance.";
const actualReference = fnv64(readFileSync(join(repositoryRoot, "Sources/XLogCore/Resources/cty.csv"), "utf8"));
const actualReferenceSHA = sha256(join(repositoryRoot, "Sources/XLogCore/Resources/cty.csv"));
const observationCounts = { "source-static": 0, "dynamic-unresolved": 0, absent: 0 };
const customDupePlugins = [];

for (const row of ledger.plugins) {
  requireThat(!pluginIDs.has(row.pluginID), `duplicate pluginID ${row.pluginID}`);
  requireThat(!sourcePaths.has(row.source.path), `duplicate source path ${row.source.path}`);
  requireThat(!sourceHashes.has(row.source.sha256), `duplicate source hash ${row.source.sha256}`);
  requireThat(!selectorLabelSet.has(row.selector.label), `duplicate selector label ${row.selector.label}`);
  pluginIDs.add(row.pluginID);
  sourcePaths.add(row.source.path);
  sourceHashes.add(row.source.sha256);
  selectorLabelSet.add(row.selector.label);

  requireThat(row.source.path === `not1mm/plugins/${row.pluginID}.py`, `source path mismatch for ${row.pluginID}`);
  const sourcePath = join(upstreamRoot, row.source.path);
  requireThat(existsSync(sourcePath), `missing upstream source ${row.source.path}`);
  requireThat(sha256(sourcePath) === row.source.sha256, `source hash mismatch for ${row.pluginID}`);
  requireThat(row.source.identity === `contest-sw@${ledger.upstream.commit}:${row.source.path}`, `source identity mismatch for ${row.pluginID}`);
  requireThat(row.selector.available === true, `${row.pluginID} is not selector-available`);
  requireThat(row.selector.label.toLowerCase().replaceAll(" ", "_") === row.pluginID,
    `selector label does not derive ${row.pluginID}`);
  requireThat(row.selector.derivedPluginID === row.pluginID, `derived selector ID mismatch for ${row.pluginID}`);
  requireThat(selectorIDs.includes(row.pluginID), `selector source omits ${row.pluginID}`);

  const observations = [row.upstreamContract.displayName, row.upstreamContract.cabrilloName,
    row.upstreamContract.modes, row.upstreamContract.exchange.hint,
    row.upstreamContract.exchange.columns, row.upstreamContract.dupePolicy];
  const extracted = extractedContracts[row.pluginID];
  requireThat(extracted, `AST extraction omitted ${row.pluginID}`);
  const expectedObservations = [extracted.name, extracted.cabrillo_name, extracted.mode,
    extracted.EXCHANGE_HINT, extracted.columns, extracted.dupe_type];
  for (const observation of observations) {
    requireThat(allowedObservation.has(observation.status), `invalid source observation status for ${row.pluginID}`);
    observationCounts[observation.status] += 1;
    if (observation.status !== "source-static") requireThat(observation.value === null, `unresolved source value must be null for ${row.pluginID}`);
  }
  observations.forEach((observation, index) => requireThat(
    observation.status === expectedObservations[index].status && equalJSON(observation.value, expectedObservations[index].value),
    `source observation mismatch for ${row.pluginID}`));
  if (row.upstreamContract.dupePolicy.value === 5) {
    requireThat(row.upstreamContract.dupePolicy.meaning === "plugin-specific-dispatch-unverified",
      `custom duplicate policy is mislabeled for ${row.pluginID}`);
    requireThat(row.upstreamContract.dupePolicy.dispatchSource === "not1mm/__main__.py:4627-4630" &&
      row.upstreamContract.dupePolicy.behaviorVerification === "unverified", `custom duplicate dispatch evidence is incomplete for ${row.pluginID}`);
    customDupePlugins.push(row.pluginID);
  }

  const isImplemented = implementedIDs.has(row.pluginID);
  requireThat(row.xlogAcceptance.implementationStatus === (isImplemented ? implementationStatuses[row.pluginID] : "pending"),
    `implementation status mismatch for ${row.pluginID}`);
  const evidenceGroups = ["ruleAudit", "sourceDerivedScoringCases", "independentScoringCases", "mutationRestart", "exportGoldens", "runSP", "platform"];
  for (const group of evidenceGroups) {
    const evidence = row.xlogAcceptance[group].evidence;
    requireThat(Array.isArray(evidence), `invalid ${group} evidence for ${row.pluginID}`);
    for (const path of evidence) requireThat(existsSync(join(repositoryRoot, path)), `missing evidence ${path}`);
  }
  requireThat(row.xlogAcceptance.runSP.status === "pending" && row.xlogAcceptance.runSP.evidence.length === 0,
    `RunSP must remain pending for ${row.pluginID}`);
  if (isImplemented) {
    requireThat(equalJSON(row.xlogAcceptance.ruleIdentity, ruleIdentities[row.pluginID]), `rule identity mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.ruleAudit.status === ruleAuditStatuses[row.pluginID], `rule audit status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.sourceDerivedScoringCases.status === scoringStatuses[row.pluginID], `scoring status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.independentScoringCases.status === independentScoringStatuses[row.pluginID],
      `independent scoring status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.mutationRestart.status === mutationRestartStatuses[row.pluginID],
      `restart status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.exportGoldens.status === exportStatuses[row.pluginID], `export status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.platform.status === "partial", `platform status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.status === "runtime-derived-pinned-resource", `reference status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.value === actualReference, `reference identity mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.source === "Sources/XLogPrototypeSupport/Contesting/ContestLane.swift#ContestReferenceData.bundled",
      `reference source mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.resourceSha256 === actualReferenceSHA, `reference resource hash mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.ruleAudit.evidence.length > 0, `rule audit evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.sourceDerivedScoringCases.evidence.length > 0, `scoring evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.independentScoringCases.evidence.length > 0, `independent scoring evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.mutationRestart.evidence.length > 0, `restart evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.exportGoldens.evidence.length > 0, `export evidence missing for ${row.pluginID}`);
    const expectedPluginPlatformNote = naqpPreviewIDs.has(row.pluginID) ? expectedNAQPPlatformNote :
      arrlRTTYPreviewIDs.has(row.pluginID) ? expectedARRLRTTYPlatformNote : expectedPlatformNote;
    requireThat(row.xlogAcceptance.platform.note === expectedPluginPlatformNote,
      `platform evidence scope mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.certification === certifications[row.pluginID],
      `certification status mismatch for ${row.pluginID}`);
  } else {
    requireThat(row.xlogAcceptance.ruleIdentity === null, `unimplemented rule identity present for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.status === "pending", `unimplemented reference identity present for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.certification === "not implemented or accepted",
      `unimplemented certification status mismatch for ${row.pluginID}`);
    for (const group of ["ruleAudit", "sourceDerivedScoringCases", "independentScoringCases", "mutationRestart", "exportGoldens", "platform"]) {
      requireThat(row.xlogAcceptance[group].status === "pending" && row.xlogAcceptance[group].evidence.length === 0,
        `unimplemented ${group} evidence present for ${row.pluginID}`);
    }
  }
}

const expectedIDs = contestFiles.map((name) => basename(name, ".py"));
requireThat(expectedIDs.every((id) => pluginIDs.has(id)), "ledger does not cover every upstream plugin file");
requireThat(selectorIDs.every((id) => pluginIDs.has(id)), "ledger does not cover every selector entry");
requireThat(sha256(join(pluginRoot, "__init__.py")) === ledger.upstream.excluded[0].sha256, "initializer hash mismatch");

const summary = {
  ok: true,
  ledger: ledgerPath,
  upstreamHead: actualHead,
  upstreamClean: true,
  pluginRows: ledger.plugins.length,
  selectorEntries: selectorLabels.length,
  uniqueSourceHashes: sourceHashes.size,
  implementedRulePreviews: implementedIDs.size,
  implementedPilots: [...sourcePilotIDs].sort(),
  officialCorrectedPracticePreviews: [...practicePreviewIDs].sort(),
  officialRulesPlainLoggingPreviews: [...officialRulesPreviewIDs].sort(),
  pendingPlugins: ledger.plugins.length - implementedIDs.size,
  observationCounts,
  customDupePlugins: customDupePlugins.sort(),
};

if (process.argv.includes("--self-test")) {
  const temporary = mkdtempSync(join(tmpdir(), "xlog-contest-ledger-"));
  const checks = [];
  try {
    const mutations = [
      ["wrong-mode", (copy) => { copy.plugins.find((row) => row.pluginID === "sac_ssb").upstreamContract.modes.value = "CW"; }, "source observation mismatch"],
      ["wrong-dupe", (copy) => { copy.plugins.find((row) => row.pluginID === "oceania_dx_cw").upstreamContract.dupePolicy.value = 4; }, "source observation mismatch"],
      ["missing-rule-evidence", (copy) => { copy.plugins.find((row) => row.pluginID === "sac_cw").xlogAcceptance.exportGoldens.evidence = []; }, "export evidence missing"],
      ["fake-rule-identity", (copy) => { copy.plugins.find((row) => row.pluginID === "sac_ssb").xlogAcceptance.ruleIdentity.id = "fake-sac"; }, "rule identity mismatch"],
      ["wrong-naqp-authority", (copy) => { copy.plugins.find((row) => row.pluginID === "naqp_cw").xlogAcceptance.ruleIdentity.sourceRevision = copy.upstream.commit; }, "rule identity mismatch"],
      ["missing-naqp-evidence", (copy) => { copy.plugins.find((row) => row.pluginID === "naqp_rtty").xlogAcceptance.independentScoringCases.evidence = []; }, "independent scoring evidence missing"],
      ["premature-naqp-operator-claim", (copy) => { copy.plugins.find((row) => row.pluginID === "naqp_ssb").xlogAcceptance.runSP.status = "operator-accepted"; }, "RunSP must remain pending"],
      ["premature-naqp-native-claim", (copy) => { copy.plugins.find((row) => row.pluginID === "naqp_cw").xlogAcceptance.platform.status = "native-accepted"; }, "platform status mismatch"],
      ["premature-naqp-submission-claim", (copy) => { copy.plugins.find((row) => row.pluginID === "naqp_rtty").xlogAcceptance.certification = "submission-ready"; }, "certification status mismatch"],
      ["wrong-arrl-rtty-authority", (copy) => { copy.plugins.find((row) => row.pluginID === "arrl_rtty_ru").xlogAcceptance.ruleIdentity.sourceRevision = copy.upstream.commit; }, "rule identity mismatch"],
      ["missing-arrl-rtty-evidence", (copy) => { copy.plugins.find((row) => row.pluginID === "arrl_rtty_ru").xlogAcceptance.mutationRestart.evidence = []; }, "restart evidence missing"],
      ["premature-arrl-rtty-digital-output-claim", (copy) => { copy.plugins.find((row) => row.pluginID === "arrl_rtty_ru").xlogAcceptance.runSP.status = "digital-output-accepted"; }, "RunSP must remain pending"],
      ["premature-arrl-rtty-submission-claim", (copy) => { copy.plugins.find((row) => row.pluginID === "arrl_rtty_ru").xlogAcceptance.certification = "submission-ready"; }, "certification status mismatch"],
      ["falsely-completed-unsupported-plugin", (copy) => { copy.plugins.find((row) => row.pluginID === "cq_wpx_rtty").xlogAcceptance.certification = "complete"; }, "unimplemented certification status mismatch"],
    ];
    for (const [name, mutate, expected] of mutations) {
      const copy = JSON.parse(JSON.stringify(ledger));
      mutate(copy);
      const path = join(temporary, `${name}.json`);
      writeFileSync(path, `${JSON.stringify(copy)}\n`);
      const rejected = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--ledger", path, "--contest-sw", upstreamRoot], { encoding: "utf8" });
      requireThat(rejected.status !== 0 && rejected.stderr.includes(expected), `negative check ${name} did not fail as expected`);
      checks.push(name);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  summary.negativeChecks = checks;
}

console.log(JSON.stringify(summary, null, 2));
