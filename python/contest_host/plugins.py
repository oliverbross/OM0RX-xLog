"""Finite registry of source-pinned plugins supported by the application adapter."""
from dataclasses import dataclass
from types import MappingProxyType


RTTY_MODES = ("RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
              "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB")


@dataclass(frozen=True)
class Plugin:
    name: str
    serial: bool = False
    conditional_serial: bool = False
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
        modes=RTTY_MODES,
        matrix_trackers=("countries", "zones", "states"),
        sent_exchange_hint="CQ Zone + (state/VE area)",
    ),
    "cq_wpx_cw": Plugin("CQ WPX CW", serial=True),
    "cq_wpx_ssb": Plugin("CQ WPX SSB", serial=True, modes=("SSB",)),
    "cq_wpx_rtty": Plugin("CQ WPX RTTY", serial=True,
                            bands=("80m", "40m", "20m", "15m", "10m"), modes=RTTY_MODES),
    "arrl_ss_cw": Plugin("ARRL Sweepstakes CW", serial=True,
                         sent_exchange_hint="Prec Call Check Section", overlay_choices=("N/A",)),
    "arrl_ss_phone": Plugin("ARRL Sweepstakes Phone", serial=True, modes=("SSB",),
                            sent_exchange_hint="Prec Call Check Section", overlay_choices=("N/A",)),
    "arrl_dx_cw": Plugin("ARRL DX CW", sent_exchange_hint="Power/State/Province"),
    "arrl_dx_ssb": Plugin("ARRL DX SSB", modes=("SSB",), sent_exchange_hint="Power/State/Province"),
    "naqp_cw": Plugin("NAQP CW", sent_exchange_hint="Name + SPC"),
    "naqp_ssb": Plugin("NAQP SSB", modes=("SSB",), sent_exchange_hint="Name + SPC"),
    "naqp_rtty": Plugin("NAQP RTTY", modes=RTTY_MODES, sent_exchange_hint="Name + SPC"),
    "phone_weekly_test": Plugin("PHONE WEEKLY TEST",
                                bands=("160m", "80m", "40m", "20m", "15m"),
                                modes=("SSB",), sent_exchange_hint="Name + SPC"),
    "weekly_rtty": Plugin("WEEKLY RTTY TEST", bands=("80m", "40m", "20m", "15m", "10m"),
                           modes=RTTY_MODES, sent_exchange_hint="Name + SPC"),
    "icwc_mst": Plugin("ICWC Medium Speed Test", serial=True, sent_exchange_hint="Name"),
    "cwt": Plugin("CWT"),
    "cwo": Plugin("CWOPS - Open", serial=True, allow_duplicate_commit=True, sent_exchange_hint="Name"),
    "k1usn_sst": Plugin("K1USN SLOW SPEED TEST"),
    "trans_tasman": Plugin("Trans Tasman CW", serial=True, bands=("160m", "80m", "40m"),
                            allow_duplicate_commit=True),
    "oceania_dx_cw": Plugin("Oceania DX CW", serial=True, allow_duplicate_commit=True),
    "oceania_dx_ssb": Plugin("Oceania DX SSB", serial=True, modes=("SSB",), allow_duplicate_commit=True),
    "sac_cw": Plugin("SAC CW", serial=True),
    "sac_ssb": Plugin("SAC SSB", serial=True, modes=("SSB",)),
    "iaru_fieldday_r1_cw": Plugin("IARU FIELDDAY R1 DARC CW", serial=True),
    "iaru_fieldday_r1_ssb": Plugin("IARU FIELDDAY R1 DARC SSB", serial=True, modes=("SSB",)),
    "10_10_fall_cw": Plugin("10 10 FALL CW", bands=("10m",)),
    "10_10_spring_cw": Plugin("10 10 SPRING CW", bands=("10m",)),
    "10_10_winter_phone": Plugin("10 10 WINTER PHONE", bands=("10m",), modes=("SSB",)),
    "10_10_summer_phone": Plugin("10 10 SUMMER PHONE", bands=("10m",), modes=("SSB",)),
    "jidx_cw": Plugin("JIDX CW", sent_exchange_hint="Prefecture or CQ Zone"),
    "jidx_ph": Plugin("JIDX PH", modes=("SSB",), sent_exchange_hint="Prefecture or CQ Zone"),
    "aadx_cw": Plugin("AADX CW", sent_exchange_hint="Age (or 01)"),
    "aadx_ssb": Plugin("AADX SSB", modes=("SSB",), sent_exchange_hint="Age (or 01)"),
    "cq_160_cw": Plugin("CQ 160 CW", bands=("160m",), sent_exchange_hint="ST/Prov or DX CQ Zone"),
    "cq_160_ssb": Plugin("CQ 160 SSB", bands=("160m",), modes=("SSB",),
                           sent_exchange_hint="ST/Prov or DX CQ Zone"),
    "euhfc": Plugin("EUHFC", modes=("CW", "SSB"),
                     sent_exchange_hint="Lic. Year (2 digits)"),
    "iaru_hf": Plugin("IARU HF", modes=("CW", "SSB"), sent_exchange_hint="ITU Zone"),
    "arrl_10m": Plugin("ARRL 10M", conditional_serial=True, bands=("10m",), modes=("CW", "SSB"),
                       sent_exchange_hint="State/Province, serial or ITU region"),
    "arrl_160m": Plugin("ARRL 160-Meter", bands=("160m",),
                        sent_exchange_hint="ARRL/RAC section or DX CQ zone"),
    "arrl_field_day": Plugin("ARRL Field Day", modes=("CW", "SSB", "RTTY", "AM", "FM"),
                             bands=("160m", "80m", "40m", "20m", "15m", "10m",
                                    "6m", "2m", "1.25m", "70cm", "33cm", "23cm"),
                             sent_exchange_hint="Class + ARRL/RAC section"),
    "arrl_rtty_ru": Plugin("ARRL RTTY Roundup", conditional_serial=True,
                           bands=("80m", "40m", "20m", "15m", "10m"), modes=RTTY_MODES,
                           sent_exchange_hint="State/province or #"),
    "arrl_vhf_jan": Plugin("ARRL VHF JAN", modes=("CW", "SSB", "RTTY", "AM", "FM"),
                           bands=("6m", "2m", "1.25m", "70cm", "33cm", "23cm"),
                           sent_exchange_hint="4-character grid square"),
    "arrl_vhf_jun": Plugin("ARRL VHF JUN", modes=("CW", "SSB", "RTTY", "AM", "FM"),
                           bands=("6m", "2m", "1.25m", "70cm", "33cm", "23cm"),
                           sent_exchange_hint="4-character grid square"),
    "arrl_vhf_sep": Plugin("ARRL VHF SEP", modes=("CW", "SSB", "RTTY", "AM", "FM"),
                           bands=("6m", "2m", "1.25m", "70cm", "33cm", "23cm"),
                           sent_exchange_hint="4-character grid square"),
    "ea_majestad_cw": Plugin("His Maj. King of Spain Contest, CW", conditional_serial=True,
                             sent_exchange_hint="Province or #"),
    "ea_majestad_ssb": Plugin("His Maj. King of Spain Contest, SSB", conditional_serial=True,
                              modes=("SSB",), sent_exchange_hint="Province or #"),
    "ref_cw": Plugin("French REF DX contest - CW", conditional_serial=True,
                     bands=("80m", "40m", "20m", "15m", "10m"),
                     sent_exchange_hint="Department/prefix or #"),
    "ref_ssb": Plugin("French REF DX contest - SSB", conditional_serial=True,
                      bands=("80m", "40m", "20m", "15m", "10m"), modes=("SSB",),
                      sent_exchange_hint="Department/prefix or #"),
    "rsgb_80m_cc": Plugin("RSGB 80M CC", serial=True, bands=("80m",),
                          sent_exchange_hint="Serial number"),
    "rsgb_commonwealth_beru": Plugin("RSGB Commonwealth BERU", serial=True,
                                     bands=("80m", "40m", "20m", "15m", "10m"),
                                     sent_exchange_hint="Serial number (optional HQ)"),
    "es_field_day": Plugin("ES FIELD DAY", serial=True, modes=("CW", "SSB"),
                           allow_duplicate_commit=True,
                           sent_exchange_hint="Serial + Estonian region"),
    "es_ll_kv": Plugin("ES LL KV", serial=True, modes=("CW", "SSB"),
                       allow_duplicate_commit=True, sent_exchange_hint="Serial number"),
    "es_manual_key": Plugin("ES MANUAL KEY", serial=True, allow_duplicate_commit=True,
                            sent_exchange_hint="Seniority + serial"),
    "es_open": Plugin("ES OPEN", serial=True, modes=("CW", "SSB"),
                      allow_duplicate_commit=True, sent_exchange_hint="Serial number"),
    "hadx": Plugin("HA DX", conditional_serial=True, modes=("CW", "SSB"),
                   sent_exchange_hint="# or County"),
    "helvetia": Plugin("HELVETIA", conditional_serial=True, modes=("CW", "SSB"),
                       sent_exchange_hint="Canton or #"),
    "pacc": Plugin("PACC", conditional_serial=True, modes=("CW", "SSB"),
                   sent_exchange_hint="# or Province"),
    "spdx": Plugin("SPDX", conditional_serial=True, modes=("CW", "SSB"),
                   sent_exchange_hint="Province/Territory"),
    "ari_dx": Plugin("ARI International DX", conditional_serial=True,
                     bands=("80m", "40m", "20m", "15m", "10m"), modes=("CW", "SSB", "RTTY"),
                     sent_exchange_hint="Province or #", overlay_choices=("N/A",)),
    "darc_xmas": Plugin("DARC XMAS", conditional_serial=True, bands=("80m", "40m"),
                        modes=("CW", "SSB"), sent_exchange_hint="DOK/NM or #", overlay_choices=("N/A",)),
    "eudx": Plugin("EUDXC", modes=("CW", "SSB"),
                   sent_exchange_hint="ITU zone or EU Union region", overlay_choices=("N/A",)),
    "lz-dx": Plugin("LZ DX", modes=("CW", "SSB"),
                    sent_exchange_hint="District or ITU zone", overlay_choices=("N/A",)),
    "wag": Plugin("WAG", conditional_serial=True,
                  bands=("80m", "40m", "20m", "15m", "10m"), modes=("CW", "SSB"),
                  sent_exchange_hint="DOK/NM or #", overlay_choices=("N/A",)),
})
PLUGINS = MappingProxyType({key: plugin.name for key, plugin in PLUGIN_REGISTRY.items()})
CQ_WW_PLUGINS = frozenset({"cq_ww_cw", "cq_ww_ssb", "cq_ww_rtty"})
SERIAL_PLUGINS = frozenset(key for key, plugin in PLUGIN_REGISTRY.items() if plugin.serial)
CONDITIONAL_SERIAL_PLUGINS = frozenset(
    key for key, plugin in PLUGIN_REGISTRY.items() if plugin.conditional_serial)
