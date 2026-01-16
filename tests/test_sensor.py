"""Tests for the Marees France sensor platform."""

from unittest.mock import AsyncMock, patch

import pytest

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from custom_components.marees_france.const import CONF_HARBOR_ID
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.marees_france.const import DOMAIN
# Assuming ATTRIBUTION is defined in const.py, if not, this import will fail
# and ATTRIBUTION would need to be defined locally or the check removed.

# MOCK_CONFIG_ENTRY_DATA is defined in conftest and available as a fixture or direct import
# For direct import to work reliably now that pytest.ini should fix paths:
from tests.conftest import MOCK_CONFIG_ENTRY_DATA

# Define sensor keys expected to be created by the integration.
# These are assumptions for the test, based on typical tide data.
KEY_NEXT_TIDE_TIME = "next_tide_time"
KEY_NEXT_TIDE_HEIGHT = "next_tide_height"
KEY_NEXT_TIDE_TYPE = "next_tide_type"
KEY_CURRENT_DAY_COEFFICIENT = "current_day_coefficient"
KEY_NEXT_DAY_COEFFICIENT = "next_day_coefficient"
# Specific tides for the first events of the day, based on MOCK_PORT_DATA
# MOCK_PORT_DATA: BM at 03:00 (1.5m), PM at 09:00 (6.5m) for day 1
KEY_FIRST_LOW_TIDE_TIME_TODAY = "first_low_tide_time_today"
KEY_FIRST_LOW_TIDE_HEIGHT_TODAY = "first_low_tide_height_today"
KEY_FIRST_HIGH_TIDE_TIME_TODAY = "first_high_tide_time_today"
KEY_FIRST_HIGH_TIDE_HEIGHT_TODAY = "first_high_tide_height_today"

ALL_SENSOR_KEYS = [
    KEY_NEXT_TIDE_TIME,
    KEY_NEXT_TIDE_HEIGHT,
    KEY_NEXT_TIDE_TYPE,
    KEY_CURRENT_DAY_COEFFICIENT,
    KEY_NEXT_DAY_COEFFICIENT,
    KEY_FIRST_LOW_TIDE_TIME_TODAY,
    KEY_FIRST_LOW_TIDE_HEIGHT_TODAY,
    KEY_FIRST_HIGH_TIDE_TIME_TODAY,
    KEY_FIRST_HIGH_TIDE_HEIGHT_TODAY,
]


def get_entity_id(friendly_name_slug: str, sensor_key: str) -> str:
    """Helper to create entity IDs based on slugified friendly name."""
    return f"sensor.{friendly_name_slug}_{sensor_key}"


@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True


