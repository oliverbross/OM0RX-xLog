"""Finite registry of source-pinned plugins supported by the application adapter."""
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class Plugin:
    name: str
    serial: bool = False
    bands: tuple[str, ...] = ("160m", "80m", "40m", "20m", "15m", "10m")
    modes: tuple[str, ...] = ("CW",)
    allow_duplicate_commit: bool = False
    matrix_trackers: tuple[str, ...] = ()
    sent_exchange_hint: str = "Sent Exchange"
    overlay_choices: tuple[str, ...] = ("N/A", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH")


PLUGIN_REGISTRY = MappingProxyType({
    "cq_ww_cw": Plugin("CQ WW CW", matrix_trackers=("countries", "zones")),
    "cq_wpx_cw": Plugin("CQ WPX CW", serial=True),
    "arrl_ss_cw": Plugin("ARRL Sweepstakes CW", serial=True,
                         sent_exchange_hint="Prec Call Check Section", overlay_choices=("N/A",)),
    "icwc_mst": Plugin("ICWC Medium Speed Test", serial=True, sent_exchange_hint="Name"),
    "cwt": Plugin("CWT"),
    "cwo": Plugin("CWOPS - Open", serial=True, allow_duplicate_commit=True, sent_exchange_hint="Name"),
    "k1usn_sst": Plugin("K1USN SLOW SPEED TEST"),
    "trans_tasman": Plugin("Trans Tasman CW", serial=True, bands=("160m", "80m", "40m"),
                            allow_duplicate_commit=True),
    "oceania_dx_cw": Plugin("Oceania DX CW", serial=True, allow_duplicate_commit=True),
})
PLUGINS = MappingProxyType({key: plugin.name for key, plugin in PLUGIN_REGISTRY.items()})
SERIAL_PLUGINS = frozenset(key for key, plugin in PLUGIN_REGISTRY.items() if plugin.serial)
