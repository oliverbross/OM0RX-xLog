import gzip
import importlib.util
import io
import json
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
        with sqlite3.connect(database) as connection:
            connection.execute('CREATE TABLE qsos(call TEXT)')
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


if __name__ == '__main__':
    unittest.main()
