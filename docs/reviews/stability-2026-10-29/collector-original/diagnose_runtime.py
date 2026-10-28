from pathlib import Path
import json,subprocess
task=Path('/tmp/xlog-phase5-20261029-721e0705')
contents=task/'process-r2/bootstrap/OM0RX-xLog Contesting Worker Bootstrap.app/Contents'
python=contents/'Frameworks/Python.framework/Versions/3.12/bin/python3.12'
launcher=contents/'Resources/Not1MM/python/contest_host/launcher.py'
data=task/'runtime-probe-data'; data.mkdir()
env={'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1',
 'SSL_CERT_FILE':str(contents/'Frameworks/Python.framework/Versions/3.12/etc/openssl/cert.pem')}
request=json.dumps({'id':'private-runtime-probe','method':'contest_catalog','params':{}})+'\n'
rows=[]
for root in [data,data.resolve()]:
 r=subprocess.run([str(python),'-I','-B',str(launcher),'--data-root',str(root)],env=env,input=request,text=True,capture_output=True,timeout=30)
 rows.append({'dataRoot':str(root),'exit':r.returncode,'stdout':r.stdout[:1000],'stderr':r.stderr})
(task/'runtime-canonical-probe.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps(rows))
