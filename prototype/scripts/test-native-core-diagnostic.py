#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('native_core_diagnostic', Path(__file__).with_name('native-core-diagnostic.py'))
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class NativeCoreDiagnosticTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='xlog-native-filter-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.script = self.root / 'fixture.py'
        self.summary = self.root / 'summary.md'
        environment = patch.dict('os.environ', {'GITHUB_STEP_SUMMARY': str(self.summary)})
        environment.start()
        self.addCleanup(environment.stop)

    def execute(self, body, selected_filter):
        self.script.write_text(body, encoding='utf-8')
        code = diagnostic.run_diagnostic([sys.executable, str(self.script)], selected_filter, self.root)
        receipt = next((self.root / '.build/native-core-diagnostics').glob('*.json'))
        return code, json.loads(receipt.read_text())

    def test_completion_evidence_excludes_summaries_and_skips_on_both_frameworks(self):
        for line in ["Test Case 'Fixture.test' passed (0.001 seconds).", '√ Test "Fixture" passed after 0.001 seconds.',
                     '\x1b[32m✔ Test fixture() with 2 test cases passed after 1.2 seconds.\x1b[0m']:
            self.assertEqual(diagnostic.completion(line)['outcome'], 'passed')
        for line in ['✔ Test run with 0 tests passed after 0.001 seconds.', '↷ Test fixture() skipped.',
                     "Test Case 'Fixture.test' skipped (0.001 seconds).", '✔ Suite "Fixture" passed after 0.1 seconds.',
                     "  | print(\"Test Case 'Fixture.test' passed (0.001 seconds).\")"]:
            self.assertIsNone(diagnostic.completion(line))
        self.assertEqual(diagnostic.completion('× Test "Expected failed after restart" failed after 1.0 seconds with 1 issue.')['outcome'], 'failed')

    def test_quotes_and_shell_metacharacters_are_one_literal_argument(self):
        selected = 'Fixture["quoted"]; $(touch should-not-exist) | Other'
        code, proof = self.execute("import json, pathlib, sys\npathlib.Path('argv.json').write_text(json.dumps(sys.argv[1:]))\nprint(\"Test Case 'Fixture.test' passed (0.001 seconds).\")\n", selected)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads((self.root / 'argv.json').read_text()), ['--filter', selected])
        self.assertFalse((self.root / 'should-not-exist').exists())
        self.assertEqual(proof['actualCompletedTestRecords'], 1)
        self.assertEqual(proof['scope'], 'filtered-native-core')
        self.assertFalse(proof['fullProductQualification'])
        self.assertIn('only that observed subset', self.summary.read_text())

    def test_zero_match_is_not_a_green_filtered_diagnostic(self):
        code, proof = self.execute("print('Test run with 0 tests passed after 0.001 seconds.')\n", 'NoSuchSuite')
        self.assertEqual(code, 1)
        self.assertEqual(proof['childExitCode'], 0)
        self.assertEqual(proof['actualCompletedTestRecords'], 0)
        self.assertIn('does not qualify', proof['error'])

    def test_failed_command_status_is_preserved(self):
        code, proof = self.execute("import sys\nprint(\"Test Case 'Fixture.test' failed (0.001 seconds).\")\nsys.exit(7)\n", 'Fixture')
        self.assertEqual(code, 7)
        self.assertEqual(proof['childExitCode'], 7)
        self.assertEqual(proof['state'], 'failed')

    def test_unfiltered_run_keeps_the_original_arguments(self):
        code, proof = self.execute("import json, pathlib, sys\npathlib.Path('argv.json').write_text(json.dumps(sys.argv[1:]))\nprint(\"Test Case 'Fixture.test' passed (0.001 seconds).\")\n", '')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads((self.root / 'argv.json').read_text()), [])
        self.assertEqual(proof['scope'], 'unfiltered-native-core')


if __name__ == '__main__':
    unittest.main()
