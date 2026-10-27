"""Immutable submission snapshots. ZIP contents are data, never restore actions."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import zipfile

LIMIT = 32 * 1024 * 1024


def encoded(value):
    return (json.dumps(value,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+'\n').encode()


def build(desk, review, export_bytes, recording_index, require):
    state, store=desk.state, desk.database
    rows=store.exec_sql_mult('SELECT d.*,i.raw_fields,i.country AS country_identity FROM DXLOG d LEFT JOIN xlog_qso_identity i ON i.id=d.ID WHERE d.ContestNR=? ORDER BY d.TS,d.rowid',(store.current_contest,))
    notes=store.exec_sql_mult('SELECT * FROM xlog_note ORDER BY created_utc,id')
    lanes=store.exec_sql_mult('SELECT * FROM xlog_qso_lane ORDER BY qso_id')
    sites=store.exec_sql_mult('SELECT * FROM xlog_qso_site ORDER BY qso_id')
    if recording_index is None:
        recording_index={'status':'not-supplied','reason':'No Recorder index was attached; absence is not proof that recordings do not exist','audioIncluded':False}
    require(isinstance(recording_index,dict) and len(encoded(recording_index))<=12000 and recording_index.get('audioIncluded') is False,
            'Use a bounded recording index with explicit no-audio status')
    extension={'cabrillo':'log','adif':'adi','edi':'edi'}[review['manifest']['format']]
    payloads={'export.'+extension:export_bytes,'review.json':encoded(review),'contacts.json':encoded(rows),
              'notes.json':encoded(notes),'recording-index.json':encoded(recording_index),
              'station-sites.json':encoded({'visits':state.get('vhfSites'),'contactSites':sites}),
              'contact-attribution.json':encoded(lanes),
              'summary.txt':('Local immutable submission archive. Organizer submission has not occurred.\n'
                  f'Session {state["sessionID"]}, revision {state["revision"]}, {len(rows)} authoritative contacts.\n'
                  'The reviewed export scope may be a site subset; review.json identifies its selected contacts.\n'
                  'No credentials, service configuration, recording media or executable commands are included.\n').encode()}
    if state.get('qtc') is not None:payloads['qtc-journal.json']=encoded(state['qtc'])
    if store.exec_sql("SELECT name FROM sqlite_master WHERE type='table' AND name='xlog_adif_import'"):
        payloads['import-provenance.json']=encoded(store.exec_sql_mult('SELECT * FROM xlog_adif_import ORDER BY qso_id'))
    require(sum(len(raw) for raw in payloads.values())<=LIMIT,'Submission snapshot exceeds the 32 MiB archive bound; nothing was truncated')
    manifest={'schemaVersion':1,'kind':'xlog-submission-archive','sessionID':state['sessionID'],'workspaceGeneration':state['workspaceGeneration'],
              'logRevision':state['revision'],'pluginID':state['pluginID'],'sourceRevision':state['sourceRevision'],
              'definitionVersion':state.get('definitionVersion') or state.get('scoringRevision'), 'referenceID':state['reference']['id'],
              'submissionStatus':'not-submitted','authorityContacts':len(rows),'exportManifest':review['manifest'],
              'files':{name:{'sha256':hashlib.sha256(raw).hexdigest(),'byteLength':len(raw)} for name,raw in sorted(payloads.items())}}
    payloads['manifest.json']=encoded(manifest)
    stream=BytesIO()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        for name,raw in sorted(payloads.items()):
            entry=zipfile.ZipInfo(name,date_time=(2000,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
            entry.external_attr=0o600<<16
            archive.writestr(entry,raw)
    result=stream.getvalue()
    require(len(result)<=LIMIT,'Submission archive exceeds the native save bound')
    return result,manifest


def inspect(path, require):
    path=Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size<=LIMIT,'Choose one regular submission ZIP of at most 32 MiB')
    raw=path.read_bytes();require(len(raw)<=LIMIT,'Submission ZIP grew beyond the inspection bound')
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            entries=archive.infolist();names=[entry.filename for entry in entries]
            require(1<=len(entries)<=16 and len(set(names))==len(names) and sum(entry.file_size for entry in entries)<=LIMIT,
                    'Archive entry count/size is invalid; nothing was extracted')
            require(all('/' not in name and '\\' not in name and name not in {'.','..'} and len(name)<=128 for name in names),'Unsafe archive member; nothing was extracted')
            require('manifest.json' in names,'Submission manifest is missing')
            manifest=json.loads(archive.read('manifest.json'))
            require(isinstance(manifest,dict) and manifest.get('schemaVersion')==1 and manifest.get('kind')=='xlog-submission-archive'
                    and manifest.get('submissionStatus')=='not-submitted' and isinstance(manifest.get('files'),dict),'Unsupported submission archive manifest')
            require(set(names)==set(manifest['files'])|{'manifest.json'},'Archive contains missing/unlisted members')
            for name,expected in manifest['files'].items():
                data=archive.read(name)
                require(isinstance(expected,dict) and expected.get('byteLength')==len(data) and expected.get('sha256')==hashlib.sha256(data).hexdigest(),
                        'Archive bytes differ from their internal manifest')
            notes=json.loads(archive.read('notes.json'));recordings=json.loads(archive.read('recording-index.json'))
            require(isinstance(notes,list) and isinstance(recordings,dict) and recordings.get('audioIncluded') is False,
                    'Unsupported archive notes or recording index')
            return {'verified':True,'verification':'Internal byte consistency; compare the outer digest with the trusted Save receipt',
                    'sha256':hashlib.sha256(raw).hexdigest(),'byteLength':len(raw),'manifest':manifest,
                    'notes':len(notes),'recordingIndex':recordings,
                    'restored':False,'submitted':False}
    except (zipfile.BadZipFile,KeyError,UnicodeError,json.JSONDecodeError,RuntimeError) as error:
        require(False,'Unreadable submission archive; original bytes were not changed')
