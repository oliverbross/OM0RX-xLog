"""Render the catalogue matrix from saved disposable qualification results.

This does not run contests, touch operator data, or manufacture acceptance.
Run check_all_contests_readiness.py first; refresh after the final source gate.
"""
import argparse
import ast
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from contest_host.plugins import PLUGIN_REGISTRY
from contest_host.host import APPEND_RECALCULATION_PLUGINS, FULL_REBUILD_APPEND_PLUGINS

UTILITY = {"general_logging", "dxpedition", "randomgram"}
TEMPLATES = {"qso_party_rst", "qso_party_sn"}
CHECK_REASONS = {
    "setupAndDescriptors": "Configured session, supported modes/bands and Entry/Log descriptors checked.",
    "entryAndStoredFields": "Committed fixture fields, parsed call, timestamp and raw exchanges checked in SQLite.",
    "expectedPointsMultipliersScore": "First-contact points, multipliers and total match explicit fixture constants; not sponsor certification.",
    "invalidInputAtomicity": "Invalid required call rejected without row insertion or draft loss.",
    "invalidExchangeAtomicity": "Malformed required exchange rejected without row insertion or draft loss.",
    "duplicateClassification": "Repeated call classification matches the plugin duplicate contract in this fixture.",
    "repeatContact": "Repeated contact committed and score captured; family fixtures cover applicable duplicate rules.",
    "distinctCallRepeatedExchange": "Distinct call with repeated geography/exchange has the expected per-contact points.",
    "basicAnalytics": "Prepared snapshot and paged contacts retain all three fixture contacts and calls.",
    "exportContents": "Every advertised export read and decoded; contact fields and available headers validated by the checker.",
    "correction": "Received report corrected while retaining contact identity, time and historical sent serial/exchange.",
    "deletion": "Original and distinct-call rows deleted; retained contact and explicit score expectations checked.",
    "persistenceAndSerial": "Closed and reopened host retains complete rows, score and reserved serial.",
}

