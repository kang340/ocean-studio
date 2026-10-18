"""ISO 8601 instants shared by requests, subsets and visualisation.

Gregorian instants are converted to UTC. Model calendars (360_day, noleap, ...) also contain dates that the
proleptic Gregorian calendar rejects, e.g. 2001-02-30; those are validated by format and component range only and
kept calendar-local, so CFTimeIndex can interpret them by the file's own calendar.
"""
import re
from datetime import datetime, timezone

_ERR = '时间格式无效，请使用有效的 ISO 8601 日期或时间（如 2026-10-15T00:00:00Z）'
_ISO = re.compile(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$', re.I)


def parse_utc(value: str, *, end_of_day: bool = False) -> datetime:
    """Interpret timezone-free values as UTC; optionally include a date's full day."""
    try:
        instant = datetime.fromisoformat(value)
        if end_of_day and len(value) == 10:
            instant = instant.replace(hour=23, minute=59, second=59)
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=timezone.utc)
        return instant.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(_ERR) from exc


def calendar_fields(value: str, *, end_of_day: bool = False) -> tuple[int, int, int, int, int, int]:
    """(Y, M, D, h, m, s) of a calendar-local ISO value checked by format and range only (any CF calendar).

    A UTC offset other than zero is refused here: shifting it would need the file's calendar to roll the day over.
    """
    m = _ISO.match(str(value).strip()) if value is not None else None
    if not m: raise ValueError(_ERR)
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    hh, mi, ss = (int(m[4]), int(m[5]), int(m[6] or 0)) if m[4] else ((23, 59, 59) if end_of_day else (0, 0, 0))
    if not (1 <= mo <= 12 and 1 <= d <= 31 and hh <= 23 and mi <= 59 and ss <= 60): raise ValueError(_ERR)
    off = (m[7] or 'Z').upper().replace(':', '')
    if off != 'Z' and (int(off[1:3]) > 14 or int(off[3:5]) > 59): raise ValueError(_ERR)
    if off not in ('Z', '+0000', '-0000'): raise ValueError('该日期在公历中不存在，只能按文件自身日历解释，请使用不带时区或 Z 结尾的时间')
    return y, mo, d, hh, mi, ss


def normalize_utc(value: str, *, end_of_day: bool = False) -> tuple[tuple, str]:
    """Sortable key and canonical string 'YYYY-MM-DDTHH:MM:SSZ'.

    Gregorian instants are converted to UTC; non-Gregorian calendar dates (2001-02-30) are kept as written.
    Keys are (Y, M, D, h, m, s, microsecond), so sub-second order is kept for comparisons.
    """
    try:
        t = parse_utc(value, end_of_day=end_of_day)
        f = (t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond)
    except ValueError:
        f = calendar_fields(value, end_of_day=end_of_day) + (0,)
    return f, '%04d-%02d-%02dT%02d:%02d:%02dZ' % f[:6]


def is_gregorian(value: str) -> bool:
    try: parse_utc(value); return True
    except ValueError: return False


def calendar_ordinal(f: tuple, month_days: int = 31) -> float:
    """Monotonic position of calendar fields in seconds, for nearest-time lookups on any calendar.

    month_days=30 is exact for 360_day; 31 keeps the order exact for other calendars with approximate spacing
    across month ends.
    """
    y, mo, d, hh, mi, ss = f[:6]
    return ((((y * 12 + mo - 1) * month_days + d - 1) * 24 + hh) * 60 + mi) * 60 + ss + (f[6] if len(f) > 6 else 0) / 1e6
