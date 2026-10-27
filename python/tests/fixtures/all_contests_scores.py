"""Explicit first-contact integration oracles for all_contests_lifecycle.json.

Values are (stored points, displayed multipliers, claimed score). They are
deliberately independent of a second call into the scoring implementation.
The family tests remain the authority for repeated/new multipliers and entrant
branches. These pinned-behavior examples do not certify every current rulebook.
"""

EXPECTED = {
    "wae_cw": (1, 2, 2), "wae_ssb": (1, 2, 2), "wae_rtty": (1, 2, 2),
    "cq_ww_cw": (3, 2, 6), "cq_ww_ssb": (3, 2, 6), "cq_ww_rtty": (3, 3, 9),
    "cq_wpx_cw": (3, 1, 3), "cq_wpx_ssb": (3, 1, 3), "cq_wpx_rtty": (3, 1, 3),
    "arrl_ss_cw": (2, 1, 2), "arrl_ss_phone": (2, 1, 2),
    "arrl_dx_cw": (3, 1, 3), "arrl_dx_ssb": (3, 1, 3),
    "naqp_cw": (1, 1, 1), "naqp_ssb": (1, 1, 1), "naqp_rtty": (1, 1, 1),
    "phone_weekly_test": (1, 1, 1), "weekly_rtty": (1, 1, 1),
    "icwc_mst": (1, 1, 1), "cwt": (1, 1, 1), "cwo": (1, 1, 1), "k1usn_sst": (1, 1, 1),
    "trans_tasman": (1, 1, 1),
    "oceania_dx_cw": (20, 1, 20), "oceania_dx_ssb": (20, 1, 20),
    "sac_cw": (1, 1, 1), "sac_ssb": (1, 1, 1),
    "iaru_fieldday_r1_cw": (2, 1, 2), "iaru_fieldday_r1_ssb": (2, 1, 2),
    "10_10_fall_cw": (2, 0, 2), "10_10_spring_cw": (2, 0, 2),
    "10_10_winter_phone": (2, 0, 2), "10_10_summer_phone": (2, 0, 2),
    "jidx_cw": (1, 1, 1), "jidx_ph": (1, 1, 1),
    "aadx_cw": (1, 1, 1), "aadx_ssb": (1, 1, 1),
    "cq_160_cw": (10, 1, 10), "cq_160_ssb": (10, 1, 10),
    "euhfc": (1, 1, 1), "iaru_hf": (1, 1, 1),
    "arrl_10m": (4, 1, 4), "arrl_160m": (5, 1, 5),
    "arrl_field_day": (1, 1, 1), "arrl_rtty_ru": (1, 1, 1),
    "arrl_vhf_jan": (1, 1, 1), "arrl_vhf_jun": (1, 1, 1), "arrl_vhf_sep": (1, 1, 1),
    "ea_majestad_cw": (3, 2, 6), "ea_majestad_ssb": (3, 2, 6),
    "ref_cw": (1, 1, 1), "ref_ssb": (1, 1, 1),
    "rsgb_80m_cc": (1, 0, 1), "rsgb_commonwealth_beru": (30, 0, 30),
    "es_field_day": (1, 1, 2), "es_ll_kv": (2, 0, 2),
    "es_manual_key": (25, 0, 40), "es_open": (2, 0, 0),
    "hadx": (5, 1, 5), "helvetia": (10, 2, 20), "pacc": (1, 1, 1), "spdx": (3, 1, 3),
    "ari_dx": (10, 1, 10), "darc_xmas": (1, 2, 2), "eudx": (5, 1, 5),
    "lz-dx": (10, 2, 20), "wag": (3, 1, 3), "ari_40_80": (3, 1, 3), "ea_rtty": (3, 2, 6),
    "ok1wc": (1, 1, 1), "ssa_mt_cw": (2, 1, 2), "ssa_mt_ssb": (2, 1, 2),
    "dxpedition": (0, 0, 0), "general_logging": (0, 0, 0), "randomgram": (2, 0, 0),
    "qso_party_rst": (2, 1, 2), "qso_party_sn": (2, 1, 2), "ca_qso_party": (3, 1, 3),
    "canada_day": (2, 1, 2), "cqws": (7, 1, 7), "darc_schwaben": (5, 0, 5),
    "winter_field_day": (2, 1, 2), "agcw_qrp": (3, 1, 3),
    # RAEM: 50 + |48-40| + |17-(-74)|, as configured in the existing fixture.
    "raem": (115, 0, 115), "rda_contest": (10, 1, 10), "rdxc": (5, 1, 5),
    "rsgb_iota": (15, 1, 15),
    # Pinned grid distance/power arithmetic; native hardware acceptance is separate.
    "stew_perry_topband": (28, 0, 28), "ukeidx": (4, 2, 8), "wia_remembrance": (2, 0, 2),
    "cq_ww_vhf": (2, 1, 2), "darc_vhf": (443, 0, 443), "john_moyle_field_day": (2, 1, 2),
    "labre_rs_digi": (1, 1, 1), "nac_vhf": (943, 1, 943), "ta_vhf_uhf_contest": (886, 0, 886),
    "vhf_sprint": (1, 1, 1),
}