# These describe the executable pinned/overlay scopes, not adjudication rules.
MULTIPLIERS = {}
for ids, summary in (
    ("cq_ww_cw cq_ww_ssb", "DXCC country and CQ zone, separately per band."),
    ("cq_ww_rtty", "DXCC country, CQ zone and state/VE-area exchange, separately per band."),
    ("cq_wpx_cw cq_wpx_ssb cq_wpx_rtty", "WPX prefix once across the contest."),
    ("arrl_ss_cw arrl_ss_phone", "ARRL/RAC section once across the contest."),
    ("arrl_dx_cw arrl_dx_ssb", "Entrant-dependent DXCC countries or US states/VE provinces per band, using eligible three-point contacts."),
    ("naqp_cw naqp_ssb naqp_rtty phone_weekly_test k1usn_sst", "State/province/country section code per band, excluding DX sentinel."),
    ("weekly_rtty icwc_mst cwt cwo", "Unique worked call once across bands."),
    ("trans_tasman", "Eligible VK/ZL WPX prefix per band and two-hour UTC block."),
    ("oceania_dx_cw oceania_dx_ssb", "Eligible Oceania WPX prefix per band; stored first-prefix flags."),
    ("sac_cw sac_ssb", "Entrant-dependent country per band or Scandinavian country/call-area per band."),
    ("iaru_fieldday_r1_cw iaru_fieldday_r1_ssb", "Country per band; stored first-country flags."),
    ("10_10_fall_cw 10_10_spring_cw 10_10_winter_phone 10_10_summer_phone", "No contest multiplier; total uses stored contact points."),
    ("jidx_cw jidx_ph", "New scoringRevision=26.10.26: DX entrant counts eligible Japanese prefecture/JD1 island number per band; Japanese entrant counts DXCC entity and received CQ zone per band. Maritime-mobile contacts give only Japanese entrants points/zone credit, with no entity credit. Historical unmarked sessions retain the pinned global received-number count."),
    ("aadx_cw aadx_ssb", "Asian entrant: other DXCC country per band; non-Asian entrant: eligible worked Asian WPX prefix per band."),
    ("cq_160_cw cq_160_ssb", "US state, Canadian province and eligible DXCC entity; single 160 m contest scope."),
    ("euhfc", "Received licence-year value per band, independent of mode."),
    ("iaru_hf", "ITU zone or HQ exchange identity per band and mode."),
    ("arrl_10m", "Received state/province/region or DXCC identity per mode; entrant eligibility and power settings remain plugin-owned."),
    ("arrl_160m", "Distinct ARRL/RAC section and DXCC identities across the 160 m contest."),
    ("arrl_field_day winter_field_day", "Unique band/mode operating combinations and configured power factors; separate sponsor bonus claims are not certified."),
    ("arrl_rtty_ru", "Received state/province or DXCC identity per stored mode; received serial remains separate."),
    ("arrl_vhf_jan arrl_vhf_jun arrl_vhf_sep cq_ww_vhf vhf_sprint labre_rs_digi", "Received grid identity per band; contest-specific point/power factors remain plugin-owned."),
    ("ea_majestad_cw ea_majestad_ssb", "DXCC country and Spanish province per band, plus pinned special-call band credit."),
    ("ref_cw ref_ssb", "French department/prefix and DXCC entity per band; host overlay admits numeric departments and preserves first-occurrence scope."),
    ("rsgb_80m_cc wia_remembrance darc_vhf ta_vhf_uhf_contest stew_perry_topband", "No multiplicative contest identity; points/distance/timed behavior is calculated by the contest callback."),
    ("rsgb_commonwealth_beru", "No displayed multiplier; country/band bonus flags contribute through the BERU score callback."),
    ("es_field_day", "Received Estonian region suffix per band/mode; configured time blocks govern repeats separately."),
    ("es_ll_kv es_manual_key", "Estonian call-area identity per band/mode; configured time blocks govern repeats separately."),
    ("es_open", "Eligible ES region per band/mode, including own region; current overlay limits to 80/40 m and excludes RU/BY scoring."),
    ("hadx", "Eligible DXCC/WAE country and Hungarian county per band; new-session sponsor overlay owns points and totals."),
    ("helvetia", "Swiss canton and DXCC entity per band; stored first-occurrence flags."),
    ("pacc", "Entrant-dependent Dutch province or eligible country/call-area per band/mode; new-session overlay owns sponsor arithmetic."),
    ("spdx", "Received Polish province identity per band/mode."),
    ("ari_dx", "Italian province and DXCC country per band."),
    ("darc_xmas", "WPX prefix once across bands plus eligible German DOK per band; NM excluded from DOK credit."),
    ("eudx", "EU region or DXCC country per mode, as pinned distinct-key queries."),
    ("lz-dx", "Pinned stored flags count alphabetic Bulgarian district and DXCC country per band; received ITU-zone field is not a universal CQ-zone multiplier."),
    ("wag", "Entrant-dependent DOK group or DXCC country per band."),
    ("ari_40_80", "Received automobile/province exchange identity per band/mode."),
    ("ea_rtty", "DXCC/province identities per band, selected K/VE/VK/JA call areas and EA4URE special-band credit."),
    ("ok1wc", "Worked callsign last letter per band."),
    ("ssa_mt_cw ssa_mt_ssb", "First four characters of received locator per band."),
    ("dxpedition general_logging randomgram", "Utility definition; no sponsor contest multiplier requirement."),
    ("qso_party_rst qso_party_sn", "Generic-template received county identity once across the contest; actual party rules need separate selection/review."),
    ("ca_qso_party", "Received county/state/province identity once across the contest; compound counties expand in the pinned export."),
    ("canada_day", "Received province/territory identity per band/mode."),
    ("cqws", "Country once across all bands plus explicitly established Brazilian UF per band; missing UF yields a visibly partial score."),
    ("darc_schwaben", "No displayed multiplier; DOK/location bonuses are included in the contest-specific score callback."),
    ("agcw_qrp", "Numeric QRP member-number first occurrence per band; NM excluded. Pinned country-credit code is inactive."),
    ("raem", "Station latitude factor (1 or 1.1) combined with contact coordinate/bonus points, not a worked-entity multiplier."),
    ("rda_contest", "Russian district and eligible DXCC country once across the contest."),
    ("rdxc", "Russian oblast and eligible DXCC country per band."),
    ("rsgb_iota", "Eligible IOTA reference per band/mode; new-session sponsor overlay excludes ineligible own-group multipliers."),
    ("ukeidx", "Non-UK/EI DXCC country and received district suffix identities once across the contest."),
    ("john_moyle_field_day", "Eligible VK/P2/ZL WPX prefix per band, mode group and three-hour UTC block; full rebuild retained."),
    ("nac_vhf", "Distance points plus first large locator-square bonus; bonus credit assigned chronologically."),
):
    MULTIPLIERS.update({plugin: summary for plugin in ids.split()})


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_committed_source(head, recorded_hashes):
    """Map tested working-file bytes to HEAD only when Git contains those bytes."""
    checks = {}
    for path, expected in recorded_hashes.items():
        committed = subprocess.run(["git", "show", f"{head}:{path}"], cwd=ROOT,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        actual = hashlib.sha256(committed.stdout).hexdigest() if committed.returncode == 0 else None
        current_path = ROOT / path
        current = sha(current_path) if current_path.exists() else None
        reason = "Committed bytes match the recorded tested SHA-256."
        if committed.returncode != 0:
            reason = "Path is missing or unreadable in HEAD; the tested file is not verified in this commit."
        elif actual != expected:
            reason = "Committed bytes differ from the recorded tested SHA-256; HEAD does not contain this tested version."
        if current is None:
            reason += " The working file is also missing."
        elif current != expected:
            reason += " The working file also differs from the tested version."
        checks[path] = {"status": "PASS" if actual == expected else "UNVERIFIED", "reason": reason,
                        "testedSHA256": expected, "committedSHA256": actual,
                        "workingFileMatchesTested": current == expected}
    verified = bool(checks) and all(item["status"] == "PASS" for item in checks.values())
    return head if verified else None, checks


def status(value, reason):
    return {"status": value, "reason": reason}


def aggregate(features):
    values = [item["status"] for item in features.values()]
    return "FAIL" if "FAIL" in values else "UNVERIFIED" if "UNVERIFIED" in values else "PASS"


def operating_family(plugin):
    if plugin in UTILITY:
        return "utility-logging"
    if plugin in TEMPLATES or plugin == "ca_qso_party":
        return "county-qso-party"
    for prefix, family in (("cq_ww_", "cq-ww-zone-country"), ("cq_wpx_", "wpx-prefix-serial"),
                           ("arrl_ss_", "sweepstakes-compound"), ("arrl_dx_", "arrl-dx-domestic-or-dx"),
                           ("naqp_", "name-spc"), ("10_10_", "ten-ten-membership"),
                           ("jidx_", "prefecture-or-zone"), ("aadx_", "age-and-asian-prefix"),
                           ("cq_160_", "160m-state-country"), ("es_", "regional-timed-repeat"),
                           ("ref_", "french-department-or-serial")):
        if plugin.startswith(prefix) and plugin != "cq_ww_vhf":
            return family
    if plugin in {"phone_weekly_test", "k1usn_sst"}:
        return "name-spc"
    if plugin in {"cwt", "cwo", "icwc_mst", "weekly_rtty"}:
        return "name-number-unique-call"
    if plugin in {"arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep", "cq_ww_vhf", "vhf_sprint", "labre_rs_digi"}:
        return "received-grid-by-band"
    if plugin in {"darc_vhf", "nac_vhf", "ta_vhf_uhf_contest", "stew_perry_topband", "ssa_mt_cw", "ssa_mt_ssb"}:
        return "grid-distance-or-square-bonus"
    if plugin in {"john_moyle_field_day", "trans_tasman", "wia_remembrance"}:
        return "timed-or-location-repeat"
    if plugin in {"arrl_field_day", "winter_field_day", "iaru_fieldday_r1_cw", "iaru_fieldday_r1_ssb"}:
        return "field-day-class-or-serial"
    if plugin == "cqws":
        return "scout-classification-and-uf"
    if plugin == "raem":
        return "coordinate-exchange"
    if plugin == "euhfc":
        return "licence-year"
    if plugin == "iaru_hf":
        return "itu-zone-or-hq"
    if plugin in {"sac_cw", "sac_ssb", "oceania_dx_cw", "oceania_dx_ssb", "rsgb_80m_cc", "rsgb_commonwealth_beru", "ok1wc"}:
        return "serial-dx-or-regional"
    return "regional-serial-or-location"


def compact_report(report):
    """Shared feature reasons live once; each entry keeps explicit statuses."""
    result = deepcopy(report)
    reasons = {}
    for row in report["plugins"]:
        for group in ("coreFeatures", "optionalFeatures"):
            for feature, item in row[group].items():
                reasons.setdefault(feature, {}).setdefault(item["status"], Counter())[item["reason"]] += 1
    defaults = {feature: {value: choices.most_common(1)[0][0] for value, choices in statuses.items()}
                for feature, statuses in reasons.items()}
    result["featureReasons"] = defaults
    result["featureReasonResolution"] = "Each feature has an explicit status. Resolve its reason from featureReasons[feature][status], overridden by that entry's featureReasonOverrides[feature]."
    result["scoreContract"] = report["plugins"][0]["scoreContract"]
    family_tests = sorted({test for row in report["plugins"] for test in row["familyTests"] if test != row["fixture"]})
    result["familyTestIDs"] = family_tests
    result["familyTestResolution"] = "Entry familyTests contains indexes into the global familyTestIDs list; the primary source fixture remains a full ID in fixture."
    family_indexes = {test: index for index, test in enumerate(family_tests)}
    result["entryPolicySets"], result["logColumnSets"] = [], []
    result["callbackReference"] = "Each source.callbacks value is a one-based line in that entry's source.path; multiplierDimensionsAndScope describes its executable scope, including documented host overlays."
    for row in result["plugins"]:
        overrides = {}
        for group in ("coreFeatures", "optionalFeatures"):
            original = row[group]
            row[group] = {feature: item["status"] for feature, item in original.items()}
            overrides.update({feature: item["reason"] for feature, item in original.items()
                              if item["reason"] != defaults[feature][item["status"]]})
        if overrides:
            row["featureReasonOverrides"] = overrides
        row.pop("sourceRevision")
        row.pop("scoreContract")
        row["familyTests"] = [family_indexes[test] for test in row["familyTests"] if test != row["fixture"]]
        for key, table in (("entryPolicy", "entryPolicySets"), ("logColumns", "logColumnSets")):
            value = row.pop(key)
            if value not in result[table]:
                result[table].append(value)
            row[key + "Set"] = result[table].index(value)
        row["source"]["callbacks"] = {name: int(callback["source"].rsplit(":", 1)[1])
                                      for name, callback in row["source"]["callbacks"].items()}
    return result


def source_definition(plugin):
    path = ROOT / "python/vendor/not1mm/upstream/not1mm/plugins" / (plugin + ".py")
    tree = ast.parse(path.read_text())
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
    definitions = {}
    for name in ("points", "show_mults", "calc_score", "recalculate_mults"):
        node = functions.get(name)
        if not node:
            continue
        calls = sorted({child.func.attr for child in ast.walk(node)
                        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute)
                        and child.func.attr.startswith("fetch_")})
        keys = []
        for child in ast.walk(node):
            if isinstance(child, ast.Constant) and isinstance(child.value, str):
                keys.extend(re.findall(r"distinct\s*\((.*?)\)\s*(?:as|from)",
                                       " ".join(child.value.split()), re.I))
        definitions[name] = {"source": f"{path.relative_to(ROOT)}:{node.lineno}",
                             "description": ast.get_docstring(node) or "Pinned callback; host overlays are documented in PATCHES.md.",
                             "databaseMethods": calls, "distinctKeys": sorted(set(keys))}
    return {"path": str(path.relative_to(ROOT)), "sha256": sha(path), "callbacks": definitions}


