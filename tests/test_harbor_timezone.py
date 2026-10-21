"""Tests for the harbor timezone helpers."""

from datetime import datetime, timezone

import pytest

from custom_components.marees_france.harbor_timezone import (
    get_harbor_tzinfo,
    harbor_timezone_from_properties,
)


@pytest.mark.parametrize(
    ("properties", "expected"),
    [
        # Metropolitan France: legal time with daylight saving
        ({"ut": 10, "ut_sup": 20, "h_legale": 1}, "Europe/Paris"),
        # Mayotte (Dzaoudzi)
        ({"ut": 30, "ut_sup": 0, "h_legale": 0}, "UTC+03:00"),
        # La Réunion
        ({"ut": 40, "ut_sup": 0, "h_legale": 0}, "UTC+04:00"),
        # Martinique
        ({"ut": -40, "ut_sup": 0, "h_legale": 0}, "UTC-04:00"),
        # Polynésie (Papeete)
        ({"ut": -100, "ut_sup": 0, "h_legale": 0}, "UTC-10:00"),
        # Marquises (half-hour offset)
        ({"ut": -95, "ut_sup": 0, "h_legale": 0}, "UTC-09:30"),
        # Nouvelle-Calédonie
        ({"ut": 110, "ut_sup": 0, "h_legale": 0}, "UTC+11:00"),
        # UTC harbor
        ({"ut": 0, "ut_sup": 0, "h_legale": 0}, "UTC+00:00"),
        # No offset provided
        ({"ut": None}, None),
        ({}, None),
    ],
)
def test_harbor_timezone_from_properties(properties, expected):
    """The timezone identifier is derived from the SHOM harbor properties."""
    assert harbor_timezone_from_properties(properties) == expected


@pytest.mark.parametrize(
    ("timezone_name", "summer_offset_h", "winter_offset_h"),
    [
        ("Europe/Paris", 2, 1),
        ("UTC+03:00", 3, 3),
        ("UTC-04:00", -4, -4),
        (None, 2, 1),  # Fallback to Europe/Paris
        ("Not/AZone", 2, 1),  # Invalid identifier falls back to Europe/Paris
    ],
)
def test_get_harbor_tzinfo(timezone_name, summer_offset_h, winter_offset_h):
    """Tide times are localized using the harbor timezone."""
    tz = get_harbor_tzinfo(timezone_name)
    for month, offset in ((7, summer_offset_h), (1, winter_offset_h)):
        local = tz.localize(datetime(2026, month, 15, 12, 0))
        utc = local.astimezone(timezone.utc)
        assert utc.hour == 12 - offset


def test_half_hour_offset():
    """Fixed offsets with minutes are supported."""
    local = get_harbor_tzinfo("UTC-09:30").localize(datetime(2026, 1, 15, 12, 0))
    assert local.astimezone(timezone.utc) == datetime(
        2026, 1, 15, 21, 30, tzinfo=timezone.utc
    )
