"""Read-only historical duplicate evidence for Statistics, using the pinned rules."""


def duplicate_flags(desk, rows):
    """Yield flags in source order without replaying or changing any stored QSO."""
    dupe_type = desk.contest.dupe_type
    seen = set()
    for row in rows:
        if dupe_type == 4:
            yield False
        elif dupe_type in (1, 2, 3):
            call = row.get("Call")
            # Match the existing CQ WW log's historical duplicate projection.
            if desk.state["pluginID"] in {"cq_ww_ssb", "cq_ww_cw"}:
                call = str(call or "").strip().upper()
            key = (call,) if dupe_type == 1 else (call, row.get("Band"))
            if dupe_type == 3:
                mode = str(row.get("Mode") or "")
                group = ("PH" if mode in {"LSB", "USB", "SSB", "FM", "AM"} else
                         "CW" if mode in {"CW", "CW-U", "CW-L", "CWR", "CW-R"} else
                         "DI" if mode in {"FT8", "FT4", "RTTY", "PSK31", "FSK441", "MSK144",
                                          "JT65", "JT9", "Q65", "PKTUSB", "PKTLSB"} else "OTHER")
                # The pinned query uses SQL LIKE 'CW%' for stored rows, but
                # explicit aliases for the incoming mode. Preserve both sides.
                stored_key = key + ("CW" if mode.upper().startswith("CW") else group,)
                key += (group,)
            else:
                stored_key = key
            yield bool(call) and key in seen
            seen.add(stored_key)
        else:
            # Special rules own their time blocks/mode/rover semantics. Restrict
            # their SQL to prior rows rather than counting the row itself/future.
            original_database, original_rover = desk.database, desk.RoverLocation
            desk.database = _PriorRows(original_database, row)
            desk.RoverLocation = str(row.get("RoverLocation", ""))
            if desk.state["pluginID"] == "cq_ww_vhf":
                desk.RoverLocation = str(row.get("RoverLocation") or row.get("SentNr") or "")
            try:
                duplicate = (None if desk.state["pluginID"] == "cq_ww_vhf" and not desk.RoverLocation else
                             desk.is_dupe(row["Call"], row["Band"], row["TS"], row["Mode"]))
            except (ValueError, TypeError, KeyError):
                duplicate = None  # Incomplete historical time/rover evidence is not zero dupes.
            finally:
                desk.database, desk.RoverLocation = original_database, original_rover
            yield duplicate


class _PriorRows:
    def __init__(self, database, row):
        self.database, self.row = database, row

    def exec_sql(self, query, params=()):
        return self.database.exec_sql(
            "WITH DXLOG AS (SELECT * FROM main.DXLOG WHERE TS<? OR (TS=? AND rowid<?)) " + query,
            (self.row["TS"], self.row["TS"], self.row["source_order"], *params))

    def __getattr__(self, name):
        value = getattr(self.database, name)
        # Database check_dupe_* helpers must call this proxy's restricted SQL.
        return value.__func__.__get__(self) if name.startswith("check_dupe") else value
