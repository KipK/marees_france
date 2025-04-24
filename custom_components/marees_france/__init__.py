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
import homeassistant.helpers.device_registry as dr # Add device registry import

# Local application/library specific imports
from .const import (
    DOMAIN,
    PLATFORMS,
    SERVICE_GET_WATER_LEVELS,
    SERVICE_GET_TIDES_DATA, # Add new service name
    CONF_HARBOR_ID,
    ATTR_HARBOR_NAME,
    ATTR_DATE,
    DATE_FORMAT, # Add DATE_FORMAT
    TIDESURL_TEMPLATE, # Add TIDESURL_TEMPLATE
    WATERLEVELS_URL_TEMPLATE,
    HEADERS, # Ensure HEADERS is imported
)
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration # Import frontend helper here

# Import the standard frontend registration helper
# from homeassistant.components.frontend import async_register_frontend_module # Removed problematic import

_LOGGER = logging.getLogger(__name__)

# Storage constants
WATERLEVELS_STORAGE_KEY = f"{DOMAIN}_water_levels_cache"
WATERLEVELS_STORAGE_VERSION = 1
TIDES_STORAGE_KEY = f"{DOMAIN}_tides_cache" # New key for tides
TIDES_STORAGE_VERSION = 1 # New version for tides

# Service Schemas
SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema({
    vol.Required("device_id"): cv.string, # Changed from ATTR_HARBOR_NAME
    vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"), # Basic YYYY-MM-DD check
})
SERVICE_GET_TIDES_DATA_SCHEMA = vol.Schema({ # Schema for new service
    vol.Required("device_id"): cv.string, # Changed from ATTR_HARBOR_NAME
})


# --- Water Level Helpers ---

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
    """Handle the service call to get water levels for a device, using caching."""
    device_id = call.data["device_id"]
    date_str = call.data[ATTR_DATE] # Expected format: YYYY-MM-DD
    hass = call.hass

    # Get harbor_id (harbor name) from device registry -> config entry
    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get(device_id)
    if not device_entry:
        raise HomeAssistantError(f"Device not found: {device_id}")
    if not device_entry.config_entries:
         raise HomeAssistantError(f"Device {device_id} not associated with a config entry")
    # Assuming the first config entry is the correct one for this integration's device
    config_entry_id = next(iter(device_entry.config_entries))
    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry or config_entry.domain != DOMAIN:
         raise HomeAssistantError(f"Config entry {config_entry_id} not found or not for {DOMAIN}")
    harbor_id = config_entry.data[CONF_HARBOR_ID] # This is the harbor name/ID used in cache/API

    _LOGGER.debug("Service call get_water_levels for device %s (harbor: %s), date: %s", device_id, harbor_id, date_str)

    store = Store[dict[str, dict[str, Any]]](hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)

    # 1. Load cache
    cache = await store.async_load() or {}
    needs_save = False
    today_date = date.today()

    # 2. Prune cache (only for the requested harbor to optimize)
    if harbor_id in cache: # Use harbor_id from config entry
        dates_to_prune = list(cache[harbor_id].keys())
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date < today_date:
                    del cache[harbor_id][d_str]
                    needs_save = True
                    _LOGGER.debug(
                        "Marées France: Pruned old cache entry: %s for %s",
                        d_str,
                        harbor_id, # Use harbor_id
                    )
            except ValueError:
                del cache[harbor_id][d_str]
                needs_save = True
                _LOGGER.warning(
                    "Marées France: Removed cache entry with invalid date key: %s for %s",
                    d_str,
                    harbor_id, # Use harbor_id
                )
        # Remove harbor entry if empty
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True

    # 3. Check cache
    cached_entry = cache.get(harbor_id, {}).get(date_str) # Use harbor_id

    if cached_entry is not None:
        _LOGGER.debug(
            "Marées France: Cache hit for water levels service: %s on %s",
            harbor_id, # Use harbor_id
            date_str,
        )
        if needs_save:
            await store.async_save(cache)
            _LOGGER.debug("Marées France: Saved pruned cache during service call")
        return cached_entry

    # 4. Cache miss - Fallback Fetch (should be rare with prefetching)
    _LOGGER.warning(
        "Marées France: Cache miss during service call for %s on %s. Fetching...",
        harbor_id, # Use harbor_id
        date_str,
    )
    # Save pruned cache before attempting fetch, if needed
    if needs_save:
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned cache before fallback fetch")

    # Call the helper to fetch and store
    fetched_data = await _async_fetch_and_store_water_level(hass, store, cache, harbor_id, date_str) # Use harbor_id

    if fetched_data is not None:
        return fetched_data
    else:
        # Error occurred during fetch, helper already logged it.
        raise HomeAssistantError(
            f"Marées France: Failed to fetch water levels for {harbor_id} on {date_str} after cache miss." # Use harbor_id
        )


# --- Tide Data Helpers ---

