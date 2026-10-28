"""Real-host, API-only import/shared-serial reproduction using disposable data."""
import json
import sys
from pathlib import Path

repo=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
sys.path[:0]=[str(repo/'python'),str(repo/'python/tests')]
import test_wave5_adif_host as fixture
from contest_host.host import HostError

case=fixture.HistoricalImportTests()
case.setUp()
try:
    config=case.create_plugin('cq_wpx_cw')
    source=case.source('cq_wpx_cw',config['station'],STX='2',STX_STRING='002')
    case.apply(source)
    before=case.host.database(case.session).state(case.session)
    request_id=fixture.fixtures.uid()
    reserve=case.read('multi_serial_reserve',workspaceGeneration=case.workspace,
                      requestID=request_id,frequencyHz=14025000)
    assert reserve['serial']==2
    try:
        case.read('multi_contact_apply',workspaceGeneration=case.workspace,
                  requestID=fixture.fixtures.uid(),action='commit',qsoID=fixture.fixtures.uid(),
                  timestamp='2026-10-21 10:01:00',frequencyHz=14025000,
                  serialRequestID=request_id,fields={'callsign':'DL1ABC','other_2':'314'})
    except HostError as error:
        rejected={'code':error.code,'message':str(error)}
    else:
        raise AssertionError('Expected the known serial conflict to reject at commit')
    assert rejected['code']=='historical_serial_conflict'
    result={'historicalSerialFloor':before['historicalSerialFloor'],
            'existingSentSerials':[row['SentNr'] for row in case.read('log')['rows']],
            'sharedReservation':reserve,'remoteCommitRejection':rejected}
    print(json.dumps(result,indent=2))
finally:
    case.tearDown()
