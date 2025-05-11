"""Tests for the Marees France sensor platform."""
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from syrupy import SnapshotAssertion

from homeassistant.components.sensor import SensorDeviceClass
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import (
    ATTR_ATTRIBUTION,
    ATTR_DEVICE_CLASS,
    ATTR_FRIENDLY_NAME,
    ATTR_ICON,
    ATTR_UNIT_OF_MEASUREMENT,
    CONF_DEVICE_ID,
    CONF_FRIENDLY_NAME,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from custom_components.marees_france.const import CONF_HARBOR_ID
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.marees_france.const import ATTRIBUTION, DOMAIN
# Assuming ATTRIBUTION is defined in const.py, if not, this import will fail
# and ATTRIBUTION would need to be defined locally or the check removed.

# MOCK_CONFIG_ENTRY_DATA is defined in conftest and available as a fixture or direct import
# For direct import to work reliably now that pytest.ini should fix paths:
from tests.conftest import MOCK_CONFIG_ENTRY_DATA, MOCK_PORT_DATA

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

@pytest.fixture
async def setup_integration_entry(hass: HomeAssistant, mock_shom_client: AsyncMock):
    """Set up the Marees France integration with a config entry."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=MOCK_CONFIG_ENTRY_DATA,
        unique_id=MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID], # "BREST"
    )
    entry.add_to_hass(hass)

    # Set time to a fixed point for consistent testing (before first tide)
    # First tide in MOCK_PORT_DATA is 2025-05-12T03:00:00Z
    now = dt_util.parse_datetime("2025-05-12T00:00:00Z")
    # Ensure consistent timezone for dt_util.now() mock
    # dt_util.set_default_time_zone(now.tzinfo) # Not needed if parse_datetime includes tz

    with patch("homeassistant.util.dt.now", return_value=now):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    return entry

async def test_sensor_creation_and_initial_state(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    snapshot: SnapshotAssertion,
    entity_registry: er.EntityRegistry,
    device_registry: dr.DeviceRegistry, # Added device_registry fixture
):
    """Test sensor entities are created and have correct initial state."""
    config_entry = setup_integration_entry
    friendly_name_slug = MOCK_CONFIG_ENTRY_DATA[CONF_FRIENDLY_NAME].lower().replace(" ", "_")

    # Verify all expected sensors are created
    for sensor_key in ALL_SENSOR_KEYS:
        entity_id = get_entity_id(friendly_name_slug, sensor_key)
        state = hass.states.get(entity_id)
        assert state is not None, f"{entity_id} not created"
        assert state.state != STATE_UNAVAILABLE, f"{entity_id} is unavailable"
        assert state.state != STATE_UNKNOWN, f"{entity_id} is unknown"
        assert state.attributes.get(ATTR_ATTRIBUTION) == ATTRIBUTION

        # Check entity registry entry
        registry_entry = entity_registry.async_get(entity_id)
        assert registry_entry is not None, f"Entity registry entry not found for {entity_id}"
        assert registry_entry.unique_id == f"{config_entry.unique_id}_{sensor_key}"
        assert registry_entry.device_id is not None

        # Snapshot basic state for initial review
        assert state == snapshot(name=f"{entity_id}_initial_state")

    # Detailed checks for key sensors (current time mocked to 2025-05-12T00:00:00Z)
    # Next Tide (BM at 03:00 from MOCK_PORT_DATA)
    state_next_tide_time = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_TIME))
    assert state_next_tide_time.state == "2025-05-12T03:00:00+00:00"
    assert state_next_tide_time.attributes.get(ATTR_DEVICE_CLASS) == SensorDeviceClass.TIMESTAMP

    state_next_tide_height = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_HEIGHT))
    assert float(state_next_tide_height.state) == 1.5
    assert state_next_tide_height.attributes.get(ATTR_UNIT_OF_MEASUREMENT) == "m"

    state_next_tide_type = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_TYPE))
    assert state_next_tide_type.state == "Low Tide" # Assuming "BM" maps to "Low Tide"

    # Coefficients
    state_current_coeff = hass.states.get(get_entity_id(friendly_name_slug, KEY_CURRENT_DAY_COEFFICIENT))
    assert int(state_current_coeff.state) == 95 # For 2025-05-12

    state_next_day_coeff = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_DAY_COEFFICIENT))
    assert int(state_next_day_coeff.state) == 90 # For 2025-05-13

    # Specific tides for today (2025-05-12)
    state_low_tide_time = hass.states.get(get_entity_id(friendly_name_slug, KEY_FIRST_LOW_TIDE_TIME_TODAY))
    assert state_low_tide_time.state == "2025-05-12T03:00:00+00:00"
    state_low_tide_height = hass.states.get(get_entity_id(friendly_name_slug, KEY_FIRST_LOW_TIDE_HEIGHT_TODAY))
    assert float(state_low_tide_height.state) == 1.5

    state_high_tide_time = hass.states.get(get_entity_id(friendly_name_slug, KEY_FIRST_HIGH_TIDE_TIME_TODAY))
    assert state_high_tide_time.state == "2025-05-12T09:00:00+00:00"
    state_high_tide_height = hass.states.get(get_entity_id(friendly_name_slug, KEY_FIRST_HIGH_TIDE_HEIGHT_TODAY))
    assert float(state_high_tide_height.state) == 6.5

    # Check device info (using one sensor's entity registry entry)
    one_registry_entry = entity_registry.async_get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_TIME))
    device_entry = device_registry.async_get(one_registry_entry.device_id)
    assert device_entry is not None
    assert device_entry.name == MOCK_CONFIG_ENTRY_DATA[CONF_FRIENDLY_NAME]
    assert device_entry.manufacturer == "SHOM"  # Assumption
    assert device_entry.model == "Tide Information"  # Assumption
    assert device_entry.identifiers == {(DOMAIN, MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID])}


async def test_sensor_updates_on_new_data(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    mock_shom_client: AsyncMock, # Assuming this fixture gives control over the integration's client
):
    """Test sensor states update when coordinator provides new data."""
    config_entry = setup_integration_entry
    friendly_name_slug = MOCK_CONFIG_ENTRY_DATA[CONF_FRIENDLY_NAME].lower().replace(" ", "_")
    coordinator = hass.data[DOMAIN][config_entry.entry_id] # Standard way to get coordinator

    NEW_MOCK_PORT_DATA = {
        "nom_port": "BREST", "lat": 48.3833, "lon": -4.5,
        "coeff_maree": [
            {"valeur": 80, "jour": 1, "date": "2025-05-12T00:00:00Z"}, # Updated
            {"valeur": 75, "jour": 2, "date": "2025-05-13T00:00:00Z"}, # Updated
        ],
        "hauteurs_maree": [
            {"valeur": 2.0, "etat": "BM", "jour": 1, "heure": "04:00", "date": "2025-05-12T04:00:00Z"}, # Updated
            {"valeur": 7.0, "etat": "PM", "jour": 1, "heure": "10:00", "date": "2025-05-12T10:00:00Z"}, # Updated
        ],
    }

    # Change the mock client's return value for the next data fetch
    mock_shom_client.get_tide_data.return_value = NEW_MOCK_PORT_DATA

    # Trigger coordinator refresh (current time is still 2025-05-12T00:00:00Z)
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    # Verify updated states
    state_next_tide_time = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_TIME))
    assert state_next_tide_time.state == "2025-05-12T04:00:00+00:00" # Updated

    state_next_tide_height = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_TIDE_HEIGHT))
    assert float(state_next_tide_height.state) == 2.0 # Updated

    state_current_coeff = hass.states.get(get_entity_id(friendly_name_slug, KEY_CURRENT_DAY_COEFFICIENT))
    assert int(state_current_coeff.state) == 80 # Updated

    state_next_day_coeff = hass.states.get(get_entity_id(friendly_name_slug, KEY_NEXT_DAY_COEFFICIENT))
    assert int(state_next_day_coeff.state) == 75 # Updated


async def test_sensor_availability(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    mock_shom_client: AsyncMock, # Assuming this fixture gives control
):
    """Test sensor availability when coordinator fails and recovers."""
    config_entry = setup_integration_entry
    friendly_name_slug = MOCK_CONFIG_ENTRY_DATA[CONF_FRIENDLY_NAME].lower().replace(" ", "_")
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # 1. Test unavailable when coordinator fails
    mock_shom_client.get_tide_data.side_effect = Exception("API Error")
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    for sensor_key in ALL_SENSOR_KEYS:
        entity_id = get_entity_id(friendly_name_slug, sensor_key)
        state = hass.states.get(entity_id)
        assert state is not None
        assert state.state == STATE_UNAVAILABLE, f"{entity_id} should be unavailable"

    # 2. Test available again when coordinator recovers
    mock_shom_client.get_tide_data.side_effect = None # Clear the error
    mock_shom_client.get_tide_data.return_value = MOCK_PORT_DATA # Restore mock data
    await coordinator.async_refresh()
    await hass.async_block_till_done()

    for sensor_key in ALL_SENSOR_KEYS:
        entity_id = get_entity_id(friendly_name_slug, sensor_key)
        state = hass.states.get(entity_id)
        assert state is not None
        assert state.state != STATE_UNAVAILABLE, f"{entity_id} should be available"

    # Quick check of a value to ensure data is restored
    state_current_coeff = hass.states.get(get_entity_id(friendly_name_slug, KEY_CURRENT_DAY_COEFFICIENT))
    assert int(state_current_coeff.state) == 95 # Back to original MOCK_PORT_DATA