async def _async_fetch_and_store_tides(
    hass: HomeAssistant,
    store: Store,
    cache: dict[str, dict[str, Any]],
    harbor_id: str, # API uses harbor_id for tides
    start_date_str: str,
) -> bool:
    """Fetch 8 days of tide data starting from start_date_str, parse, store, and save."""
    # Construct URL for 8 days starting from start_date_str
    # Note: We add duration=8 here, it's not in the template anymore
    url = f"{TIDESURL_TEMPLATE.format(harbor_id=harbor_id, date=start_date_str)}&duration=8"
    session = async_get_clientsession(hass)
    _LOGGER.debug("Marées France: Fetching 8 days of tide data for %s starting %s from %s", harbor_id, start_date_str, url)

    try:
        async with asyncio.timeout(45): # Slightly longer timeout for multi-day fetch
            response = await session.get(url, headers=HEADERS)
            response.raise_for_status()
            # The API returns a dict like {"YYYY-MM-DD": [[tide_info], ...], ...}
            fetched_data_dict = await response.json()
            _LOGGER.debug("Marées France: Received tide data for %s starting %s", harbor_id, start_date_str)

            # Update cache with fetched data, day by day
            cache.setdefault(harbor_id, {}) # Ensure harbor key exists
            for day_str, tides in fetched_data_dict.items():
                cache[harbor_id][day_str] = tides
                _LOGGER.debug("Marées France: Updated cache for %s on %s", harbor_id, day_str)

            await store.async_save(cache)
            _LOGGER.debug("Marées France: Saved updated tides cache for %s", harbor_id)
            return True # Indicate success

    except asyncio.TimeoutError:
        _LOGGER.error("Marées France: Timeout fetching tide data for %s starting %s", harbor_id, start_date_str)
    except aiohttp.ClientResponseError as err:
        _LOGGER.error("Marées France: HTTP error fetching tide data for %s starting %s: %s %s", harbor_id, start_date_str, err.status, err.message)
    except aiohttp.ClientError as err:
        _LOGGER.error("Marées France: Client error fetching tide data for %s starting %s: %s", harbor_id, start_date_str, err)
    except Exception:
        _LOGGER.exception("Marées France: Unexpected error fetching tide data for %s starting %s", harbor_id, start_date_str)

    return False # Indicate failure


