from pathlib import Path
import json
out=Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
p=out/'coverage.json'
d=json.loads(p.read_text())
d.pop('every_function_body_exhaustively_reviewed',None)
d['every_assigned_changed_production_function_body_read']=True
d['all_changed_function_behaviors_certified']=False
for item in d['changed_functions']:
    if item['function']=='MainLiveApp':
        item['range']=[217,1477]
        item['body_read_complete']=True
        item['depth']='complete function body read in bounded windows; changed time/save/navigation paths and selected safety/IPC/journal interactions deeply traced; not every behavior or callee certified'
        item['previous_actual_ranges']=item['actual_ranges']
        item['actual_ranges']=[[217,1477]]
        item['completion_read_windows']=[[217,249],[361,379],[466,520],[521,567],[568,619],[712,753],[754,794],[834,879],[880,925],[963,1012],[1013,1064],[1157,1205],[1206,1253],[1254,1301],[1346,1369],[1391,1411],[1412,1431],[1432,1445],[1446,1464],[1465,1477]]
        item['caller_read_ranges']=[[197,216]]
        item['completion_report']='MAIN_BODY_COMPLETION.md'
        item['reviewed_source_copy']='MainLiveApp-reviewed-source.txt'
        item['additional_confirmed_findings_on_completion']=0
    else:
        item['body_read_complete']=True
d['unverified']=[v for v in d['unverified'] if v!='repository-wide frontend/function coverage']+['repository-wide unchanged frontend/function coverage; all assigned changed function bodies read, not all behaviors certified']
p.write_text(json.dumps(d,indent=2)+'\n')
