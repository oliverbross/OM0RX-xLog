from copy import deepcopy
import unittest
import test_analytics_catalogue as catalogue


class SelectedAnalyticsTests(unittest.TestCase):
    setUp=catalogue.AnalyticsCatalogueTests.setUp
    tearDown=catalogue.AnalyticsCatalogueTests.tearDown
    read=catalogue.AnalyticsCatalogueTests.read
    mutate=catalogue.AnalyticsCatalogueTests.mutate
    create=catalogue.AnalyticsCatalogueTests.create
    log=catalogue.AnalyticsCatalogueTests.log
    snapshot=catalogue.AnalyticsCatalogueTests.snapshot
    assert_prefix_equivalence=catalogue.AnalyticsCatalogueTests.assert_prefix_equivalence

    def test_aadx_both_modes_branches_duplicate_prefix_correction_deletion_match_full_authority(self):
        for plugin in ('aadx_cw','aadx_ssb'):
            for asian in (False,True):
                with self.subTest(plugin=plugin,asian=asian):
                    fixture=self.create(plugin,station_call='JA1ABC' if asian else None)
                    fields={**fixture['fields'],'callsign':'DL1ABC' if asian else 'JA1ABC'}
                    first=self.log(fields)
                    duplicate=self.log(fields,'2026-10-21 10:01:00')
                    if not asian:self.assertEqual(self.snapshot()[0]['scoreHistory']['status'],'UNVERIFIED')
                    self.mutate('recalculate')
                    meta,rows=self.snapshot();self.assertEqual(meta['scoreHistory']['status'],'PASS',meta['scoreHistory'])
                    self.assert_prefix_equivalence(meta,rows)
                    extra={'entity':'China','continent':'AS','cq':24,'itu':44,'primary_pfx':'BY'}
                    third=self.log({**fields,'callsign':'BY1ABC'},'2026-10-21 10:02:00',countries={'BY1ABC':extra},referenceID=fixture['state']['reference']['id'])
                    self.assert_prefix_equivalence(*self.snapshot())
                    self.mutate('qso_correct',qsoID=duplicate,fields={'callsign':'K1ABC','other_2':'42'})
                    meta,rows=self.snapshot();self.assertEqual(meta['scoreHistory']['status'],'PASS');self.assert_prefix_equivalence(meta,rows)
                    self.mutate('qso_delete',qsoID=third)
                    self.assert_prefix_equivalence(*self.snapshot())

    def test_sst_needed_is_only_reviewed_subdivision_scope_and_pwt_stays_unverified(self):
        fixture=self.create('k1usn_sst');self.log({**fixture['fields'],'callsign':'K1ABC','other_1':'ALICE','other_2':'MA'})
        meta,rows=self.snapshot();view=meta['neededViews'][0]
        self.assertEqual(view['status'],'PASS');self.assertEqual(view['universeSize'],63);self.assertFalse(view['universeComplete'])
        self.assertIn('DXCC',view['reason']);self.assertNotIn('AK',view['rows'][0]['needed']);self.assertNotIn('HI',view['rows'][0]['needed'])
        self.assertNotIn('NL',view['rows'][0]['needed'])
        fixture=self.create('phone_weekly_test');self.log(fixture['fields'])
        self.assertEqual(self.snapshot()[0]['analyticsCapabilities']['neededUniverse']['status'],'UNVERIFIED')

if __name__=='__main__':unittest.main()