def optional_features(plugin, row):
    utility = plugin in UTILITY
    matrices = row.get("multiplierViewStatus", {})
    supported = [key for key, value in matrices.items() if value == "supported"]
    features = {
        "multiplierTracker": status("NOT APPLICABLE" if utility else "UNVERIFIED",
            "Utility has no required contest multiplier view." if utility else
            "Host descriptor supports " + ", ".join(supported) + "; detailed per-plugin view assertions are separate from catalogue core checks."
            if supported else "No tested per-plugin detailed worked/needed view; plugin total remains authoritative."),
        "advancedAnalytics": status("UNVERIFIED", "Basic snapshot/page checked; credited history and every advanced view are not certified for this plugin."),
        "recordedVoiceOutput": status("UNVERIFIED" if "SSB" in PLUGIN_REGISTRY[plugin].modes else "NOT APPLICABLE",
            "Voice output/hardware not exercised by disposable catalogue tests." if "SSB" in PLUGIN_REGISTRY[plugin].modes
            else "No SSB mode is advertised by this definition."),
        "cwOutput": status("UNVERIFIED" if "CW" in PLUGIN_REGISTRY[plugin].modes else "NOT APPLICABLE",
            "Existing simulated owners/family tests only; no per-plugin transmitter acceptance." if "CW" in PLUGIN_REGISTRY[plugin].modes
            else "No CW mode is advertised by this definition."),
        "digitalOutput": status("UNVERIFIED" if row["catalogue"].get("digitalLoggingSupported") else "NOT APPLICABLE",
            "Digital logging capability does not certify an external modem or transport."
            if row["catalogue"].get("digitalLoggingSupported") else "No digital output capability advertised by catalogue."),
        "recorder": status("UNVERIFIED", "Shared recorder fixtures exist; catalogue tests do not record audio or accept station playback."),
        "multiOperator": status("UNVERIFIED", "Shared replication fixtures are separate; no live per-plugin network acceptance."),
        "hardwareAcceptance": status("UNVERIFIED", "No installed-app, radio, RF/PTT, audio route or station-setting operation performed."),
        "currentSponsorRules": status("NOT APPLICABLE" if utility else "UNVERIFIED",
            "Utility definition; no sponsor submission certification required." if utility else
            "Pinned integration and explicit fixture arithmetic do not certify the current organizer edition."),
    }
    if plugin in TEMPLATES:
        features["currentSponsorRules"] = status("NOT APPLICABLE", "Generic QSO-party template; choose and verify the actual sponsor's rules independently.")
    if plugin == "cqws":
        features["currentSponsorRules"] = status("UNVERIFIED", "Available official 2023 class/country/UF rules informed the overlay; 2026 edition is unknown. The explicit-UF one-point branch preserves legacy behavior without an established 2023 point-rule authority, so providing UF alone does not certify this branch.")
    if plugin in {"jidx_cw", "jidx_ph"}:
        features["currentSponsorRules"] = status("UNVERIFIED", "Official English rules revision 2026-10 sections 5–7 support six bands including 160 m in both modes, JA/DX eligibility, per-band prefecture or country/zone credit, JD1 and maritime-mobile handling. These checks support the new scoringRevision=26.10.26 overlay; remaining sponsor clauses and full-edition certification remain unverified. Historical unmarked sessions retain their pinned behavior; see PATCHES.md.")
    return features


