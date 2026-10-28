"""Do not silently reintroduce the dependency versions reviewed in Phase 5."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("security_policy", Path(__file__).resolve().parents[2] / "tools/check_reviewed_security_patches.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ReviewedSecurityPatchTests(unittest.TestCase):
    def packages(self):
        return [{"name": name, "version": ".".join(map(str, value))} for name, value in policy.FLOORS.items()]

    def test_advisory_patched_versions_pass(self):
        self.assertEqual(policy.violations(self.packages()), [])

    def test_each_previous_locked_version_is_rejected(self):
        for name, version in [("rustls", "0.23.45"), ("rustls-webpki", "0.103.15"), ("tokio", "1.53.2")]:
            with self.subTest(name=name):
                rows = self.packages()
                next(row for row in rows if row["name"] == name)["version"] = version
                self.assertEqual(len(policy.violations(rows)), 1)
                self.assertIn("below reviewed patch", policy.violations(rows)[0])

    def test_later_patch_on_reviewed_line_passes(self):
        rows = self.packages(); rows[0]["version"] = "0.23.99"
        self.assertEqual(policy.violations(rows), [])

    def test_prerelease_malformed_and_unreviewed_line_fail_closed(self):
        for version in ["0.23.46-alpha.1", "0.24.0", "invalid"]:
            rows = self.packages(); rows[0]["version"] = version
            self.assertIn("unreviewed release line", policy.violations(rows)[0])

    def test_missing_reviewed_dependency_requires_policy_review(self):
        self.assertEqual(len(policy.violations(self.packages()[1:])), 1)

    def test_second_unsafe_copy_cannot_hide_behind_patched_version(self):
        rows = self.packages() + [{"name": "tokio", "version": "1.53.2"}]
        self.assertEqual(len(policy.violations(rows)), 1)

    def test_unrelated_dependencies_do_not_change_bounded_policy(self):
        self.assertEqual(policy.violations(self.packages() + [{"name": "unrelated", "version": "0.1.0"}]), [])
