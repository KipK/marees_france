""" Marées France integration."""

from __future__ import annotations

import logging
import asyncio
import aiohttp
import voluptuous as vol
from datetime import date, timedelta # Add timedelta import
import random # Add random import
from typing import Any # Add Any import

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
# Remove SupportsResponse from here
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse # Add SupportsResponse here
from homeassistant.exceptions import HomeAssistantError # Import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession # Import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change # Add time tracker import
from homeassistant.helpers.storage import Store # Add Store import
import homeassistant.helpers.config_validation as cv # Import cv

# Local application/library specific imports
from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_GET_WATER_LEVELS,
    CONF_HARBOR_ID, # Add CONF_HARBOR_ID import
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

# Internal helper to fetch and store water level data
async def _async_fetch_and_store_water_level(
    hass: HomeAssistant,
    store: Store,
    cache: dict[str, dict[str, Any]],
    harbor_name: str,
    date_str: str,
) -> Any | None:
    """Fetch water level data from API, store in cache, and save."""
    url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
    session = async_get_clientsession(hass)
    # Keep this as debug as it can be noisy if many dates are fetched
    _LOGGER.debug("Marées France: Fetching water level data for %s on %s from %s", harbor_name, date_str, url)

    try:
        async with asyncio.timeout(30):
            response = await session.get(url, headers=HEADERS)
            response.raise_for_status()
            data = await response.json()
            _LOGGER.debug(
                "Marées France: Received water level data for %s on %s",
                harbor_name,
                date_str,
            )

            # Store in cache and save
            cache.setdefault(harbor_name, {})[date_str] = data
            await store.async_save(cache)
            _LOGGER.debug(
                "Marées France: Cached new water level data for %s on %s and saved cache",
                harbor_name,
                date_str,
            )
            return data

    except asyncio.TimeoutError:
        _LOGGER.error(
            "Marées France: Timeout fetching water levels for %s on %s",
            harbor_name,
            date_str,
        )
    except aiohttp.ClientResponseError as err:
        _LOGGER.error(
            "Marées France: HTTP error fetching water levels for %s on %s: %s %s",
            harbor_name,
            date_str,
            err.status,
            err.message,
        )
    except aiohttp.ClientError as err:
        _LOGGER.error(
            "Marées France: Client error fetching water levels for %s on %s: %s",
            harbor_name,
            date_str,
            err,
        )
    except Exception:
        _LOGGER.exception(
            "Marées France: Unexpected error fetching water levels for %s on %s",
            harbor_name,
            date_str,
        )

    return None # Return None on any error


