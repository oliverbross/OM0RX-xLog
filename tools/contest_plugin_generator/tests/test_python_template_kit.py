import importlib.util
import hashlib,json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

SPEC=importlib.util.spec_from_file_location('python_template_kit',Path(__file__).parents[1]/'python_template_kit.py')
kit=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(kit)
from contest_host.developer import TEMPLATES, describe


class PythonKitTests(unittest.TestCase):
    def test_four_bundled_examples_match_existing_lifecycle_and_export_oracles(self):
        fixtures=json.loads((kit.ROOT/'python/tests/fixtures/all_contests_lifecycle.json').read_text())
        exports=json.loads((kit.ROOT/'python/tests/fixtures/all_contests_exports.json').read_text())
        for plugin in TEMPLATES:
            with self.subTest(plugin=plugin):
                value=describe(plugin)
                self.assertEqual(value['example']['fixture'],fixtures[plugin])
                self.assertEqual(value['example']['expectedExportRecords'],exports[plugin])
                self.assertEqual(value['readiness']['newDefinition'],'UNVERIFIED')
                self.assertEqual(set(value['fieldRoles']),{'callsign','sent','receive','other_1','other_2'})

    def test_deterministic_scaffold_manifest_exact_hashes_and_no_overwrite(self):
        with TemporaryDirectory() as folder:
            a,b=Path(folder)/'one',Path(folder)/'two'
            self.assertEqual(kit.build(a,'cq_wpx_cw')[0],0);self.assertEqual(kit.build(b,'cq_wpx_cw')[0],0)
            self.assertEqual((a/'manifest.json').read_bytes(),(b/'manifest.json').read_bytes())
            manifest=json.loads((a/'manifest.json').read_text())
            self.assertFalse(manifest['installed'])
            for name,value in manifest['files'].items():
                self.assertEqual(hashlib.sha256((a/name).read_bytes()).hexdigest(),value['sha256'])
                self.assertEqual((a/name).read_bytes(),(b/name).read_bytes())
            with self.assertRaises(ValueError):kit.build(a,'cq_wpx_cw')
            with self.assertRaises(ValueError):describe('../untrusted.py')

    def test_unsupported_udc_keeps_exact_original_bytes_and_never_claims_translation(self):
        with TemporaryDirectory() as folder:
            raw=b'[Contest]\r\nName=Example\r\nBonusPoints=999\r\nQTC=execute()\r\nDynamicExchange=__import__("os")\r\n'
            path=Path(folder)/'input.udc';path.write_bytes(raw)
            out=Path(folder)/'diagnostic';code,_=kit.build(out,udc=path)
            self.assertEqual(code,2);self.assertEqual((out/'original.udc').read_bytes(),raw)
            value=json.loads((out/'diagnostics.json').read_text())
            self.assertFalse(value['converted']);self.assertFalse(value['executed']);self.assertFalse(value['installed'])
            self.assertIn('QTC',{row['key'] for row in value['diagnostics']})
            self.assertEqual(value['original']['content'].encode(),raw)


if __name__=='__main__':unittest.main()
