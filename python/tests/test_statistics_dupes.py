"""Disposable-host duplicate statistics; reads never rewrite the completed log."""
from types import SimpleNamespace
from unittest import TestCase

from contest_host.statistics_dupes import duplicate_flags
from contest_host.host import Desk
from test_statistics import StatisticsHostTests
from test_trans_tasman_host import TransTasmanHostTests


class DuplicateFlagsTests(TestCase):
    def test_contest_band_mode_and_disabled_scopes(self):
        rows = [{"Call":"K1ABC","Band":band,"Mode":mode} for band, mode in
                [(7,"USB"),(7,"LSB"),(14,"USB"),(7,"CW"),(7,"CW-R")]]
        for dupe_type, expected in [(1,[False,True,True,True,True]),
                                    (2,[False,True,False,True,True]),
                                    (3,[False,True,False,False,True]),
                                    (4,[False]*5)]:
            desk=SimpleNamespace(contest=SimpleNamespace(dupe_type=dupe_type),state={"pluginID":"test"})
            self.assertEqual(list(duplicate_flags(desk,rows)),expected)


class DuplicateStatisticsHostTests(StatisticsHostTests):
    def test_dupes_are_historical_band_scoped_and_not_zero_point_contacts(self):
        store=self.host.database(self.session)
        base=store.get_empty().copy()
        for index,(call,band,stamp) in enumerate([
                ("K1ABC",7,"2026-10-24 00:00:00"),("K1ABC",7,"2026-10-24 00:00:01"),
                ("K1ABC",14,"2026-10-24 00:00:02"),("DL1ABC",7,"2026-10-24 00:00:03")]):
            store.log_contact({**base,"ID":str(index),"Call":call,"Band":band,"Mode":"CW","TS":stamp,
                               "ContestNR":store.current_contest,"Points":0})
        store.conn.commit()
        before=list(store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY rowid"))
        changes=store.conn.total_changes
        stats=self.call("score",{"sessionID":self.session})["statistics"]
        self.assertEqual([(r["band"],r["dupes"]) for r in stats["rows"]],[("14.0",0),("7.0",1)])
        self.assertEqual(stats["total"]["dupes"],1)
        self.assertEqual(list(store.exec_sql_mult("SELECT * FROM DXLOG ORDER BY rowid")),before)
        self.assertEqual(store.conn.total_changes,changes)
        # Deleting the original makes its former duplicate the first contact.
        store.conn.execute("DELETE FROM DXLOG WHERE ID='0'");store.conn.commit()
        self.assertEqual(self.call("score",{"sessionID":self.session})["statistics"]["total"]["dupes"],0)


class SpecialDuplicateStatisticsTests(TransTasmanHostTests):
    def test_read_uses_original_two_hour_blocks_and_does_not_mutate(self):
        self.log(stamp="2026-10-20 08:10:00")
        self.log(stamp="2026-10-20 09:59:59")
        self.log(stamp="2026-10-20 10:00:00")
        store=self.host.database(self.session)
        rows=store.exec_sql_mult("SELECT rowid AS source_order,* FROM DXLOG ORDER BY TS,rowid")
        desk=Desk(store,store.state(self.session),self.host.commit)
        changes=store.conn.total_changes
        self.assertEqual(list(duplicate_flags(desk,rows)),[False,True,False])
        self.assertIs(desk.database,store)
        self.assertEqual(store.conn.total_changes,changes)
        self.assertEqual(self.read("score")["statistics"]["total"]["dupes"],1)
