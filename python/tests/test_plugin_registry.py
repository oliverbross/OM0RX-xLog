from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from contest_host.host import Host, HostError
from contest_host.plugins import PLUGIN_REGISTRY, PLUGINS, SERIAL_PLUGINS
from contest_host import upstream


class PluginRegistryTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((upstream.VENDOR.parent / "source-manifest.json").read_text())

    def verify_manifest(self, manifest):
        with patch.object(upstream, "_verified", False), patch.object(upstream.json, "loads", return_value=manifest):
            upstream.verify_source()

    def test_registered_plugins_are_verified_and_catalog_and_serials_derive_from_registry(self):
        self.verify_manifest(self.manifest)
        self.assertEqual(self.manifest["registeredPlugins"], list(PLUGIN_REGISTRY))
        self.assertEqual(SERIAL_PLUGINS, {key for key, plugin in PLUGIN_REGISTRY.items() if plugin.serial})
        self.assertEqual(dict(PLUGINS), {key: plugin.name for key, plugin in PLUGIN_REGISTRY.items()})
        self.assertEqual(PLUGIN_REGISTRY["cq_ww_cw"].matrix_trackers, ("countries", "zones"))
        self.assertEqual(PLUGIN_REGISTRY["cq_ww_ssb"].matrix_trackers, ("countries", "zones"))
        self.assertEqual(PLUGIN_REGISTRY["cq_ww_ssb"].modes, ("SSB",))
        self.assertEqual(PLUGIN_REGISTRY["cq_ww_rtty"].matrix_trackers, ("countries", "zones", "states"))
        self.assertIn("USB-D", PLUGIN_REGISTRY["cq_ww_rtty"].modes)
        self.assertEqual(PLUGIN_REGISTRY["cq_wpx_ssb"].modes, ("SSB",))
        self.assertEqual(PLUGIN_REGISTRY["arrl_ss_phone"].modes, ("SSB",))
        self.assertEqual(PLUGIN_REGISTRY["oceania_dx_ssb"].modes, ("SSB",))
        self.assertTrue(all(not plugin.matrix_trackers for key, plugin in PLUGIN_REGISTRY.items()
                            if key not in {"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"}))
        with TemporaryDirectory() as root:
            host = Host(Path(root).resolve())
            try:
                catalog = host.dispatch({"id": "catalog", "method": "catalog", "params": {}})
                self.assertEqual(len(catalog["plugins"]), 64)
                self.assertEqual([(item["id"], item["name"]) for item in catalog["plugins"]], list(PLUGINS.items()))
                sweepstakes = next(item for item in catalog["plugins"] if item["id"] == "arrl_ss_cw")
                self.assertEqual(sweepstakes["modes"], ["CW"])
                self.assertEqual(sweepstakes["sentExchangeHint"], "Prec Call Check Section")
                self.assertEqual(sweepstakes["overlayChoices"], ["N/A"])
                sweepstakes_phone = next(item for item in catalog["plugins"] if item["id"] == "arrl_ss_phone")
                self.assertEqual((sweepstakes_phone["name"], sweepstakes_phone["modes"],
                                  sweepstakes_phone["sentExchangeHint"], sweepstakes_phone["overlayChoices"]),
                                 ("ARRL Sweepstakes Phone", ["SSB"], "Prec Call Check Section", ["N/A"]))
                oceania = next(item for item in catalog["plugins"] if item["id"] == "oceania_dx_ssb")
                self.assertEqual(oceania["modes"], ["SSB"])
                cq_ww_ssb = next(item for item in catalog["plugins"] if item["id"] == "cq_ww_ssb")
                self.assertEqual((cq_ww_ssb["name"], cq_ww_ssb["modes"], cq_ww_ssb["sentExchangeHint"]),
                                 ("CQ WW SSB", ["SSB"], "CQ Zone No."))
                cq_ww_rtty = next(item for item in catalog["plugins"] if item["id"] == "cq_ww_rtty")
                self.assertEqual((cq_ww_rtty["name"], cq_ww_rtty["modes"][0], cq_ww_rtty["sentExchangeHint"]),
                                 ("CQ WW RTTY", "RTTY", "CQ Zone + (state/VE area)"))
                cq_wpx_ssb = next(item for item in catalog["plugins"] if item["id"] == "cq_wpx_ssb")
                self.assertEqual((cq_wpx_ssb["name"], cq_wpx_ssb["modes"], cq_wpx_ssb["sentExchangeHint"]),
                                 ("CQ WPX SSB", ["SSB"], "Sent Exchange"))
                championships = {item["id"]: item for item in catalog["plugins"]
                                 if item["id"] in {"euhfc", "iaru_hf"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in championships.items()},
                    {
                        "euhfc": ("EUHFC", ["CW", "SSB"], "Lic. Year (2 digits)"),
                        "iaru_hf": ("IARU HF", ["CW", "SSB"], "ITU Zone"),
                    },
                )
                estonian = {item["id"]: item for item in catalog["plugins"]
                            if item["id"] in {"es_field_day", "es_ll_kv", "es_manual_key", "es_open"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in estonian.items()},
                    {
                        "es_field_day": ("ES FIELD DAY", ["CW", "SSB"], "Serial + Estonian region"),
                        "es_ll_kv": ("ES LL KV", ["CW", "SSB"], "Serial number"),
                        "es_manual_key": ("ES MANUAL KEY", ["CW"], "Seniority + serial"),
                        "es_open": ("ES OPEN", ["CW", "SSB"], "Serial number"),
                    },
                )
                single_band = {item["id"]: item for item in catalog["plugins"]
                               if item["id"] in {"arrl_10m", "arrl_160m"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in single_band.items()},
                    {
                        "arrl_10m": ("ARRL 10M", ["CW", "SSB"],
                                     "State/Province, serial or ITU region"),
                        "arrl_160m": ("ARRL 160-Meter", ["CW"],
                                      "ARRL/RAC section or DX CQ zone"),
                    },
                )
                king_of_spain = {item["id"]: item for item in catalog["plugins"]
                                 if item["id"] in {"ea_majestad_cw", "ea_majestad_ssb"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in king_of_spain.items()},
                    {
                        "ea_majestad_cw": ("His Maj. King of Spain Contest, CW", ["CW"],
                                           "Province or #"),
                        "ea_majestad_ssb": ("His Maj. King of Spain Contest, SSB", ["SSB"],
                                            "Province or #"),
                    },
                )
                rsgb = {item["id"]: item for item in catalog["plugins"]
                        if item["id"] in {"rsgb_80m_cc", "rsgb_commonwealth_beru"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in rsgb.items()},
                    {
                        "rsgb_80m_cc": ("RSGB 80M CC", ["CW"], "Serial number"),
                        "rsgb_commonwealth_beru": (
                            "RSGB Commonwealth BERU", ["CW"], "Serial number (optional HQ)"),
                    },
                )
                central = {item["id"]: item for item in catalog["plugins"]
                           if item["id"] in {"ari_dx", "darc_xmas", "eudx", "lz-dx", "wag"}}
                self.assertEqual(
                    {key: (item["name"], item["modes"], item["sentExchangeHint"])
                     for key, item in central.items()},
                    {
                        "ari_dx": ("ARI International DX", ["CW", "SSB", "RTTY"], "Province or #"),
                        "darc_xmas": ("DARC XMAS", ["CW", "SSB"], "DOK/NM or #"),
                        "eudx": ("EUDXC", ["CW", "SSB"], "ITU zone or EU Union region"),
                        "lz-dx": ("LZ DX", ["CW", "SSB"], "District or ITU zone"),
                        "wag": ("WAG", ["CW", "SSB"], "DOK/NM or #"),
                    },
                )
            finally:
                host.close()
        for plugin_id in PLUGIN_REGISTRY:
            self.assertEqual(upstream.load_plugin(plugin_id).__file__,
                             str(upstream.VENDOR / f"not1mm/plugins/{plugin_id}.py"))

    def test_manifest_plugin_drift_fails_before_hash_verification(self):
        for ids in (list(PLUGIN_REGISTRY)[:-1], [*PLUGIN_REGISTRY, "unsupported"],
                    [*PLUGIN_REGISTRY, next(iter(PLUGIN_REGISTRY))], list(reversed(PLUGIN_REGISTRY)), None):
            with self.subTest(ids=ids):
                manifest = deepcopy(self.manifest)
                manifest["registeredPlugins"] = ids
                with self.assertRaisesRegex(RuntimeError, "registered plugins differ"):
                    self.verify_manifest(manifest)

    def test_registered_plugin_requires_a_verified_source_hash(self):
        manifest = deepcopy(self.manifest)
        del manifest["sha256"]["not1mm/plugins/cq_wpx_cw.py"]
        with self.assertRaisesRegex(RuntimeError, "plugin source hash is missing: cq_wpx_cw"):
            self.verify_manifest(manifest)

    def test_registered_plugin_hash_drift_still_fails(self):
        manifest = deepcopy(self.manifest)
        manifest["sha256"]["not1mm/plugins/cq_wpx_cw.py"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "source hash differs"):
            self.verify_manifest(manifest)

    def test_catalog_refuses_unverified_registry_manifest(self):
        manifest = deepcopy(self.manifest)
        manifest["registeredPlugins"] = []
        with TemporaryDirectory() as root:
            host = Host(Path(root).resolve())
            try:
                with patch.object(upstream, "_verified", False), patch.object(upstream.json, "loads", return_value=manifest):
                    with self.assertRaisesRegex(RuntimeError, "registered plugins differ"):
                        host.dispatch({"id": "catalog", "method": "catalog", "params": {}})
            finally:
                host.close()

    def test_unsupported_plugin_ids_never_reach_loader_or_session_creation(self):
        with TemporaryDirectory() as root:
            host = Host(Path(root).resolve())
            try:
                for plugin_id in ("unsupported", "../cq_ww_cw", ""):
                    with self.subTest(plugin_id=plugin_id), patch.object(upstream, "verify_source") as verify:
                        with self.assertRaisesRegex(ValueError, "Unsupported pinned plugin"):
                            upstream.load_plugin(plugin_id)
                        verify.assert_not_called()
                        with self.assertRaisesRegex(HostError, "Unsupported pinned plugin"):
                            host.new_state("unused", {"pluginID": plugin_id})
            finally:
                host.close()


if __name__ == "__main__":
    unittest.main()
