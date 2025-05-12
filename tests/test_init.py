"""Tests for the Marees France integration."""
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.const import Platform

from custom_components.marees_france.const import DOMAIN
from tests.conftest import MOCK_CONFIG_ENTRY_DATA

@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True


async def test_async_setup_entry(hass: HomeAssistant) -> None:
    """Test a successful setup entry."""
    # Create a mock config entry
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=MOCK_CONFIG_ENTRY_DATA,
        entry_id="test_setup",
        unique_id="BREST_TEST",
        version=2,  # Skip migration
    )
    entry.add_to_hass(hass)

    # Mock all the necessary functions
    with patch("custom_components.marees_france.coordinator.MareesFranceUpdateCoordinator.async_refresh", return_value=None), \
         patch("custom_components.marees_france.frontend.JSModuleRegistration._async_wait_for_lovelace_resources", return_value=None), \
         patch("homeassistant.helpers.event.async_call_later", return_value=lambda: None), \
         patch("custom_components.marees_france.__init__.fetch_harbors", return_value={"BREST": {"name": "Brest", "id": "BREST"}}), \
         patch("custom_components.marees_france.async_setup", return_value=True):
        
        # Set up the component
        assert await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()
        
        # Import the setup entry function
        from custom_components.marees_france import async_setup_entry
        
        # Set up the entry
        assert await async_setup_entry(hass, entry)
        await hass.async_block_till_done()
        
        # Basic assertions
        assert DOMAIN in hass.data
        assert entry.entry_id in hass.data[DOMAIN]


async def test_async_unload_entry(hass: HomeAssistant) -> None:
    """Test a successful unload entry."""
    # Create a mock config entry
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=MOCK_CONFIG_ENTRY_DATA,
        entry_id="test_unload",
        unique_id="BREST_UNLOAD",
        version=2,  # Skip migration
    )
    entry.add_to_hass(hass)

    # Mock all the necessary functions
    with patch("custom_components.marees_france.coordinator.MareesFranceUpdateCoordinator.async_refresh", return_value=None), \
         patch("custom_components.marees_france.frontend.JSModuleRegistration._async_wait_for_lovelace_resources", return_value=None), \
         patch("homeassistant.helpers.event.async_call_later", return_value=lambda: None), \
         patch("custom_components.marees_france.__init__.fetch_harbors", return_value={"BREST": {"name": "Brest", "id": "BREST"}}), \
         patch("custom_components.marees_france.async_setup", return_value=True):
        
        # Set up the component
        assert await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()
        
        # Import the setup and unload entry functions
        from custom_components.marees_france import async_setup_entry, async_unload_entry
        
        # Set up the entry
        assert await async_setup_entry(hass, entry)
        await hass.async_block_till_done()
        
        # Basic assertions before unloading
        assert DOMAIN in hass.data
        assert entry.entry_id in hass.data[DOMAIN]
        
        # Unload the entry
        assert await async_unload_entry(hass, entry)
        await hass.async_block_till_done()
        
        # Check that the entry was unloaded
        assert entry.entry_id not in hass.data.get(DOMAIN, {})