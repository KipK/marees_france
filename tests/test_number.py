"""Tests for the Marees France number platform."""

from typing import Any

import pytest

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import STATE_UNAVAILABLE
from custom_components.marees_france.const import CONF_HARBOR_ID
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.components.number import (
    DOMAIN as NUMBER_DOMAIN,
    ATTR_VALUE,
    SERVICE_SET_VALUE,
)
from homeassistant.const import ATTR_ENTITY_ID

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.marees_france.const import DOMAIN
# Assuming ATTRIBUTION is defined in const.py, if not, this import will fail
# and ATTRIBUTION would need to be defined locally or the check removed.

# MOCK_CONFIG_ENTRY_DATA is defined in conftest and available as a fixture or direct import
# For direct import to work reliably now that pytest.ini should fix paths:
from tests.conftest import MOCK_CONFIG_ENTRY_DATA

KEY_HARBOUR_MIN_DEPTH = "_depth_to_boat"

ALL_NUMBER_KEYS = [
    KEY_HARBOUR_MIN_DEPTH,
]

def get_entity_id(friendly_name_slug: str, sensor_key: str) -> str:
    """Helper to create entity IDs based on slugified friendly name."""
    return f"number.{friendly_name_slug}_{sensor_key}"

@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True


@pytest.fixture
async def setup_integration_entry(
    hass: HomeAssistant,
    mock_api_fetchers_detailed,
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

    if entry.state != ConfigEntryState.LOADED:
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

    return entry


async def test_number_creation_and_initial_state(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    entity_registry: er.EntityRegistry,
    device_registry: dr.DeviceRegistry,  # Added device_registry fixture
):
    """Test number entities are created and have correct initial state."""
    config_entry = setup_integration_entry

    # Get the coordinator from hass data
    coordinator = hass.data[DOMAIN][config_entry.entry_id]
    coordinator.last_update_success = True
    coordinator.async_update_listeners()

    # Wait for the sensors to update
    await hass.async_block_till_done()

    # Check that the entity registry has the entities
    entities_full = er.async_entries_for_config_entry(entity_registry, config_entry.entry_id)
    entities = [s for s in entities_full if s.domain == "number"]
    assert len(entities) > 0, "No number entities found for config entry "

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


async def test_number_updates_on_new_data(
    hass: HomeAssistant,
    setup_integration_entry: MockConfigEntry,
    entity_registry: er.EntityRegistry,
    mock_api_fetchers_detailed,
):
    """Test number states update when coordinator provides new data."""
    config_entry = setup_integration_entry
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    # First update with initial data
    #coordinator.data = MOCK_PORT_DATA
    coordinator.last_update_success = True
    coordinator.async_update_listeners()
    await hass.async_block_till_done()

    # update with new data
    new_mock_data = { "harborMinDepth": 3.5 }

    # Check that the entities exist

    entities_full = er.async_entries_for_config_entry(entity_registry, config_entry.entry_id)
    entities = [s for s in entities_full if s.domain == "number"]
    assert len(entities) > 0, "No number entities found for config entry"
    for entity in entities:
        await hass.services.async_call(
            NUMBER_DOMAIN,
            SERVICE_SET_VALUE,
            {ATTR_ENTITY_ID: "number.brest_minimum_depth", ATTR_VALUE: new_mock_data["harborMinDepth"]},
            blocking=True,
        )

        await hass.async_block_till_done()

        #Check number state value
        assert new_mock_data["harborMinDepth"] == float(hass.states.get(entity.entity_id).state)

        #Check store content
        cache: dict[str, dict[str, Any]] = await coordinator.harborMinDepth_store.async_load()
        assert new_mock_data["harborMinDepth"] == cache.setdefault("BREST", {})["harborMinDepth"]