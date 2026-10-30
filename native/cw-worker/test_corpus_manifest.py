import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from corpus_manifest import CONTRACT_SHA256, NORMALIZATION, counter, digest, seal, validate, verify_seal

class CorpusManifestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.manifest = self.root / "manifest.json"
        self.value = {"schema_version": 1, "contract_sha256": CONTRACT_SHA256,
            "normalization": NORMALIZATION, "recordings": []}
        for index, split in enumerate(("calibration", "held_out")):
            identity = f"recording-{index}"
            iq = self.root / (identity + ".cf32")
            iq.write_bytes(struct.pack("<ffff", .1 + index, -.2, .3, -.4))
            annotations = self.root / (identity + ".json")
            annotations.write_text(json.dumps({"schema_version": 1, "recording_id": identity,
                "annotator_id": "independent-reviewer", "independent_of_decoder": True, "truth_review": "reviewed_with_uncertainty"}))
            self.value["recordings"].append({"id": identity, "split": split, "kind": "real_iq", "provider": "flex_dax_iq",
                "recording_family_id": f"family-{index}", "capture_session_id": f"session-{index}", "operator_id": f"operator-{index}",
                "sample_rate": 96000, "format": "cf32_le_interleaved_iq", "first_sample": "0", "complex_samples": "2",
                "permission": {"basis": "operator_consent", "reference": "TEST FIXTURE ONLY: not a real licensed RF capture"},
                "iq_path": iq.name, "iq_sha256": digest(iq), "annotations_path": annotations.name, "annotations_sha256": digest(annotations)})

    def run_value(self, value=None):
        self.manifest.write_text(json.dumps(self.value if value is None else value))
        return validate(self.manifest)

    def test_seals_hashes_and_uncertainty_without_qualification_or_exposure_claims(self):
        result = self.run_value()
        self.assertEqual(result["status"], "sealed_inputs_not_scored_or_qualified")
        self.assertEqual(len(result["recordings"]), 2)
        self.assertEqual(result["recordings"][1]["truth_review"], "reviewed_with_uncertainty")
        self.assertEqual(result["recordings"][1]["recorded_sample_seconds"], 2 / 96000)
        self.assertNotIn("negative_band_hours", result)
        self.assertNotIn("quality_qualified", result)
        output = self.root / "seal.json"
        seal(self.manifest, output)
        self.assertEqual(verify_seal(output)["recordings"], result["recordings"])
        original = output.read_bytes()
        with self.assertRaises(FileExistsError): seal(self.manifest, output)
        self.assertEqual(output.read_bytes(), original)

    def test_reverification_refuses_later_capture_annotation_and_manifest_edits(self):
        for target in ("iq_path", "annotations_path", "manifest"):
            self.run_value(); output = self.root / ("seal-" + target + ".json"); seal(self.manifest, output)
            path = self.manifest if target == "manifest" else self.root / self.value["recordings"][0][target]
            original = path.read_bytes(); path.write_bytes(original + b" ")
            with self.subTest(target=target), self.assertRaises(ValueError): verify_seal(output)
            path.write_bytes(original)

    def test_refuses_leakage_by_family_session_or_operator_including_case_variants(self):
        for group in ("recording_family_id", "capture_session_id", "operator_id"):
            value = copy.deepcopy(self.value)
            value["recordings"][1][group] = value["recordings"][0][group].upper()
            with self.subTest(group=group), self.assertRaisesRegex(ValueError, group): self.run_value(value)

    def test_duplicate_iq_does_not_become_independent_exposure(self):
        value = copy.deepcopy(self.value)
        for key in ("iq_path", "iq_sha256"):
            value["recordings"][1][key] = value["recordings"][0][key]
        with self.assertRaisesRegex(ValueError, "Duplicate IQ"): self.run_value(value)

    def test_spacing_alias_cannot_hide_a_shared_operator(self):
        value = copy.deepcopy(self.value)
        value["recordings"][1]["operator_id"] = "  " + value["recordings"][0]["operator_id"].upper() + "  "
        with self.assertRaisesRegex(ValueError, "operator_id"): self.run_value(value)

    def test_refuses_changed_bytes_sample_counts_and_lost_integer_origins(self):
        for key, invalid in (("iq_sha256", "0" * 64), ("complex_samples", "3"), ("first_sample", 123),
                ("first_sample", "01"), ("first_sample", "18446744073709551615"), ("sample_rate", 192000)):
            value = copy.deepcopy(self.value); value["recordings"][0][key] = invalid
            with self.subTest(key=key, invalid=invalid), self.assertRaises(ValueError): self.run_value(value)
        self.assertEqual(counter("18446744073709551615"), 2**64 - 1)

    def test_requires_consent_and_does_not_relabel_real_iq_as_owned_synthetic(self):
        for permission in ({}, {"basis": "operator_consent", "reference": ""},
                {"basis": "owned_synthetic", "reference": "not real consent"}):
            value = copy.deepcopy(self.value); value["recordings"][0]["permission"] = permission
            with self.subTest(permission=permission), self.assertRaises(ValueError): self.run_value(value)

    def test_refuses_missing_independent_or_mismatched_annotation_provenance(self):
        item = self.value["recordings"][0]; path = self.root / item["annotations_path"]
        original = json.loads(path.read_text())
        for key, invalid in (("independent_of_decoder", False), ("independent_of_decoder", 1),
                ("recording_id", "other"), ("annotator_id", ""), ("truth_review", "unreviewed")):
            truth = dict(original, **{key: invalid}); path.write_text(json.dumps(truth)); item["annotations_sha256"] = digest(path)
            with self.subTest(key=key, invalid=invalid), self.assertRaises(ValueError): self.run_value()

    def test_refuses_duplicate_json_fields_and_linked_artifacts(self):
        self.manifest.write_text('{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, "Duplicate"): validate(self.manifest)
        self.manifest.write_text('{"schema_version":1,"extra":1e999}')
        with self.assertRaisesRegex(ValueError, "Non-finite"): validate(self.manifest)
        item = self.value["recordings"][0]
        link = self.root / "iq-link.cf32"; link.symlink_to(self.root / item["iq_path"]); item["iq_path"] = link.name
        with self.assertRaisesRegex(ValueError, "linked"): self.run_value()

    def test_refuses_contract_or_normalization_changes(self):
        for key, value in (("schema_version", True), ("contract_sha256", "0" * 64), ("normalization", "remove_repeated_calls")):
            manifest = copy.deepcopy(self.value); manifest[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.run_value(manifest)

if __name__ == "__main__": unittest.main()
