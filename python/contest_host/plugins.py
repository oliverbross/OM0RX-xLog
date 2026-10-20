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
    "cq_ww_ssb": Plugin("CQ WW SSB", modes=("SSB",), matrix_trackers=("countries", "zones"),
                        sent_exchange_hint="CQ Zone No."),
    "cq_ww_rtty": Plugin(
        "CQ WW RTTY",
        bands=("80m", "40m", "20m", "15m", "10m"),
        modes=("RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
               "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"),
        matrix_trackers=("countries", "zones", "states"),
        sent_exchange_hint="CQ Zone + (state/VE area)",
    ),
    "cq_wpx_cw": Plugin("CQ WPX CW", serial=True),
    "cq_wpx_ssb": Plugin("CQ WPX SSB", serial=True, modes=("SSB",)),
    "arrl_ss_cw": Plugin("ARRL Sweepstakes CW", serial=True,
                         sent_exchange_hint="Prec Call Check Section", overlay_choices=("N/A",)),
    "arrl_ss_phone": Plugin("ARRL Sweepstakes Phone", serial=True, modes=("SSB",),
                            sent_exchange_hint="Prec Call Check Section", overlay_choices=("N/A",)),
    "arrl_dx_cw": Plugin("ARRL DX CW", sent_exchange_hint="Power/State/Province"),
    "arrl_dx_ssb": Plugin("ARRL DX SSB", modes=("SSB",), sent_exchange_hint="Power/State/Province"),
    "naqp_cw": Plugin("NAQP CW", sent_exchange_hint="Name + SPC"),
    "naqp_ssb": Plugin("NAQP SSB", modes=("SSB",), sent_exchange_hint="Name + SPC"),
    "phone_weekly_test": Plugin("PHONE WEEKLY TEST",
                                bands=("160m", "80m", "40m", "20m", "15m"),
                                modes=("SSB",), sent_exchange_hint="Name + SPC"),
    "icwc_mst": Plugin("ICWC Medium Speed Test", serial=True, sent_exchange_hint="Name"),
    "cwt": Plugin("CWT"),
    "cwo": Plugin("CWOPS - Open", serial=True, allow_duplicate_commit=True, sent_exchange_hint="Name"),
    "k1usn_sst": Plugin("K1USN SLOW SPEED TEST"),
    "trans_tasman": Plugin("Trans Tasman CW", serial=True, bands=("160m", "80m", "40m"),
                            allow_duplicate_commit=True),
    "oceania_dx_cw": Plugin("Oceania DX CW", serial=True, allow_duplicate_commit=True),
    "oceania_dx_ssb": Plugin("Oceania DX SSB", serial=True, modes=("SSB",), allow_duplicate_commit=True),
    "10_10_fall_cw": Plugin("10 10 FALL CW", bands=("10m",)),
    "10_10_spring_cw": Plugin("10 10 SPRING CW", bands=("10m",)),
    "10_10_winter_phone": Plugin("10 10 WINTER PHONE", bands=("10m",), modes=("SSB",)),
    "10_10_summer_phone": Plugin("10 10 SUMMER PHONE", bands=("10m",), modes=("SSB",)),
})
PLUGINS = MappingProxyType({key: plugin.name for key, plugin in PLUGIN_REGISTRY.items()})
CQ_WW_PLUGINS = frozenset({"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"})
SERIAL_PLUGINS = frozenset(key for key, plugin in PLUGIN_REGISTRY.items() if plugin.serial)
TEN_TEN_PLUGINS = frozenset({"10_10_fall_cw", "10_10_spring_cw", "10_10_winter_phone", "10_10_summer_phone"})
NAME_SPC_PLUGINS = frozenset({"naqp_cw", "naqp_ssb", "phone_weekly_test"})
ARRL_DX_PLUGINS = frozenset({"arrl_dx_cw", "arrl_dx_ssb"})
