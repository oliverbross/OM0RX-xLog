import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import runtime_artifacts as runtime


class RuntimeArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, names, link=None):
        path = self.root / 'fixture.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            for name in names:
                info = tarfile.TarInfo(name)
                info.size = 7
                archive.addfile(info, io.BytesIO(b'fixture'))
            if link:
                info = tarfile.TarInfo('python/link')
                info.type = tarfile.SYMTYPE
                info.linkname = link
                archive.addfile(info)
        return path

    def test_regular_runtime_extracts_without_other_files(self):
        target = runtime.extract(self.archive(['python/python.exe', 'python/Lib/ssl.py']), self.root / 'stage', 'python')
        self.assertEqual((target / 'python.exe').read_bytes(), b'fixture')

    def test_archive_rejects_escape_absolute_windows_and_ads_paths(self):
        for index, name in enumerate(['../escape', '/escape', 'other/file', 'python/../escape', 'python/C:/escape', 'python/file:stream', 'python\\escape']):
            with self.subTest(name=name), self.assertRaises(ValueError):
                runtime.extract(self.archive([name]), self.root / f'stage{index}', 'python')

    def test_archive_rejects_link_escape_before_extraction(self):
        with self.assertRaises(ValueError):
            runtime.extract(self.archive(['python/ok'], '../outside'), self.root / 'stage', 'python')
        self.assertFalse((self.root / 'stage/python/ok').exists())

    def test_nonempty_destination_is_never_overwritten(self):
        stage = self.root / 'stage'
        stage.mkdir()
        (stage / 'keep').write_bytes(b'keep')
        with self.assertRaises(ValueError):
            runtime.extract(self.archive(['python/ok']), stage, 'python')
        self.assertEqual((stage / 'keep').read_bytes(), b'keep')

    def test_cached_archive_must_still_match_pinned_hash(self):
        entry = {'url': 'https://example.invalid/runtime.tar.gz', 'sha256': 'a' * 64}
        (self.root / ('a' * 64 + '.tar.gz')).write_bytes(b'corrupted')
        with patch.object(runtime, 'sources', return_value={'fixture': entry}), patch.object(runtime.urllib.request, 'urlopen') as network:
            with self.assertRaises(ValueError):
                runtime.download('fixture', self.root)
            network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
