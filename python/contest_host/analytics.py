"""Bounded, ephemeral analytical copies. The live store remains the only writer."""
from datetime import datetime, UTC
import hashlib
import json
import math
import time
import uuid
from .multipliers import (project as multiplier_dimensions, needed_views, dimensions, _global_countries,
                          validate_multiplier_universe, COUNTRY_UNIVERSE_REFERENCE)
from .plugins import ARRL_VHF_PLUGINS, SSA_MT_PLUGINS, NO_MULTIPLIER_PLUGINS, TEN_TEN_PLUGINS
from .statistics_dupes import duplicate_flags

MAX_CONTACTS = 50000
PAGE_SIZE = 500

PRODUCT_HISTORY = frozenset("""cq_ww_cw cq_ww_ssb cq_ww_rtty cq_wpx_cw cq_wpx_ssb cq_wpx_rtty
arrl_ss_cw arrl_ss_phone arrl_dx_cw arrl_dx_ssb naqp_cw naqp_ssb naqp_rtty phone_weekly_test weekly_rtty
icwc_mst cwt cwo k1usn_sst oceania_dx_cw oceania_dx_ssb sac_cw sac_ssb iaru_fieldday_r1_cw iaru_fieldday_r1_ssb
jidx_cw jidx_ph aadx_cw aadx_ssb cq_160_cw cq_160_ssb euhfc iaru_hf arrl_10m arrl_160m arrl_field_day arrl_rtty_ru
arrl_vhf_jan arrl_vhf_jun arrl_vhf_sep ea_majestad_cw ea_majestad_ssb ref_cw ref_ssb helvetia ari_dx darc_xmas
eudx lz-dx wag ari_40_80 ea_rtty ok1wc ssa_mt_cw ssa_mt_ssb qso_party_rst qso_party_sn ca_qso_party agcw_qrp
rda_contest rdxc ukeidx cq_ww_vhf john_moyle_field_day labre_rs_digi vhf_sprint""".split())
ADDITIVE_HISTORY = (NO_MULTIPLIER_PLUGINS - {"dxpedition", "general_logging", "randomgram", "raem"}) | TEN_TEN_PLUGINS | {"rsgb_80m_cc", "rsgb_commonwealth_beru", "nac_vhf"}


def aadx_history(rows,state,score,desk):
    """Linear model of the pinned rebuild, including its shared-last-dupe flag.

    This describes the current engine; it does not repair/replace its multiplier
    policy. Original SQLite and draft widgets are never changed.
    """
    model='aadx-pinned-prefix-rebuild'
    unavailable=lambda reason:({'status':'UNVERIFIED','reason':reason,'model':model},{})
    own=state['reference']['countries'].get(state['station']['Call'])
    if not own:return unavailable('Station entity is unresolved; AADX branch cannot be established.')
    asian=own['continent']=='AS';points,count,events=0,0,{}
    seen,earliest=set(),{}
    saved_contact,saved_dupe=desk.contact,desk.contact_is_dupe
    try:
        for row in rows:
            try:datetime.strptime(row['TS'],'%Y-%m-%d %H:%M:%S')
            except (ValueError,TypeError):return unavailable('Invalid UTC prevents prefix reconstruction.')
            value=finite(row.get('Points'));country=state['reference']['countries'].get(row['Call'])
            if value is None or not country:return unavailable('Stored points or historical entity evidence is missing.')
            dupe_key=(row['Call'],row['Band']);dupe=dupe_key in seen;seen.add(dupe_key)
            desk.contact=row;desk.contact_is_dupe=0
            intrinsic=desk.contest.points(desk)
            key=(row['CountryPrefix'] if asian else row['WPXPrefix'],row['Band'])
            first=earliest.setdefault(key,row['TS'])
            if first==row['TS'] and (country['entity'].upper()!=own['entity'].upper() if asian else intrinsic>0):count+=1
            points+=value
            events[row['ID']]=points*(count if asian or not dupe else 0)
    finally:desk.contact,desk.contact_is_dupe=saved_contact,saved_dupe
    if points!=score['points'] or abs(next(reversed(events.values()),0)-score['total'])>1e-8:
        return unavailable('Pinned prefix arithmetic does not reconcile with the current authoritative score.')
    return ({'status':'PASS','model':model,'initialScore':0,'reason':'Corrected-log reconstruction of the pinned AADX rebuild, including non-Asian prefix multiplier reset when the final contact is a duplicate; not the historical operator display or sponsor certification.'},events)


