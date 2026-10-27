"""Station sites and observational locator evidence under the session owner."""
from copy import copy, deepcopy
from datetime import datetime, UTC
import json
import re

PROFILES = frozenset({"arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep", "cq_ww_vhf", "darc_vhf", "nac_vhf", "ta_vhf_uhf_contest", "vhf_sprint", "ssa_mt_cw", "ssa_mt_ssb", "labre_rs_digi"})
GRID = re.compile(r"[A-R]{2}[0-9]{2}(?:[A-X]{2})?$")


def data(state):
    value = state.get("vhfSites", {"schema": 1, "currentSiteID": None, "sites": [], "beacons": []})
    if (not isinstance(value, dict) or value.get("schema") != 1 or not isinstance(value.get("sites"), list)
            or not isinstance(value.get("beacons"), list) or len(value["sites"]) > 500 or len(value["beacons"]) > 200):
        raise ValueError("Saved VHF site evidence is unreadable; preserve it before recovery")
    return deepcopy(value)


def projection(desk, params):
    from not1mm.lib.ham_utility import gridtolatlon, distance, bearing
    value = data(desk.state)
    current = next((site for site in value["sites"] if site["id"] == value["currentSiteID"]), None)
    locator = current["locator"] if current else str(desk.state["station"].get("GridSquare", "")).upper()
    def point(grid):
        if not isinstance(grid, str) or not GRID.fullmatch(grid):
            return None
        lat, lon = gridtolatlon(grid)
        return [lon, lat]
    now = datetime.now(UTC)
    for beacon in value["beacons"]:
        age = max(0, (now-datetime.fromisoformat(beacon["observedUTC"].replace("Z", "+00:00"))).total_seconds())
        beacon.update(coordinate=point(beacon["locator"]), ageSeconds=age, status="stale" if age > 86400 else "unverified",
                      worked=False, distanceKm=distance(locator, beacon["locator"]) if point(locator) and point(beacon["locator"]) else None,
                      headingDegrees=bearing(locator, beacon["locator"]) if point(locator) and point(beacon["locator"]) else None)
    for site in value["sites"]:
        site["coordinate"] = point(site["locator"])
        site["contacts"] = desk.database.exec_sql("SELECT count(*) AS n FROM xlog_qso_site s JOIN DXLOG d ON d.ID=s.qso_id WHERE json_extract(s.site,'$.id')=?", (site["id"],))["n"]
    return {**value, "available": desk.state["pluginID"] in PROFILES, "stationLocator": locator, "coordinate": point(locator),
            "locatorBasis": "explicit station site" if current else "configured station locator; current rover position not independently established"}


