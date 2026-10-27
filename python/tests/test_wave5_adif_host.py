from copy import deepcopy
import base64, json, unittest
from pathlib import Path
from contest_host.host import Host,HostError
from contest_host.upstream import load_plugin
import test_host as fixtures


class HistoricalImportTests(unittest.TestCase):
    setUp=fixtures.HostTests.setUp
    tearDown=fixtures.HostTests.tearDown
    call=fixtures.HostTests.call
    mutate=fixtures.HostTests.mutate
    read=fixtures.HostTests.read

    def create_plugin(self,plugin):
        config=json.loads((Path(__file__).parent/'fixtures/all_contests_lifecycle.json').read_text())[plugin]['state']
        self.session,self.workspace,self.revision=fixtures.uid(),fixtures.uid(),0
        self.call('session_create',dict(sessionID=self.session,workspaceGeneration=self.workspace,operationID=fixtures.uid(),expectedRevision=0,
            pluginID=plugin,station=config['station'],settings=config['settings'],reference=config['reference'],frequencyHz=144050000 if 'vhf' in plugin else 14025000))
        return config

    def source(self,plugin,station,**extra):
        return {'raw':{'CONTEST_ID':load_plugin(plugin).cabrillo_name,'STATION_CALLSIGN':station['Call'],'CALL':'K1ABC','QSO_DATE':'20261021','TIME_ON':'100000',
                       'FREQ':'144.05' if 'vhf' in plugin else '14.025','MODE':'CW','RST_SENT':'599','RST_RCVD':'579',
                       'STX':'0101','SRX':'0202','STX_STRING':'0101','X_VENDOR_FIELD':'opaque retained',**extra},'metadata':None,'sourceSHA256':'a'*64}

    def preview(self,source):return self.read('strategy',workspaceGeneration=self.workspace,expectedRevision=self.revision,section='adif_preview',record=source)
    def apply(self,source):return self.mutate('strategy_apply',workspaceGeneration=self.workspace,action='adif_import',record=source)

    def test_actual_serials_repeat_restart_and_occupied_draft_preserved_without_reservations(self):
        config=self.create_plugin('cq_wpx_cw')
        self.mutate('draft_apply',fields={'callsign':'DL1ABC','other_2':'314'})
        store=self.host.database(self.session);before=deepcopy(store.state(self.session)['draft'])
        reservations=store.exec_sql_mult('SELECT * FROM xlog_serial')
        source=self.source('cq_wpx_cw',config['station'],SUBMODE='',OPERATOR='HISTORIC',FREQ_RX='14.026')
        preview=self.preview(source);self.assertEqual(preview['status'],'ready');self.assertEqual(self.read('log')['total'],0)
        self.apply(source);self.assertEqual(store.state(self.session)['draft'],before)
        self.assertEqual(store.exec_sql_mult('SELECT * FROM xlog_serial'),reservations)
        row=self.read('log')['rows'][0];self.assertEqual(row['SentNr'],101);self.assertEqual(row['NR'],202)
        self.assertEqual(row['QSXFreq'],14026);self.assertEqual(row['Operator'],'HISTORIC')
        self.assertEqual(store.exec_sql('SELECT count(*) n FROM xlog_qso_lane')['n'],0)
        self.host.close();self.host=Host(self.root);self.assertEqual(self.preview(source)['status'],'already-imported')
        self.apply(source);self.assertEqual(self.read('log')['total'],1)
        self.assertEqual(self.host.database(self.session).exec_sql_mult('SELECT * FROM xlog_serial'),reservations)
        self.assertEqual(self.host.database(self.session).state(self.session)['draft'],before)
        prepared=self.read('export_prepare',format='adif');payload=self.read('export_read',workspaceGeneration=self.workspace,exportID=prepared['artifactID'],offset=0,length=prepared['byteLength'])
        exported=base64.b64decode(payload['dataBase64']).decode();self.assertIn('APP_XLOG_IMPORT_SOURCE',exported);self.assertIn('opaque retained',exported)
        self.assertIn('0101',exported)

    def test_identity_conflict_and_existing_serial_are_explicit_without_draft_renumbering(self):
        config=self.create_plugin('cq_wpx_cw');source=self.source('cq_wpx_cw',config['station'],APP_N1MM_ID=fixtures.uid(),STX='1')
        self.apply(source);before=deepcopy(self.host.database(self.session).state(self.session)['draft'])
        changed=deepcopy(source);changed['raw']['SRX']='999'
        with self.assertRaises(HostError) as error:self.preview(changed)
        self.assertEqual(error.exception.code,'source_conflict')
        with self.assertRaises(HostError) as error:self.mutate('qso_commit',qsoID=fixtures.uid(),timestamp='2026-10-21 10:05:00',fields={'callsign':'DL1ABC','other_2':'42'})
        self.assertEqual(error.exception.code,'historical_serial_conflict')
        self.assertEqual(self.host.database(self.session).state(self.session)['draft'],before)
        self.assertEqual(self.read('log')['total'],1)

    def test_name_location_and_grid_families_keep_original_station_and_site(self):
        for plugin,extra in [('naqp_cw',{'NAME':'ALICE','STATE':'MA','STX_STRING':'BOB SK'}),
                             ('darc_vhf',{'MY_GRIDSQUARE':'JN88XX','GRIDSQUARE':'JO60AA','APP_XLOG_SITE':json.dumps({'id':'historic-site','locator':'JN88XX'})}),
                             ('arrl_vhf_jun',{'MY_GRIDSQUARE':'JN88','GRIDSQUARE':'JO60'})]:
            with self.subTest(plugin=plugin):
                config=self.create_plugin(plugin);source=self.source(plugin,config['station'],**extra)
                before=deepcopy(self.host.database(self.session).state(self.session))
                self.preview(source);self.apply(source);row=self.read('log')['rows'][0]
                self.assertEqual(self.host.database(self.session).state(self.session)['draft'],before['draft'])
                if plugin=='naqp_cw':self.assertEqual((row['Name'],row['Sect']),('ALICE','MA'))
                if plugin=='darc_vhf':self.assertEqual(row['MiscText'],'JN88XX');self.assertEqual(row['Points'],443)
                if plugin=='arrl_vhf_jun':self.assertEqual(row['NR'],'JO60')

    def test_mismatch_unknown_mapping_and_invalid_rx_reject_before_apply(self):
        config=self.create_plugin('cq_wpx_cw');source=self.source('cq_wpx_cw',config['station'])
        for extra in [{'STATION_CALLSIGN':'OTHER'},{'STX':''},{'MODE':'SSB'},{'CONTEST_ID':'UNRELATED'},{'FREQ_RX':'nan'}]:
            changed=deepcopy(source);changed['raw'].update(extra)
            with self.assertRaises(HostError):self.preview(changed)
        self.assertEqual(self.read('log')['total'],0)

if __name__=='__main__':unittest.main()
