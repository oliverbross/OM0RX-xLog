"""Historical ADIF import audited through actual group change/replica APIs."""
from copy import deepcopy
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
    case.apply(case.source('cq_wpx_cw',config['station']))
    changes=case.read('multi_changes',workspaceGeneration=case.workspace,
                      requestID=fixture.fixtures.uid(),afterRevision=0,afterSequence=0,limit=100)
    uid=fixture.fixtures.uid
    replica,workspace=uid(),uid()
    created=case.host.dispatch({'id':uid(),'method':'session_create','params':dict(
        sessionID=replica,workspaceGeneration=workspace,operationID=uid(),expectedRevision=0,
        pluginID='cq_wpx_cw',station=deepcopy(config['station']),settings=deepcopy(config['settings']),
        reference=deepcopy(config['reference']),frequencyHz=14025000)})
    try:
        case.host.dispatch({'id':uid(),'method':'multi_replica_apply','params':dict(
            sessionID=replica,workspaceGeneration=workspace,operationID=uid(),expectedRevision=created['revision'],
            authority=changes['authority'],fromCursor={'revision':0,'sequence':0},
            toCursor={'revision':changes['nextRevision'],'sequence':changes['nextSequence']},
            historyComplete=True,changes=changes['changes'])})
    except HostError as error:
        rejected={'code':error.code,'message':str(error)}
    else:
        raise AssertionError('Expected actual host history contract mismatch')
    assert rejected['message']=='Replica change kind is invalid',rejected
    print(json.dumps({'masterAuditKinds':[row['kind'] for row in changes['changes']],
                      'masterAfterIdentity':[row['afterIdentity'] for row in changes['changes']],
                      'replicaRejection':rejected,
                      'masterContacts':case.read('log')['total'],
                      'replicaContacts':case.host.database(replica).exec_sql('SELECT count(*) n FROM DXLOG')['n']},indent=2))
finally:
    case.tearDown()
