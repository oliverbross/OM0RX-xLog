"""Read-only submission checks and exact-byte provenance, using existing writers."""
import hashlib


def submission_preflight(desk, export_format, filename, payload):
    state, store = desk.state, desk.database
    settings = state["settings"]
    extent = store.exec_sql("SELECT count(*) AS count,min(TS) AS firstUTC,max(TS) AS lastUTC FROM DXLOG WHERE ContestNR=?",
                            (store.current_contest,))
    other_band = store.exec_sql("SELECT count(*) AS count FROM DXLOG WHERE ContestNR=? AND Band<>?",
                                (store.current_contest, desk.band(state["draft"]["frequencyHz"])))["count"]
    score = desk.score()
    checks = []

    def check(key, status, message):
        checks.append({"id": key, "status": status, "message": message})

    check("entrant", "ready" if state["station"].get("Call") else "missing", "Entrant: " + str(state["station"].get("Call", "Unknown")))
    check("category", "review", " / ".join(str(settings.get(key, "Unknown")) for key in (
        "OperatorCategory", "AssistedCategory", "BandCategory", "PowerCategory", "ModeCategory", "TransmitterCategory")))
    check("exchange", "ready" if settings.get("SentExchange") else "review", "Configured sent exchange: " + str(settings.get("SentExchange", "Unknown")))
    check("utc", "review", f'{extent["count"]} contacts · UTC {extent["firstUTC"] or "—"} to {extent["lastUTC"] or "—"}. Confirm the event edition and period before submission.')
    band_category = str(settings.get("BandCategory", "ALL")).upper()
    check("bands", "review", f'{other_band} contacts outside the current draft band. Declared category: {band_category}. No records are removed by this review.')
    check("score", "limited" if score.get("scoringComplete") is False else "ready",
          str(score.get("scoringLimitation") or "Known score is partial; retain the contest limitation.") if score.get("scoringComplete") is False
          else "Plugin scoring is available; fixture acceptance does not certify current organizer rules.")
    check("rules", "unverified", "Organizer rule edition and submission acceptance require operator verification.")
    check("practice", "limited" if state.get("practice") else "ready",
          "Practice log — native output and public posting disabled. Do not submit as a real contest entry." if state.get("practice") else "Operating log; export alone does not establish Submitted.")
    manifest = {
        "schemaVersion": 1, "sessionID": state["sessionID"], "workspaceGeneration": state["workspaceGeneration"],
        "logRevision": state["revision"], "pluginID": state["pluginID"], "sourceRevision": state["sourceRevision"],
        "scoringRevision": state.get("scoringRevision"), "referenceID": state["reference"]["id"],
        "ruleEdition": "operator verification required", "format": export_format, "filename": filename,
        "byteLength": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
        "contacts": extent, "category": {key: value for key, value in settings.items() if key.endswith("Category")},
        "sentExchange": settings.get("SentExchange"), "scoringComplete": score.get("scoringComplete", True),
        "practice": bool(state.get("practice")), "submissionStatus": "not-submitted",
    }
    return {"sessionID": state["sessionID"], "workspaceGeneration": state["workspaceGeneration"],
            "revision": state["revision"], "checks": checks, "manifest": manifest}
