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
        self.assertTrue(all(not plugin.matrix_trackers for key, plugin in PLUGIN_REGISTRY.items() if key != "cq_ww_cw"))
        with TemporaryDirectory() as root:
            host = Host(Path(root).resolve())
            try:
                catalog = host.dispatch({"id": "catalog", "method": "catalog", "params": {}})
                self.assertEqual([(item["id"], item["name"]) for item in catalog["plugins"]], list(PLUGINS.items()))
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
                for plugin_id in ("unsupported", "cq_ww_ssb", "../cq_ww_cw", ""):
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
