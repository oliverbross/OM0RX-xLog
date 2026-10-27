import base64, hashlib, json, unittest, zipfile
from io import BytesIO
from copy import deepcopy
from contest_host.host import Host, HostError
import test_host as fixtures


class ArchiveTests(unittest.TestCase):
    setUp=fixtures.HostTests.setUp
    tearDown=fixtures.HostTests.tearDown
    call=fixtures.HostTests.call
    mutate=fixtures.HostTests.mutate
    read=fixtures.HostTests.read
    log=fixtures.HostTests.log
    def test_archive_freezes_reviewed_bytes_notes_and_identity_without_mutation(self):
        qso=self.log()
        self.mutate('note_save',workspaceGeneration=self.workspace,noteID=fixtures.uid(),target={'qsoID':qso},text='Reviewed paper log')
        before=deepcopy(self.host.database(self.session).state(self.session))
        review=self.read('submission_preflight',workspaceGeneration=self.workspace,expectedRevision=self.revision,format='adif',archive=True,
                         recordingIndex={'status':'unavailable','audioIncluded':False,'reason':'No fixture media'})
        prepared=review['prepared']
        self.assertEqual(self.host.database(self.session).state(self.session),before)
        def download():
            return base64.b64decode(self.read('export_read',workspaceGeneration=self.workspace,exportID=prepared['artifactID'],offset=0,length=prepared['byteLength'])['dataBase64'])
        raw=download();self.assertEqual(hashlib.sha256(raw).hexdigest(),prepared['sha256'])
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            exported=archive.read('export.adi')
            self.assertEqual(hashlib.sha256(exported).hexdigest(),review['manifest']['sha256'])
            self.assertEqual(json.loads(archive.read('notes.json'))[0]['body'],'Reviewed paper log')
            self.assertEqual(json.loads(archive.read('manifest.json'))['submissionStatus'],'not-submitted')
        self.mutate('qso_correct',qsoID=qso,fields={'callsign':'DL1ABC','other_2':'14'})
        self.assertEqual(download(),raw)
        path=self.root/'reviewed.zip';path.write_bytes(raw)
        self.host.close();self.host=Host(self.root)
        reopened=self.read('strategy',workspaceGeneration=self.workspace,expectedRevision=self.revision,section='archive_inspect',sourcePath=str(path))
        self.assertTrue(reopened['verified']);self.assertFalse(reopened['restored']);self.assertFalse(reopened['submitted'])
        self.assertEqual(reopened['sha256'],prepared['sha256']);self.assertEqual(path.read_bytes(),raw)
        self.assertEqual(self.read('log')['rows'][0]['Call'],'DL1ABC')

    def test_untrusted_archive_rejects_malformed_manifest_tampering_and_paths(self):
        for manifest,extra in [([],{}),({'schemaVersion':1,'kind':'xlog-submission-archive','submissionStatus':'not-submitted','files':{'notes.json':{'byteLength':2,'sha256':'bad'}}},{'notes.json':b'[]'}),({}, {'../escape':b'x'})]:
            stream=BytesIO()
            with zipfile.ZipFile(stream,'w') as archive:
                archive.writestr('manifest.json',json.dumps(manifest))
                for name,raw in extra.items():archive.writestr(name,raw)
            path=self.root/'invalid.zip';path.write_bytes(stream.getvalue())
            with self.assertRaises(HostError):self.read('strategy',workspaceGeneration=self.workspace,expectedRevision=self.revision,section='archive_inspect',sourcePath=str(path))
            self.assertEqual(path.read_bytes(),stream.getvalue());self.assertFalse((self.root/'escape').exists())


if __name__=='__main__':unittest.main()
