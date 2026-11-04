import gzip
import importlib.util
import io
import json
import copy
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('payload', Path(__file__).with_name('verify-release-payload.py'))
payload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(payload)


class ReleasePayloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_public_resources_and_author_credit_are_allowed(self):
        (self.root / 'country.json').write_text(json.dumps({'name': 'Scotland', 'adif': 279}))
        (self.root / 'author.json').write_text(json.dumps({'name': 'Oliver Bross', 'email': 'oliver@bross.eu'}))
        (self.root / 'program').write_bytes(b'Executable fixture, not a user database')
        self.assertTrue(payload.scan(self.root)['passed'])

    def test_saved_operator_state_is_rejected_even_under_an_unexpected_name(self):
        (self.root / 'innocent.json').write_text(json.dumps({'account': {'operatorCall': 'TEST1'}}))
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_canonical_qso_and_adif_json_shapes_are_rejected(self):
        for record in [{'call': 'TEST1', 'start': 815123456.125},
                       {'CALL': 'TEST1', 'QSO_DATE': '20260101'}]:
            (self.root / 'innocent.json').write_text(json.dumps({'records': [record]}))
            self.assertFalse(payload.scan(self.root)['passed'])

    def test_renamed_json_and_generic_account_tokens_are_rejected(self):
        (self.root / 'innocent.cache').write_text(json.dumps({'call': 'TEST1', 'start': 1}))
        self.assertFalse(payload.scan(self.root)['passed'])
        (self.root / 'innocent.cache').write_text(json.dumps({'refresh_token': 'private-fixture'}))
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_oversized_or_invalid_json_fails_closed(self):
        (self.root / 'innocent.json').write_text(json.dumps({'data': 'x' * payload.MAX_JSON}))
        self.assertFalse(payload.scan(self.root)['passed'])
        (self.root / 'innocent.json').write_text('{"operatorCall":')
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_renamed_database_magic_is_rejected(self):
        database = self.root / 'innocent.cache'
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('CREATE TABLE qsos(call TEXT)')
            connection.commit()
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_compressed_database_is_rejected(self):
        with gzip.open(self.root / 'innocent.cache.gz', 'wb') as stream:
            stream.write(b'SQLite format 3\x00' + b'\x00' * 64)
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_archive_cannot_hide_a_logbook_or_escape(self):
        with zipfile.ZipFile(self.root / 'resources.zip', 'w') as archive:
            archive.writestr('../elsewhere.txt', b'fixture')
            archive.writestr('contacts.adi', '<CALL:5>TEST1<EOR>')
        report = payload.scan(self.root)
        self.assertFalse(report['passed'])
        self.assertEqual(len(report['findings']), 2)

    def test_windows_absolute_archive_paths_are_rejected_on_every_host(self):
        with zipfile.ZipFile(self.root / 'resources.zip', 'w') as archive:
            archive.writestr('C:/Users/operator/innocent.txt', b'fixture')
        self.assertFalse(payload.scan(self.root)['passed'])

    def test_archives_cannot_hide_compressed_or_nested_operator_state(self):
        private = json.dumps({'call': 'TEST1', 'start': 1}).encode()
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as archive:
            archive.writestr('innocent.json', private)
        with zipfile.ZipFile(self.root / 'resources.zip', 'w') as archive:
            archive.writestr('innocent.json.gz', gzip.compress(private))
            archive.writestr('nested.zip', nested.getvalue())
        report = payload.scan(self.root)
        self.assertFalse(report['passed'])
        self.assertEqual(len(report['findings']), 2)

    def test_private_state_filename_is_rejected_without_parsing(self):
        (self.root / 'workspace.json').write_bytes(b'not valid JSON')
        self.assertFalse(payload.scan(self.root)['passed'])

    @unittest.skipIf(__import__('os').name == 'nt', 'Windows CI symlink privilege is not assumed')
    def test_internal_framework_link_allowed_external_link_rejected(self):
        (self.root / 'actual').write_text('fixture')
        (self.root / 'current').symlink_to('actual')
        self.assertTrue(payload.scan(self.root)['passed'])
        (self.root / 'outside').symlink_to(self.root.parent)
        self.assertFalse(payload.scan(self.root)['passed'])


class CountryPackPayloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resource = Path(__file__).resolve().parents[2] / 'Sources/XLogCore/Resources/country-reference-pack.json'
        cls.public_bytes = cls.resource.read_bytes()
        cls.public = json.loads(cls.public_bytes)
        assert payload.MAX_JSON < len(cls.public_bytes) < payload.MAX_COUNTRY_PACK_JSON

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write_transport(self, data, transport, name=payload.COUNTRY_PACK_NAME):
        for existing in self.root.iterdir():
            existing.unlink()
        if transport == 'file':
            (self.root / name).write_bytes(data)
        elif transport == 'gzip':
            (self.root / (name + '.gz')).write_bytes(gzip.compress(data))
        else:
            with zipfile.ZipFile(self.root / 'resources.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                if transport == 'zip':
                    archive.writestr('resources/' + name, data)
                else:
                    archive.writestr('resources/' + name + '.gz', gzip.compress(data))

    def test_actual_large_public_resource_passes_every_bounded_transport(self):
        for transport in ['file', 'gzip', 'zip', 'zip-gzip']:
            with self.subTest(transport=transport):
                self.write_transport(self.public_bytes, transport)
                report = payload.scan(self.root)
                self.assertTrue(report['passed'], report['findings'])

    def test_recursive_credentials_and_qso_after_four_mib_are_rejected_in_all_transports(self):
        for private, expected in [({'nested': [{'password': 'private-fixture'}]}, 'non-empty operator/account setting'),
                                  ({'nested': [{'CALL': 'TEST1', 'QSO_DATE': '20260101'}]}, 'saved QSO record')]:
            value = copy.deepcopy(self.public)
            value['records'][-1]['country']['injected'] = private
            data = json.dumps(value).encode()
            self.assertGreater(data.index(b'"injected"'), payload.MAX_JSON)
            for transport in ['file', 'gzip', 'zip', 'zip-gzip']:
                with self.subTest(private=expected, transport=transport):
                    self.write_transport(data, transport)
                    report = payload.scan(self.root)
                    self.assertFalse(report['passed'])
                    self.assertTrue(any(expected in item['reason'] for item in report['findings']), report['findings'])

    def test_country_pack_budget_requires_exact_filename_and_schema(self):
        for name in ['other.json', 'not-country-reference-pack.json', 'country-reference-pack.JSON']:
            for transport in ['file', 'gzip', 'zip', 'zip-gzip']:
                with self.subTest(name=name, transport=transport):
                    self.write_transport(self.public_bytes, transport, name)
                    self.assertFalse(payload.scan(self.root)['passed'])
        for mutation in [lambda v: v.update({'extra': 'not a public field'}),
                         lambda v: v['records'][-1]['country'].update({'extra': 'not a public field'}),
                         lambda v: v.update({'records': []}),
                         lambda v: v.update({'schemaVersion': True}),
                         lambda v: v['records'][-1].update({'start': '2026-02-30T00:00:00Z'}),
                         lambda v: v['records'][-1].update({'pattern': '[Z-A]'}),
                         lambda v: v['records'][-1]['country'].update({'latitude': float('nan')}),
                         lambda v: v.update({'sourceURL': 'https://user:secret@example.com/country.json'})]:
            value = copy.deepcopy(self.public)
            mutation(value)
            self.assertIsNotNone(payload.inspect_bytes(payload.COUNTRY_PACK_NAME, json.dumps(value).encode()))

    def test_malformed_duplicate_keys_and_oversized_country_packs_fail_closed(self):
        duplicate = self.public_bytes.rstrip()[:-1] + b',"provider":"duplicate"}'
        for data in [self.public_bytes.rstrip()[:-1], duplicate,
                     self.public_bytes + b' ' * (payload.MAX_COUNTRY_PACK_JSON + 1 - len(self.public_bytes))]:
            for transport in ['file', 'gzip', 'zip', 'zip-gzip']:
                with self.subTest(bytes=len(data), transport=transport):
                    self.write_transport(data, transport)
                    self.assertFalse(payload.scan(self.root)['passed'])


if __name__ == '__main__':
    unittest.main()