SENTNR_FIELD_PLUGINS = SERIAL_PLUGINS | CONDITIONAL_SERIAL_PLUGINS
TEN_TEN_PLUGINS = frozenset({"10_10_fall_cw", "10_10_spring_cw", "10_10_winter_phone", "10_10_summer_phone"})
NAME_SPC_PLUGINS = frozenset({"naqp_cw", "naqp_ssb", "naqp_rtty", "phone_weekly_test"})
NAME_SPC_ENTRY_PLUGINS = NAME_SPC_PLUGINS | frozenset({"weekly_rtty"})
RTTY_PLUGINS = frozenset({"cq_ww_rtty", "cq_wpx_rtty", "naqp_rtty", "weekly_rtty", "arrl_rtty_ru"})
CONFIGURED_SENTNR_PLUGINS = frozenset({"cq_ww_rtty", "naqp_rtty", "weekly_rtty",
                                       "aadx_cw", "aadx_ssb", "euhfc", "iaru_hf", "eudx", "lz-dx"})
DISPLAY_SENTNR_PLUGINS = frozenset({"euhfc", "iaru_hf", "eudx", "lz-dx", "arrl_rtty_ru",
                                    "arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep"})
ARRL_DX_PLUGINS = frozenset({"arrl_dx_cw", "arrl_dx_ssb"})
JIDX_PLUGINS = frozenset({"jidx_cw", "jidx_ph"})
AADX_PLUGINS = frozenset({"aadx_cw", "aadx_ssb"})
CQ_160_PLUGINS = frozenset({"cq_160_cw", "cq_160_ssb"})
EA_MAJESTAD_PLUGINS = frozenset({"ea_majestad_cw", "ea_majestad_ssb"})
REF_PLUGINS = frozenset({"ref_cw", "ref_ssb"})
RSGB_PLUGINS = frozenset({"rsgb_80m_cc", "rsgb_commonwealth_beru"})
ESTONIAN_PLUGINS = frozenset({"es_field_day", "es_ll_kv", "es_manual_key", "es_open"})
EUROPEAN_DX_PLUGINS = frozenset({"hadx", "helvetia", "pacc", "spdx"})
CENTRAL_EUROPEAN_PLUGINS = frozenset({"ari_dx", "darc_xmas", "eudx", "lz-dx", "wag"})
ARRL_VHF_PLUGINS = frozenset({"arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep"})
SIMPLE_MULTIPLIER_PLUGINS = frozenset({
    "sac_cw", "sac_ssb", "iaru_fieldday_r1_cw", "iaru_fieldday_r1_ssb",
    "euhfc", "arrl_10m", "arrl_160m", "arrl_field_day", "arrl_rtty_ru",
}) | JIDX_PLUGINS | AADX_PLUGINS | CQ_160_PLUGINS | EA_MAJESTAD_PLUGINS | REF_PLUGINS | RSGB_PLUGINS | ESTONIAN_PLUGINS | EUROPEAN_DX_PLUGINS
SIMPLE_MULTIPLIER_PLUGINS |= ARRL_VHF_PLUGINS
SIMPLE_MULTIPLIER_PLUGINS |= CENTRAL_EUROPEAN_PLUGINS