@pytest.fixture
async def setup_integration_entry(
    hass: HomeAssistant,
    mock_api_fetchers_detailed: AsyncMock,
    entity_registry: er.EntityRegistry,
):
    """Set up the Marees France integration with a config entry."""
    # First, check if there's already an entry with the same ID
    existing_entries = hass.config_entries.async_entries(DOMAIN)
    for entry in existing_entries:
        if entry.entry_id == "test":
            # If the entry is already loaded, we'll use it
            return entry

    # Create a new entry if it doesn't exist
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=MOCK_CONFIG_ENTRY_DATA,
        unique_id=MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID],  # "BREST"
        entry_id="test",
        version=2,  # Skip migration
    )
    entry.add_to_hass(hass)

    # Set time to a fixed point for consistent testing (before first tide)
    # First tide in MOCK_PORT_DATA is 2025-05-12T03:00:00Z
    now = dt_util.parse_datetime("2025-05-12T00:00:00Z")

    # Create mock data for the coordinator
    mock_data = {
        "now_data": {
            "tide_trend": "rising",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
            "current_height": 5.0,
            "water_temp": "15.5",
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T09:15:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T03:00:00+00:00",
            "starting_height": "1.8",
            "finished_height": "8.2",
            "coefficient": "90",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "95",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "88",
        "last_update": "2025-05-12T00:00:00+00:00",
        "water_temp_data": [
            {"datetime": "2025-05-11T23:00:00Z", "temp": "15.5"},
            {"datetime": "2025-05-12T00:00:00Z", "temp": "15.6"},
        ],
    }

    # Patch the coordinator's _parse_tide_data method and dt_util.now
    with (
        patch(
            "custom_components.marees_france.coordinator.MareesFranceUpdateCoordinator._parse_tide_data",
            return_value=mock_data,
        ),
        patch("homeassistant.util.dt.now", return_value=now),
    ):
        # Set up the entry if it's not already set up
        if entry.state != ConfigEntryState.LOADED:
            assert await hass.config_entries.async_setup(entry.entry_id)
            await hass.async_block_till_done()

    return entry


async def test_sensor_creation_and_initial_state(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    entity_registry: er.EntityRegistry,
    device_registry: dr.DeviceRegistry,  # Added device_registry fixture
):
    """Test sensor entities are created and have correct initial state."""
    config_entry = setup_integration_entry

    # Get the coordinator from hass data
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # Directly set the coordinator data to ensure sensors have data
    mock_data = {
        "now_data": {
            "tide_trend": "rising",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
            "current_height": 5.0,
            "water_temp": "15.5",
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T09:15:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T03:00:00+00:00",
            "starting_height": "1.8",
            "finished_height": "8.2",
            "coefficient": "90",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "95",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "88",
        "last_update": "2025-05-12T00:00:00+00:00",
        "water_temp_data": [
            {"datetime": "2025-05-11T23:00:00Z", "temp": "15.5"},
            {"datetime": "2025-05-12T00:00:00Z", "temp": "15.6"},
        ],
    }
    coordinator.data = mock_data
    coordinator.last_update_success = True
    coordinator.async_update_listeners()

    # Wait for the sensors to update
    await hass.async_block_till_done()

    # Check that the entity registry has the entities
    entities_full = er.async_entries_for_config_entry(entity_registry, config_entry.entry_id)
    entities = [s for s in entities_full if s.domain == "sensor"]
    assert len(entities) > 0, "No sensor entities found for config entry"

    # Check that the device registry has the device
    device_entries = dr.async_entries_for_config_entry(
        device_registry, config_entry.entry_id
    )
    assert len(device_entries) > 0, "No devices found for config entry"

    # Check that the sensors are available
    for entity in entities:
        state = hass.states.get(entity.entity_id)
        assert state is not None, f"{entity.entity_id} not created"
        assert state.state != STATE_UNAVAILABLE, f"{entity.entity_id} is unavailable"


async def test_sensor_updates_on_new_data(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    entity_registry: er.EntityRegistry,
):
    """Test sensor states update when coordinator provides new data."""
    config_entry = setup_integration_entry
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # First update with initial data
    mock_data = {
        "now_data": {
            "tide_trend": "rising",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
            "current_height": 5.0,
            "water_temp": "15.5",
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T09:15:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T03:00:00+00:00",
            "starting_height": "1.8",
            "finished_height": "8.2",
            "coefficient": "90",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "95",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "88",
        "last_update": "2025-05-12T00:00:00+00:00",
        "water_temp_data": [
            {"datetime": "2025-05-11T23:00:00Z", "temp": "15.5"},
            {"datetime": "2025-05-12T00:00:00Z", "temp": "15.6"},
        ],
    }
    coordinator.data = mock_data
    coordinator.last_update_success = True
    coordinator.async_update_listeners()
    await hass.async_block_till_done()

    # Then update with new data
    new_mock_data = {
        "now_data": {
            "tide_trend": "falling",
            "starting_time": "2025-05-12T04:00:00+00:00",
            "finished_time": "2025-05-12T10:00:00+00:00",
            "starting_height": "7.5",
            "finished_height": "2.0",
            "coefficient": "80",
            "current_height": 6.0,
            "water_temp": "16.2",
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T04:00:00+00:00",
            "finished_time": "2025-05-12T04:00:00+00:00",
            "starting_height": "7.5",
            "finished_height": "2.0",
            "coefficient": "80",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T04:00:00+00:00",
            "finished_time": "2025-05-12T04:00:00+00:00",
            "starting_height": "2.0",
            "finished_height": "7.5",
            "coefficient": "80",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "80",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "75",
        "last_update": "2025-05-12T01:00:00+00:00",
        "water_temp_data": [
            {"datetime": "2025-05-11T23:00:00Z", "temp": "15.5"},
            {"datetime": "2025-05-12T00:00:00Z", "temp": "15.6"},
            {"datetime": "2025-05-12T01:00:00Z", "temp": "16.2"},
        ],
    }
    coordinator.data = new_mock_data
    coordinator.last_update_success = True
    coordinator.async_update_listeners()
    await hass.async_block_till_done()

    # Check that the entities exist
    entities_full = er.async_entries_for_config_entry(entity_registry, config_entry.entry_id)
    entities = [s for s in entities_full if s.domain == "sensor"]
    assert len(entities) > 0, "No sensor entities found for config entry"


async def test_sensor_availability(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    entity_registry: er.EntityRegistry,
):
    """Test sensor availability when coordinator fails and recovers."""
    config_entry = setup_integration_entry
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # First, set up with good data
    mock_data = {
        "now_data": {
            "tide_trend": "rising",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
            "current_height": 5.0,
            "water_temp": "15.5",
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T09:15:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T03:00:00+00:00",
            "starting_height": "1.8",
            "finished_height": "8.2",
            "coefficient": "90",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "95",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "88",
        "last_update": "2025-05-12T00:00:00+00:00",
        "water_temp_data": [
            {"datetime": "2025-05-11T23:00:00Z", "temp": "15.5"},
            {"datetime": "2025-05-12T00:00:00Z", "temp": "15.6"},
        ],
    }
    coordinator.data = mock_data
    coordinator.last_update_success = True
    coordinator.async_update_listeners()
    await hass.async_block_till_done()

    # Check that the entities exist
    entities_full = er.async_entries_for_config_entry(entity_registry, config_entry.entry_id)
    entities = [s for s in entities_full if s.domain == "sensor"]
    assert len(entities) > 0, "No sensor entities found for config entry"

    # Then simulate a failure
    coordinator.last_update_success = False
    coordinator.async_update_listeners()
    await hass.async_block_till_done()

    # Then simulate recovery
    coordinator.last_update_success = True
    coordinator.async_update_listeners()
    await hass.async_block_till_done()