# Prefetch function
async def async_check_and_prefetch_water_levels(
    hass: HomeAssistant,
    entry: ConfigEntry,
    store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check cache for the next 8 days and prefetch missing water level data."""
    harbor_name = entry.data[CONF_HARBOR_ID] # Use harbor name/ID from config entry
    _LOGGER.info("Starting water level prefetch check for harbor: %s", harbor_name) # Changed to INFO
    cache = await store.async_load() or {}
    today = date.today()
    missing_dates = []

    for i in range(8): # Check today + next 7 days
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime("%Y-%m-%d")
        if check_date_str not in cache.get(harbor_name, {}):
            missing_dates.append(check_date_str)

    if not missing_dates:
        _LOGGER.info(
            "Marées France: Water level cache is up to date for the next 8 days for %s.",
            harbor_name,
        ) # Added INFO log
        return

    _LOGGER.info(
        "Marées France: Found missing water level data for %s on dates: %s. Starting prefetch.",
        harbor_name,
        ", ".join(missing_dates),
    ) # Adjusted wording

    # Fetch missing dates sequentially with delay
    for i, date_str in enumerate(missing_dates):
        await _async_fetch_and_store_water_level(hass, store, cache, harbor_name, date_str)
        # The helper function saves the cache after each successful fetch
        if i < len(missing_dates) - 1: # Don't sleep after the last one
            await asyncio.sleep(2) # Wait 2 seconds between requests

    _LOGGER.info(
        "Marées France: Finished prefetching water level data for %s", harbor_name
    )


# Service Handler Definition
async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get water levels, using caching and fallback fetch."""
    harbor_name = call.data[ATTR_HARBOR_NAME]
    date_str = call.data[ATTR_DATE] # Expected format: YYYY-MM-DD
    hass = call.hass

    store = Store[dict[str, dict[str, Any]]](hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)

    # 1. Load cache
    cache = await store.async_load() or {}
    needs_save = False
    today_date = date.today()

    # 2. Prune cache (only for the requested harbor to optimize)
    if harbor_name in cache:
        dates_to_prune = list(cache[harbor_name].keys())
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date < today_date:
                    del cache[harbor_name][d_str]
                    needs_save = True
                    _LOGGER.debug(
                        "Marées France: Pruned old cache entry: %s for %s",
                        d_str,
                        harbor_name,
                    )
            except ValueError:
                del cache[harbor_name][d_str]
                needs_save = True
                _LOGGER.warning(
                    "Marées France: Removed cache entry with invalid date key: %s for %s",
                    d_str,
                    harbor_name,
                )
        # Remove harbor entry if empty
        if not cache[harbor_name]:
            del cache[harbor_name]
            needs_save = True

    # 3. Check cache
    cached_entry = cache.get(harbor_name, {}).get(date_str)

    if cached_entry is not None:
        _LOGGER.debug(
            "Marées France: Cache hit for water levels service: %s on %s",
            harbor_name,
            date_str,
        )
        if needs_save:
            await store.async_save(cache)
            _LOGGER.debug("Marées France: Saved pruned cache during service call")
        return cached_entry

    # 4. Cache miss - Fallback Fetch (should be rare with prefetching)
    _LOGGER.warning(
        "Marées France: Cache miss during service call for %s on %s. Fetching...",
        harbor_name,
        date_str,
    )
    # Save pruned cache before attempting fetch, if needed
    if needs_save:
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned cache before fallback fetch")

    # Call the helper to fetch and store
    fetched_data = await _async_fetch_and_store_water_level(hass, store, cache, harbor_name, date_str)

    if fetched_data is not None:
        return fetched_data
    else:
        # Error occurred during fetch, helper already logged it.
        raise HomeAssistantError(
            f"Marées France: Failed to fetch water levels for {harbor_name} on {date_str} after cache miss."
        )


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Marées France component."""
    # Register the custom frontend panel (custom card)
    # This should only happen once
    module_register = JSModuleRegistration(hass)
    await module_register.async_register()
    _LOGGER.debug("Marées France: Registered Marées France frontend module.")
    # Return true to indicate successful setup of the component
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Marées France from a config entry."""
    _LOGGER.debug("Marées France: Setting up Marées France entry: %s", entry.entry_id)

    # Create the central coordinator for tide entity updates
    coordinator = MareesFranceUpdateCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Forward the setup to the sensor platform
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _LOGGER.debug("Marées France: Forwarded entry setup for platforms: %s", PLATFORMS)

    # Set up update listener for config entry changes
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # --- Water Level Service and Prefetch Setup ---

    # Create store instance for water levels
    water_level_store = Store[dict[str, dict[str, Any]]](hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)

    # Register the get_water_levels service if not already registered
    if not hass.services.has_service(DOMAIN, SERVICE_GET_WATER_LEVELS):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_WATER_LEVELS,
            async_handle_get_water_levels, # Uses the store internally now
            schema=SERVICE_GET_WATER_LEVELS_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_WATER_LEVELS
        )
    else:
        _LOGGER.debug(
            "Marées France: Service %s.%s already registered.",
            DOMAIN,
            SERVICE_GET_WATER_LEVELS,
        )

    # Schedule initial prefetch check shortly after startup
    hass.async_create_task(async_check_and_prefetch_water_levels(hass, entry, water_level_store))

    # Schedule daily prefetch check at a random time (e.g., 1-5 AM)
    async def _daily_prefetch_job(*_): # Use *_ to accept the 'now' argument from tracker
        """Called daily to trigger the prefetch check."""
        _LOGGER.debug("Marées France: Running daily water level prefetch job.")
        await async_check_and_prefetch_water_levels(hass, entry, water_level_store)

    # Calculate random time for daily check
    rand_hour = random.randint(1, 5)
    rand_min = random.randint(0, 59)
    _LOGGER.info(
        "Marées France: Scheduled daily water level prefetch check at %02d:%02d",
        rand_hour,
        rand_min,
    )

    # Register the daily job and store the cancel function for unload
    remove_daily_job_listener = async_track_time_change(
        hass, _daily_prefetch_job, hour=rand_hour, minute=rand_min, second=0
    )
    entry.async_on_unload(remove_daily_job_listener)
    # --- End Water Level Setup ---

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    _LOGGER.debug("Unloading Marées France entry: %s", entry.entry_id)

    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    # Remove coordinator and data if unload was successful
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        _LOGGER.debug(
            "Marées France: Successfully unloaded Marées France entry: %s", entry.entry_id
        )

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    _LOGGER.debug("RMarées France: eloading Marées France entry: %s", entry.entry_id)
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
    _LOGGER.debug(
        "Marées France: Finished reloading Marées France entry: %s", entry.entry_id
    )
