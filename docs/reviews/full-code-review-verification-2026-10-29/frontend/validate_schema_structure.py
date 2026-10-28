from pathlib import Path
import xml.etree.ElementTree as ET,subprocess,json
out=Path(__file__).parent
root=ET.parse(out/'adx317.xsd');ns='{http://www.w3.org/2001/XMLSchema}'
record=next(e for e in root.iter(ns+'element') if e.attrib.get('name')=='RECORD')
allowed={e.attrib['name'] for e in record.iter(ns+'element') if 'name' in e.attrib}-{'RECORD'}
relaxed=[]
for parent in root.iter():
    for child in list(parent):
        if child.tag==ns+'pattern' and '(?=' in child.attrib.get('value',''):
            relaxed.append({'parent':parent.tag,'pattern':child.attrib['value']});parent.remove(child)
assert len(relaxed)==1,relaxed
derived=out/'adx317.unused-nz-facet-relaxed.xsd'
root.write(derived,encoding='utf-8',xml_declaration=True)
result=[]
for name in ['NAME','GUEST_OP','VE_PROV']:
    path=out/(name+'.adx')
    xml=ET.parse(path)
    fields=[field.tag for row in xml.findall('.//RECORD') for field in row]
    unknown=sorted(set(fields)-allowed)
    run=subprocess.run(['/usr/bin/xmllint','--noout','--schema',str(derived),str(path)],capture_output=True,text=True)
    result.append({'field':name,'unknownRecordElementNames':unknown,'derivedSchemaExit':run.returncode,'stderr':run.stderr})
report={'limitation':'Original official schema cannot compile in xmllint because one unrelated NZ subdivision regex uses unsupported lookahead. Derived schema removes exactly that unused pattern facet. No field-name rules changed. These test documents contain no NZ subdivision fields. This is bounded validation, not blanket exact-XSD validation.','relaxed':relaxed,'results':result}
(out/'schema-structural-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
