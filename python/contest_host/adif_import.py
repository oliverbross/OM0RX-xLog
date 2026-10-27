"""Finite historical ADIF mappings. Parsing belongs to the existing ADIF decoder.

Only the existing Desk creates/scorers rows. Import never borrows an entry draft,
reserves a sent serial, attributes a radio, or executes ADIF extension contents.
"""
from copy import deepcopy
from datetime import datetime
import hashlib, json, re, uuid

FAMILIES={**dict.fromkeys(('cq_wpx_cw','cq_wpx_ssb','cq_wpx_rtty'),'serial'),
          **dict.fromkeys(('naqp_cw','naqp_ssb','naqp_rtty'),'name-location'),
          **dict.fromkeys(('darc_vhf','nac_vhf','ta_vhf_uhf_contest'),'serial-grid'),
          **dict.fromkeys(('arrl_vhf_jan','arrl_vhf_jun','arrl_vhf_sep'),'grid'),
          **dict.fromkeys(('cq_ww_cw','cq_ww_ssb'),'zone')}


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)


def review(host,store,state,params,require):
    from .host import Desk, INPUTS, operating_mode, requires_serial
    require(state['pluginID'] in FAMILIES,'No reviewed historical ADIF mapping exists for this definition')
    item=params.get('record');require(isinstance(item,dict) and set(item)=={'raw','metadata','sourceSHA256'},'Use a decoded ADIF record with source provenance')
    raw=item['raw'];require(isinstance(raw,dict) and 1<=len(raw)<=128 and len(canonical(item).encode())<=20000,'ADIF record exceeds the bounded import envelope')
    require(all(isinstance(k,str) and re.fullmatch(r'[A-Z0-9_]{1,64}',k) and isinstance(v,str) and len(v.encode())<=8192 for k,v in raw.items()),'Invalid decoded ADIF field')
    require(re.fullmatch(r'[0-9a-f]{64}',str(item['sourceSHA256'])) is not None,'Missing source digest')
    require(item['metadata'] is None or isinstance(item['metadata'],dict),'Invalid ADIF extension metadata')
    def value(key,required=True):
        result=raw.get(key,'').strip()
        require(not required or result,'Historical ADIF is missing '+key)
        require(not any(ord(c)<32 for c in result),'ADIF control characters are not supported in '+key)
        return result
    clone=deepcopy(state)
    if 'countries' in params:
        require(params.get('referenceID')==state['reference']['id'],'ADIF country reference changed','reference_mismatch')
        additions=host.countries(deepcopy(params['countries']))
        clone['reference']['countries'].update({k:v for k,v in additions.items() if k not in clone['reference']['countries']})
    desk=Desk(store,clone,host.commit)
    contest=value('CONTEST_ID').upper()
    accepted={desk.contest.cabrillo_name.upper(),state['pluginID'].upper().replace('_','-')}
    require(contest in accepted,'ADIF contest does not match the selected definition: '+str(sorted(accepted)))
    station=value('STATION_CALLSIGN').upper();require(station==str(state['station']['Call']).upper(),'ADIF station must match the selected entrant; choose the correct session')
    call=value('CALL').upper();require(re.fullmatch(r'[A-Z0-9/]{3,32}',call) is not None,'Invalid historical callsign')
    mode=value('MODE').upper();submode=value('SUBMODE',False).upper()
    expected=operating_mode(state)
    require(mode in ({'SSB','PHONE','USB','LSB'} if expected=='SSB' else {'RTTY','DATA'} if expected=='RTTY' else {'CW'}),'ADIF mode does not match the selected definition')
    require(not submode or (expected=='SSB' and submode in {'USB','LSB'}) or (expected=='RTTY' and submode=='RTTY'),'Unsupported historical submode')
    require(mode!='DATA' or submode=='RTTY','DATA requires an explicit supported RTTY submode')
    date,time=value('QSO_DATE'),value('TIME_ON')
    require(re.fullmatch(r'\d{8}',date) and re.fullmatch(r'\d{4}(\d{2})?',time),'Invalid historical UTC')
    try:
        stamp=datetime.strptime(date+time.ljust(6,'0'),'%Y%m%d%H%M%S').strftime('%Y-%m-%d %H:%M:%S')
        frequency=float(value('FREQ'))*1000000
        require(frequency.is_integer() and 0<frequency<=7500000000000,'Invalid historical RF')
        frequency=int(frequency);desk.band(frequency)
    except (ValueError,OverflowError):require(False,'Invalid historical UTC or frequency')
    fields={name:'' for name in INPUTS};fields.update(callsign=call,sent=value('RST_SENT'),receive=value('RST_RCVD'))
    family=FAMILIES[state['pluginID']]
    if family=='name-location':
        fields.update(other_1=value('NAME').upper(),other_2=value('STATE',False).upper() or value('VE_PROV',False).upper() or value('SRX_STRING').upper())
        require(bool(value('STX_STRING')),'Actual sent name/location exchange is required')
    elif family=='grid':fields.update(other_1=value('MY_GRIDSQUARE').upper(),other_2=value('GRIDSQUARE').upper())
    elif family=='zone':fields.update(other_1=value('STX_STRING',False) or value('STX'),other_2=value('CQZ'))
    else:
        fields['other_1']=value('STX')
        require(re.fullmatch(r'\d{1,6}',fields['other_1']) and int(fields['other_1'])>0,'Actual sent serial is required')
        fields['other_2']=value('SRX') if family=='serial' else value('SRX')+' '+value('GRIDSQUARE').upper()
    mygrid=value('MY_GRIDSQUARE',False).upper()
    if family in {'serial-grid','grid'}:
        require(re.fullmatch(r'[A-R]{2}\d{2}([A-X]{2})?',mygrid),'Historical station locator is required')
        clone['station']['GridSquare']=mygrid
        clone['settings']['SentExchange']=mygrid if family=='grid' else clone['settings'].get('SentExchange','')
        desk=Desk(store,clone,host.commit)
    for name in INPUTS:getattr(desk,name).setText(fields[name])
    host.validate_exchange(desk,fields)
    # All source values/metadata remain available even when no direct field exists.
    semantic=hashlib.sha256(canonical({'plugin':state['pluginID'],'raw':raw}).encode()).hexdigest()
    supplied=raw.get('APP_XLOG_QSO_ID') or raw.get('APP_N1MM_ID')
    try:qso_id=str(uuid.UUID(supplied)) if supplied else str(uuid.uuid5(uuid.NAMESPACE_URL,'xlog:adif:'+semantic))
    except (ValueError,AttributeError):qso_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'xlog:adif:id:'+str(supplied)))
    prior=store.exec_sql('SELECT semantic_digest FROM xlog_adif_import WHERE qso_id=?',(qso_id,))
    require(not prior or prior['semantic_digest']==semantic,'This ADIF identity has different source content','source_conflict')
    identity=store.exec_sql('SELECT id FROM xlog_qso_identity WHERE id=?',(qso_id,))
    require(not identity or prior,'ADIF identity collides with an existing non-imported contact','source_conflict')
    collision=store.exec_sql('SELECT ID FROM DXLOG WHERE Call=? AND TS=? AND Freq=? AND ID<>?',(call,stamp,frequency/1000,qso_id))
    require(not collision,'An existing contact has the same caller/time/RF with different identity; reconcile explicitly','source_conflict')
    receive_rf=None
    if raw.get('FREQ_RX'):
        try:
            receive_rf=float(value('FREQ_RX'))*1000000
            require(receive_rf.is_integer() and 0<receive_rf<=7500000000000,'Invalid historical receive RF')
        except (ValueError,OverflowError):require(False,'Invalid historical receive RF')
    site=None
    if raw.get('APP_XLOG_SITE'):
        try:site=json.loads(raw['APP_XLOG_SITE'])
        except ValueError:require(False,'Malformed explicit site provenance')
        require(isinstance(site,dict) and isinstance(site.get('id'),str) and site.get('locator')==mygrid,'Site provenance does not match the actual sent locator')
    return {'qsoID':qso_id,'status':'already-imported' if prior else 'ready','family':family,'timestamp':stamp,'frequencyHz':frequency,
            'fields':fields,'semanticDigest':semantic,'source':deepcopy(item),'mode':mode,'submode':submode,'station':station,
            'operator':value('OPERATOR',False),'myGrid':mygrid,'site':site,'receiveFrequencyHz':receive_rf,'outputActions':[],'radioAttribution':'unknown'},desk


