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
const pilotIDs = new Set(["cq_ww_cw", "cq_wpx_cw"]);
const pilotRuleIdentities = {
  cq_ww_cw: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
  cq_wpx_cw: { id: "cq-wpx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: ledger.upstream.commit },
};
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

  const isPilot = pilotIDs.has(row.pluginID);
  requireThat(row.xlogAcceptance.implementationStatus === (isPilot ? "source-derived-pilot" : "pending"),
    `implementation status mismatch for ${row.pluginID}`);
  const evidenceGroups = ["ruleAudit", "sourceDerivedScoringCases", "independentScoringCases", "mutationRestart", "exportGoldens", "runSP", "platform"];
  for (const group of evidenceGroups) {
    const evidence = row.xlogAcceptance[group].evidence;
    requireThat(Array.isArray(evidence), `invalid ${group} evidence for ${row.pluginID}`);
    for (const path of evidence) requireThat(existsSync(join(repositoryRoot, path)), `missing evidence ${path}`);
  }
  requireThat(row.xlogAcceptance.runSP.status === "pending" && row.xlogAcceptance.runSP.evidence.length === 0,
    `RunSP must remain pending for ${row.pluginID}`);
  requireThat(row.xlogAcceptance.independentScoringCases.status === "pending" && row.xlogAcceptance.independentScoringCases.evidence.length === 0,
    `independent scoring must remain pending for ${row.pluginID}`);
  if (isPilot) {
    requireThat(equalJSON(row.xlogAcceptance.ruleIdentity, pilotRuleIdentities[row.pluginID]), `pilot rule identity mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.ruleAudit.status === "audited-gaps-open", `pilot audit status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.sourceDerivedScoringCases.status === "source-derived-tested", `pilot scoring status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.mutationRestart.status === "pilot-integrated-tested", `pilot restart status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.exportGoldens.status === "source-derived-tested", `pilot export status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.platform.status === "partial", `pilot platform status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.status === "runtime-derived-pinned-resource", `pilot reference status mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.value === actualReference, `reference identity mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.resourceSha256 === actualReferenceSHA, `reference resource hash mismatch for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.ruleAudit.evidence.length > 0, `pilot rule audit evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.sourceDerivedScoringCases.evidence.length > 0, `pilot scoring evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.mutationRestart.evidence.length > 0, `pilot restart evidence missing for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.exportGoldens.evidence.length > 0, `pilot export evidence missing for ${row.pluginID}`);
  } else {
    requireThat(row.xlogAcceptance.ruleIdentity === null, `unimplemented rule identity present for ${row.pluginID}`);
    requireThat(row.xlogAcceptance.referenceIdentity.status === "pending", `unimplemented reference identity present for ${row.pluginID}`);
    for (const group of ["ruleAudit", "sourceDerivedScoringCases", "mutationRestart", "exportGoldens", "platform"]) {
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
  implementedPilots: [...pilotIDs].sort(),
  pendingPlugins: ledger.plugins.length - pilotIDs.size,
  observationCounts,
  customDupePlugins: customDupePlugins.sort(),
};

if (process.argv.includes("--self-test")) {
  const temporary = mkdtempSync(join(tmpdir(), "xlog-contest-ledger-"));
  const checks = [];
  try {
    const mutations = [
      ["changed-mode", (copy) => { copy.plugins.find((row) => row.pluginID === "10_10_fall_cw").upstreamContract.modes.value = "SSB"; }, "source observation mismatch"],
      ["changed-dupe", (copy) => { copy.plugins.find((row) => row.pluginID === "10_10_fall_cw").upstreamContract.dupePolicy.value = 4; }, "source observation mismatch"],
      ["falsely-completed-pilot-audit", (copy) => { copy.plugins.find((row) => row.pluginID === "cq_ww_cw").xlogAcceptance.ruleAudit.status = "complete"; }, "pilot audit status mismatch"],
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
