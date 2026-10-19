"""Finite registry of source-pinned plugins supported by the application adapter."""
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class Plugin:
    name: str
    serial: bool = False


PLUGIN_REGISTRY = MappingProxyType({
    "cq_ww_cw": Plugin("CQ WW CW"),
    "cq_wpx_cw": Plugin("CQ WPX CW", serial=True),
    "arrl_ss_cw": Plugin("ARRL Sweepstakes CW", serial=True),
    "icwc_mst": Plugin("ICWC Medium Speed Test", serial=True),
    "cwt": Plugin("CWT"),
    "k1usn_sst": Plugin("K1USN SLOW SPEED TEST"),
})
PLUGINS = MappingProxyType({key: plugin.name for key, plugin in PLUGIN_REGISTRY.items()})
SERIAL_PLUGINS = frozenset(key for key, plugin in PLUGIN_REGISTRY.items() if plugin.serial)