async def async_check_and_prefetch_tides(
    hass: HomeAssistant,
    entry: ConfigEntry,
    store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check tide cache (yesterday to today+7) and prefetch if needed. Prune old data."""
    harbor_id = entry.data[CONF_HARBOR_ID]
    _LOGGER.info("Marées France: Starting tide data prefetch check for harbor: %s", harbor_id)
    cache = await store.async_load() or {}
    today = date.today()
    yesterday = today - timedelta(days=1)
    yesterday_str = yesterday.strftime(DATE_FORMAT)
    needs_fetch = False
    needs_save = False

    # Check if all required dates (yesterday to today+7) are present
    for i in range(-1, 8): # -1 (yesterday) to 7 (today+7) -> 9 days total
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime(DATE_FORMAT)
        if check_date_str not in cache.get(harbor_id, {}):
            _LOGGER.info("Marées France: Missing tide data for %s on %s. Triggering full 8-day fetch.", harbor_id, check_date_str)
            needs_fetch = True
            break # No need to check further dates if one is missing

    if needs_fetch:
        # Pass the current cache to the fetch function so it can be updated directly
        fetch_successful = await _async_fetch_and_store_tides(hass, store, cache, harbor_id, yesterday_str)
        if fetch_successful:
            _LOGGER.info("Marées France: Successfully prefetched 8 days of tide data for %s starting %s.", harbor_id, yesterday_str)
            # Cache was saved by the helper, but set needs_save for pruning check below
            needs_save = True # Mark that changes (fetch) happened
        else:
            _LOGGER.error("Marées France: Failed to prefetch tide data for %s.", harbor_id)
            # Don't proceed with pruning if fetch failed, might lose last good data
            return
    else:
         _LOGGER.info("Marées France: Tide data cache is up to date for %s (yesterday to today+7).", harbor_id)


    # Prune cache: remove dates before yesterday for this harbor
    if harbor_id in cache:
        dates_to_prune = list(cache[harbor_id].keys())
        pruned_count = 0
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date < yesterday:
                    del cache[harbor_id][d_str]
                    needs_save = True # Mark that changes (pruning) happened
                    pruned_count += 1
            except ValueError: # Handle potential invalid date strings in cache
                 del cache[harbor_id][d_str]
                 needs_save = True
                 pruned_count += 1
                 _LOGGER.warning("Marées France: Removed tide cache entry with invalid date key: %s for %s", d_str, harbor_id)
        if pruned_count > 0:
             _LOGGER.info("Marées France: Pruned %d old tide data entries for %s.", pruned_count, harbor_id)
        # Remove harbor entry if empty after pruning
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True # Ensure save if harbor entry removed

    # Save if pruning occurred AND fetch didn't happen (fetch saves itself)
    if needs_save and not needs_fetch:
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned tides cache for %s", harbor_id)

    _LOGGER.info("Marées France: Finished tide data prefetch check for harbor: %s", harbor_id)


# --- Service Handler for Tides ---

async def async_handle_get_tides_data(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get all cached tides data for a device."""
    device_id = call.data["device_id"]
    hass = call.hass

    # Get harbor_id (harbor name) from device registry -> config entry
    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get(device_id)
    if not device_entry:
        raise HomeAssistantError(f"Device not found: {device_id}")
    if not device_entry.config_entries:
         raise HomeAssistantError(f"Device {device_id} not associated with a config entry")
    config_entry_id = next(iter(device_entry.config_entries))
    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry or config_entry.domain != DOMAIN:
         raise HomeAssistantError(f"Config entry {config_entry_id} not found or not for {DOMAIN}")
    harbor_id = config_entry.data[CONF_HARBOR_ID] # This is the harbor name/ID used in cache

    _LOGGER.debug("Service call get_tides_data for device %s (harbor: %s)", device_id, harbor_id)

    tides_store = Store[dict[str, dict[str, Any]]](hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY)
    cache = await tides_store.async_load() or {}

    # Get data using the harbor_id from the config entry
    harbor_data = cache.get(harbor_id, {})

    if not harbor_data:
         _LOGGER.warning("Marées France: No cached tide data found for harbor '%s' (device: %s) in service call.", harbor_id, device_id)
         return {} # Return empty dict

    _LOGGER.debug("Marées France: Returning cached tide data for harbor '%s' (device: %s) via service call.", harbor_id, device_id)
    return harbor_data


# --- Component Setup ---

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

    # --- Store Setup ---
    water_level_store = Store[dict[str, dict[str, Any]]](hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)
    tides_store = Store[dict[str, dict[str, Any]]](hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY) # Tides store

    # --- Coordinator Setup (Now uses Tides Store) ---
    # Pass the tides_store to the coordinator
    coordinator = MareesFranceUpdateCoordinator(hass, entry, tides_store)
    # Initial refresh will now use the cache, potentially populated by prefetch below
    # Run prefetch checks *before* first coordinator refresh to ensure data is likely there
    await async_check_and_prefetch_water_levels(hass, entry, water_level_store)
    await async_check_and_prefetch_tides(hass, entry, tides_store)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # --- Platform Setup ---
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _LOGGER.debug("Marées France: Forwarded entry setup for platforms: %s", PLATFORMS)

    # --- Update Listener ---
    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    # --- Service Registration ---
    # Water Levels Service
    if not hass.services.has_service(DOMAIN, SERVICE_GET_WATER_LEVELS):
        hass.services.async_register(
            DOMAIN, SERVICE_GET_WATER_LEVELS, async_handle_get_water_levels,
            schema=SERVICE_GET_WATER_LEVELS_SCHEMA, supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug("Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_WATER_LEVELS)
    # Tides Data Service (New)
    if not hass.services.has_service(DOMAIN, SERVICE_GET_TIDES_DATA):
        hass.services.async_register(
            DOMAIN, SERVICE_GET_TIDES_DATA, async_handle_get_tides_data,
            schema=SERVICE_GET_TIDES_DATA_SCHEMA, supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug("Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_TIDES_DATA)

    # --- Prefetch Scheduling ---
    listeners = [] # Store listeners to remove on unload

    # Water Level Prefetch (Daily)
    async def _daily_water_level_prefetch_job(*_):
        _LOGGER.debug("Marées France: Running daily water level prefetch job.")
        await async_check_and_prefetch_water_levels(hass, entry, water_level_store)
    rand_wl_hour = random.randint(1, 5)
    rand_wl_min = random.randint(0, 59)
    _LOGGER.info("Marées France: Scheduled daily water level prefetch check at %02d:%02d", rand_wl_hour, rand_wl_min)
    listeners.append(async_track_time_change(
        hass, _daily_water_level_prefetch_job, hour=rand_wl_hour, minute=rand_wl_min, second=0
    ))

    # Tides Prefetch (Daily)
    async def _daily_tides_prefetch_job(*_):
        _LOGGER.debug("Marées France: Running daily tides prefetch job.")
        await async_check_and_prefetch_tides(hass, entry, tides_store)
    # Schedule tides check at a different random time
    rand_t_hour = random.randint(1, 5)
    # Ensure different minute if hour is the same
    rand_t_min = random.randint(0, 59)
    while rand_t_hour == rand_wl_hour and rand_t_min == rand_wl_min:
         rand_t_min = random.randint(0, 59)
    _LOGGER.info("Marées France: Scheduled daily tides prefetch check at %02d:%02d", rand_t_hour, rand_t_min)
    listeners.append(async_track_time_change(
        hass, _daily_tides_prefetch_job, hour=rand_t_hour, minute=rand_t_min, second=0
    ))

    # Add unload handler for all listeners
    def _unload_listeners():
        _LOGGER.debug("Marées France: Removing daily prefetch listeners.")
        for remove_listener in listeners:
            remove_listener()
    entry.async_on_unload(_unload_listeners)

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
