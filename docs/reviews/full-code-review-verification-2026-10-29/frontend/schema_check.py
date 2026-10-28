from pathlib import Path
import xml.etree.ElementTree as ET,re,json,hashlib
out=Path(__file__).parent
source=Path('/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/adifTransfer.ts').read_text()
data=(out/'adx317.xsd').read_bytes()
x=ET.fromstring(data);ns={'x':'http://www.w3.org/2001/XMLSchema'}
record=next(e for e in x.iter('{http://www.w3.org/2001/XMLSchema}element') if e.attrib.get('name')=='RECORD')
names={e.attrib['name'] for e in record.iter('{http://www.w3.org/2001/XMLSchema}element') if 'name' in e.attrib}-{'RECORD','USERDEF','APP'}
typescript=set(re.search(r'const standardADXFields = new Set\(`(.*?)`\.split',source,re.S)[1].split())
summary={'sourceURL':'https://adif.org/317/adx317.xsd','schemaVersion':x.attrib.get('version'),'sha256':hashlib.sha256(data).hexdigest(),'schemaRecordFields':len(names),'typescriptFields':len(typescript),'missingFromFrontend':sorted(names-typescript),'extraFrontendFields':sorted(typescript-names)}
summary['selectedTypeDefinitions']={}
for name in ['String','MultilineString','IntlString','IntlMultilineString','Number','NumberGE0','Integer','IntegerGE0','PositiveInteger','Location','DataTypeIndicator']:
    element=x.find("x:simpleType[@name='"+name+"']",ns)
    if element is not None: summary['selectedTypeDefinitions'][name]=ET.tostring(element,encoding='unicode')
(out/'schema-check.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='selectedTypeDefinitions'},indent=2))
