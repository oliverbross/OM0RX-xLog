"""Read-only explanation of existing plugin preview; no alternative scorer."""
from .multipliers import project


def details(store, state, contact, before_score, after_score, band_labels):
    rows = store.exec_sql_mult("SELECT rowid AS source_order,* FROM DXLOG WHERE ContestNR=? ORDER BY TS,rowid", (store.current_contest,))
    before, _, before_ok = project([row for row in rows if row["ID"] != contact["ID"]], state, before_score, band_labels)
    after, _, after_ok = project(rows, state, after_score, band_labels)
    keys = []
    if before_ok and after_ok:
        worked = {(view["id"], row["value"], row["scope"]) for view in before for row in view["rows"]}
        keys = [{"dimension": view["id"], "label": view["label"], "value": row["value"], "scope": row["scope"]}
                for view in after for row in view["rows"] if (view["id"], row["value"], row["scope"]) not in worked]
    complete = before_score.get("scoringComplete") is not False and after_score.get("scoringComplete") is not False
    return {"conditionalScoreGain": max(0, after_score["total"] - before_score["total"]) if complete else None,
            "newDimensions": keys, "dimensionsVerified": before_ok and after_ok}


def explain(results):
    for row in results:
        row.setdefault("conditionalScoreGain", 0 if row["dupe"] is True else None)
        row.setdefault("newDimensions", [])
        row.setdefault("dimensionsVerified", False)
        row.setdefault("inferredExchange", {})
        row["valueBasis"] = "Conditional on a valid completed exchange and committed QSO; never guaranteed or probability weighted."
        row["exchangeProvenance"] = "Plugin defaults and pinned CTY inference; not heard exchange. Unknown fields remain unknown."
    return results