def apply(host,store,state,params,require):
    from .host import requires_serial
    reviewed,desk=review(host,store,state,params,require)
    if reviewed['status']=='already-imported':return {'qsoID':reviewed['qsoID'],'status':'already-imported','outputActions':[]}
    raw=reviewed['source']['raw'];qso_id=reviewed['qsoID']
    row=desk.contact_for(reviewed['fields'],qso_id,reviewed['timestamp'],reviewed['frequencyHz'])
    row.update(StationPrefix=reviewed['station'],Operator=reviewed['operator'],Mode=reviewed['submode'] or reviewed['mode'],IsRunQSO='',Run1Run2='')
    if requires_serial(state):row['SentNr']=int(raw['STX'])
    if reviewed['myGrid']:row['MiscText']=reviewed['myGrid']
    if reviewed['receiveFrequencyHz'] is not None:row['QSXFreq']=reviewed['receiveFrequencyHz']/1000
    store.log_contact(row)
    country=desk.state['reference']['countries'].get(row['Call'])
    store.conn.execute('INSERT INTO xlog_qso_identity VALUES(?,?,?,0)',(qso_id,canonical(reviewed['fields']),canonical(country)))
    store.conn.execute('INSERT INTO xlog_adif_import VALUES(?,?,?)',(qso_id,reviewed['semanticDigest'],canonical(reviewed['source'])))
    if reviewed['site']:store.conn.execute('INSERT INTO xlog_qso_site VALUES(?,?)',(qso_id,canonical(reviewed['site'])))
    state['reference']['countries'].update({k:v for k,v in desk.state['reference']['countries'].items() if k not in state['reference']['countries']})
    if requires_serial(state):state['historicalSerialFloor']=max(state.get('historicalSerialFloor',0),int(raw['STX']))
    host.rebuild(desk)
    after=store.exec_sql('SELECT * FROM DXLOG WHERE ID=?',(qso_id,))
    host.audit(store,qso_id,'adif_import',None,after,'Explicit reviewed historical ADIF import',revision=state['revision']+1)
    return {'qsoID':qso_id,'status':'imported','outputActions':[]}
