""" Marées France integration."""

from __future__ import annotations

import logging
import asyncio
import aiohttp
import voluptuous as vol

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
# Remove SupportsResponse from here
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse # Add SupportsResponse here
from homeassistant.exceptions import HomeAssistantError # Import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession # Import async_get_clientsession
import homeassistant.helpers.config_validation as cv # Import cv

# Local application/library specific imports
from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_GET_WATER_LEVELS,
    ATTR_HARBOR_NAME,
    ATTR_DATE,
    WATERLEVELS_URL_TEMPLATE,
    HEADERS, # Ensure HEADERS is imported
)
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration # Import frontend helper here

# Import the standard frontend registration helper
# from homeassistant.components.frontend import async_register_frontend_module # Removed problematic import

_LOGGER = logging.getLogger(__name__)

# Service Schema Definition
SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema({
    vol.Required(ATTR_HARBOR_NAME): cv.string,
    vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"), # Basic YYYY-MM-DD check
})

# Service Handler Definition
async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get water levels."""
    harbor_name = call.data[ATTR_HARBOR_NAME]
    date_str = call.data[ATTR_DATE]
    url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
    # Get session from hass instance passed in the call object
    session = async_get_clientsession(call.hass)

    _LOGGER.debug("Calling SHOM water level API: %s", url)
    try:
        # Use asyncio.timeout for request timeout
        async with asyncio.timeout(30):
            response = await session.get(url, headers=HEADERS)
            # Raise HTTPError for bad responses (4xx or 5xx)
            response.raise_for_status()
            data = await response.json()
            _LOGGER.debug("Received water level data for %s on %s", harbor_name, date_str)
            # Return the data directly
            return data
    except asyncio.TimeoutError as err:
        _LOGGER.error("Timeout fetching water levels for %s on %s", harbor_name, date_str)
        # Raise HomeAssistantError for service call failures
        raise HomeAssistantError(f"Timeout fetching water levels: {err}") from err
    except aiohttp.ClientResponseError as err:
        _LOGGER.error("HTTP error fetching water levels for %s on %s: %s %s", harbor_name, date_str, err.status, err.message)
        raise HomeAssistantError(f"HTTP error fetching water levels: {err.status} {err.message}") from err
    except aiohttp.ClientError as err:
        _LOGGER.error("Client error fetching water levels for %s on %s: %s", harbor_name, date_str, err)
        raise HomeAssistantError(f"Client error fetching water levels: {err}") from err
    except Exception as err:
        # Log the full exception traceback for unexpected errors
        _LOGGER.exception("Unexpected error fetching water levels for %s on %s", harbor_name, date_str)
        raise HomeAssistantError(f"Unexpected error fetching water levels: {err}") from err


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Marées France component."""
    # Register the custom frontend panel (custom card)
    # This should only happen once
    module_register = JSModuleRegistration(hass)
    await module_register.async_register()
    _LOGGER.debug("Registered Marées France frontend module.")
    # Return true to indicate successful setup of the component
    return True


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

    # Register the service
    # Check if service already exists to prevent duplicate registration during reloads
    if not hass.services.has_service(DOMAIN, SERVICE_GET_WATER_LEVELS):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_WATER_LEVELS,
            async_handle_get_water_levels,
            schema=SERVICE_GET_WATER_LEVELS_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug("Registered service: %s.%s", DOMAIN, SERVICE_GET_WATER_LEVELS)
    else:
        _LOGGER.debug("Service %s.%s already registered.", DOMAIN, SERVICE_GET_WATER_LEVELS)


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
