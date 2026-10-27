from copy import deepcopy
import unittest
from contest_host.host import HostError
import test_host as fixtures


class DeveloperTests(unittest.TestCase):
    setUp=fixtures.HostTests.setUp
    tearDown=fixtures.HostTests.tearDown
    call=fixtures.HostTests.call
    read=fixtures.HostTests.read

    def test_bundled_template_and_unsupported_udc_reads_preserve_complete_session(self):
        store=self.host.database(self.session)
        before=deepcopy(store.state(self.session)),store.conn.total_changes
        params=dict(workspaceGeneration=self.workspace,expectedRevision=self.revision,section='developer')
        for template in ('cq_wpx_cw','naqp_cw','darc_vhf','wae_cw'):
            value=self.read('strategy',**params,templateID=template)
            self.assertEqual(value['templateID'],template);self.assertEqual(value['engine'],'not1mm-python')
        original='Name=Test\nQTC=execute\nDynamicExchange={TX}\n'
        diagnostic=self.read('strategy',**params,udcText=original)
        self.assertEqual(diagnostic['original']['content'],original);self.assertFalse(diagnostic['converted']);self.assertFalse(diagnostic['executed'])
        with self.assertRaises(HostError):self.read('strategy',**params,templateID='../evil.py')
        self.assertEqual((store.state(self.session),store.conn.total_changes),before)
        self.assertEqual(self.read('log')['total'],0)

    def test_definition_version_mismatch_does_not_upgrade_or_rescore_existing_session(self):
        from test_wave5_qtc_host import QTCTests
        qtc=QTCTests();qtc.setUp()
        try:
            qtc.create_wae();qtc.log('K1ABC','21')
            store=qtc.host.database(qtc.session);state=store.state(qtc.session)
            self.assertEqual(state['definitionVersion'],'1.0.0')
            state['definitionVersion']='unreviewed-local-definition';store.save_state(state);store.conn.commit()
            rows=store.exec_sql_mult('SELECT * FROM DXLOG');before=store.conn.total_changes
            with self.assertRaises(HostError):qtc.read('session_open')
            self.assertEqual(store.conn.total_changes,before);self.assertEqual(store.exec_sql_mult('SELECT * FROM DXLOG'),rows)
            self.assertEqual(store.state(qtc.session)['definitionVersion'],'unreviewed-local-definition')
        finally:qtc.tearDown()


if __name__=='__main__':unittest.main()
