"""Isolated host-only reproduction; creates disposable synthetic sessions."""
import json
import sys
from pathlib import Path

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
sys.path[:0] = [str(repo / 'python'), str(repo / 'python/tests')]
import test_cq_ww_ssb_host as fixture

case = fixture.CQWWSSBHostTests()
case.setUp()
try:
    case.mutate('esm', field='callsign', fields={'callsign':'K1ABC'})
    entered = case.mutate('esm', field='other_2', fields={'other_2':'5'})
    assert case.read('log')['total'] == 1
    direct_qso = case.log(call='DL1ABC', zone='14', minute=1)
    page = case.read('recorder_changes', afterSequence=0, limit=200)
    result = {'events': page['events'], 'direct_qso': direct_qso,
              'esm_operation_id': entered['operationID'],
              'payload_methods': [json.loads(row['payload'])['method'] for row in
                case.host.database(case.session).exec_sql_mult(
                    'SELECT o.payload FROM xlog_qso_audit a JOIN xlog_operation o ON o.operation_id=a.operation_id ORDER BY a.sequence')]}
    assert result['payload_methods'] == ['esm', 'qso_commit']
    assert [event['local'] for event in page['events']] == [False, True]
    print(json.dumps(result, indent=2))
finally:
    case.tearDown()
