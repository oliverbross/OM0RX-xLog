"""Bounded N1MM-compatible UDP XML output derived from the pinned Not1MM sender."""
from copy import deepcopy
import logging
import socket
from xml.etree.ElementTree import Element, SubElement, tostring


LOGGER = logging.getLogger(__name__)

RADIO_INFO = {
    "app": "NOT1MM", "StationName": "", "RadioNr": "1", "Freq": "", "TXFreq": "",
    "Mode": "", "OpCall": "", "IsRunning": "False", "FocusEntry": "0", "EntryWindowHwnd": "0",
    "Antenna": "1", "Rotors": "", "FocusRadioNr": "1", "IsStereo": "False", "IsSplit": "False",
    "ActiveRadioNr": "1", "IsTransmitting": "False", "FunctionKeyCaption": "", "RadioName": "Brad",
    "AuxAntSelected": "-1", "AuxAntSelectedName": "",
}

CONTACT_INFO = {
    "app": "NOT1MM", "contestname": "", "contestnr": "1", "timestamp": "", "mycall": "",
    "operator": "", "band": "", "rxfreq": "", "txfreq": "", "mode": "", "call": "",
    "countryprefix": "K", "wpxprefix": "", "stationprefix": "", "continent": "NA", "snt": "59",
    "sntnr": "", "rcv": "59", "rcvnr": "", "gridsquare": "", "exchange1": "", "section": "",
    "comment": "", "qth": "", "name": "", "power": "", "misctext": "", "zone": "5", "prec": "",
    "ck": "0", "ismultiplier1": "0", "ismultiplier2": "0", "ismultiplier3": "0", "points": "1",
    "radionr": "1", "RoverLocation": "", "RadioInterfaced": "0", "NetworkedCompNr": "0",
    "IsOriginal": 1, "NetBiosName": "", "IsRunQSO": 0, "Run1Run2": "", "ContactType": "",
    "StationName": "", "ID": "", "IsClaimedQso": 1, "oldcall": "",
}

CONTACT_DELETE = {
    "app": "NOT1MM", "timestamp": "", "call": "", "contestnr": "1", "StationName": "", "ID": "",
}

SCORE_INFO = {
    "app": "NOT1MM", "contest": "", "call": "",
    "class": {"ops": "SINGLE-OP", "mode": "MIXED", "power": "LOW", "bands": "ALL", "transmitter": "ONE"},
    "score": 0, "timestamp": "",
}


def xml_packet(root_name, payload):
    """Encode the same simple dict shape used by Not1MM's dicttoxml call."""
    root = Element(root_name)

    def append(parent, name, value):
        child = SubElement(parent, name)
        if isinstance(value, dict):
            for nested_name, nested_value in value.items():
                append(child, nested_name, nested_value)
        else:
            child.text = str(value)

    for key, value in payload.items():
        append(root, key, value)
    return b'<?xml version="1.0" encoding="UTF-8" ?>' + tostring(root, encoding="utf-8")


class N1MMOutput:
    """Send one XML datagram to each whitespace-separated ``host:port`` destination."""

    def __init__(self, socket_factory=socket.socket):
        self.socket_factory = socket_factory

    def send(self, destinations, payload, root_name):
        packet = xml_packet(root_name, payload)
        for connection in destinations.split():
            try:
                address, raw_port = connection.split(":")
                port = int(raw_port)
                with self.socket_factory(family=socket.AF_INET, type=socket.SOCK_DGRAM) as udp:
                    udp.sendto(packet, (address, port))
            except (OSError, TypeError, ValueError) as error:
                # Optional telemetry must never change the committed contest result.
                LOGGER.warning("N1MM UDP output failed for %s: %s", connection, error)

    def radio(self, destinations, values):
        self.send(destinations, {**deepcopy(RADIO_INFO), **values}, "RadioInfo")

    def contact(self, destinations, values, replace=False):
        self.send(destinations, {**deepcopy(CONTACT_INFO), **values}, "contactreplace" if replace else "contactinfo")

    def delete(self, destinations, values):
        self.send(destinations, {**deepcopy(CONTACT_DELETE), **values}, "contactdelete")

    def lookup(self, destinations, values):
        self.send(destinations, {**deepcopy(CONTACT_INFO), **values}, "lookupinfo")

    def score(self, destinations, values):
        payload = deepcopy(SCORE_INFO)
        payload.update(values)
        self.send(destinations, payload, "scoreinfo")
