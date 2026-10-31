#!/usr/bin/env python3
"""Disposable native bundle fixtures; no app compilation, signing or launch."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("macos_staging", Path(__file__).with_name("stage-macos-app.py"))
staging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staging)
COMMIT, TARGET = "a" * 40, "aarch64-apple-darwin"


class NativeBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="xlog-native-bundle-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.project = self.root / "prototype/src-tauri"
        self.release = self.project / "target/release"
        self.release.mkdir(parents=True)
        self.config = {
            "productName": "OM0RX-xLog", "version": "9.8.7", "identifier": "com.oliverbross.xlog.integration",
            "bundle": {"icon": ["icons/icon.icns"], "externalBin": ["binaries/xlog-prototype-worker", "binaries/rigctld", "binaries/rotctld"],
                       "resources": {"assets": "Manual"}, "category": "Utility",
                       "macOS": {"minimumSystemVersion": "14.0", "infoPlist": "Info.plist"}},
        }
        self.write(self.project / "Cargo.toml", '[package]\nname = "xlog-prototype"\nversion = "9.8.7"\n')
        self.write(self.root / "prototype/package.json", json.dumps({"version": "9.8.7"}))
        self.fragment = {"NSMicrophoneUsageDescription": "Explicit operator-selected recording input."}
        self.write(self.project / "Info.plist", plistlib.dumps(self.fragment))
        self.write(self.project / "icons/icon.icns", b"icns fixture")
        self.write(self.project / "assets/help.txt", b"Packaged resource")
        self.write(self.release / "Manual/help.txt", b"Packaged resource")
        self.write(self.release / "xlog-prototype", b"application fixture " + COMMIT.encode(), executable=True)
        for name in ("xlog-prototype-worker", "rigctld", "rotctld"):
            self.write(self.project / f"binaries/{name}-{TARGET}", name, executable=True)
            self.write(self.release / name, name, executable=True)
        self.receipt = self.root / "cargo.jsonl"
        self.messages = [
            {"reason": "compiler-artifact", "target": {"name": "tauri"}, "features": ["custom-protocol"], "fresh": True},
            {"reason": "compiler-artifact", "target": {"name": "xlog-prototype"}, "executable": str(self.release / "xlog-prototype"),
             "package_id": "path+file:///fixture/src-tauri#xlog-prototype@9.8.7",
             "fresh": False, "profile": {"test": False, "debug_assertions": False}},
            {"reason": "build-finished", "success": True},
        ]
        self.save()

    @staticmethod
    def write(path, data, executable=False):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data.encode() if isinstance(data, str) else data)
        path.chmod(0o755 if executable else 0o644)

    def save(self):
        self.write(self.project / "tauri.conf.json", json.dumps(self.config))
        self.write(self.receipt, "\n".join(json.dumps(item) for item in self.messages))
        self.write(self.root / "prototype/distribution-metadata/components.json", json.dumps({
            "sourceCommit": COMMIT, "components": [{"ecosystem": "cargo", "name": "xlog-prototype", "version": self.config["version"]}],
        }))

    def stage(self):
        return staging.stage_bundle(self.root, self.receipt, TARGET, COMMIT)

    def test_stages_exact_metadata_sidecars_and_resources(self):
        self.write(self.release / "unconfigured.sqlite", "Never ship this stale release file")
        bundle = self.stage()
        info = plistlib.loads((bundle / "Contents/Info.plist").read_bytes())
        self.assertEqual(info["CFBundleIdentifier"], "com.oliverbross.xlog.integration")
        self.assertEqual(info["CFBundleExecutable"], "xlog-prototype")
        self.assertEqual(info["CFBundleName"], "OM0RX-xLog")
        self.assertEqual(info["CFBundleShortVersionString"], "9.8.7")
        self.assertEqual(info["CFBundleVersion"], "9.8.7")
        self.assertEqual(info["LSMinimumSystemVersion"], "14.0")
        self.assertEqual(info["LSApplicationCategoryType"], "public.app-category.utilities")
        self.assertTrue(info["NSHighResolutionCapable"])
        self.assertTrue(info["LSRequiresCarbon"])
        self.assertEqual(info["NSMicrophoneUsageDescription"], self.fragment["NSMicrophoneUsageDescription"])
        self.assertEqual((bundle / "Contents/Resources/icon.icns").read_bytes(), b"icns fixture")
        self.assertEqual((bundle / "Contents/Resources/Manual/help.txt").read_bytes(), b"Packaged resource")
        self.assertEqual((bundle / "Contents/MacOS/rigctld").read_bytes(), b"rigctld")
        self.assertFalse((bundle / "Contents/Resources/unconfigured.sqlite").exists())
        manifest = json.loads((bundle / "Contents/Resources/NativeBundleBuild.json").read_text())
        self.assertEqual(manifest["sourceCommit"], COMMIT)
        self.assertTrue(manifest["customProtocol"])
        self.assertEqual(manifest["executableSHA256"], staging.digest(self.release / "xlog-prototype"))

    def test_rejects_dev_stale_failed_or_dirty_artifacts(self):
        for change in ("dev", "stale", "failed", "dirty"):
            with self.subTest(change=change):
                if change == "dev": self.messages[0]["features"] = []
                if change == "stale": self.messages[1]["fresh"] = True
                if change == "failed": self.messages[-1]["success"] = False
                if change == "dirty": self.write(self.release / "xlog-prototype", COMMIT + "-dirty", executable=True)
                self.save()
                with self.assertRaises(ValueError): self.stage()
                self.messages[0]["features"] = ["custom-protocol"]
                self.messages[1]["fresh"] = False
                self.messages[-1]["success"] = True

    def test_versions_and_identity_overrides_fail_before_replacement(self):
        self.write(self.root / "prototype/package.json", '{"version":"9.8.6"}')
        with self.assertRaisesRegex(ValueError, "versions must match"): self.stage()
        self.write(self.root / "prototype/package.json", '{"version":"9.8.7"}')
        self.write(self.project / "Info.plist", plistlib.dumps({**self.fragment, "CFBundleVersion": "old"}))
        with self.assertRaisesRegex(ValueError, "cannot override"): self.stage()

    def test_cargo_artifact_and_dependency_inventory_are_bound_to_version_source_and_path(self):
        original = dict(self.messages[1])
        for key, wrong in (("package_id", "path+file:///fixture/src-tauri#xlog-prototype@9.8.6"),
                           ("executable", str(self.release / "other-app"))):
            with self.subTest(key=key):
                self.messages[1][key] = wrong
                self.save()
                with self.assertRaisesRegex(ValueError, "freshly compiled"): self.stage()
                self.messages[1] = dict(original)
        self.save()
        inventory = self.root / "prototype/distribution-metadata/components.json"
        metadata = json.loads(inventory.read_text())
        metadata["components"][0]["version"] = "9.8.6"
        self.write(inventory, json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "versions must match"): self.stage()
        metadata["components"][0]["version"] = "9.8.7"
        metadata["sourceCommit"] = "b" * 40
        self.write(inventory, json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "inventory does not match"): self.stage()

    def test_missing_or_changed_sidecar_resource_and_escaping_paths_fail_closed(self):
        for path in (self.release / "rigctld", self.release / "Manual/help.txt"):
            original = path.read_bytes()
            path.unlink()
            with self.assertRaises(ValueError): self.stage()
            self.write(path, b"stale bytes", executable=path.name == "rigctld")
            with self.assertRaises(ValueError): self.stage()
            self.write(path, original, executable=path.name == "rigctld")
        self.config["bundle"]["resources"] = {"../operator.sqlite": "copied.sqlite"}
        self.save()
        with self.assertRaisesRegex(ValueError, "escaping bundle path"): self.stage()

    def test_new_version_archives_previous_candidate_and_same_version_changes_are_rejected(self):
        bundle = self.stage()
        self.write(bundle / "Contents/Resources/preserved-sentinel", "unique previous evidence")
        self.write(self.release / "xlog-prototype", b"different application " + COMMIT.encode(), executable=True)
        with self.assertRaisesRegex(ValueError, "advance its software version"): self.stage()
        self.assertTrue((bundle / "Contents/Resources/preserved-sentinel").is_file())
        self.config["version"] = "9.8.8"
        self.messages[1]["package_id"] = "path+file:///fixture/src-tauri#xlog-prototype@9.8.8"
        self.write(self.project / "Cargo.toml", '[package]\nname="xlog-prototype"\nversion="9.8.8"\n')
        self.write(self.root / "prototype/package.json", '{"version":"9.8.8"}')
        self.save()
        self.stage()
        previous = list(bundle.parent.glob(".OM0RX-xLog-previous-*.app"))
        self.assertEqual(len(previous), 1)
        self.assertTrue((previous[0] / "Contents/Resources/preserved-sentinel").is_file())
        self.assertFalse((bundle / "Contents/Resources/preserved-sentinel").exists())

    def test_failed_atomic_replacement_restores_the_previous_bundle(self):
        bundle = self.stage()
        self.write(bundle / "Contents/Resources/preserved-sentinel", "unchanged")
        replace = os.replace
        def fail_install(source, destination):
            if "-stage-" in str(source): raise OSError("fixture replacement failure")
            return replace(source, destination)
        with patch.object(staging.os, "replace", side_effect=fail_install):
            with self.assertRaises(OSError): self.stage()
        self.assertEqual((bundle / "Contents/Resources/preserved-sentinel").read_text(), "unchanged")


if __name__ == "__main__":
    unittest.main()
