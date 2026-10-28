"""Host-only synthetic WAE numerical-call-area scoring reproduction."""
import hashlib
import json
import sys
from pathlib import Path

repo = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
sys.path[:0] = [str(repo / 'python'), str(repo / 'python/tests')]
import test_wave5_qtc_host as fixture
from contest_host.wae import multiplier

case = fixture.QTCTests()
case.setUp()
try:
    case.create_wae()
    japan = {'entity':'Japan','continent':'AS','cq':25,'itu':45,'primary_pfx':'JA'}
    countries = {call: japan for call in ['JR4AAA','7K4ABC','7M4XYZ']}
    case.mutate('draft_apply', referenceID='test-cty-v1', countries=countries)
    for i, call in enumerate(countries):
        case.log(call, str(i+1), i)
    rows = case.read('log')['rows']
    state = case.host.database(case.session).state(case.session)
    view = case.view()
    result = {'actual_score':view['score'],
              'actual_keys': {row['Call']:multiplier(state,row) for row in rows},
              'expected_keys': {call:'JA4' for call in countries},
              'expected_score': {'points':3,'multipliers':2,'total':6},
              'rule_evidence_sha256':hashlib.sha256((repo/'.build/wave5/rules/darc-wae-rules.html').read_bytes()).hexdigest()}
    assert result['actual_keys'] == {'JR4AAA':'JA4','7K4ABC':'JA7','7M4XYZ':'JA7'}
    assert result['actual_score']['total'] == 12
    print(json.dumps(result,indent=2))
finally:
    case.tearDown()
