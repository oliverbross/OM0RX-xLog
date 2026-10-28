"""Runs the exact production enrichment module; no radio, worker or database."""
import copy, importlib.util, json, os, pathlib, re, unittest
from contest_host import lanes as module

def require(condition, message, *args):
    if not condition: raise ValueError(message)

def fields(text):
    # Independent length-framed reader, so a literal EOR in a value stays data.
    values = {}; p = 0
    while True:
        m = re.search(r'<([^<>]+)>', text[p:])
        if not m: return values
        p += m.end(); parts=m.group(1).split(':')
        if len(parts) > 1:
            size=int(parts[1]); key=parts[0].upper()
            if key in values: raise AssertionError('duplicate tag: '+key)
            values[key]=text[p:p+size]; p += size
        elif parts[0].upper() == 'EOR': return values

def field(key,value): return f'<{key}:{len(value)}>{value}'

class EnrichmentTests(unittest.TestCase):
    def setUp(self):
        self.row={'ID':'qso-1','Operator':'NEWOP','QSXFreq':14050.0}
        self.packet={'MODE':'CW','OPERATOR':'OLDOP','FREQ_RX':'14.026','STX':'001'}
        self.payload=(field('CALL','K1ABC')+field('OPERATOR','NEWOP')+
            field('COMMENT','literal <EOR> stays data')+'<EOR>').encode()
    def run_case(self, row=None, known=None, payload=None):
        r=row if row is not None else self.row
        before=copy.deepcopy((r,self.packet,known))
        result=module.augment_adif(payload or self.payload,[r],known or {},require,{'qso-1':self.packet})
        self.assertEqual((r,self.packet,known),before)
        return fields(result.decode())
    def test_current_operator_and_receive_frequency_win_over_packet(self):
        got=self.run_case()
        self.assertEqual(got['OPERATOR'],'NEWOP')
        self.assertEqual(float(got['FREQ_RX']),14.05)
        self.assertEqual(json.loads(got['APP_XLOG_EXTERNAL_ADIF']),self.packet)
    def test_cleared_current_values_do_not_reappear(self):
        row={**self.row,'Operator':'','QSXFreq':0}
        got=self.run_case(row=row,payload=(field('CALL','K1ABC')+'<EOR>').encode())
        self.assertNotIn('OPERATOR',got); self.assertNotIn('FREQ_RX',got)
        self.assertEqual(json.loads(got['APP_XLOG_EXTERNAL_ADIF']),self.packet)
    def test_known_lane_does_not_let_packet_replace_corrected_receive(self):
        known={'qso-1':{'loggingLaneID':'laneB','receiveFrequencyHz':14026000}}
        got=self.run_case(known=known)
        self.assertEqual(got['APP_XLOG_LOGGING_LANE'],'laneB')
        self.assertEqual(float(got['FREQ_RX']),14.05)
        self.assertEqual(got['COMMENT'],'literal <EOR> stays data')
    def test_original_mode_serial_and_packet_are_preserved(self):
        got=self.run_case()
        self.assertEqual((got['MODE'],got['STX']),('CW','001'))
        self.assertEqual(json.loads(got['APP_XLOG_EXTERNAL_ADIF']),self.packet)
    def test_record_count_mismatch_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'record count'):
            module.augment_adif(self.payload,[],{},require,{'qso-1':self.packet})

if __name__=='__main__': unittest.main(verbosity=2)
