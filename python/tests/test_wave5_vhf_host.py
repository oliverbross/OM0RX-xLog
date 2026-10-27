from copy import deepcopy
import json, base64
from pathlib import Path
import unittest
from contest_host.host import Host, HostError
import test_host as fixtures


class SiteTests(unittest.TestCase):
    setUp=fixtures.HostTests.setUp
    tearDown=fixtures.HostTests.tearDown
    call=fixtures.HostTests.call
    mutate=fixtures.HostTests.mutate
    read=fixtures.HostTests.read

    def create_vhf(self):
        value=json.loads((Path(__file__).parent/'fixtures/all_contests_lifecycle.json').read_text())['darc_vhf']
        self.session,self.workspace,self.revision=fixtures.uid(),fixtures.uid(),0
        self.call('session_create',dict(sessionID=self.session,workspaceGeneration=self.workspace,expectedRevision=0,operationID=fixtures.uid(),pluginID='darc_vhf',
                  station=value['state']['station'],settings=value['state']['settings'],reference=value['state']['reference'],frequencyHz=144050000,mode='CW'))

    def site(self,site_id,grid):
        return self.mutate('strategy_apply',workspaceGeneration=self.workspace,action='site_activate',siteID=site_id,locator=grid,name=site_id,note='Operator supplied site',atUTC='2026-10-27T10:00:00Z')

    def vhf(self):
        return self.read('strategy',workspaceGeneration=self.workspace,expectedRevision=self.revision,section='vhf')

    def log(self,call,minute):
        identity=fixtures.uid()
        self.mutate('qso_commit',qsoID=identity,timestamp=f'2026-10-21 10:{minute:02}:00',fields={'callsign':call,'other_2':'101 JO60AA'})
        return identity

    def edi(self,site_id):
        prepared=self.read('export_prepare',format='edi',siteID=site_id)
        payload=self.read('export_read',workspaceGeneration=self.workspace,exportID=prepared['artifactID'],offset=0,length=prepared['byteLength'])
        self.read('export_release',workspaceGeneration=self.workspace,exportID=prepared['artifactID'])
        return base64.b64decode(payload['dataBase64']).decode()

    def test_sites_keep_original_distances_and_edi_subsets_through_restart_and_rebuild(self):
        self.create_vhf(); self.site('site-one','JN88XX'); first=self.log('K1ABC',0)
        old=next(row for row in self.read('log')['rows'] if row['ID']==first)
        self.assertEqual(old['Points'],443)
        self.site('site-two','JO60AA'); second=self.log('DL1ABC',1)
        self.assertEqual(next(row for row in self.read('log')['rows'] if row['ID']==second)['Points'],1)
        self.mutate('recalculate')
        self.host.close();self.host=Host(self.root)
        after=next(row for row in self.read('log')['rows'] if row['ID']==first)
        for key in ('SentNr','NR','Exchange1','MiscText','Points','RoverLocation'):self.assertEqual(after[key],old[key])
        self.assertEqual([row['contacts'] for row in self.vhf()['sites']],[1,1])
        with self.assertRaises(HostError) as error:self.read('export_prepare',format='edi')
        self.assertEqual(error.exception.code,'edi_mixed_sites')
        one,two=self.edi('site-one'),self.edi('site-two')
        self.assertIn('PWWLo=JN88XX',one);self.assertIn('CToSc=443',one);self.assertIn('CQSOs=1;1',one)
        self.assertIn('K1ABC',one);self.assertNotIn('DL1ABC',one)
        self.assertIn('PWWLo=JO60AA',two);self.assertIn('CToSc=1',two)
        review=self.read('submission_preflight',workspaceGeneration=self.workspace,expectedRevision=self.revision,format='edi',siteID='site-one')
        self.assertEqual(review['manifest']['contacts']['count'],1)
        self.assertEqual(review['manifest']['selectedQSOIDs'],[first])
        self.assertEqual(self.read('log')['total'],2)
        prepared=self.read('export_prepare',format='adif')
        payload=self.read('export_read',workspaceGeneration=self.workspace,exportID=prepared['artifactID'],offset=0,length=prepared['byteLength'])
        self.assertIn('APP_XLOG_SITE',base64.b64decode(payload['dataBase64']).decode())

    def test_occupied_draft_blocks_site_change_and_beacons_never_create_worked_evidence(self):
        self.create_vhf();self.site('first','JN88XX')
        self.mutate('draft_apply',fields={'callsign':'K1ABC','other_2':'100 JO60AA'})
        before=deepcopy(self.host.database(self.session).state(self.session))
        with self.assertRaises(HostError) as error:self.site('second','JO60AA')
        self.assertEqual(error.exception.code,'occupied_draft')
        self.assertEqual(self.host.database(self.session).state(self.session),before)
        self.mutate('strategy_apply',workspaceGeneration=self.workspace,action='beacon_add',beacon={'id':'old','callsign':'DB0ABC','locator':'JO60AA',
                    'frequencyHz':144450000,'source':'operator fixture dated bulletin','observedUTC':'2020-01-01T00:00:00Z'})
        self.mutate('strategy_apply',workspaceGeneration=self.workspace,action='beacon_add',beacon={'id':'unknown','callsign':'DB0XYZ','locator':'',
                    'frequencyHz':144450000,'source':'unverified operator note','observedUTC':'2020-01-01T00:00:00Z'})
        beacons=self.vhf()['beacons'];self.assertEqual(beacons[0]['status'],'stale');self.assertFalse(beacons[0]['worked'])
        self.assertIsNone(beacons[1]['coordinate']);self.assertIsNone(beacons[1]['distanceKm'])
        self.assertEqual(self.read('log')['total'],0)

    def test_lane_bound_mapping_restarts_without_output_and_rejects_stale_binding(self):
        self.create_vhf()
        self.mutate('draft_apply',frequencyHz=10368000000)
        bindings={'laneA':{'radioID':'radio1','receiverID':'receiver1','vfo':'A','sliceID':None,'generation':1},
                  'laneB':{'radioID':'radio2','receiverID':'receiver2','vfo':'B','sliceID':None,'generation':1}}
        configured=self.mutate('lanes_configure',workspaceGeneration=self.workspace,mode='SO2R',bindings=bindings)['projection']
        lane=next(row for row in configured['operatingLanes']['lanes'] if row['laneID']=='laneA')
        values=dict(workspaceGeneration=self.workspace,laneID='laneA',bindingVersion=lane['bindingVersion'],draftID=lane['draftID'],action='transverter_save',
                    mapping={'band':'10000','loHz':10224000000,'inverted':False,'ifLowHz':140000000,'ifHighHz':148000000})
        saved=self.mutate('strategy_apply',**values)
        self.assertEqual(saved['actions'],[])
        self.host.close();self.host=Host(self.root)
        mapping=self.vhf()['mappings']['laneA']
        self.assertEqual(mapping['binding'],bindings['laneA']);self.assertEqual(mapping['mapping'],values['mapping'])
        with self.assertRaises(HostError):self.mutate('strategy_apply',**{**values,'bindingVersion':999})
        self.assertEqual(self.vhf()['mappings']['laneA'],mapping)


if __name__=='__main__':unittest.main()
