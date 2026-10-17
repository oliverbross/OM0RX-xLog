import argparse, json, pathlib, zipfile, xml.etree.ElementTree as ET

parser=argparse.ArgumentParser(description='Add native Excel hyperlinks to an Artifact Tool workbook.')
parser.add_argument('workbook',type=pathlib.Path)
parser.add_argument('metadata',type=pathlib.Path,nargs='?',help='Generated hyperlink manifest; defaults beside the workbook.')
args=parser.parse_args()
out=args.workbook.resolve()
metadata=args.metadata.resolve() if args.metadata else out.with_name('native-links.generated.json')
meta=json.loads(metadata.read_text())
MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('',MAIN)
ET.register_namespace('r',OFFICE)
with zipfile.ZipFile(out) as z:
    files={n:z.read(n) for n in z.namelist()}

count=0
for i,name in enumerate(meta['names'],1):
    links=[x for x in meta['links'] if x['sheet']==name]
    if not links: continue
    p=f'xl/worksheets/sheet{i}.xml'
    relp=f'xl/worksheets/_rels/sheet{i}.xml.rels'
    root=ET.fromstring(files[p])
    rels=ET.fromstring(files[relp]) if relp in files else ET.Element(f'{{{REL}}}Relationships')
    ids={r.get('Id') for r in rels}
    hs=ET.Element(f'{{{MAIN}}}hyperlinks')
    for n,link in enumerate(links,1):
        attrs={'ref':link['ref'],'display':link['display']}
        if 'location' in link: attrs['location']=link['location']
        else:
            rid=f'rIdReportLink{n}'
            if rid in ids: raise RuntimeError('duplicate relationship '+rid)
            attrs[f'{{{OFFICE}}}id']=rid
            ET.SubElement(rels,f'{{{REL}}}Relationship',{'Id':rid,'Type':OFFICE+'/hyperlink','Target':link['target'],'TargetMode':'External'})
        ET.SubElement(hs,f'{{{MAIN}}}hyperlink',attrs)
        count+=1
    # Hyperlinks follow conditional formatting/data validation and precede page/print/drawing/table parts.
    after={'sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations'}
    insert=0
    for j,ch in enumerate(root):
        if ch.tag.split('}')[-1] in after: insert=j+1
    root.insert(insert,hs)
    files[p]=ET.tostring(root,encoding='utf-8',xml_declaration=True)
    files[relp]=ET.tostring(rels,encoding='utf-8',xml_declaration=True)

tmp=out.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as z:
    for n,b in files.items(): z.writestr(n,b)
tmp.replace(out)

# Independently inspect the actual deliverable XML, preserving Artifact Tool formula caches.
with zipfile.ZipFile(out) as z:
    summary=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    cells={x.get('r'):x for x in summary.findall(f'.//{{{MAIN}}}c')}
    expected={'B6':94,'B7':16,'B8':78,'B10':33}
    for ref,v in expected.items():
        c=cells[ref]
        assert c.find(f'{{{MAIN}}}f') is not None
        assert float(c.find(f'{{{MAIN}}}v').text)==v,(ref,ET.tostring(c))
    assert not any(b'HYPERLINK is not implemented' in z.read(n) for n in z.namelist())
    assert not any(b'<f>HYPERLINK' in z.read(n) for n in z.namelist())
    for i,name in enumerate(meta['names'],1):
        root=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))
        hs=root.findall(f'.//{{{MAIN}}}hyperlink')
        expected_links=[x for x in meta['links'] if x['sheet']==name]
        assert len(hs)==len(expected_links),(name,len(hs),len(expected_links))
        if name!='Summary':
            pane=root.find(f'.//{{{MAIN}}}pane')
            assert pane is not None and pane.get('ySplit')=='5',(name,ET.tostring(pane))
        for h in hs:
            loc=h.get('location')
            if loc: assert loc.startswith("'Evidence'!A") and 6<=int(loc.split('A')[-1])<=27
            else:
                relroot=ET.fromstring(z.read(f'xl/worksheets/_rels/sheet{i}.xml.rels'))
                matches=[r for r in relroot if r.get('Id')==h.get(f'{{{OFFICE}}}id')]
                assert len(matches)==1 and matches[0].get('TargetMode')=='External'
                assert matches[0].get('Target').startswith('https://github.com/')
    errors=[]
    for n in z.namelist():
        if n.startswith('xl/worksheets/') and n.endswith('.xml'):
            root=ET.fromstring(z.read(n))
            errors.extend((n,c.get('r'),c.find(f'{{{MAIN}}}v').text) for c in root.findall(f'.//{{{MAIN}}}c') if c.get('t')=='e')
    assert not errors,errors
    tables=[]
    for n in z.namelist():
        if n.startswith('xl/tables/') and n.endswith('.xml'):
            root=ET.fromstring(z.read(n)); tables.append((root.get('name'),root.get('ref')))
    assert ('ContestMatrix','A5:Q99') in tables and ('FeatureMatrix','A5:K38') in tables,tables

inspector=pathlib.Path(str(out)+'.inspect.ndjson')
if inspector.exists(): inspector.unlink()
verification={'native_hyperlinks':count,'cached_summary_counts':expected,'error_cells':0,'table_ranges':tables,'freeze_header_rows':5,'formula_messages':0}
out.with_name('native-link-verification.json').write_text(json.dumps(verification,indent=2))
print(json.dumps(verification))
