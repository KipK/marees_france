"""Tests for the Marees France integration."""
from unittest.mock import AsyncMock

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.const import Platform

from custom_components.marees_france.const import DOMAIN
from tests.conftest import MOCK_CONFIG_ENTRY_DATA


async def test_async_setup_entry(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test a successful setup entry."""
    entry = MockConfigEntry(domain=DOMAIN, data=MOCK_CONFIG_ENTRY_DATA)
    entry.add_to_hass(hass)

    # Pre-assertion: Ensure the domain is not already loaded for this entry
    assert DOMAIN not in hass.data or entry.entry_id not in hass.data[DOMAIN]

    # Setup the component
    assert await async_setup_component(hass, DOMAIN, {}) is True
    await hass.async_block_till_done()

    # Call the setup entry function for the integration
    # (Note: init_integration fixture in conftest.py might do parts of this,
    # but for testing async_setup_entry directly, we call it here)
    # We need to import the actual async_setup_entry from the integration
    from custom_components.marees_france import async_setup_entry

    assert await async_setup_entry(hass, entry) is True
    await hass.async_block_till_done()

    # Assertions
    assert DOMAIN in hass.data
    assert entry.entry_id in hass.data[DOMAIN]
    # Add more specific checks for what's stored in hass.data[DOMAIN][entry.entry_id] if needed

    # Check if platforms are loaded (e.g., sensor)
    # This assumes your integration sets up a sensor platform.
    # Adjust Platform.SENSOR to other platforms if necessary (e.g., Platform.BINARY_SENSOR)
    # Or check for specific entities if platforms are not directly loaded but entities are created.
    assert entry.entry_id in hass.config_entries.async_loaded_entries(DOMAIN)

    # Example: Check if sensor entities were created for this config entry
    # This requires knowing the entity_ids or how they are derived.
    # For now, we'll check if the sensor component associated with the domain was set up.
    # This is a more generic check.
    # If your integration directly creates entities without a separate platform setup,
    # you might need to check hass.states for entities linked to this device/config entry.
    # For integrations that define platforms in manifest.json, Home Assistant loads them.
    # We can check if the expected platforms are loaded for the entry.
    # Assuming 'sensor' is a platform for this integration.
    loaded_platforms = {
        platform
        for entry_dict in hass.data["setup_platforms"].values()
        for platform in entry_dict
        if entry.entry_id in entry_dict[platform]
    }
    # This check might be too broad or not specific enough.
    # A better check is to see if the entry is associated with the platform loading.
    # However, the direct way to check if a platform was loaded for an entry is not straightforward
    # without knowing the internals of how HA tracks this.
    # A common pattern is to check for the creation of entities.

    # Let's assume the integration creates a coordinator and stores it.
    # coordinator = hass.data[DOMAIN][entry.entry_id]
    # assert coordinator is not None
    # assert coordinator.last_update_success is True # If applicable

    # If your integration has platforms defined in manifest.json (e.g., "sensor"),
    # HA will attempt to load them. We can check if the entry is forwarded to these platforms.
    # This is implicitly tested by checking hass.config_entries.async_loaded_entries
    # and by the fact that async_setup_entry returned True.

    # A more robust check for platform setup is to see if entities of that platform
    # belonging to this integration exist.
    # For example, if you have a sensor:
    # state = hass.states.get("sensor.maree_brest_next_tide") # Adjust entity_id
    # assert state is not None


async def test_async_unload_entry(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test a successful unload entry."""
    entry = MockConfigEntry(domain=DOMAIN, data=MOCK_CONFIG_ENTRY_DATA)
    entry.add_to_hass(hass)

    # Setup the component and the entry
    assert await async_setup_component(hass, DOMAIN, {}) is True
    await hass.async_block_till_done()

    from custom_components.marees_france import async_setup_entry, async_unload_entry

    assert await async_setup_entry(hass, entry) is True
    await hass.async_block_till_done()

    # Pre-assertion: Ensure the integration is loaded
    assert DOMAIN in hass.data
    assert entry.entry_id in hass.data[DOMAIN]
    assert entry.entry_id in hass.config_entries.async_loaded_entries(DOMAIN)

    # Unload the entry
    assert await async_unload_entry(hass, entry) is True
    await hass.async_block_till_done()

    # Assertions
    assert entry.entry_id not in hass.data.get(DOMAIN, {})
    assert entry.entry_id not in hass.config_entries.async_loaded_entries(DOMAIN)

    # Verify that entities are removed (if applicable)
    # For example, if you had a sensor:
    # state = hass.states.get("sensor.maree_brest_next_tide") # Adjust entity_id
    # assert state is None

    # If platforms were set up, ensure they are no longer associated with this entry
    # This is generally handled by Home Assistant when an entry is unloaded.
    # The check `entry.entry_id not in hass.config_entries.async_loaded_entries(DOMAIN)`
    # covers that the entry is no longer considered loaded.