def score_history(rows, state, score, support, available, desk):
    """Corrected-log events from explicit pinned arithmetic, never a universal product."""
    plugin, marked = state["pluginID"], state.get("scoringRevision") == "26.10.26"
    kind, factor = None, 1
    if plugin in ADDITIVE_HISTORY: kind = "stored-points"
    elif plugin == "ca_qso_party": kind = "points-times-capped-identities"
    elif plugin in PRODUCT_HISTORY: kind = "points-times-credited-identities"
    elif plugin in {"hadx", "pacc", "rsgb_iota", "es_open", "cqws"}:
        kind = "points-times-credited-identities" if marked else "points-times-identities-plus-one"
    elif plugin in {"es_field_day", "es_ll_kv"}: kind = "points-times-identities-plus-one"
    elif plugin == "es_manual_key": kind = "points-plus-seniority-times-identities-plus-one"
    elif plugin in {"spdx", "canada_day"}: kind = "points-times-at-least-one-identity"
    elif plugin == "winter_field_day":
        kind, factor = "points-times-credited-identities", 2 if state["settings"].get("PowerCategory") == "QRP" else 1
    elif plugin == "raem":
        kind, factor = "station-latitude-factor", desk.contest.show_mults(desk)
    elif plugin == "trans_tasman": kind = "sum-of-utc-block-products"
    reason = "Corrected category log reconstruction; not an immutable record of what the operator saw."
    unavailable = lambda message: ({"status": "UNVERIFIED", "reason": message, "model": kind}, {})
    if kind is None:
        if plugin.startswith("wae_"):
            return unavailable("WAE score includes the separate QTC journal; QSO-only chronological growth is not a verified history model.")
        return ({"status": "NOT APPLICABLE", "reason": "Utility definition has no contest claimed-score history.", "model": None}, {})
    if score.get("scoringComplete") is False:
        return unavailable("The host reports incomplete scoring; score growth is unavailable until the missing evidence is established.")
    if plugin in {'aadx_cw','aadx_ssb'}:
        return aadx_history(rows,state,score,desk)
    if kind not in {"stored-points", "station-latitude-factor"} and not available:
        return unavailable("Credited identities do not reconcile; score growth is unavailable.")
    bonus = 0
    if kind == "points-plus-seniority-times-identities-plus-one":
        try: bonus = 3 * int(str(state["station"].get("LicenseClass", "")).strip()[:2])
        except ValueError: bonus = 3
        reason += f" Initial station-seniority score is {bonus}; contact growth excludes that baseline."
    points, keys, events, blocks = 0, set(), {}, {}
    owners = set()
    for row in rows:
        value = finite(row.get("Points"))
        try: datetime.strptime(row["TS"], "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError): return unavailable("Invalid timestamp prevents chronological score reconstruction.")
        if value is None: return unavailable("Missing/nonfinite stored points prevent score reconstruction.")
        if desk.contest.dupe_type in {1, 2, 3}:
            mode = str(row.get("Mode") or "")
            mode = "PH" if mode in {"LSB", "USB", "SSB", "FM", "AM"} else "CW" if mode.startswith("CW") else "DI" if mode in {"FT8", "FT4", "RTTY", "PSK31", "FSK441", "MSK144", "JT65", "JT9", "Q65", "PKTUSB", "PKTLSB"} else "OTHER"
            key = (row["Call"],) if desk.contest.dupe_type == 1 else (row["Call"], row["Band"])
            if desk.contest.dupe_type == 3: key += (mode,)
            if row.get("host_dupe") is True and key not in owners:
                return unavailable("A backdated duplicate precedes its stored scoring owner; chronological prefix growth cannot be established without replay.")
            if row.get("host_dupe") is False: owners.add(key)
        points += value
        keys.update(support.get(row["ID"], []))
        count = len(keys)
        if kind == "stored-points": total = points
        elif kind == "station-latitude-factor": total = points * factor
        elif kind == "sum-of-utc-block-products":
            if value > 0 and str(row.get("WPXPrefix") or "").startswith(("VK", "ZL", "ZK", "ZM")):
                block = desk.contest._block_from_ts(row["TS"])
                units, identities = blocks.setdefault(block, [0, set()])
                blocks[block][0] = units + 1
                identities.add((row["Band"], row["WPXPrefix"]))
            total = sum(units * len(identities) for units, identities in blocks.values())
        else: total = (points + bonus) * (count + 1 if kind in {"points-times-identities-plus-one", "points-plus-seniority-times-identities-plus-one"} else max(1, count) if kind == "points-times-at-least-one-identity" else min(58, count) if kind == "points-times-capped-identities" else count) * factor
        events[row["ID"]] = total
    total = next(reversed(events.values()), bonus)
    if points != score["points"] or abs(total - score["total"]) > 1e-8:
        return unavailable("Reconstructed points/score do not reconcile with the current plugin total.")
    return ({"status": "PASS", "reason": reason, "model": kind, "factor": factor, "initialScore": bonus, "constantBonus": bonus,
             **({"identityCap": 58} if kind == "points-times-capped-identities" else {})}, events)


def feature_statuses(state, score, available, history, needed):
    no_identities = state["pluginID"] in NO_MULTIPLIER_PLUGINS or state["pluginID"] in TEN_TEN_PLUGINS or state["pluginID"] in {"rsgb_80m_cc", "rsgb_commonwealth_beru"}
    return {"multiplierAcquisition": {"status": "PASS" if available else "NOT APPLICABLE" if no_identities else "UNVERIFIED",
                "reason": "Credited keys reconcile with the host multiplier total." if available else "This definition has no acquired multiplier identity." if no_identities else "A reconciled identity adapter is not available for this configuration."},
            "scoreHistory": history,
            "neededUniverse": {"status": "PASS" if any(view["status"] == "PASS" for view in needed) else "NOT APPLICABLE" if no_identities or needed and all(view["status"] == "NOT APPLICABLE" for view in needed) else "UNVERIFIED",
                "reason": "Only the explicitly identified finite dimensions/reference scopes are enumerated; inspect each dimension's provenance and unavailable dimensions." if needed else "No finite eligible Needed universe is supplied for this definition."},
            "candidateNeeded": {"status": "PASS" if state['pluginID'] in {'cq_ww_cw','cq_ww_ssb'} and available else "NOT APPLICABLE" if no_identities else "UNVERIFIED",
                "reason": "Bounded analytical adapter: explicitly selected saved contact supplies country evidence; proposed band/received zone/points remain assumptions. Unknown new calls/exchanges stay unverified. Existing live station preview is separate." if state['pluginID'] in {'cq_ww_cw','cq_ww_ssb'} and available else "This analytical copy contains no verified candidate adapter; existing station-owned spot preview is separate."}}


def identity(store, state):
    # Draft revisions deliberately do not invalidate an analytical copy.
    audit = store.exec_sql("SELECT coalesce(max(sequence),0) AS seq FROM xlog_qso_audit")["seq"]
    count = store.exec_sql("SELECT count(*) AS n FROM DXLOG WHERE ContestNR=?", (store.current_contest,))["n"]
    source = {"audit": audit, "count": count, "plugin": state["pluginID"],
              "settings": state["settings"], "station": state["station"], "reference": state["reference"]["id"]}
    coordinate = state["reference"].get("multiplierUniverse")
    if isinstance(coordinate, dict):
        source["multiplierUniverse"] = {key: coordinate.get(key) for key in ("referenceID", "sourceSHA256", "entriesSHA256")}
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def contact(row, band_labels, score_band, cq_ww, plugin_id="", received_cq_zone=False):
    country = json.loads(row["country_identity"]) if row.get("country_identity") else {}
    country = country or {}
    band = finite(row.get("Band"))
    style = str(row.get("IsRunQSO", "")).strip()
    zone = finite(row.get("NR") if received_cq_zone else row.get("ZN"))
    # GridSquare is the SENT locator in SSA MT; the received locator belongs to
    # Exchange1 there and in the serial/distance families, and NR in ARRL VHF.
    grid_field = ("Exchange1" if plugin_id in {*SSA_MT_PLUGINS, "darc_vhf", "nac_vhf", "ta_vhf_uhf_contest", "stew_perry_topband"}
                  else "NR" if plugin_id in {*ARRL_VHF_PLUGINS, "cq_ww_vhf", "labre_rs_digi", "vhf_sprint"} else None)
    return {"id": row["ID"], "sourceOrder": row["source_order"], "call": row["Call"], "utc": row["TS"],
            "band": band_labels.get(band, "Unknown"), "frequencyKHz": finite(row.get("Freq")),
            "mode": str(row.get("Mode") or "Unknown"), "operator": str(row.get("Operator") or "Unknown"),
            "style": "Run" if style == "1" else "S&P" if style == "0" else "Unknown",
            "country": str(row.get("CountryPrefix") or "Unknown"),
            "countryName": str(country.get("entity") or row.get("CountryPrefix") or "Unknown"),
            "continent": str(country.get("continent") or row.get("Continent") or "Unknown"),
            "zone": str(int(zone)) if (cq_ww or plugin_id == "cq_ww_rtty" or received_cq_zone) and zone is not None and zone.is_integer() and 1 <= zone <= 40 else "Unknown",
            "section": str(row.get("Sect") or "Unknown"),
            "state": str(row.get("Exchange1") or "Unknown") if plugin_id == "cq_ww_rtty" else
                     str(row.get("NR") or "Unknown") if plugin_id in {"arrl_dx_cw", "arrl_dx_ssb"} and str(row.get("NR", "")).isalpha() else "Unknown",
            "ituZone": str(row["ZN"]) if plugin_id == "iaru_hf" and isinstance(row.get("ZN"), int) else "Unknown",
            "hq": str(row["ZN"]) if plugin_id == "iaru_hf" and not isinstance(row.get("ZN"), int) else "Unknown",
            "grid": str(row.get(grid_field) or "Unknown") if grid_field else "Unknown",
            "creditedKeys": row.get("credited_keys", []),
            "hostDupe": row.get("host_dupe"), "claimedScore": row.get("claimed_score"),
            "prefix": str(row.get("WPXPrefix") or "Unknown"),
            "points": finite(row.get("Points")),
            "multiplierEligible": row.get("multiplier_eligible") if cq_ww else None,
            "inCategory": score_band is None or band == score_band}


class AnalyticsCopies:
    def __init__(self):
        self.copies = {}

    def read(self, store, state, params, desk_factory, band_labels, require):
        allowed = {"sessionID", "workspaceGeneration", "action", "snapshotID", "offset", "limit", "multiplierUniverse"}
        require(set(params) <= allowed, "Unexpected analytics parameters")
        action = params.get("action")
        require(action in {"prepare", "page", "check", "release"}, "Unknown analytics read")
        self.copies = {key: value for key, value in self.copies.items() if value["expires"] > time.monotonic()}
        if action == "prepare":
            required = {"sessionID", "workspaceGeneration", "action"}
            require(set(params) in (required, required | {"multiplierUniverse"}), "Invalid analytics snapshot request")
            require("multiplierUniverse" not in params or isinstance(params["multiplierUniverse"], dict), "Invalid analytics reference context")
            request_universe = validate_multiplier_universe(params.get("multiplierUniverse"), COUNTRY_UNIVERSE_REFERENCE, require)
            store.conn.execute("BEGIN")
            try:
                state = store.state(params["sessionID"])
                token = identity(store, state)
                desk = desk_factory(state)
                score = desk.score()
                analytical_state, coordinate_source = state, "session"
                if ("multiplierUniverse" not in state["reference"] and request_universe is not None
                        and request_universe["referenceID"] == state["reference"]["id"]):
                    # The immutable copy alone gains context. The base identity,
                    # live state, scoring desk and page invalidation stay pinned
                    # to the stored log; this is not a session migration.
                    analytical_state = {**state, "reference": {**state["reference"], "multiplierUniverse": request_universe}}
                    coordinate_source = "verified-request"
                score_band = desk.database.score_band
                rows = store.exec_sql_mult(
                    "SELECT d.rowid AS source_order,d.*,i.country AS country_identity "
                    "FROM DXLOG AS d LEFT JOIN xlog_qso_identity AS i ON i.id=d.ID "
                    "WHERE d.ContestNR=? ORDER BY d.TS,d.rowid LIMIT ?", (store.current_contest, MAX_CONTACTS + 1))
                require(len(rows) <= MAX_CONTACTS, "Analytics supports up to 50,000 contacts in one contest.")
                metadata = {"sessionID": params["sessionID"], "workspaceGeneration": params["workspaceGeneration"],
                            "revision": state["revision"], "identity": token, "pluginID": state["pluginID"],
                            "name": state.get("name") or desk.contest.name,
                            "stationCall": state["station"]["Call"], "settings": state["settings"],
                            "referenceID": state["reference"]["id"], "sourceRevision": state.get("sourceRevision", ""),
                            "score": score, "dupeType": desk.contest.dupe_type,
                            "cqWW": state["pluginID"] in {"cq_ww_ssb", "cq_ww_cw"},
                            "capturedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
                copied = [row for row in rows if score_band is None or row["Band"] == score_band]
                views, support, available = multiplier_dimensions(copied, analytical_state, score, band_labels)
                metadata["multiplierAdapter"] = available
                metadata["multiplierSupportBasis"] = "stored-credit-flags" if any(d.criterion.startswith("flag") for d in dimensions(state)) else "eligible-identities"
                metadata["hostEvidence"] = True
                if isinstance(coordinate := analytical_state["reference"].get("multiplierUniverse"), dict):
                    metadata["multiplierUniverseReference"] = {key: coordinate.get(key) for key in ("schema", "referenceID", "source", "sourceSHA256", "entriesSHA256")}
                    metadata["multiplierUniverseReference"].update(compatible=_global_countries(analytical_state) is not None,
                                                                  coordinateSource=coordinate_source)
                flags = {row["ID"]: flag for row, flag in zip(sorted(rows, key=lambda row: row["source_order"]), duplicate_flags(desk, sorted(rows, key=lambda row: row["source_order"])))}
                for row in rows: row["host_dupe"] = flags[row["ID"]]
                history, events = score_history(copied, state, score, support, available, desk)
                metadata["scoreHistory"] = history
                metadata["neededViews"] = needed_views(copied, analytical_state, views, band_labels)
                if score.get("scoringComplete") is False:
                    for view in metadata["neededViews"]:
                        view.update(status="UNVERIFIED", reason="Incomplete scoring may conceal worked identities; Needed cannot be established from this lower bound.", rows=[])
                metadata["analyticsCapabilities"] = feature_statuses(state, score, available, history, metadata["neededViews"])
                for row in rows:
                    row["credited_keys"] = support.get(row["ID"], [])
                    row["host_dupe"], row["claimed_score"] = flags[row["ID"]], events.get(row["ID"])
            finally:
                store.conn.rollback()
            # No live SQLite read lock is held while serializing the copied rows.
            # Match Store.cq_ww_multiplier_filter's original row-order eligibility,
            # including zero-point domestic QSOs. Do not infer credit from flags.
            seen = set()
            for row in sorted(rows, key=lambda row: row["source_order"]):
                duplicate_key = (row["Call"], row["Band"])
                row["multiplier_eligible"] = bool(row["CountryPrefix"]) and duplicate_key not in seen
                seen.add(duplicate_key)
            received_zone = state["pluginID"] in {"jidx_cw", "jidx_ph"} and state.get("scoringRevision") == "26.10.26" and any(d.id == "zone" for d in dimensions(state))
            normalized = [contact(row, band_labels, score_band, metadata["cqWW"], state["pluginID"], received_zone) for row in rows]
            key = str(uuid.uuid4())
            while len(self.copies) >= 2:
                del self.copies[next(iter(self.copies))]
            self.copies[key] = {"meta": metadata, "rows": normalized, "expires": time.monotonic() + 900}
            return {**metadata, "snapshotID": key, "total": len(rows)}
        key = params.get("snapshotID")
        value = self.copies.get(key) if isinstance(key, str) else None
        required = {"sessionID", "workspaceGeneration", "action", "snapshotID"}
        require(set(params) == required | ({"offset", "limit"} if action == "page" else set()),
                "Invalid analytics read parameters")
        require(value is not None, "Analytics snapshot expired. Refresh analytics.", "stale_snapshot")
        require(value["meta"]["sessionID"] == params["sessionID"]
                and value["meta"]["workspaceGeneration"] == params["workspaceGeneration"], "Analytics session changed", "stale_context")
        if action == "release":
            del self.copies[key]
            return {"released": True}
        if action == "check":
            value["expires"] = time.monotonic() + 900
            return {"current": identity(store, state) == value["meta"]["identity"], "identity": value["meta"]["identity"]}
        offset, limit = params.get("offset"), params.get("limit")
        require(type(offset) is int and 0 <= offset <= len(value["rows"])
                and type(limit) is int and 1 <= limit <= PAGE_SIZE, "Invalid analytics page")
        value["expires"] = time.monotonic() + 900
        return {"snapshotID": key, "identity": value["meta"]["identity"], "offset": offset,
                "total": len(value["rows"]), "rows": value["rows"][offset:offset + limit]}