def mutate(desk, params, require, occupied):
    from .strategy import utc
    require(desk.state["pluginID"] in PROFILES, "Station sites require a supported grid contest definition")
    value = data(desk.state)
    action = params.get("action")
    if action == "site_activate":
        require(not occupied(), "Finish or park all occupied lane drafts before changing the station site", "occupied_draft")
        site_id, locator = params.get("siteID"), params.get("locator")
        require(isinstance(site_id, str) and re.fullmatch(r"[A-Za-z0-9-]{1,64}", site_id) is not None, "Invalid site identity")
        require(isinstance(locator, str) and GRID.fullmatch(locator) is not None, "Use a 4- or 6-character Maidenhead station locator")
        require(desk.state["pluginID"] not in {"darc_vhf", "nac_vhf", "ta_vhf_uhf_contest"} or len(locator) == 6, "This distance/EDI definition requires a 6-character site locator")
        existing = next((site for site in value["sites"] if site["id"] == site_id), None)
        require(existing is None, "Historical site records are immutable; create a new timestamped visit identity")
        require(len(value["sites"]) < 500, "Site history capacity reached")
        note, name = params.get("note", ""), params.get("name", "")
        require(all(isinstance(item, str) and len(item.encode()) <= limit and not any(ord(char) < 32 and char not in "\n\t" for char in item) for item, limit in ((note,4096),(name,128))), "Invalid site name/note")
        timestamp = utc(params.get("atUTC"))
        value["sites"].append({"id": site_id, "locator": locator, "name": name, "note": note, "atUTC": timestamp})
        value["currentSiteID"] = site_id
        desk.state["station"]["GridSquare"] = locator
        desk.station["GridSquare"] = locator
        desk.state["roverLocation"] = locator[:4] if desk.state["pluginID"] == "cq_ww_vhf" else locator
        desk.RoverLocation = desk.state["roverLocation"]
        if desk.state["pluginID"] in {"arrl_vhf_jan", "arrl_vhf_jun", "arrl_vhf_sep", "cq_ww_vhf", "vhf_sprint", "labre_rs_digi", "ssa_mt_cw", "ssa_mt_ssb"}:
            desk.state["settings"]["SentExchange"] = locator[:4]
            desk.contest_settings["SentExchange"] = locator[:4]
            if desk.state["pluginID"] not in {"ssa_mt_cw", "ssa_mt_ssb"}:
                desk.other_1.setText(locator[:4])
                for lane in desk.state.get("laneState", {}).get("lanes", {}).values():
                    lane["draft"]["fields"]["other_1"] = locator[:4]
    elif action == "transverter_save":
        from .lanes import attribution
        context=attribution(desk.state)
        require(context is not None and context["binding"] is not None, "Bind an explicit lane receiver before saving a transverter mapping")
        require(params.get("draftID")==desk.state["draft"]["id"], "Transverter draft changed", "stale_draft")
        mapping=params.get("mapping")
        require(isinstance(mapping,dict) and set(mapping)=={"band","loHz","inverted","ifLowHz","ifHighHz"}, "Invalid transverter mapping")
        require(type(mapping["inverted"]) is bool and isinstance(mapping["band"],str) and 0<len(mapping["band"])<=16, "Record band/orientation")
        try:
            require(float(mapping["band"])==desk.band(desk.state["draft"]["frequencyHz"]), "Mapping band differs from the current RF entry")
        except ValueError:
            require(False, "Use the authoritative numeric RF band identity")
        require(all(type(mapping[key]) is int for key in ("loHz","ifLowHz","ifHighHz")) and 0<=mapping["loHz"]<=7500000000000
                and 100000<=mapping["ifLowHz"]<=mapping["ifHighHz"]<=1000000000, "Mapping cannot widen provider IF capability")
        value.setdefault("mappings",{})[context["laneID"]]={"mapping":deepcopy(mapping),"binding":deepcopy(context["binding"]),"bindingVersion":context["bindingVersion"]}
    elif action == "beacon_add":
        require(len(value["beacons"]) < 200, "Beacon evidence capacity reached")
        beacon = params.get("beacon")
        require(isinstance(beacon, dict) and set(beacon) == {"id","callsign","locator","frequencyHz","source","observedUTC"}, "Beacon evidence requires identity/call/locator/frequency/source/date")
        require(isinstance(beacon["id"], str) and re.fullmatch(r"[A-Za-z0-9-]{1,64}",beacon["id"]) is not None and not any(row["id"]==beacon["id"] for row in value["beacons"]), "Repeated or invalid beacon identity")
        require(isinstance(beacon["callsign"],str) and re.fullmatch(r"[A-Z0-9/]{3,32}",beacon["callsign"]) is not None, "Invalid beacon call")
        require(isinstance(beacon["locator"],str) and (not beacon["locator"] or GRID.fullmatch(beacon["locator"]) is not None), "Unknown locator must be empty; otherwise use a valid grid")
        require(type(beacon["frequencyHz"]) is int and 100000 <= beacon["frequencyHz"] <= 7500000000000, "Invalid beacon RF frequency")
        require(isinstance(beacon["source"],str) and 1 <= len(beacon["source"].encode()) <= 512 and not any(ord(c)<32 for c in beacon["source"]), "Record the beacon source")
        beacon=deepcopy(beacon);beacon["observedUTC"]=utc(beacon["observedUTC"])
        require(datetime.fromisoformat(beacon["observedUTC"].replace("Z","+00:00")) <= datetime.now(UTC), "Beacon evidence date is in the future")
        value["beacons"].append(beacon)
    else:
        require(False, "Unsupported VHF evidence action")
    desk.state["vhfSites"] = value
    return projection(desk, params)


def bind_contact(store, state, qso_id):
    value = data(state)
    site = next((item for item in value["sites"] if item["id"] == value["currentSiteID"]), None)
    if site:
        store.conn.execute("INSERT INTO xlog_qso_site VALUES(?,?)", (qso_id,json.dumps(site,sort_keys=True,separators=(",",":"))))


def edi_scope(desk, site_id, require):
    """Existing EDI writer over explicit immutable site rows, never the live log."""
    rows = desk.database.fetch_all_contacts_asc()
    known = {row["qso_id"]: json.loads(row["site"]) for row in desk.database.exec_sql_mult("SELECT * FROM xlog_qso_site")}
    if site_id is not None:
        require(isinstance(site_id,str), "Invalid EDI site identity")
        rows = [row for row in rows if known.get(row["ID"],{}).get("id")==site_id]
        require(bool(rows), "The selected site has no attributed contacts")
    historical = {str(row.get("MiscText") or "").upper() for row in rows if desk.state["pluginID"] in {"darc_vhf","nac_vhf","ta_vhf_uhf_contest"}}
    historical |= {known[row["ID"]]["locator"] for row in rows if row["ID"] in known}
    require(len(historical) <= 1, "EDI has one station locator: review and export each historical site separately", "edi_mixed_sites")
    scoped = copy(desk)
    scoped.state = deepcopy(desk.state)
    scoped.station = deepcopy(desk.station)
    if historical:
        grid = next(iter(historical))
        require(GRID.fullmatch(grid) is not None, "Historical station locator is unknown; EDI cannot guess it")
        scoped.station["GridSquare"] = grid
    class Rows:
        def fetch_all_contacts_asc(self): return deepcopy(rows)
        def fetch_points(self): return {"Points":sum(row["Points"] or 0 for row in rows)}
        def fetch_qso_count(self): return {"qsos":len(rows)}
        def __getattr__(self,name): return getattr(desk.database,name)
    scoped.database = Rows()
    return scoped
