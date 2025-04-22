"""The Marées France integration."""

from __future__ import annotations

import logging

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

# Local application/library specific imports
from .const import DOMAIN, PLATFORMS
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Marées France from a config entry."""
    _LOGGER.debug("Setting up Marées France entry: %s", entry.entry_id)

    # Create the central coordinator
    coordinator = MareesFranceUpdateCoordinator(hass, entry)

    # Fetch initial data so we have it when platforms are ready
    await coordinator.async_config_entry_first_refresh()

    # Store the coordinator in hass.data
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Forward the setup to the sensor platform
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _LOGGER.debug("Forwarded entry setup for platforms: %s", PLATFORMS)

    # Set up update listener
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # Register custom cards
    moodule_register = JSModuleRegistration(hass)
    await moodule_register.async_register()

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.debug("Unloading Marées France entry: %s", entry.entry_id)

    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Remove coordinator and data if unload was successful
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        _LOGGER.debug("Successfully unloaded Marées France entry: %s", entry.entry_id)

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    _LOGGER.debug("Reloading Marées France entry: %s", entry.entry_id)
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
    _LOGGER.debug("Finished reloading Marées France entry: %s", entry.entry_id)
