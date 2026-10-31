#!/usr/bin/env python3
import copy
import importlib.util
import itertools
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('worker_acceptance', Path(__file__).with_name('linux-worker-acceptance.py'))
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class CorrelatedWorkerResponses(unittest.TestCase):
    def test_independent_requests_may_complete_in_any_order(self):
        responses = [{'id': 'one', 'ok': True, 'result': {}},
                     {'id': 'two', 'ok': True, 'result': {'record_count': 1}},
                     {'id': 'three', 'ok': True, 'result': {'network_contact': False}}]
        for ordered in itertools.permutations(responses):
            acceptance.validate_responses(ordered)
        for malformed in [responses[:2], responses + [responses[0]], [responses[0], responses[0], responses[2]]]:
            with self.assertRaises(AssertionError):
                acceptance.validate_responses(malformed)
        for index, key, value in [(1, 'record_count', 0), (2, 'network_contact', True)]:
            malformed = copy.deepcopy(responses)
            malformed[index]['result'][key] = value
            with self.assertRaises(AssertionError):
                acceptance.validate_responses(malformed)

    def test_errors_and_recovery_require_exact_coverage_without_order(self):
        responses = [{'id': '', 'ok': False, 'error': {'code': 'invalid_request'}},
                     {'id': '', 'ok': False, 'error': {'code': 'request_too_large'}},
                     {'id': 'recovered', 'ok': True}]
        for ordered in itertools.permutations(responses):
            acceptance.validate_responses(ordered, True)
        for malformed in [responses[:2], [responses[0], responses[0], responses[2]], [responses[2]] * 3]:
            with self.assertRaises(AssertionError):
                acceptance.validate_responses(malformed, True)


class PackagedContestRuntimeEvidence(unittest.TestCase):
    def test_shipping_host_and_private_persistence_proofs_are_all_required(self):
        proof = {'id': 'contest-runtime-self-test', 'ok': True, 'result': {
            'passed': True, 'engine': 'not1mm-python', 'synthetic_records': True,
            'catalogue': True, 'catalogue_count': 97, 'save_read': True, 'reopened': True, 'qso_count': 1,
            'station_io': False, 'network_contact': False, 'credentials_accessed': False,
            'shipping_shutdown': True, 'temporary_store_removed': True}}
        acceptance.validate_contest_runtime(proof)
        for field, original in proof['result'].items():
            malformed = copy.deepcopy(proof)
            malformed['result'][field] = not original if isinstance(original, bool) else None
            with self.subTest(field=field), self.assertRaises(AssertionError):
                acceptance.validate_contest_runtime(malformed)
            del malformed['result'][field]
            with self.subTest(missing=field), self.assertRaises(AssertionError):
                acceptance.validate_contest_runtime(malformed)
        for field in ['id', 'ok']:
            malformed = copy.deepcopy(proof)
            del malformed[field]
            with self.subTest(missing=field), self.assertRaises(AssertionError):
                acceptance.validate_contest_runtime(malformed)


if __name__ == '__main__':
    unittest.main()
