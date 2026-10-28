"""Direct tests of the production archive writer and reader, no host substitute."""
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import os
import tempfile
import unittest
from unittest.mock import patch
from io import BytesIO
import zipfile

from contest_host import submission_archive as archive

class Queries:
    current_contest=1
    def exec_sql_mult(self,*args):return []
    def exec_sql(self,*args):return None
class ArchiveBoundTests(unittest.TestCase):
    def setUp(self):
        self.desk=SimpleNamespace(database=Queries(),state={'sessionID':'review-fixture','workspaceGeneration':'private',
          'revision':1,'pluginID':'cq_wpx_cw','sourceRevision':'pinned','reference':{'id':'fixture'}})
        self.review={'manifest':{'format':'adif'}}
    @staticmethod
    def require(condition,message,*args):
        if not condition:raise ValueError(message)
    def build(self,payload):return archive.build(self.desk,self.review,payload,None,self.require)
    def inspect(self,payload):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'review.zip';path.write_bytes(payload)
            return archive.inspect(path,self.require)
    def test_manifest_is_included_in_writer_size_limit(self):
        _,manifest=self.build(b'')
        overhead=sum(row['byteLength'] for row in manifest['files'].values())
        with patch.object(archive,'LIMIT',8192):
            with self.assertRaisesRegex(ValueError,'including its manifest'):
                self.build(b'X'*(8192-overhead))
    def test_normal_bounded_archive_round_trips(self):
        payload,manifest=self.build(b'<CALL:5>K1ABC<EOR>')
        result=self.inspect(payload)
        self.assertTrue(result['verified']);self.assertFalse(result['restored'])
        self.assertFalse(result['submitted']);self.assertEqual(result['manifest'],manifest)
    def test_manifest_overflow_at_the_actual_32_mib_limit(self):
        _,manifest=self.build(b'')
        overhead=sum(row['byteLength'] for row in manifest['files'].values())
        with self.assertRaisesRegex(ValueError,'including its manifest'):
            self.build(b'X'*(32*1024*1024-overhead))
    def test_expanded_size_exactly_at_limit_is_accepted(self):
        payload,_=self.build(b'X'*4096)
        with zipfile.ZipFile(BytesIO(payload)) as z:expanded=sum(row.file_size for row in z.infolist())
        with patch.object(archive,'LIMIT',expanded):
            at_limit,_=self.build(b'X'*4096)
            self.assertTrue(self.inspect(at_limit)['verified'])

if __name__=='__main__':unittest.main(verbosity=2)
