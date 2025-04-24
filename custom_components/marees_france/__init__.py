""" Marées France integration."""

from __future__ import annotations

import logging
import asyncio
import aiohttp
import voluptuous as vol
from datetime import date # Add date import
from typing import Any # Add Any import

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
# Remove SupportsResponse from here
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse # Add SupportsResponse here
from homeassistant.exceptions import HomeAssistantError # Import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession # Import async_get_clientsession
from homeassistant.helpers.storage import Store # Add Store import
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

# Storage constants for water levels cache
WATERLEVELS_STORAGE_KEY = f"{DOMAIN}_water_levels_cache"
WATERLEVELS_STORAGE_VERSION = 1

# Service Schema Definition
SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema({
    vol.Required(ATTR_HARBOR_NAME): cv.string,
    vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"), # Basic YYYY-MM-DD check
})

# Service Handler Definition
async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get water levels, using caching."""
    harbor_name = call.data[ATTR_HARBOR_NAME]
    date_str = call.data[ATTR_DATE] # Expected format: YYYY-MM-DD

    store = Store[dict[str, dict[str, Any]]](call.hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)

    # 1. Load cache
    cache = await store.async_load() or {}
    needs_save = False
    today_date = date.today()

    # 2. Prune cache
    harbors_to_prune = list(cache.keys()) # Iterate over a copy of keys
    for h_name in harbors_to_prune:
        if h_name not in cache: # Check if harbor still exists (might be removed by inner loop)
            continue
        dates_to_prune = list(cache[h_name].keys()) # Iterate over a copy of date keys
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date < today_date:
                    del cache[h_name][d_str]
                    needs_save = True
                    _LOGGER.debug("Pruned old cache entry: %s for %s", d_str, h_name)
            except ValueError:
                # Invalid date format in cache key, remove it
                del cache[h_name][d_str]
                needs_save = True
                _LOGGER.warning("Removed cache entry with invalid date key: %s for %s", d_str, h_name)

        # Remove harbor entry if it becomes empty after pruning dates
        if not cache[h_name]:
            del cache[h_name]
            needs_save = True # Ensure save happens if harbor entry is removed

    # 3. Check cache
    cached_entry = cache.get(harbor_name, {}).get(date_str)

    if cached_entry is not None:
        _LOGGER.debug("Cache hit for water levels: %s on %s", harbor_name, date_str)
        # Save if pruning occurred
        if needs_save:
            await store.async_save(cache)
            _LOGGER.debug("Saved pruned cache")
        return cached_entry # Return cached data

    # 4. Cache miss - Fetch from API
    _LOGGER.debug("Cache miss for water levels: %s on %s. Fetching from API.", harbor_name, date_str)
    url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
    session = async_get_clientsession(call.hass)

    try:
        async with asyncio.timeout(30):
            response = await session.get(url, headers=HEADERS)
            response.raise_for_status()
            data = await response.json()
            _LOGGER.debug("Received water level data for %s on %s", harbor_name, date_str)

            # 5. Store in cache and save
            cache.setdefault(harbor_name, {})[date_str] = data
            await store.async_save(cache)
            _LOGGER.debug("Cached new water level data for %s on %s and saved cache", harbor_name, date_str)

            return data # Return freshly fetched data

    except asyncio.TimeoutError as err:
        _LOGGER.error("Timeout fetching water levels for %s on %s", harbor_name, date_str)
        raise HomeAssistantError(f"Timeout fetching water levels: {err}") from err
    except aiohttp.ClientResponseError as err:
        _LOGGER.error("HTTP error fetching water levels for %s on %s: %s %s", harbor_name, date_str, err.status, err.message)
        raise HomeAssistantError(f"HTTP error fetching water levels: {err.status} {err.message}") from err
    except aiohttp.ClientError as err:
        _LOGGER.error("Client error fetching water levels for %s on %s: %s", harbor_name, date_str, err)
        raise HomeAssistantError(f"Client error fetching water levels: {err}") from err
    except Exception as err:
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
