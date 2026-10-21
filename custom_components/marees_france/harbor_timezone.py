"""Harbor timezone helpers for the Marées France integration.

The SHOM API returns tide times in the local time of the harbor, which is not
always the Paris time (overseas harbors: Mayotte, La Réunion, Antilles...).
Each harbor of the SHOM list exposes its UTC offset (`ut`, in tenths of an
hour), the offset applied during daylight saving (`ut_sup`) and whether the
legal time applies (`h_legale`).
"""

from __future__ import annotations

import re
from datetime import tzinfo
from typing import Any, Final

import pytz

DEFAULT_HARBOR_TIMEZONE: Final[str] = "Europe/Paris"

_FIXED_OFFSET_RE: Final[re.Pattern[str]] = re.compile(
    r"^UTC(?P<sign>[+-])(?P<hours>\d{2}):(?P<minutes>\d{2})$"
)


def harbor_timezone_from_properties(properties: dict[str, Any]) -> str | None:
    """Build a timezone identifier from the SHOM harbor properties.

    Returns:
        "Europe/Paris" for harbors following the French legal time (with
        daylight saving), a fixed offset such as "UTC+03:00" for the others,
        or None if the harbor does not provide its UTC offset.
    """
    ut = properties.get("ut")
    if not isinstance(ut, (int, float)):
        return None

    if properties.get("h_legale") == 1 and ut == 10 and properties.get("ut_sup") == 20:
        return DEFAULT_HARBOR_TIMEZONE

    total_minutes = round(ut * 6)  # ut is in tenths of an hour
    sign = "-" if total_minutes < 0 else "+"
    hours, minutes = divmod(abs(total_minutes), 60)
    return f"UTC{sign}{hours:02d}:{minutes:02d}"


def get_harbor_tzinfo(timezone_name: str | None) -> tzinfo:
    """Return a pytz timezone from a harbor timezone identifier.

    This may read the timezone database from disk for named zones, so it must be
    run in an executor from the event loop. Falls back to Europe/Paris if the
    identifier is missing or invalid.
    """
    if timezone_name:
        match = _FIXED_OFFSET_RE.match(timezone_name)
        if match:
            minutes = int(match["hours"]) * 60 + int(match["minutes"])
            if match["sign"] == "-":
                minutes = -minutes
            return pytz.FixedOffset(minutes)
        try:
            return pytz.timezone(timezone_name)
        except pytz.UnknownTimeZoneError:
            pass
    return pytz.timezone(DEFAULT_HARBOR_TIMEZONE)
