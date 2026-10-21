"""Load original pinned modules with a finite, inspectable import overlay.

Original bytes remain in vendor. No contest expressions or SQL are converted.
The overlaid modules have only imports/output destination adjusted.
"""
from importlib import import_module, util
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

from .plugins import PLUGIN_REGISTRY, RTTY_PLUGINS

VENDOR = Path(__file__).resolve().parents[1] / "vendor/not1mm/upstream"
_verified = False


def verify_source():
    global _verified
    if _verified:
        return
    manifest = json.loads((VENDOR.parent / "source-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("registeredPlugins") != list(PLUGIN_REGISTRY):
        raise RuntimeError("Pinned Not1MM registered plugins differ from the supported registry")
    for plugin_id in PLUGIN_REGISTRY:
        if f"not1mm/plugins/{plugin_id}.py" not in manifest["sha256"]:
            raise RuntimeError(f"Pinned Not1MM plugin source hash is missing: {plugin_id}")
    for relative, expected in manifest["sha256"].items():
        if sha256((VENDOR / relative).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Pinned Not1MM source hash differs: {relative}")
    _verified = True


def adapt_cw_template(plugin_id, template):
    """Adapt one pinned or persisted Not1MM template to xLog's output tokens."""
    replacements = {"HISCALL": "CALL", "SNT": "RST", "EXCH": "EXCHANGE"}
    for upstream, native in replacements.items():
        template = template.replace("{" + upstream + "}", "{" + native + "}")
    if plugin_id == "cq_ww_cw":
        # CQ WW's configured zone is the number meant by MyNR. Persisted
        # macro-editor rows must receive the same migration as pinned defaults.
        template = template.replace("{SENTNR}", "{EXCHANGE}")
    if re.findall(r"\{([^}]+)\}", template) and any(
            token not in {"MYCALL", "CALL", "RST", "EXCHANGE", "SENTNR"}
            for token in re.findall(r"\{([^}]+)\}", template)):
        raise RuntimeError("Pinned Not1MM CW macro uses an unsupported token")
    return template


def load_cw_macros(plugin_id="cq_ww_cw"):
    """Return the pinned Not1MM Run/S&P macro text through a finite token adapter."""
    verify_source()
    result = {}
    source = VENDOR / ("not1mm/data/rttymacros.txt" if plugin_id in RTTY_PLUGINS
                       else "not1mm/data/cwmacros.txt")
    for line in source.read_text(encoding="utf-8").splitlines():
        parts = line.split("|", 3)
        if len(parts) != 4 or parts[0] not in {"S", "R"} or re.fullmatch(r"F(?:[1-9]|1[0-2])", parts[1]) is None:
            raise RuntimeError("Pinned Not1MM CW macro source is invalid")
        template = adapt_cw_template(plugin_id, parts[3])
        result[(parts[0], parts[1])] = {"label": parts[2], "template": template}
    if plugin_id in {"arrl_ss_cw", "arrl_ss_phone"}:
        # The pinned plugin's SOAPBOX_HINT gives its exchange macro explicitly.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{CALL} {SENTNR} {EXCHANGE}"
    elif plugin_id == "icwc_mst":
        # Original plugin stores configured name and the reserved serial separately.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{EXCHANGE} {SENTNR}"
    elif plugin_id == "cwo":
        # CW Open sends the host-reserved serial followed by the configured name.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{SENTNR} {EXCHANGE}"
    elif plugin_id in {"ssa_mt_cw", "ssa_mt_ssb"}:
        # SSA MT sends both the host-reserved serial and configured station
        # locator; its visible Nr field is the received serial.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{RST} {SENTNR} {EXCHANGE}"
    elif PLUGIN_REGISTRY[plugin_id].serial or PLUGIN_REGISTRY[plugin_id].conditional_serial:
        # Ordinary serial contests send the host-reserved draft serial,
        # independently of any configured exchange text.
        for mode in ("R", "S"):
            result[(mode, "F3")]["template"] = "{RST} {SENTNR}"
    if len(result) != 24:
        raise RuntimeError("Pinned Not1MM CW macro set is incomplete")
    return result


def overlay(name, replacements):
    path = VENDOR.joinpath(*name.split(".")).with_suffix(".py")
    source = path.read_text(encoding="utf-8")
    for original, replacement in replacements:
        if source.count(original) != 1:
            raise RuntimeError(f"Pinned overlay no longer matches {name}")
        source = source.replace(original, replacement)
    spec = util.spec_from_file_location(name, path)
    module = util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        exec(compile(source, str(path), "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def load_plugin(plugin_id="cq_ww_cw"):
    if plugin_id not in PLUGIN_REGISTRY:
        raise ValueError("Unsupported pinned plugin")
    verify_source()
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    import_module("not1mm.lib")
    if "not1mm.lib.plugin_common" not in sys.modules:
        overlay("not1mm.lib.plugin_common", [
            ("import adif_io\n", "# adif_io is loaded only by the unsupported import callback.\n"),
            ("from PyQt6.QtCore import QCoreApplication, Qt", "from contest_host.qt_compat import QCoreApplication, Qt"),
            ("from PyQt6.QtWidgets import QApplication, QDialog, QProgressDialog, QPushButton", "from contest_host.qt_compat import QApplication, QDialog, QProgressDialog, QPushButton"),
            ("def imp_adif(self):", "def imp_adif(self):\n    import adif_io  # real optional dependency; never a stand-in"),
        ])
    module_name = f"not1mm.plugins.{plugin_id}"
    if module_name not in sys.modules:
        import_module("not1mm.plugins")
        replacements = [
            ("from PyQt6 import QtWidgets", "from contest_host.qt_compat import QtWidgets"),
            ("str(Path.home())", "str(self.export_directory)"),
        ]
        if plugin_id == "cq_ww_rtty":
            # Apply the CQ WW duplicate-eligibility rule to its third multiplier
            # family; the original query otherwise counts a duplicate's state.
            replacements.append((
                "res3_query = f\"select count(DISTINCT(Exchange1 || ':' || Band)) as spc_count from dxlog where ContestNR = {self.database.current_contest} and Exchange1 != 'DX';\"\n"
                "    result3 = self.database.exec_sql(res3_query)",
                "result3 = {\"spc_count\": self.database.fetch_state_band_count()}",
            ))
        if plugin_id == "cq_wpx_rtty":
            # The pinned RTTY ESM accidentally tests the received serial with
            # isalpha(), making its LOGIT branch unreachable for valid numeric
            # exchanges. Correct each distinct Run/S&P anchor without changing
            # the preserved source bytes or its button/commit decisions.
            replacements.extend([
                ("elif self.other_1.text().isnumeric() and self.other_2.text().isalpha():\n"
                 "                # If the operator corrected a busted callsign",
                 "elif self.other_1.text().isnumeric() and self.other_2.text().isnumeric():\n"
                 "                # If the operator corrected a busted callsign"),
                ("elif self.other_1.text().isnumeric() and self.other_2.text().isalpha():\n"
                 "                self.make_button_green(self.esm_dict[\"EXCH\"])",
                 "elif self.other_1.text().isnumeric() and self.other_2.text().isnumeric():\n"
                 "                self.make_button_green(self.esm_dict[\"EXCH\"])")
            ])
        if plugin_id == "jidx_cw":
            # The CW sibling targets older container-label and cty_lookup
            # shapes; the pinned phone sibling already uses both current APIs.
            replacements.extend([
                (
                    'label = self.field3.findChild(QtWidgets.QLabel)\n'
                    '    label.setText("SentNR")\n'
                    '    self.field3.setAccessibleName("Sent Number")\n'
                    '    label = self.field4.findChild(QtWidgets.QLabel)\n'
                    '    label.setText("RcvNR")\n'
                    '    self.field4.setAccessibleName("Received Number")',
                    'self.other_label.setText("SentNR")\n'
                    '    self.other_1.setAccessibleName("Sent Number")\n'
                    '    self.exch_label.setText("RcvNR")\n'
                    '    self.other_2.setAccessibleName("Received Number")',
                ),
                (
                    'mycountry = item[1].get("entity", "")',
                    'mycountry = item.get("entity", "")',
                ),
            ])
        if plugin_id in {"aadx_cw", "aadx_ssb"}:
            # The original multiplier rebuild orders contacts only by UTC
            # second. Use rowid as the stable tie-break already used by the
            # host so same-second QSOs cannot both claim one multiplier.
            replacements.extend([
                (
                    'f"TS < \'{time_stamp}\' "',
                    'f"(TS < \'{time_stamp}\' OR (TS = \'{time_stamp}\' AND rowid < "'
                    '\n        f"(SELECT rowid FROM dxlog WHERE ID = \'{self.contact.get(\"ID\", \"\")}\'))) "',
                ),
                (
                    'f" TS < \'{time_stamp}\' "',
                    'f" (TS < \'{time_stamp}\' OR (TS = \'{time_stamp}\' AND rowid < "'
                    '\n        f"(SELECT rowid FROM dxlog WHERE ID = \'{self.contact.get(\"ID\", \"\")}\'))) "',
                ),
            ])
        if plugin_id in {"ea_majestad_cw", "ea_majestad_ssb"}:
            # This GUI-only keyword controls Not1MM radio output. xLog owns
            # output admission, while the original function-key choice stays.
            replacements.append((
                "self.process_function_key(button, rttysendrx=False)",
                "self.process_function_key(button)",
            ))
        if plugin_id in {"ref_cw", "ref_ssb"}:
            # The pinned REF siblings inherited Helvetia's country-prefix
            # literal during multiplier replay, and their ESM accepted only
            # numeric exchanges despite valid French department/prefix text.
            replacements.extend([
                ('if dxcc == "HB" and canton.isalpha():',
                 'if dxcc == "F" and canton.isalpha():'),
                ('elif self.other_2.text().isnumeric():\n'
                 '                # If the operator corrected a busted callsign',
                 'elif self.other_2.text().isalnum():\n'
                 '                # If the operator corrected a busted callsign'),
                ('elif self.other_2.text().isnumeric():\n'
                 '                self.make_button_green(self.esm_dict["EXCH"])',
                 'elif self.other_2.text().isalnum():\n'
                 '                self.make_button_green(self.esm_dict["EXCH"])'),
            ])
        if plugin_id in {"cq_160_cw", "cq_160_ssb"}:
            # Preserve the original /MM non-multiplier rule during ordered
            # replay and make its timestamp-only multiplier queries stable for
            # contacts logged in the same UTC second.
            replacements.extend([
                (
                    'time_stamp = contact.get("TS", "")',
                    'time_stamp = contact.get("TS", "")\n'
                    '        if "/MM" in contact.get("Call", ""):\n'
                    '            contact["IsMultiplier1"] = 0\n'
                    '            self.database.change_contact(contact)\n'
                    '            continue',
                ),
                (
                    'where TS < \'{time_stamp}\' and CountryPrefix = \'K\'',
                    'where (TS < \'{time_stamp}\' or (TS = \'{time_stamp}\' and rowid < '
                    '(select rowid from dxlog where ID = \'{contact.get("ID", "")}\'))) and CountryPrefix = \'K\'',
                ),
                (
                    'where TS < \'{time_stamp}\' and CountryPrefix = \'VE\'',
                    'where (TS < \'{time_stamp}\' or (TS = \'{time_stamp}\' and rowid < '
                    '(select rowid from dxlog where ID = \'{contact.get("ID", "")}\'))) and CountryPrefix = \'VE\'',
                ),
                (
                    "where TS < '{time_stamp}' and CountryPrefix = '{contact.get('CountryPrefix', '')}'",
                    'where (TS < \'{time_stamp}\' or (TS = \'{time_stamp}\' and rowid < '
                    '(select rowid from dxlog where ID = \'{contact.get("ID", "")}\'))) and CountryPrefix = '
                    "'{contact.get('CountryPrefix', '')}'",
                ),
            ])
        if plugin_id in {"oceania_dx_cw", "oceania_dx_ssb"}:
            # SQLite stores Band as REAL; the pinned plugin indexes string keys.
            # Ordered host replay already computed each row's duplicate points.
            replacements.extend([
                ('band = self.contact.get("Band", "0.0")', 'band = str(self.contact.get("Band", "0.0"))'),
                ('_BAND_POINTS.get(self.contact.get("Band", "0.0"), 0)',
                 '_BAND_POINTS.get(str(self.contact.get("Band", "0.0")), 0)'),
                ('contact["Points"] = points(self)',
                 '# Preserve per-contact points from the host ordered replay.'),
                ('contest_nr = self.pref.get("contest")',
                 'contest_nr = self.pref.get("contest")\n    contact_id = self.contact.get("ID", "")'),
                ('f" TS < \'{time_stamp}\' "',
                 'f" (TS < \'{time_stamp}\' OR (TS = \'{time_stamp}\' AND rowid < "\n'
                 '        f"(SELECT rowid FROM dxlog WHERE ID = \'{contact_id}\'))) "'),
            ])
        if plugin_id in {"es_field_day", "es_ll_kv", "es_open"}:
            # The original desktop plugins compare against wall-clock time.
            # Replay and back-dated imports must instead classify the contact
            # timestamp supplied by the host.
            replacements.append((
                "iso_current_time = datetime.now(timezone.utc)",
                "iso_current_time = datetime.fromisoformat(self.dupe_timestamp).replace(tzinfo=timezone.utc)",
            ))
        if plugin_id == "es_manual_key":
            replacements.append((
                "iso_current_time = datetime.datetime.now(datetime.timezone.utc)",
                "iso_current_time = datetime.datetime.fromisoformat(self.dupe_timestamp).replace(tzinfo=datetime.timezone.utc)",
            ))
            # DXLOG declares NR/SentNr as INTEGER, so SQLite strips the leading
            # seniority zero on replay and export. Restore the original five-
            # digit exchange shape before the plugin reads or formats it.
            replacements.extend([
                ('call_result = str(self.contact.get("NR", "")).strip()',
                 'call_result = str(self.contact.get("NR", "")).strip().zfill(5)'),
                ("str(contact.get('SentNr', '')).ljust(6)",
                 "str(contact.get('SentNr', '')).zfill(5).ljust(6)"),
                ("str(contact.get('NR', '')).ljust(6)",
                 "str(contact.get('NR', '')).zfill(5).ljust(6)"),
            ])
        if plugin_id == "es_field_day":
            # Three independent if-statements leave the final else attached
            # only to period four, overwriting period-one through period-three
            # duplicate results. Preserve the intended mutually exclusive bins.
            replacements.extend([
                ("\n    if (\n        time_period_1 is not None\n        and time_period_2 is not None",
                 "\n    elif (\n        time_period_1 is not None\n        and time_period_2 is not None"),
                ("\n    if (\n        time_period_2 is not None\n        and time_period_3 is not None",
                 "\n    elif (\n        time_period_2 is not None\n        and time_period_3 is not None"),
                ("\n    if (\n        time_period_3 is not None\n        and time_period_4 is not None",
                 "\n    elif (\n        time_period_3 is not None\n        and time_period_4 is not None"),
            ])
        if plugin_id == "spdx":
            # The pinned module omitted the f-string prefix, so its multiplier
            # query contains a literal Python expression and cannot execute.
            replacements.append((
                '"where ContestNR = {self.database.current_contest} and typeof(NR) = \'text\';"',
                'f"where ContestNR = {self.database.current_contest} and typeof(NR) = \'text\';"',
            ))
        if plugin_id == "helvetia":
            # Stable replay for contacts sharing the same UTC second.
            replacements.extend([
                (
                    'f"select count(*) as canton_count from dxlog where  TS < \'{time_stamp}\' "',
                    'f"select count(*) as canton_count from dxlog where  (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
                (
                    'f"select count(*) as dxcc_count from dxlog where TS < \'{time_stamp}\' "',
                    'f"select count(*) as dxcc_count from dxlog where (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
            ])
        if plugin_id == "ari_dx":
            # The pinned points callback prints CTY lookup internals to stdout,
            # which is the worker's JSON protocol channel.
            replacements.append((
                'print(f"{result=}")',
                'logger.debug("cty_lookup result: %s", result)',
            ))
        if plugin_id == "darc_xmas":
            # Stable rowid tie-breaks preserve source multiplier rules when
            # multiple contacts share one UTC second.
            replacements.extend([
                (
                    "result = self.database.fetch_wpx_exists_before_me(wpx, time_stamp)",
                    "result = self.database.fetch_wpx_exists_before_contact(wpx, time_stamp, contact.get(\"ID\", \"\"))",
                ),
                (
                    'f"select count(*) as dok_count from dxlog where  TS < \'{time_stamp}\' "',
                    'f"select count(*) as dok_count from dxlog where  (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
            ])
        if plugin_id == "ok1wc":
            # Original replay orders only by UTC second. Include the durable ID
            # tie-break so two same-second QSOs cannot both claim one suffix.
            replacements.append((
                'self.database.fetch_band_lastletter_exists_before_me(\n'
                '            self.contact.get("Band", ""), self.contact.get("Call", ""), time_stamp\n'
                '        )',
                'self.database.fetch_band_lastletter_exists_before_contact(\n'
                '            self.contact.get("Band", ""), self.contact.get("Call", ""), time_stamp,\n'
                '            self.contact.get("ID", "")\n'
                '        )',
            ))
        if plugin_id in {"ssa_mt_cw", "ssa_mt_ssb"}:
            # SQLite returns Band as numeric; the original replay concatenates
            # it into a locator key as though it were already text.
            replacements.append((
                'key = exch[:4].upper() + ":" + band',
                'key = exch[:4].upper() + ":" + str(band)',
            ))
        if plugin_id == "ea_rtty":
            # Preserve every admitted live digital alias in session/log state,
            # but emit Cabrillo's single RY mode token at export time.
            replacements.append((
                'if themode == "RTTY":',
                'if themode in ("RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D", '
                '"DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"):',
            ))
        if plugin_id == "lz-dx":
            # Stable replay for contacts sharing the same UTC second.
            replacements.extend([
                (
                    'f"select count(*) as canton_count from dxlog where  TS < \'{time_stamp}\' "',
                    'f"select count(*) as canton_count from dxlog where  (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
                (
                    'f"select count(*) as dxcc_count from dxlog where TS < \'{time_stamp}\' "',
                    'f"select count(*) as dxcc_count from dxlog where (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
            ])
        if plugin_id == "wag":
            # Stable replay for both DOK-prefix and country multipliers.
            replacements.extend([
                (
                    'f"and TS < \'{time_stamp}\' "\n                f"and NR like \'{district}%\' "',
                    'f"and (TS < \'{time_stamp}\' OR (TS = \'{time_stamp}\' AND rowid < "\n'
                    '                f"(SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "\n'
                    '                f"and NR like \'{district}%\' "',
                ),
                (
                    'f"and TS < \'{time_stamp}\' "\n                f"and CountryPrefix = \'{dxcc}\' "',
                    'f"and (TS < \'{time_stamp}\' OR (TS = \'{time_stamp}\' AND rowid < "\n'
                    '                f"(SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "\n'
                    '                f"and CountryPrefix = \'{dxcc}\' "',
                ),
            ])
        if plugin_id in {"arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep"}:
            # DXLOG stores the canonical band as REAL while these original
            # plugins compare it with digit-only strings.
            replacements.extend([
                ('if _band in ["50", "144"]:', 'if _band in [50.0, 144.0]:'),
                ('if _band in ["222", "432"]:', 'if _band in [222.0, 432.0]:'),
                ('if _band in ["902", "1296"]:', 'if _band in [902.0, 1296.0]:'),
                ('if _band in ["2300+"]:', 'if _band >= 2300.0:'),
                ('if themode in ("LSB", "USB", "AM"):', 'if themode in ("LSB", "USB", "AM", "FM"):'),
            ])
        if plugin_id == "arrl_field_day":
            replacements.append(
                ('if themode in ("LSB", "USB", "FM"):', 'if themode in ("LSB", "USB", "FM", "AM"):')
            )
        if plugin_id == "es_manual_key":
            replacements.extend([
                ("\n    if (\n        time_period_2 is not None\n        and time_period_1 is not None",
                 "\n    elif (\n        time_period_2 is not None\n        and time_period_1 is not None"),
                ("\n    if (\n        time_period_3 is not None\n        and time_period_2 is not None",
                 "\n    elif (\n        time_period_3 is not None\n        and time_period_2 is not None"),
            ])
        if plugin_id == "trans_tasman":
            # Explicit compatibility fixes; original pinned bytes stay intact.
            replacements.extend([
                ('float(contact.get("Freq", "0")) * 1000', 'float(contact.get("Freq", "0"))'),
                ('now = datetime.datetime.now(datetime.UTC)',
                 'now = datetime.datetime.fromisoformat(self.dupe_timestamp).replace(tzinfo=datetime.UTC)'),
                ('if not _is_vk_zl_prefix(wpx):\n            continue',
                 'if not _is_vk_zl_prefix(wpx) or not contact.get("Points", 0):\n            continue'),
            ])
            # Both score-display SQL queries need the same eligibility filter.
            original = 'and {_vk_zl_wpx_filter()};'
            replacement = 'and {_vk_zl_wpx_filter()} and Points > 0;'
            source = (VENDOR / "not1mm/plugins/trans_tasman.py").read_text(encoding="utf-8")
            for fragment in ("as mults", "as qsos"):
                start = source.index(fragment)
                end = source.index(original, start) + len(original)
                chunk = source[start:end]
                replacements.append((chunk, chunk.replace(original, replacement)))
        overlay(module_name, replacements)
    return sys.modules[module_name]


def load_cqww():
    return load_plugin("cq_ww_cw")
