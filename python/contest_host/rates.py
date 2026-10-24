"""Rates over the complete Python-owned log, independent of display pagination."""
from datetime import datetime, timedelta, UTC


def timestamp(value):
    """Not1MM naive timestamps are UTC; also accept ISO fractions and offsets."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except (ValueError, OverflowError):
        return None


def calculate_rates(rows, at):
    timed = [(timestamp(row["TS"]), row["ID"],
              {"1": "run", "0": "sp"}.get(str(row.get("IsRunQSO", "")).strip(), "unknown")) for row in rows]
    past = sorted((stamp, identity, run) for stamp, identity, run in timed if stamp is not None and stamp <= at)
    hour = [(stamp, identity, run) for stamp, identity, run in past if stamp >= at - timedelta(hours=1)]
    hour_start = at.replace(minute=0, second=0, microsecond=0)
    current_hour = [row for row in past if row[0] >= hour_start]

    def sample_rate(size):
        if len(past) < size:
            return None
        seconds = (past[-1][0] - past[-size][0]).total_seconds()
        return size * 3600 / seconds if seconds > 0 else None

    # A bounded UTC timeline includes quiet hours instead of joining distant
    # contacts into adjacent chart bars. Future/invalid timestamps are excluded.
    hourly = []
    if past:
        first_hour = max(past[0][0].replace(minute=0, second=0, microsecond=0),
                         hour_start - timedelta(hours=167))
        counts = {}
        for stamp, _, _ in past:
            bucket = stamp.replace(minute=0, second=0, microsecond=0)
            if bucket >= first_hour:
                counts[bucket] = counts.get(bucket, 0) + 1
        bucket = first_hour
        while bucket <= hour_start:
            hourly.append({"hourUTC": bucket.isoformat().replace("+00:00", "Z"),
                           "qsos": counts.get(bucket, 0)})
            bucket += timedelta(hours=1)
    return {"lastHourQsoPerHour": len(hour),
            "last10QsoPerHour": sample_rate(10), "last100QsoPerHour": sample_rate(100),
            "sinceHourUTC": hour_start.hour, "sinceHourQso": len(current_hour),
            "runQso": sum(run == "run" for _, _, run in past),
            "searchAndPounceQso": sum(run == "sp" for _, _, run in past),
            "unknownStyleQso": sum(run == "unknown" for _, _, run in past),
            "invalidTimestampQso": sum(stamp is None for stamp, _, _ in timed),
            "hourRunQso": sum(run == "run" for _, _, run in current_hour),
            "hourSearchAndPounceQso": sum(run == "sp" for _, _, run in current_hour),
            "hourly": hourly,
            "lastQsoAt": past[-1][0].isoformat().replace("+00:00", "Z") if past else None}
