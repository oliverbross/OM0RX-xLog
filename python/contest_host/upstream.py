"""Load original pinned modules with a finite, inspectable import overlay.

Original bytes remain in vendor. No contest expressions or SQL are converted.
The overlaid modules have only imports/output destination adjusted.
"""
from importlib import import_module, util
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

from .plugins import PLUGIN_REGISTRY, RTTY_PLUGINS

VENDOR = Path(__file__).resolve().parents[1] / "vendor/not1mm/upstream"
_verified = False


@lru_cache(maxsize=1)
def pinned_band_definitions():
    """Return the pinned Not1MM band plan without inventing UI-side edges."""
    verify_source()
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    bands = import_module("not1mm.lib.ham_utility").BANDS
    advertised = {band for plugin in PLUGIN_REGISTRY.values() for band in plugin.bands}
    return tuple({"id": band.name, "lowHz": round(band.start * 1000),
                  "highHz": round(band.end * 1000), "value": band.band_mhz}
                 for band in bands if band.name in advertised)


def verify_source():
    global _verified
    if _verified:
        return
    manifest = json.loads((VENDOR.parent / "source-manifest.json").read_text(encoding="utf-8"))
    from .wae import PLUGINS as FIRST_PARTY_PLUGINS
    if manifest.get("registeredPlugins") != [key for key in PLUGIN_REGISTRY if key not in FIRST_PARTY_PLUGINS]:
        raise RuntimeError("Pinned Not1MM registered plugins differ from the supported registry")
    for plugin_id in PLUGIN_REGISTRY:
        if plugin_id in FIRST_PARTY_PLUGINS:
            continue
        if f"not1mm/plugins/{plugin_id}.py" not in manifest["sha256"]:
            raise RuntimeError(f"Pinned Not1MM plugin source hash is missing: {plugin_id}")
    for relative, expected in manifest["sha256"].items():
        if sha256((VENDOR / relative).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Pinned Not1MM source hash differs: {relative}")
    _verified = True


MACRO_TEXT_TOKENS = {"MYCALL", "CALL", "RST", "EXCHANGE", "SENTNR",
                     "PREVNR", "OTHER1", "OTHER2"}
MACRO_ACTION_TOKENS = ("LOGIT", "RUN", "SANDP", "WIPE")
EXTERNAL_MACRO_ACTION_TOKENS = {"MARK", "SPOT", "TX", "RX", "TX/RX"}
MACRO_ACTION_PATTERN = re.compile(r"\{(" + "|".join(map(re.escape, MACRO_ACTION_TOKENS)) + r")\}")


def split_macro_template(template):
    """Separate renderable text from ordered, contest-owner macro actions."""
    actions = []
    def capture(match):
        actions.append(match.group(1))
        return ""
    return MACRO_ACTION_PATTERN.sub(capture, template), tuple(actions)


def adapt_cw_template(plugin_id, template):
    """Adapt and validate one pinned or persisted Not1MM macro template."""
    replacements = {"HISCALL": "CALL", "SNT": "RST", "EXCH": "EXCHANGE"}
    for upstream, native in replacements.items():
        template = template.replace("{" + upstream + "}", "{" + native + "}")
    if plugin_id == "cq_ww_cw":
        # CQ WW's configured zone is the number meant by MyNR. Persisted
        # macro-editor rows must receive the same migration as pinned defaults.
        template = template.replace("{SENTNR}", "{EXCHANGE}")
    # Not1MM's VOICEn tokens normally address radio voice memories. xLog does
    # not expose that hardware owner: map them to the managed f1.wav-f10.wav
    # profile slots already consumed, in order, by the native WAV parser.
    template = re.sub(r"\{VOICE(10|[1-9])\}", lambda match: f"[f{match.group(1)}]", template)
    if "^M" in template and plugin_id not in RTTY_PLUGINS:
        raise RuntimeError("Not1MM ^M newline is available only through the original RTTY/fldigi output owner")
    tokens = re.findall(r"\{([^}]+)\}", template)
    external = next((token for token in tokens if token in EXTERNAL_MACRO_ACTION_TOKENS), None)
    if external:
        ownership = ({"MARK": "band-map marking", "SPOT": "cluster spotting"}.get(
            external, "radio PTT"))
        raise RuntimeError(f"Not1MM macro action {{{external}}} requires the unavailable {ownership} owner")
    if any(token not in MACRO_TEXT_TOKENS | set(MACRO_ACTION_TOKENS) for token in tokens):
        raise RuntimeError("Not1MM macro uses an unsupported token")
    if "RI:" in template:
        raise RuntimeError("Not1MM RI: radio command macros are unavailable because xLog owns radio control")
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
    for item in replacements:
        original, replacement, expected = (*item, 1) if len(item) == 2 else item
        if source.count(original) != expected:
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
    from .wae import PLUGINS as WAE_PLUGINS, plugin as wae_plugin
    if plugin_id in WAE_PLUGINS:
        return wae_plugin(plugin_id, load_plugin("cq_wpx_cw"))
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    import_module("not1mm.lib")
    if "not1mm.lib.plugin_common" not in sys.modules:
        overlay("not1mm.lib.plugin_common", [
            ("import adif_io\n", "# adif_io is loaded only by the unsupported import callback.\n"),
            ("from PyQt6.QtCore import QCoreApplication, Qt", "from contest_host.qt_compat import QCoreApplication, Qt"),
            ("from PyQt6.QtWidgets import QApplication, QDialog, QProgressDialog, QPushButton", "from contest_host.qt_compat import QApplication, QDialog, QProgressDialog, QPushButton"),
            ("def imp_adif(self):", "def imp_adif(self):\n    import adif_io  # real optional dependency; never a stand-in"),
            ('                print("<EOR>", end="\\r\\n", file=file_descriptor)',
             '                from contest_host.upstream import adif_context_fields\n'
             '                for tag, value in adif_context_fields(self, contact).items():\n'
             '                    print(f"<{tag}:{len(value)}>{value}", end="\\r\\n", file=file_descriptor)\n'
             '                print("<EOR>", end="\\r\\n", file=file_descriptor)'),
        ])
    module_name = f"not1mm.plugins.{plugin_id}"
    if module_name not in sys.modules:
        import_module("not1mm.plugins")
        replacements = [
            ("from PyQt6 import QtWidgets", "from contest_host.qt_compat import QtWidgets"),
        ]
        source = (VENDOR / f"not1mm/plugins/{plugin_id}.py").read_text(encoding="utf-8")
        if "str(Path.home())" in source:
            replacements.append(("str(Path.home())", "str(self.export_directory)"))
        if plugin_id == "labre_rs_digi":
            # DXLOG stores frequency in kHz; this writer divided it again and
            # emitted 14 rather than 14080, outside Cabrillo's HF contract.
            replacements.append(('freq = contact.get("Freq", "0") / 1000',
                                 'freq = float(contact.get("Freq", "0"))'))
        if plugin_id in {"cq_wpx_rtty", "arrl_rtty_ru"}:
            replacements.append(('themode = contact.get("Mode", "")',
                                 'themode = "RY"'))
        if plugin_id in {"ref_cw", "ref_ssb"}:
            # SQLite's NUMERIC affinity returns numeric departments as integers
            # during replay; the original callback expects a string widget.
            replacements.extend([
                ('self.contact.get("NR", "").isalpha()', 'str(self.contact.get("NR", "")).isalpha()'),
                ('canton = contact.get("NR", "")', 'canton = str(contact.get("NR", ""))'),
                ('def points(self):\n', 'def points(self):\n    from contest_host.upstream import ref_french_call\n'),
                ('if my_country == "France":',
                 'if my_country == "France" or self.state.get("scoringRevision") == "26.10.26" and ref_french_call(self, self.station.get("Call", "")):'),
                ('if their_country == "France":',
                 'if their_country == "France" or self.state.get("scoringRevision") == "26.10.26" and ref_french_call(self, self.contact.get("Call", "")):', 2),
                ('def predupe(self):',
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import ref_assign_multipliers\n'
                 '        ref_assign_multipliers(self, self.contact)\n\n\ndef predupe(self):'),
                ('def recalculate_mults(self):\n',
                 'def recalculate_mults(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import ref_assign_multipliers\n'
                 '        seen = set()\n'
                 '        for row in self.database.fetch_all_contacts_asc():\n'
                 '            ref_assign_multipliers(self, row, seen)\n'
                 '            self.database.change_contact(row)\n'
                 '        return\n'),
            ])
        if plugin_id in {"hadx", "pacc", "rsgb_iota"}:
            # Organizer 2026 final-score rules use the actual multiplier count.
            # Persisted pre-fix sessions keep the original arithmetic, including
            # in Cabrillo. No source bytes or historical contacts are rewritten.
            corrected = 'self.state.get("scoringRevision") == "26.10.26"'
            if plugin_id == "rsgb_iota":
                replacements.append((
                    "return contest_points * (mults + 1)",
                    f"return contest_points * (mults if {corrected} else mults + 1)"))
            else:
                old_factor = "(1 + int(mults))" if plugin_id == "hadx" else "(int(mults) + 1)"
                replacements.extend([
                    (f"contest_points = int(score) * {old_factor}",
                     f"contest_points = int(score) * (int(mults) if {corrected} else int(mults) + 1)"),
                    ("contest_points = int(score)\n        return contest_points",
                     f"contest_points = int(score) * (0 if {corrected} else 1)\n        return contest_points"),
                ])
            if plugin_id == "pacc":
                replacements.append((
                    'def show_mults(self):\n',
                    'def show_mults(self):\n'
                    '    if self.state.get("scoringRevision") == "26.10.26" and im_dutch(self):\n'
                    '        from contest_host.upstream import pacc_multiplier_key\n'
                    '        return len({(row["Band"], row["Mode"], pacc_multiplier_key(row))\n'
                    '                    for row in self.database.fetch_all_contacts_asc()\n'
                    '                    if row.get("Points", 0) > 0 and pacc_multiplier_key(row)})\n'))
        if plugin_id == "es_open":
            replacements.extend([
                ('def points(self):\n',
                 'def points(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import es_open_points\n'
                 '        return es_open_points(self)\n'),
                ('def show_mults(self, rtc=None):\n',
                 'def show_mults(self, rtc=None):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import es_open_multiplier_key\n'
                 '        return len({es_open_multiplier_key(row)\n'
                 '                    for row in self.database.fetch_all_contacts_asc()\n'
                 '                    if row.get("Points", 0) > 0 and es_open_multiplier_key(row)})\n'),
                ('return contest_points * (mults + 1)',
                 'return contest_points * (mults if self.state.get("scoringRevision") == "26.10.26" else mults + 1)'),
            ])
        if plugin_id == "cqws":
            replacements.extend([
                ('        "YL": 7,', '        "YL": 3 if self.state.get("scoringRevision") == "26.10.26" else 7,'),
                ('        "QRP": 7,',
                 '        "QRP": 3 if self.state.get("scoringRevision") == "26.10.26" else 7,\n'
                 '        "TEEN": 7 if self.state.get("scoringRevision") == "26.10.26" else 0,\n'
                 '        "ROOKIE": 7 if self.state.get("scoringRevision") == "26.10.26" else 0,'),
                ('def show_mults(self, rtc=None):\n',
                 'def show_mults(self, rtc=None):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import cqws_multiplier_counts\n'
                 '        countries, units, _ = cqws_multiplier_counts(self)\n'
                 '        return (countries, units) if rtc is not None else countries + units\n'),
                ('return contest_points * (1 + mults)',
                 'return contest_points * (mults if self.state.get("scoringRevision") == "26.10.26" else 1 + mults)'),
            ])
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
        if plugin_id == "rsgb_commonwealth_beru":
            # BERU permits HQ stations to send "SERIAL HQ", and the original
            # contact setter preserves that complete exchange. Its ESM gates,
            # however, only reach LOGIT for a purely numeric value. Extend the
            # two original Run/S&P predicates while leaving button order,
            # commit ownership and the host's authoritative validation intact.
            replacements.extend([
                (
                    "elif self.other_2.text().isnumeric():\n"
                    "                # If the operator corrected a busted callsign",
                    "elif (self.other_2.text().isnumeric() or re.fullmatch(\n"
                    "                r\"[0-9]+\\s+[Hh][Qq]\", self.other_2.text())):\n"
                    "                # If the operator corrected a busted callsign",
                ),
                (
                    "elif self.other_2.text().isnumeric():\n"
                    "                self.make_button_green(self.esm_dict[\"EXCH\"])",
                    "elif (self.other_2.text().isnumeric() or re.fullmatch(\n"
                    "                r\"[0-9]+\\s+[Hh][Qq]\", self.other_2.text())):\n"
                    "                self.make_button_green(self.esm_dict[\"EXCH\"])",
                ),
            ])
        if plugin_id in {"jidx_cw", "jidx_ph"}:
            replacements.extend([
                ('def points(self):\n',
                 'def points(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import jidx_points\n'
                 '        return jidx_points(self)\n'),
                ('def show_mults(self):\n',
                 'def show_mults(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import jidx_credit_keys\n'
                 '        return len({key for row in self.database.fetch_all_contacts_asc()\n'
                 '                    if row.get("Points", 0) > 0 for key in jidx_credit_keys(self, row)})\n'),
                ('        result = self.database.fetch_nr_count()\n        mults = int(result.get("nr_count", 0))',
                 '        result = self.database.fetch_nr_count()\n'
                 '        mults = (show_mults(self) if self.state.get("scoringRevision") == "26.10.26"\n'
                 '                 else int(result.get("nr_count", 0)))'),
                ('def predupe(self):  # pylint: disable=unused-argument',
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import jidx_assign_multipliers\n'
                 '        jidx_assign_multipliers(self, self.contact)\n\n\n'
                 'def predupe(self):  # pylint: disable=unused-argument'),
                ('def recalculate_mults(self):\n',
                 'def recalculate_mults(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import jidx_assign_multipliers\n'
                 '        seen = set()\n'
                 '        for row in self.database.fetch_all_contacts_asc():\n'
                 '            jidx_assign_multipliers(self, row, seen)\n'
                 '            self.database.change_contact(row)\n'
                 '        return\n'),
                ('def get_mults(self):\n',
                 'def get_mults(self):\n'
                 '    if self.state.get("scoringRevision") == "26.10.26":\n'
                 '        from contest_host.upstream import jidx_rtc_mults\n'
                 '        return jidx_rtc_mults(self)\n'),
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
        if plugin_id == "ca_qso_party":
            replacements.append((
                'my_qth = self.contest_settings.get("SentExchange", "").upper()',
                'my_qth = str(contact.get("MiscText", self.contest_settings.get("SentExchange", ""))).upper()',
            ))
        if plugin_id == "winter_field_day":
            replacements.append((
                'f"{self.contest_settings.get(\'SentExchange\', \'\').ljust(9).upper()}"',
                'f"{str(contact.get(\'MiscText\', self.contest_settings.get(\'SentExchange\', \'\'))).ljust(9).upper()}"',
            ))
        if plugin_id == "raem":
            replacements.append((
                'f"{self.contest_settings.get(\'SentExchange\', \'\').ljust(14).upper()}"',
                'f"{str(contact.get(\'MiscText\', self.contest_settings.get(\'SentExchange\', \'\'))).ljust(14).upper()}"',
            ))
        if plugin_id == "stew_perry_topband":
            replacements.append((
                'f"{self.contest_settings.get(\'SentExchange\', \'\').ljust(9).upper()}"',
                'f"{str(contact.get(\'MiscText\', self.contest_settings.get(\'SentExchange\', \'\'))).split(\'|\', 1)[0].ljust(9).upper()}"',
            ))
        if plugin_id == "ukeidx":
            replacements.extend([
                (
                    'zt = datetime.datetime.now(datetime.UTC).isoformat(" ")[11:16]',
                    'zt = str(self.contact.get("TS", ""))[11:16]',
                ),
                ('["3.5", "7"]', '[3.5, 7.0]', 8),
            ])
        if plugin_id == "wia_remembrance":
            replacements.extend([
                (
                    'self.contact.get("Band", 0) == "1.8"',
                    'float(self.contact.get("Band", 0)) == 1.8',
                ),
                (
                    '100 >= int(datetime.datetime.now().astimezone().strftime("%H%M")) <= 600',
                    '100 <= int((datetime.datetime.strptime(self.contact.get("TS", ""), "%Y-%m-%d %H:%M:%S")'
                    '.replace(tzinfo=datetime.UTC) + datetime.timedelta(minutes=int('
                    'self.contest_settings.get("ContestUTCOffsetMinutes", 0)))).strftime("%H%M")) <= 600',
                ),
                (
                    'now = datetime.datetime.now(datetime.UTC)\n            date_time = now.strftime("%Y-%m-%d %H:%M:%S")',
                    'date_time = self.dupe_timestamp',
                ),
            ])
        if plugin_id == "agcw_qrp":
            replacements.extend([
                (
                    'self.contact["SentNr"] = self.other_1.text().upper() + self.contest_settings.get(\n'
                    '        "SentExchange", "xxx xxx"\n    ).strip("#")',
                    'configured = self.contest_settings.get("SentExchange", "xxx xxx")\n'
                    '    self.contact["SentNr"] = (self.other_1.text().upper() + configured.strip("#")\n'
                    '                              if "#" in configured else self.other_1.text().upper())',
                ),
                (
                    'f"select count(*) as member_count from dxlog where  TS < \'{time_stamp}\' "',
                    'f"select count(*) as member_count from dxlog where  (TS < \'{time_stamp}\' OR "\n'
                    '                f"(TS = \'{time_stamp}\' AND rowid < (SELECT rowid FROM dxlog WHERE ID = \'{contact.get(\"ID\", \"\")}\'))) "',
                ),
            ])
        if plugin_id in {"rda_contest", "rdxc"}:
            replacements.extend([
                (
                    '"select count(*) as mult_count from dxlog where TS < ? and "',
                    '"select count(*) as mult_count from dxlog where (TS < ? or (TS = ? and rowid < "\n'
                    '                "(select rowid from dxlog where ID = ?))) and "',
                ),
                (
                    'contact.get("TS", ""),\n                    rda_code,' if plugin_id == "rda_contest" else
                    'contact.get("TS", ""),\n                    oblast,',
                    'contact.get("TS", ""),\n                    contact.get("TS", ""),\n'
                    '                    contact.get("ID", ""),\n                    '
                    + ('rda_code,' if plugin_id == "rda_contest" else 'oblast,'),
                ),
                (
                    '"select CountryPrefix from dxlog where TS < ? and "' if plugin_id == "rda_contest" else
                    '"select CountryPrefix from dxlog where TS < ? and Band = ? "',
                    ('"select CountryPrefix from dxlog where (TS < ? or (TS = ? and rowid < "\n'
                     '                "(select rowid from dxlog where ID = ?))) and "')
                    if plugin_id == "rda_contest" else
                    ('"select CountryPrefix from dxlog where (TS < ? or (TS = ? and rowid < "\n'
                     '                "(select rowid from dxlog where ID = ?))) and Band = ? "'),
                ),
                (
                    'contact.get("TS", ""),\n                    self.pref.get("contest", "1"),' if plugin_id == "rda_contest" else
                    'contact.get("TS", ""),\n                    band,',
                    'contact.get("TS", ""),\n                    contact.get("TS", ""),\n'
                    '                    contact.get("ID", ""),\n                    '
                    + ('self.pref.get("contest", "1"),' if plugin_id == "rda_contest" else 'band,'),
                ),
            ])
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
        if plugin_id == "qso_party_rst":
            # The pinned plugin refers to a nonexistent `rcv` widget in prefill.
            # Keep source bytes exact and adapt only those three proven aliases.
            replacements.extend([
                ('case "LSB" | "USB" | "SSB" | "FM" | "AM":\n            self.sent.setText("599")\n            self.rcv.setText("599")',
                 'case "LSB" | "USB" | "SSB" | "FM" | "AM":\n            self.sent.setText("599")\n            self.receive.setText("599")'),
                ('case "CW" | "CW-U" | "CW-L" | "CW-R" | "CWR":\n            self.sent.setText("59")\n            self.rcv.setText("59")',
                 'case "CW" | "CW-U" | "CW-L" | "CW-R" | "CWR":\n            self.sent.setText("59")\n            self.receive.setText("59")'),
                ('| "PKTLSB"\n        ):\n            self.sent.setText("599")\n            self.rcv.setText("599")',
                 '| "PKTLSB"\n        ):\n            self.sent.setText("599")\n            self.receive.setText("599")'),
            ])
        if plugin_id in {"qso_party_rst", "qso_party_sn"}:
            # Keep operator-entered locations out of upstream SQL while retaining
            # its exact uppercase comparison and stable same-second replay order.
            replacements.extend([
                (
                    'query = (\n'
                    '        f"select count(*) as county_count from dxlog where "\n'
                    '        f"Exchange1 = \'{county}\' "\n'
                    '        f"and ContestNR = {self.pref.get(\'contest\', \'1\')};"\n'
                    '    )\n'
                    '    result = self.database.exec_sql(query)',
                    'result = self.database.qso_party_location_count(county)',
                ),
                (
                    'query = (\n'
                    '            f"select count(*) as county_count from dxlog where  TS < \'{time_stamp}\' "\n'
                    '            f"and Exchange1 = \'{county.upper()}\' "\n'
                    '            f"and ContestNR = {self.pref.get(\'contest\', \'1\')};"\n'
                    '        )\n'
                    '        result = self.database.exec_sql(query)',
                    'result = self.database.qso_party_location_count_before(\n'
                    '            county.upper(), time_stamp, contact.get("ID", "")\n'
                    '        )',
                ),
                (
                    'print(f"{result=}")',
                    'logger.debug("call-history result: %s", result)',
                ),
            ])
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
        if plugin_id == "cq_ww_vhf":
            # DXLOG persists the host's canonical numeric band. Keep the source
            # scoring while adapting that boundary.
            replacements.extend([
                ('if band in ("50.0", "6"):', 'if float(band) == 50.0:'),
                ('if band in ("144.0", "2"):', 'if float(band) == 144.0:'),
            ])
        if plugin_id == "john_moyle_field_day":
            # Duplicate checks must use the contact timestamp during correction
            # and replay. A rowid tie-break makes same-second WPX allocation stable.
            replacements.extend([
                ('now = datetime.datetime.now(datetime.UTC)',
                 'now = datetime.datetime.fromisoformat(self.dupe_timestamp).replace(tzinfo=datetime.UTC)'),
                ('        TS < ?\n        and WPXPrefix = ?',
                 '        (TS < ? OR (TS = ? AND rowid < (SELECT rowid FROM dxlog WHERE ID = ?)))\n'
                 '        and WPXPrefix = ?'),
                ('        (time_stamp, wpx, contest_nr, band, mode_group, block),',
                 '        (time_stamp, time_stamp, self.contact.get("ID", ""), wpx, contest_nr, band, mode_group, block),'),
            ])
        if plugin_id == "nac_vhf":
            # The original settings label is not a durable per-QSO band. Derive
            # the GHz factor from the contact's canonical numeric band instead.
            replacements.append((
                'return GHZ_MULT.get(str(self.contest_settings.get("BandCategory", "")), 1)',
                'band = float(self.contact.get("Band", 0) or 0)\n'
                '    return 7 if band >= 47000 else 6 if band >= 24000 else 5 if band >= 10000 else '\
                '4 if band >= 5650 else 3 if band >= 3300 else 2 if band >= 2300 else 1',
            ))
        if plugin_id == "ta_vhf_uhf_contest":
            replacements.append((
                '        "50": 1,\n        "144": 2,\n        "432": 3,',
                '        "50.0": 1,\n        "144.0": 2,\n        "432.0": 3,',
            ))
        if plugin_id == "vhf_sprint":
            replacements.extend([
                ('if _band in ["50", "144"]:', 'if _band in [50.0, 144.0]:'),
                ('if _band in ["222", "432"]:', 'if _band in [222.0, 432.0]:'),
                ('if _band in ["902", "1296"]:', 'if _band in [902.0, 1296.0]:'),
                ('if _band in ["2300+"]:', 'if float(_band) >= 2300.0:'),
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


def pacc_multiplier_key(row):
    """PACC 2026 §9.2: country except the named country/call-area families."""
    country = str(row.get("CountryPrefix", "")).upper()
    if country not in {"UA9", "CE", "JA", "LU", "PY", "VE", "K", "VK", "ZS", "ZL"}:
        return country
    prefix = str(row.get("WPXPrefix", "")).upper()
    digits = re.findall(r"[0-9]", prefix)
    area = digits[-1] if digits else "0"
    if country == "VE":
        # VO/VY districts are separate from VE/VA and equivalent special calls.
        country = "VO" if prefix.startswith("VO") else "VY" if prefix.startswith("VY") else "VE"
    elif country == "UA9":
        country = "UA"
    return country + area


def jidx_japanese_prefix(prefix):
    """Japan and the JD1 island entities named in JIDX §6."""
    prefix = str(prefix).upper()
    return prefix in {"JA", "JD/O", "JD/M"} or prefix.startswith("JD1")


def jidx_exchange_limit(prefix, call):
    """JA land stations send prefectures; every DX or /MM station sends a zone."""
    return 50 if jidx_japanese_prefix(prefix) and not str(call).upper().endswith("/MM") else 40


def jidx_credit_keys(desk, row):
    """JIDX 2026 §§5–6: eligible JA/DX multipliers, independently per band."""
    own = desk.cty_lookup(desk.station.get("Call", ""))
    own_prefix = next(iter(own.values())).get("primary_pfx", "") if own else ""
    their_mm = str(row.get("Call", "")).upper().endswith("/MM")
    their_prefix = str(row.get("CountryPrefix", ""))
    if not own_prefix or not their_prefix and not their_mm:
        return []
    own_ja = jidx_exchange_limit(own_prefix, desk.station.get("Call", "")) == 50
    their_ja = jidx_exchange_limit(their_prefix, row.get("Call", "")) == 50
    if own_ja == their_ja:
        return []
    band = row.get("Band")
    if band not in {1.8, 3.5, 7.0, 14.0, 21.0, 28.0}:
        return []
    number = str(row.get("NR", ""))
    if not number.isdigit() or not 1 <= int(number) <= (40 if own_ja else 50):
        return []
    if not own_ja:
        return [("prefecture", band, int(number))]
    keys = [("zone", band, int(number))]
    if not their_mm:
        keys.append(("country", band, their_prefix))
    return keys


def jidx_points(desk):
    if desk.contact_is_dupe or not jidx_credit_keys(desk, desk.contact):
        return 0
    return {1.8: 4, 3.5: 2, 7.0: 1, 14.0: 1, 21.0: 1, 28.0: 2}.get(desk.contact.get("Band"), 0)


def jidx_rtc_mults(desk):
    keys = {key for row in desk.database.fetch_all_contacts_asc() if row.get("Points", 0) > 0
            for key in jidx_credit_keys(desk, row)}
    own = desk.cty_lookup(desk.station.get("Call", ""))
    prefix = next(iter(own.values())).get("primary_pfx", "") if own else ""
    japanese = jidx_exchange_limit(prefix, desk.station.get("Call", "")) == 50
    families = ("country", "zone") if japanese else ("prefecture",)
    return {family: sum(key[0] == family for key in keys) for family in families}


def jidx_assign_multipliers(desk, contact, seen=None):
    """M1 is prefecture/zone; M2 is the Japanese entrant's DXCC credit."""
    rebuilding = seen is not None
    if seen is None:
        seen = {key for row in desk.database.fetch_all_contacts_asc() if row.get("Points", 0) > 0
                for key in jidx_credit_keys(desk, row)}
    contact["IsMultiplier1"] = contact["IsMultiplier2"] = 0
    eligible = contact.get("Points", 0) > 0 if rebuilding else not desk.contact_is_dupe
    if eligible:
        for key in jidx_credit_keys(desk, contact):
            if key not in seen:
                contact["IsMultiplier2" if key[0] == "country" else "IsMultiplier1"] = 1
            seen.add(key)


def es_open_points(desk):
    """ES Open 2026: eligible 80/40m QSOs; no Russian/Belarusian credit."""
    own = desk.cty_lookup(desk.station.get("Call", ""))
    own_prefix = next(iter(own.values())).get("primary_pfx", "") if own else ""
    their_prefix = desk.contact.get("CountryPrefix", "")
    excluded = {"UA", "UA2", "UA9", "EU"}
    if (desk.contact_is_dupe or desk.contact.get("Band") not in {3.5, 7.0}
            or own_prefix in excluded or their_prefix in excluded
            or not own_prefix or not their_prefix
            or own_prefix != "ES" and their_prefix != "ES"):
        return 0
    return {"CW": 2, "SSB": 1, "USB": 1, "LSB": 1}.get(desk.contact.get("Mode"), 0)


def es_open_multiplier_key(row):
    """One ES region 0–9 on each band/mode, including the entrant's region."""
    prefix = str(row.get("WPXPrefix", "")).upper()
    match = re.fullmatch(r"ES([0-9])", prefix)
    if row.get("CountryPrefix") == "ES" and match:
        return (match.group(1), row.get("Band"), row.get("Mode"))
    return None


CQWS_BRAZILIAN_UNITS = frozenset({
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RS", "RO", "RN", "RR", "SC", "SP", "SE", "TO",
})
CQWS_UF_LIMITATION = ("Brazilian station-type exchanges do not identify a federal unit; "
                      "unknown UF multipliers are omitted and this score is a lower bound.")


def cqws_multiplier_counts(desk):
    """CQWS 2023 §10: countries globally; explicit Brazilian UF per band only.

    Category codes are not federal units. No callsign-to-UF inference is made.
    The unresolved count prevents a partial lower bound being presented as final.
    """
    countries, units, unresolved = set(), set(), 0
    for row in desk.database.fetch_all_contacts_asc():
        if row.get("Points", 0) <= 0:
            continue
        prefix = row.get("CountryPrefix", "")
        if prefix:
            countries.add(prefix)
        # Include Brazil's separate PY0 island entities; category exchanges
        # still do not establish their UF, so they also need the partial guard.
        if str(prefix).startswith("PY"):
            exchange = str(row.get("Exchange1", "")).upper()
            if exchange in CQWS_BRAZILIAN_UNITS:
                units.add((exchange, row.get("Band")))
            else:
                unresolved += 1
    return len(countries), len(units), unresolved


def adif_context_fields(desk, contact):
    """Retain compound exchanges that the pinned generic ADIF writer omits.

    Application-defined ADIF fields supplement the original interoperable tags.
    Use saved identity/row values only; never guess old exchanges from setup.
    """
    identity = desk.database.exec_sql("SELECT raw_fields FROM xlog_qso_identity WHERE id=?", (contact["ID"],))
    fields = {"APP_XLOG_PLUGIN": desk.state["pluginID"], "APP_XLOG_QSO_ID": contact["ID"]}
    if identity:
        fields["APP_XLOG_ENTRY_FIELDS"] = identity["raw_fields"]
    site = desk.database.exec_sql("SELECT site FROM xlog_qso_site WHERE qso_id=?", (contact["ID"],))
    if site:
        fields["APP_XLOG_SITE"] = site["site"]
    imported = desk.database.exec_sql("SELECT source FROM xlog_adif_import WHERE qso_id=?",(contact["ID"],))
    if imported:
        fields["APP_XLOG_IMPORT_SOURCE"] = imported["source"]
    exchange = {key: contact[key] for key in (
        "SentNr", "NR", "Name", "Exchange1", "CK", "Prec", "Sect", "GridSquare", "ZN", "MiscText"
    ) if key in contact and contact[key] not in (None, "")}
    fields["APP_XLOG_EXCHANGE_FIELDS"] = json.dumps(exchange, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return fields


def ref_french_call(desk, call):
    country = desk.cty_lookup(call)
    prefix = next(iter(country.values())).get("primary_pfx", "") if country else ""
    return prefix.startswith("F") or prefix == "TK"


def ref_credit_keys(desk, contact):
    prefix = str(contact.get("CountryPrefix", ""))
    band = contact.get("Band")
    if prefix in {"F", "TK"}:
        department = str(contact.get("NR", "")).upper()
        if department.isdigit():
            department = department.zfill(2)
        return [("department", band, department)] if department else []
    if prefix.startswith("F"):
        return [("department", band, prefix)]
    if prefix and ref_french_call(desk, desk.station.get("Call", "")):
        return [("country", band, prefix)]
    return []


def ref_assign_multipliers(desk, contact, seen=None):
    """REF department/overseas-prefix and domestic-only DXCC credit per band."""
    rebuilding = seen is not None
    if seen is None:
        seen = {key for row in desk.database.fetch_all_contacts_asc() if row.get("Points", 0) > 0
                for key in ref_credit_keys(desk, row)}
    contact["IsMultiplier1"] = contact["IsMultiplier2"] = 0
    eligible = contact.get("Points", 0) > 0 if rebuilding else not desk.contact_is_dupe
    if eligible:
        for key in ref_credit_keys(desk, contact):
            if key not in seen:
                contact["IsMultiplier1" if key[0] == "department" else "IsMultiplier2"] = 1
            seen.add(key)
