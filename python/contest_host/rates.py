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
    timed = [(timestamp(row["TS"]), row["ID"], str(row["IsRunQSO"]).strip() == "1") for row in rows]
    past = sorted((stamp, identity, run) for stamp, identity, run in timed if stamp is not None and stamp <= at)
    hour = [(stamp, identity, run) for stamp, identity, run in past if stamp > at - timedelta(hours=1)]
    hour_start = at.replace(minute=0, second=0, microsecond=0)
    current_hour = [row for row in past if row[0] > hour_start]
    valid = all(stamp is not None for stamp, _, _ in timed)

    def sample_rate(size):
        if not valid or len(past) < size:
            return None
        seconds = (past[-1][0] - past[-size][0]).total_seconds()
        return size * 3600 / seconds if seconds > 0 else None

    hour_seconds = (hour[-1][0] - hour[0][0]).total_seconds() if len(hour) > 1 else 0
    hour_rate = len(hour) * 3600 / hour_seconds if hour_seconds > 0 else (1 if len(hour) == 1 else None)
    return {"lastHourQsoPerHour": hour_rate if valid else None,
            "last10QsoPerHour": sample_rate(10), "last100QsoPerHour": sample_rate(100),
            "sinceHourUTC": hour_start.hour, "sinceHourQso": len(current_hour),
            "runQso": sum(run for _, _, run in past),
            "searchAndPounceQso": sum(not run for _, _, run in past),
            "hourRunQso": sum(run for _, _, run in current_hour),
            "hourSearchAndPounceQso": sum(not run for _, _, run in current_hour)}