def render(options):
    raw = json.loads(options.input.read_text())
    assert raw["engine"] == "not1mm-python"
    rows = {row["pluginID"]: row for row in raw["plugins"]}
    assert set(rows) == set(PLUGIN_REGISTRY), "Every registered plugin must appear exactly once"
    assert len(rows) == len(raw["plugins"]) == raw["catalogueCount"]
    assert set(MULTIPLIERS) == set(PLUGIN_REGISTRY), "Multiplier scope summaries must cover the live registry"
    manifest_path = ROOT / "python/vendor/not1mm/source-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    vendor_ids = {path.stem for path in (ROOT / "python/vendor/not1mm/upstream/not1mm/plugins").glob("*.py")
                  if path.stem != "__init__"}
    api_ids = {row["catalogue"]["id"] for row in rows.values()}
    reconciliation = {"registryCount": len(PLUGIN_REGISTRY), "apiCount": len(api_ids), "manifestRegisteredCount": len(manifest["registeredPlugins"]),
                      "setsEqual": set(PLUGIN_REGISTRY) == api_ids == set(manifest["registeredPlugins"]),
                      "vendoredModuleCount": len(vendor_ids), "unregisteredVendoredModules": sorted(vendor_ids - set(PLUGIN_REGISTRY)),
                      "registeredWithoutVendoredModule": sorted(set(PLUGIN_REGISTRY) - vendor_ids)}
    assert reconciliation["setsEqual"] and not reconciliation["registeredWithoutVendoredModule"], reconciliation
    ui = json.loads(options.ui.read_text()) if options.ui.exists() else {}
    ui_results = {item["title"].split("current React desk commits ", 1)[-1].split(" through ")[0]: item
                  for suite in ui.get("testResults", []) for item in suite.get("assertionResults", [])}
    native = options.native.read_text() if options.native.exists() else ""
    native_pass = "PythonCatalogueReadinessTests testEveryRegisteredFixtureCommitsThroughTheNativePythonLane]' passed" in native
    python_suite = options.python_suite.read_text() if options.python_suite.exists() else ""
    python_suite_counts = re.findall(r"Ran (\d+) tests?", python_suite)
    python_suite_passed = bool(re.search(r"^OK(?:\s|$)", python_suite, re.M)) and not bool(re.search(r"^FAILED", python_suite, re.M))
    append = options.append.read_text() if options.append.exists() else ""
    append_line = next((line for line in append.splitlines() if line.startswith("APPEND_EQUIVALENCE ")), "")
    covered = dict(re.findall(r"([a-z0-9_-]+)=(\d+)", append_line))
    append_suite_count = re.findall(r"Ran (\d+) tests?", append)
    append_suite_passed = bool(re.search(r"^OK$", append, re.M)) and not bool(re.search(r"^FAILED", append, re.M))
    append_admitted = APPEND_RECALCULATION_PLUGINS - FULL_REBUILD_APPEND_PLUGINS
    append_missing = sorted(append_admitted - covered.keys())
    changed = {path: {"tested": digest, "current": sha(ROOT / path) if (ROOT / path).exists() else None}
               for path, digest in raw["sourceFilesSHA256"].items()
               if not (ROOT / path).exists() or sha(ROOT / path) != digest}
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    verified_commit, committed_checks = verify_committed_source(head, raw["sourceFilesSHA256"])
    report = {"schemaVersion": 1, "date": "2026-10-26", "scope": "Disposable source qualification; no installed-app or hardware acceptance",
              "sourceCommit": raw["source"], "renderedAtCommit": head, "engine": raw["engine"], "runtime": raw["runtime"],
              "verifiedSourceCommit": verified_commit, "recordedFilesCommitVerification": committed_checks,
              "verifiedSourceCommitScope": "Only the recorded sourceFilesSHA256 paths are compared with Git object bytes; raw sourceCommit remains the HEAD recorded during the original working-tree test run.",
              "catalogueCount": len(rows), "sourceFilesSHA256": raw["sourceFilesSHA256"], "sourceChangesSinceQualification": changed,
              "catalogueReconciliation": reconciliation,
              "vendor": {"repository": manifest["repository"], "revision": manifest["revision"], "manifestSHA256": sha(manifest_path)},
              "evidence": {"lifecycle": {"path": str(options.input), "sha256": sha(options.input),
                                        "familyTestsRun": raw["familyTestsRun"], "familyTestsPassed": raw["familyTestsPassed"],
                                        "fixtureCache": raw["fixtureCache"]},
                           "react": {"path": str(options.ui), "sha256": sha(options.ui) if options.ui.exists() else None,
                                     "passed": ui.get("numPassedTests"), "failed": ui.get("numFailedTests"),
                                     "scope": "94 registered-desk fixtures plus any separately named regression cases in the saved JSON"},
                           "native": {"path": str(options.native), "sha256": sha(options.native) if options.native.exists() else None,
                                      "testPassed": native_pass, "scope": "One XCTest loops all fixture IDs through PythonContestLane"},
                           "sourceGatePython": {"path": str(options.python_suite), "sha256": sha(options.python_suite) if options.python_suite.exists() else None,
                                                "testsRun": int(python_suite_counts[-1]) if python_suite_counts else None,
                                                "passed": python_suite_passed, "scope": "Full Python source suite; synthetic test storage, separate from per-plugin lifecycle counts"},
                           "append": {"path": str(options.append), "sha256": sha(options.append) if options.append.exists() else None,
                                      "optimizedPluginsCovered": len(covered), "familyTestsRun": int(append_suite_count[-1]) if append_suite_count else None,
                                      "familyTestsPassed": append_suite_passed,
                                      "admittedPluginCount": len(append_admitted), "uncoveredAdmittedPlugins": append_missing,
                                      "comparisonToolSHA256": sha(ROOT / "tools/check_contest_append_equivalence.py"),
                                      "scope": "Per-append score and contact assignments compared; JMMFD fallback; suite outcome recorded separately"}},
              "sharedEvidence": "docs/contesting/CROSS_CONTEST_CONSISTENCY_2026-10-26.md",
              "sponsorRuleEvidence": "docs/contesting/PILOT_SPONSOR_RULE_AUDIT.md",
              "sponsorRuleOverlayProvenance": "python/vendor/not1mm/PATCHES.md",
              "jidxPartialOfficialRuleEvidence": {"source": "https://www.jidx.org/jidxrule-e.html", "revisionHeading": "2026-10",
                  "retrieved": "2026-10-26", "scope": "Sections 5–7: supported bands, JA/DX eligibility, per-band prefecture/country/zone multipliers, JD1 and maritime-mobile branches",
                  "editionStatus": "UNVERIFIED", "reason": "Partial rule/branch verification supports the new-session overlay; full sponsor-edition certification is not claimed."},
              "plugins": []}
    for plugin, definition in PLUGIN_REGISTRY.items():
        row = rows[plugin]
        checks = {name: {**item, "reason": item.get("reason", CHECK_REASONS.get(name, "See saved checker result."))}
                  for name, item in row["checks"].items()}
        checks["currentReactEntry"] = status("PASS" if ui_results.get(plugin, {}).get("status") == "passed" else "UNVERIFIED",
            "Current workspace and detached Entry commit via real Python JSONL; native/output services are simulated.")
        checks["nativePythonLane"] = status("PASS" if native_pass else "UNVERIFIED",
            "All-fixture XCTest creates, commits, reads and reopens through the actual Swift PythonContestLane; no GUI launch.")
        if plugin == "cqws":
            checks["brazilUFIdentity"] = status("UNVERIFIED", "Brazil UF is counted only when explicitly established. Automatic received-UF acquisition is absent; affected contacts expose scoringComplete=false, partial-score UI and Cabrillo SOAPBOX limitation. RTC/manual or automatic score payloads refuse scoring_incomplete. Operator UF review remains required.")
        optional = optional_features(plugin, row)
        serial = "conditional; entrant/configuration determines allocation" if definition.conditional_serial else "allocated serial" if definition.serial else "no allocated serial"
        exchanges = [{"id": field["id"], "label": field["label"], "visible": field["visible"],
                      "readOnly": field["readOnly"], "example": row["fields"].get(field["id"], "")}
                     for field in row["entryFields"]]
        exports = {name: {"sha256": item["sha256"], "bytes": len(item["content"].encode()),
                          "sample": next((line for line in item["content"].splitlines() if line.startswith("QSO:") or ";1000;" in line),
                                         item["content"].splitlines()[0] if item["content"].splitlines() else "")[:160]}
                   for name, item in row.get("exports", {}).items()}
        source = source_definition(plugin)
        report["plugins"].append({"id": plugin, "name": definition.name,
            "kind": "utility" if plugin in UTILITY else "generic-template" if plugin in TEMPLATES else "contest",
            "family": operating_family(plugin), "fixtureGroup": row["fixture"].split(".")[0],
            "sourceRevision": row["catalogue"]["sourceRevision"], "source": source,
            "modes": list(definition.modes), "bands": list(definition.bands), "station": row["station"], "settings": row["settings"],
            "sentExchangeHint": definition.sent_exchange_hint, "serialPolicy": serial,
            "entryFields": exchanges, "logColumns": row["logColumns"], "duplicateType": row["dupeType"],
            "duplicateScope": row["duplicateScope"], "entryPolicy": row.get("entryPolicy"),
            "scoreExample": row["score"], "scoreContract": "Plugin points/show_mults/calc_score with documented host scoreRevision overlays; no universal reconstructed formula.",
            "multiplierDimensionsAndScope": MULTIPLIERS[plugin],
            "supportedExports": list(definition.export_formats), "exportEvidence": exports,
            "fixture": row["fixture"], "familyTests": row["familyTests"], "coreStatus": aggregate(checks), "coreFeatures": checks,
            "appendEquivalence": status("PASS" if plugin in covered else "UNVERIFIED" if plugin in append_admitted else "NOT APPLICABLE",
                f"{covered[plugin]} fixture append comparisons; full score and per-contact fields." if plugin in covered else
                "Admitted to append optimization but no saved comparison evidence is available." if plugin in append_admitted else
                "John Moyle uses full rebuild because earlier multiplier assignments can differ." if plugin == "john_moyle_field_day" else
                "Not admitted to the generic chronological-append fast path; existing scoring owner retained."),
            "optionalFeatures": optional})
    options.json.parent.mkdir(parents=True, exist_ok=True)
    options.json.write_text(json.dumps(compact_report(report), ensure_ascii=False, separators=(",", ":")) + "\n")
    lines = ["# All-contest readiness and operator setup", "", "Qualification date: 26 October 2026. Generated companion: [ALL_CONTESTS_READINESS.json](ALL_CONTESTS_READINESS.json).", "",
        f"The live registry contains **{len(rows)} definitions**: {len(rows)-len(UTILITY)-len(TEMPLATES)} named contests, three utility definitions and two generic QSO-party templates. Every ID is retained. The table reports source integration in disposable SQLite sessions through `not1mm-python`; it does not certify current sponsor rules or an installed application.", "",
        f"Registry, live catalogue API and source-manifest registered-ID sets match exactly ({len(rows)} each). There are {len(vendor_ids)} vendored Python plugin modules excluding `__init__`. Unregistered vendored modules outside this catalogue: {', '.join('`'+plugin+'`' for plugin in reconciliation['unregisteredVendoredModules']) or 'none'}. No registered plugin lacks its vendored module.", "",
        f"Lifecycle source HEAD: `{raw['source']}`. Report rendered at `{head}`. Pinned Not1MM revision: `{manifest['revision']}`. Python runtime: `{raw['runtime'].splitlines()[0]}`. Exact tested source hashes, plugin bytes, export hashes, field descriptors and per-feature reasons are in the JSON companion.", "",
        f"Verified source commit for every recorded lifecycle source path: `{verified_commit}`. Each committed Git object matches the recorded tested SHA-256; this mapping is limited to the listed source paths." if verified_commit else "**Verified source commit: pending / UNVERIFIED.** The raw lifecycle HEAD above may predate its tested working-file changes. At least one recorded source path is absent from HEAD or has different committed bytes. JSON records each path's reason and hashes; a working-file hash match alone does not establish commit provenance.", "",
        ("**Refresh required:** qualification source hashes differ for " + ", ".join(f"`{p}`" for p in changed) + ". Existing PASS labels describe the saved run; rerun the checker after source convergence before final acceptance.") if changed else "The lifecycle source hashes match the files present when this report was generated.", "",
        "**Family gate is not accepted:** the saved family runner reports a failure. Per-plugin lifecycle outcomes below remain separate evidence; the suite must be repaired/rerun before final acceptance." if raw["familyTestsPassed"] is False else "Family-suite outcome is recorded below; final integrated build/package acceptance remains a separate release record.", "",
        "## Status and evidence boundaries", "",
        "`PASS` means the named check ran successfully in its stated fixture scope. `FAIL` is an observed failed check. `UNVERIFIED` means the claimed capability/edition was not established by this evidence. `NOT APPLICABLE` states why that feature is outside the definition. A core PASS may coexist with optional UNVERIFIED features; these are separate decisions.", "",
        "The lifecycle checks configure a session, verify generated fields, commit and inspect raw/stored fields, assert explicit first-contact score constants, reject invalid input atomically, classify/repeat a contact, commit a distinct call with a repeated exchange, page analytics, read every advertised export, correct/delete contacts and restart the host. Repeated-multiplier, domestic/DX, mixed-mode, category, rover and timed behavior additionally use the named existing family fixtures. The matrix does not imply an exhaustive Cartesian product of all configurations.", "",
        "The React tests use the current `Not1MMContestWorkspace` and `DetachedContestSurface`, real Python JSONL and disposable storage for each ID; native windows, output, recorder, SCP and network services are simulated/unavailable. The native test loops every registered fixture through the actual Swift `PythonContestLane`. Neither is a live installed-app rehearsal. The lifecycle runner dispatches the same real host implementation directly for detailed SQLite/export assertions; the JSONL and native checks separately establish the transport path.", "",
        f"Saved React results: {ui.get('numPassedTests', 'unavailable')} passed / {ui.get('numFailedTests', 'unavailable')} failed. Native all-ID XCTest: {'PASS' if native_pass else 'UNVERIFIED'}. Family runner in this lifecycle report: {raw['familyTestsRun']} tests, success={raw['familyTestsPassed']}; zero means the committed fixture inputs were reused and that family suite was not rerun by this invocation. Counts from overlapping suites must not be added.", "",
        f"Full Python source suite: {python_suite_counts[-1] if python_suite_counts else 'unavailable'} tests; saved result {'PASS' if python_suite_passed else 'UNVERIFIED/FAIL'}. Its log hash is captured separately from the lifecycle and append runs. This is source/test evidence; final packaging and installed-app acceptance remain separate.", "",
        f"Append equivalence reports {len(covered)} fast-path IDs with comparisons out of {len(append_admitted)} currently admitted; uncovered admitted IDs: {', '.join(append_missing) or 'none'}. The saved harness ran {append_suite_count[-1] if append_suite_count else 'unknown'} family tests; overall suite outcome: {'PASS' if append_suite_passed else 'UNVERIFIED/FAIL (inspect saved log)'}. Each optimized append is compared with a rolled-back full rebuild, including score components and contact point/multiplier assignments. Tied/backdated/correction/deletion cases remain covered by the family fixtures. John Moyle stays on full rebuild because prior multiplier assignments can change. See [shared consistency evidence](CROSS_CONTEST_CONSISTENCY_2026-10-26.md).", "",
        "Export PASS validates actual downloaded bytes, not just a marker. The checker verifies ADIF IDs, plugin, raw/exchange fields, date/time, frequency, station and mode; Cabrillo contact rows, identifiers, available categories and exchange oracles; and EDI records as implemented. Each actual export has a SHA-256 and a bounded sample in JSON. Sponsor submission acceptance and every optional header are not implied.", "",
        "## Operator setup", "",
        "Create a new session for the exact definition below. Set your own callsign, station grid, zone/region and sent exchange before logging. The examples are synthetic fixture values, not recommended operating identities. Select an advertised mode and permitted band/category; a mixed category remains distinct from the current operating mode. Wide pinned band lists describe integration support and do not confer a legal allocation or prove sponsor eligibility.", "",
        "Load a current CTY reference for the entrant and received calls before relying on country/continent-dependent points. The qualification uses a small synthetic CTY reference, not the operator's live database. Supply a real station grid for grid/distance contests, and use each received grid's descriptor rather than overwriting the sent grid. Conditional serials depend on the entrant's country and sent-exchange configuration. Retain allocated serials and historical exchanges; do not renumber gaps after a wipe or correction.", "",
        "Follow the displayed field labels and order. Compound exchanges may contain spaces. Manual Enter/ESM and Run/S&P remain explicit operating policies, with CQ WW SSB's established manual workflow retained. A DUPE label describes its configured scope; checking disabled, unchecked and unknown scoring remain different states. The pinned score is authoritative; do not reconstruct totals as points × a universal multiplier count.", "",
        "Before an actual submission, check the current organizer rules and final export with the operator's category, station and exchanged fields. HA DX, PACC and IOTA have partial 2026 sponsor arithmetic checks and documented new-session overlays; this is not full-edition certification. REF's official summary was consulted while its current full DOCX could not be retrieved. ES Open received an official-rule overlay for 80/40 m, CW/SSB points and eligible ES-region multipliers. CQWS scoring was checked against the available official 2023 rules; its 2026 edition remains unknown. Sources, edition limits and overlay provenance are in the [sponsor-rule audit](PILOT_SPONSOR_RULE_AUDIT.md). Other unverified editions remain explicitly UNVERIFIED. No existing production log is silently rescored by this qualification.", "",
        "JIDX CW/Phone new sessions use `scoringRevision=26.10.26`. The [official English rules](https://www.jidx.org/jidxrule-e.html), heading `2026-10`, support six bands including 160 m in both modes and the checked JA/DX contact and multiplier branches: DX entrants count Japanese prefecture/JD1 island numbers per band; Japanese entrants count DXCC countries and CQ zones per band; maritime-mobile contacts give Japanese entrants points and zone credit without country credit. The host supplies family-specific score labels and totals. Existing unmarked sessions retain their original global received-number behavior. This is partial rule/branch verification; full sponsor-edition status remains UNVERIFIED. Exact overlay boundaries and regression coverage are in [PATCHES.md](../../python/vendor/not1mm/PATCHES.md).", "",
        "CQWS has an explicit remaining branch limitation: Brazilian state/UF identity is counted only when established. Automatic received-UF acquisition is unavailable. Such a score is visibly partial (`scoringComplete=false`), Cabrillo carries a SOAPBOX limitation, and manual/automatic RTC score payloads refuse with `scoring_incomplete`. The CQWS core row is UNVERIFIED for this branch even when its tested lifecycle and explicit-UF arithmetic pass; operator UF review is required before relying on a submission total. Its explicit-UF one-point branch also preserves legacy behavior without established point-rule authority in the available official 2023 document. Providing UF alone therefore does not establish current sponsor correctness.", "",
        "## Complete catalogue matrix", "", "Core includes the feature checks in the JSON companion and the saved transport runs. Optional status defaults and per-plugin reasons follow below.", "",
        "| ID / definition | Kind / family | Core | Fixture mode; serial | Exports |", "|---|---|---|---|---|"]
    for row in report["plugins"]:
        lines.append(f"| [`{row['id']}`](#{row['id']}) — {row['name']} | {row['kind']} / {row['family']} | {row['coreStatus']} | {rows[row['id']]['mode']}; {row['serialPolicy']} | {', '.join(row['supportedExports'])} |")
    lines += ["", "## Feature interpretation and remaining acceptance", "",
        "All definitions have individual core and optional statuses with reasons in JSON. Utilities require their advertised ADIF lifecycle, not contest scoring or Cabrillo. QSO Party RST/SN are templates and are not certified sponsor definitions. Their fixture scoring is integration evidence only.", "",
        "Basic analytics counts/snapshot/paging are checked for every ID. Advanced credited multiplier/history adapters, finite Needed universes and retrospective duplicate annotations vary by family; unavailable dimensions remain unknown rather than zero. The shared consistency document identifies the tested CQ WW, WPX, Sweepstakes, NAQP/SST, unique-call, ARRL DX, IARU and RTTY adapters. A host descriptor advertising a matrix does not certify every detailed view for every configuration.", "",
        "Recorded voice, CW output, digital engines/transports, recorder playback, multi-operator networking and hardware acceptance remain per-plugin UNVERIFIED where applicable. Existing simulated family tests can support macros/ESM and shared fixture audio supports recorder behavior; the catalogue run does not open RF/PTT/audio outputs or create local recording links for imported contacts. No output transport, station authority or safety owner was bypassed.", "",
        "## Per-definition setup and fixture appendix", "",
        "Each definition below includes the exact successful source fixture. JSON retains all captured family test IDs, multiplier/bonus dimensions and scopes, and exact source callback line references for points, multipliers and total calculation. Host compatibility and sponsor-rule overlays are recorded in `python/vendor/not1mm/PATCHES.md`; the immutable pinned plugin bytes are separately hashed."]
    for row in report["plugins"]:
        values = "; ".join(f"{field['label'] or field['id']} (`{field['id']}`) = `{field['example']}`{' [allocated/read-only]' if field['readOnly'] else ''}"
                           for field in row["entryFields"] if field["visible"])
        station = ", ".join(f"{k}={v}" for k,v in row["station"].items())
        settings = ", ".join(f"{k}={v}" for k,v in row["settings"].items())
        score = row["scoreExample"]
        lines += ["", f"### {row['id']}", "", f"**{row['name']}** — {row['kind']}; family `{row['family']}`. Core **{row['coreStatus']}**.", "",
            f"Modes: {', '.join(row['modes'])}. Bands: {', '.join(row['bands'])}. Sent exchange hint: {row['sentExchangeHint']}. Serial: {row['serialPolicy']}.", "",
            f"Fixture station: `{station}`. Setup/category: `{settings}`. Entry examples: {values}.", "",
            f"Duplicate scope: {row['duplicateScope']} (plugin type {row['duplicateType']}). Multiplier/bonus scope: {row['multiplierDimensionsAndScope']} First-contact fixture: points={score.get('points')}, multipliers={score.get('multipliers')}, total={score.get('total')}; exact callbacks are linked in JSON. Exports: {', '.join(row['supportedExports'])}.", "",
            f"Fixture: `{row['fixture']}`. Append: {row['appendEquivalence']['status']} — {row['appendEquivalence']['reason']}.", "",
            f"Multiplier view: {row['optionalFeatures']['multiplierTracker']['status']} — {row['optionalFeatures']['multiplierTracker']['reason']} Sponsor edition: {row['optionalFeatures']['currentSponsorRules']['status']} — {row['optionalFeatures']['currentSponsorRules']['reason']}"]
        if row["id"] == "wia_remembrance":
            lines += ["", "Operator setup: enter the literal number of years licensed as the sent exchange (for example `25` for an operator licensed for 25 years). The `#` appearing in this synthetic fixture is legacy compatibility evidence only; do not use it as the operating exchange. The additional literal-25 host lifecycle (`test_wia_literal_years_never_allocate_or_renumber_a_sent_serial`) and current React desk case verify that normal setup without reserving or renumbering a serial; see the acceptance record for their runs."]
        if row["id"] in {"jidx_cw", "jidx_ph"}:
            lines += ["", "Operator setup for new marked sessions: Japanese land stations send their prefecture/island number (1–50); DX and maritime-mobile stations send their CQ zone (1–40). Enter the received value for the counterpart's role. These bounds apply to setup, commits and corrections; historical unmarked-session compatibility remains separate."]
    lines += ["", "## Reproduce and refresh", "", "Run only against synthetic disposable storage:", "", "```sh",
        "/opt/local/bin/python3.12 tools/check_all_contests_readiness.py --family-tests --output .build/all-contests-readiness.json",
        "cd prototype && XLOG_CONTEST_PYTHON=/opt/local/bin/python3.12 npm exec vitest -- run src/contesting/AllContestsPythonDesk.test.tsx --reporter=json --outputFile=/tmp/xlog-all-contests-ui-final-accepted-results.json",
        "# Run PythonCatalogueReadinessTests with the repository's native prototype test command.",
        "# Run tools/check_contest_append_equivalence.py and save its bounded result log.",
        "cd .. && /opt/local/bin/python3.12 tools/render_all_contests_readiness.py", "```", "",
        "The renderer requires exact registry/result set equality, preserves every feature outcome and records stale source hashes. It never turns missing evidence into PASS. Saved logs under `/tmp` and `.build` are local artifacts; their compact hashes and outcomes are committed in JSON. Re-run the source gate after all implementation owners converge, then refresh this report. Packaging/version/build provenance and any authorized installation belong to the final coordinated release acceptance record."]
    options.markdown.write_text("\n".join(lines) + "\n")
    print(f"Rendered {len(rows)} definitions; core statuses {dict(Counter(p['coreStatus'] for p in report['plugins']))}; stale source files={len(changed)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / ".build/all-contests-readiness.json")
    parser.add_argument("--ui", type=Path, default=Path("/tmp/xlog-all-contests-ui-final-accepted-results.json"))
    parser.add_argument("--native", type=Path, default=Path("/tmp/xlog-native-catalogue-final.log"))
    parser.add_argument("--python-suite", type=Path, default=Path("/tmp/xlog-python-final-accepted.log"))
    parser.add_argument("--append", type=Path, default=Path("/tmp/xlog-append-final-accepted.log"))
    parser.add_argument("--markdown", type=Path, default=ROOT / "docs/contesting/ALL_CONTESTS_READINESS.md")
    parser.add_argument("--json", type=Path, default=ROOT / "docs/contesting/ALL_CONTESTS_READINESS.json")
    render(parser.parse_args())
