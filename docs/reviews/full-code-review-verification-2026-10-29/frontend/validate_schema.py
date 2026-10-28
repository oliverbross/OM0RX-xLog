from pathlib import Path
import subprocess,json
out=Path(__file__).parent
result=[]
for name in ['NAME','GUEST_OP','VE_PROV']:
    run=subprocess.run(['/usr/bin/xmllint','--noout','--schema',str(out/'adx317.xsd'),str(out/(name+'.adx'))],capture_output=True,text=True)
    row={'field':name,'exit':run.returncode,'stdout':run.stdout,'stderr':run.stderr};result.append(row);print(json.dumps(row))
(out/'schema-validation-results.json').write_text(json.dumps(result,indent=2)+'\n')
