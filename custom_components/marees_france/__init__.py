""" Marées France integration."""

from __future__ import annotations

import logging # Ensure logging is imported first
import asyncio
import aiohttp
import voluptuous as vol
from datetime import date, timedelta # Add timedelta import
import random # Add random import
from typing import Any # Add Any import

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, CoreState, EVENT_HOMEASSISTANT_STARTED # Add CoreState, EVENT_HOMEASSISTANT_STARTED, Add SupportsResponse here
from homeassistant.exceptions import HomeAssistantError # Import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession # Import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change # Add time tracker import
from homeassistant.helpers.storage import Store # Add Store import
import homeassistant.helpers.config_validation as cv # Import cv
import homeassistant.helpers.device_registry as dr # Add device registry import

# Local application/library specific imports
from .const import (
    ATTR_DATE,
    ATTR_HARBOR_NAME,
    COEFF_STORAGE_KEY, # Import storage keys
    COEFF_STORAGE_VERSION,
    COEFF_URL_TEMPLATE, # Add coefficient URL template
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME, # Add CONF_HARBOR_NAME (needed for migration)
    DATE_FORMAT, # Add DATE_FORMAT
    DOMAIN,
    HARBORSURL, # Add HARBORSURL (needed for fetch_harbors)
    HEADERS, # Ensure HEADERS is imported (needed for fetch_harbors)
    NEAP_TIDE_THRESHOLD, # Add Neap threshold
    PLATFORMS,
    SERVICE_GET_COEFFICIENTS_DATA, # Add new service name
    SERVICE_GET_TIDES_DATA, # Add new service name
    SERVICE_GET_WATER_LEVELS,
    SPRING_TIDE_THRESHOLD, # Add Spring threshold
    TIDES_STORAGE_KEY,
    TIDES_STORAGE_VERSION,
    TIDESURL_TEMPLATE, # Add TIDESURL_TEMPLATE
    WATERLEVELS_STORAGE_KEY,
    WATERLEVELS_STORAGE_VERSION,
    WATERLEVELS_URL_TEMPLATE,
)
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration # Import frontend helper here
# Import helpers from the new file
from .api_helpers import (
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_tides,
    _async_fetch_and_store_coefficients,
)

# Let HA discover config_flow automatically

# Import the standard frontend registration helper
# from homeassistant.components.frontend import async_register_frontend_module # Removed problematic import

_LOGGER = logging.getLogger(__name__)

# --- Exception Class for API Connection Issues ---
class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""


# --- Harbor Fetching Logic (Moved from config_flow) ---
async def fetch_harbors(
    websession: aiohttp.ClientSession,
) -> dict[str, dict[str, str]]:
    """Fetch the list of harbors from the SHOM API."""
    _LOGGER.debug("Fetching harbor list from %s", HARBORSURL)
    harbors: dict[str, dict[str, str]] = {}
    result_harbors: dict[str, dict[str, str]] = {} # Variable to hold result
    try:
        async with asyncio.timeout(20):
            response = await websession.get(HARBORSURL, headers=HEADERS)
            response.raise_for_status()
            data = await response.json()

        if not data or "features" not in data:
            _LOGGER.error("Invalid harbor data received: %s", data)
            raise CannotConnect("Invalid harbor data received")

        for feature in data.get("features", []):
            properties = feature.get("properties")
            if properties and "cst" in properties and "toponyme" in properties:
                harbor_id = properties["cst"]
                harbor_name = properties["toponyme"]
                harbors[harbor_id] = {"display": f"{harbor_name} ({harbor_id})", "name": harbor_name}

        if not harbors:
            _LOGGER.error("No harbors found in the response.")
            raise CannotConnect("No harbors found")

        # Sort harbors by display name and store in result variable
        result_harbors = dict(sorted(harbors.items(), key=lambda item: item[1]["display"]))

    except asyncio.TimeoutError as err:
        _LOGGER.error("Timeout fetching harbor list: %s", err)
        raise CannotConnect(f"Timeout fetching harbor list: {err}") from err
    except aiohttp.ClientError as err:
        _LOGGER.error("Client error fetching harbor list: %s", err)
        raise CannotConnect(f"Client error fetching harbor list: {err}") from err
    except Exception as err:
        _LOGGER.exception("Unexpected error fetching harbor list")
        raise CannotConnect(f"Unexpected error fetching harbor list: {err}") from err

    # Return the result after the try...except block
    return result_harbors


# --- Config Entry Migration (Moved from config_flow) ---
async def async_migrate_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Migrate old entry."""
    _LOGGER.debug("Migrating config entry %s from version %s", config_entry.entry_id, config_entry.version)

    if config_entry.version == 1:
        new_data = {**config_entry.data}
        harbor_id = new_data.get(CONF_HARBOR_ID)

        if not harbor_id:
            _LOGGER.error("Cannot migrate config entry %s: Missing harbor_id", config_entry.entry_id)
            return False

        try:
            websession = async_get_clientsession(hass)
            # Call the local fetch_harbors function
            all_harbors = await fetch_harbors(websession)
        except CannotConnect as err:
            _LOGGER.error("Migration failed for entry %s: Could not fetch harbor list: %s", config_entry.entry_id, err)
            return False
        except Exception as err:
             _LOGGER.exception("Migration failed for entry %s: Unexpected error fetching harbor list", config_entry.entry_id)
             return False

        harbor_details = all_harbors.get(harbor_id)
        if not harbor_details or "name" not in harbor_details:
             _LOGGER.error(
                 "Migration failed for entry %s: Harbor ID '%s' not found in fetched list or missing 'name'",
                 config_entry.entry_id,
                 harbor_id
             )
             return False

        harbor_name = harbor_details["name"]
        new_data[CONF_HARBOR_NAME] = harbor_name

        # Update entry version and data
        hass.config_entries.async_update_entry(config_entry, data=new_data, version=2) # Explicitly set version=2
        _LOGGER.info(
            "Successfully migrated config entry %s to version 2, added harbor_name: %s",
            config_entry.entry_id,
            harbor_name
        )

    # Handle potential future major version downgrades (optional but good practice)
    elif config_entry.version > 2:
        _LOGGER.error(
            "Cannot migrate config entry %s: Config entry version %s is newer than integration version 2",
            config_entry.entry_id,
            config_entry.version
        )
        return False # Migration failed

    _LOGGER.debug("Migration check complete for config entry %s", config_entry.entry_id)
    return True # Return True if migration was successful or not needed for this version
# Service Schemas
SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema({
    vol.Required("device_id"): cv.string, # Changed from ATTR_HARBOR_NAME
    vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"), # Basic YYYY-MM-DD check
})
SERVICE_GET_TIDES_DATA_SCHEMA = vol.Schema({ # Schema for new service
    vol.Required("device_id"): cv.string, # Changed from ATTR_HARBOR_NAME
})
SERVICE_GET_COEFFICIENTS_DATA_SCHEMA = vol.Schema({ # Schema for new service
    vol.Required("device_id"): cv.string,
    vol.Optional(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"), # Optional date YYYY-MM-DD
    vol.Optional("days"): cv.positive_int, # Optional number of days
})


# --- Helper functions moved to api_helpers.py ---


# --- Water Level Prefetch ---
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


# --- Tide Data Prefetch ---
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
    fetch_duration = 8 # Fetch 8 days (yesterday + 7 future)

    # Check if all required dates (yesterday to today+7) are present
    for i in range(-1, fetch_duration -1): # -1 (yesterday) to 6 (today+6) -> 8 days total
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime(DATE_FORMAT)
        if check_date_str not in cache.get(harbor_id, {}):
            _LOGGER.info("Marées France: Missing tide data for %s on %s. Triggering full %d-day fetch.", harbor_id, check_date_str, fetch_duration)
            needs_fetch = True
            break # No need to check further dates if one is missing

    if needs_fetch:
        # Pass the current cache to the fetch function so it can be updated directly
        # Explicitly pass the required duration
        fetch_successful = await _async_fetch_and_store_tides(hass, store, cache, harbor_id, yesterday_str, duration=fetch_duration)
        if fetch_successful:
            _LOGGER.info("Marées France: Successfully prefetched %d days of tide data for %s starting %s.", fetch_duration, harbor_id, yesterday_str)
            # Cache was saved by the helper, but set needs_save for pruning check below
            needs_save = True # Mark that changes (fetch) happened
        else:
            _LOGGER.error("Marées France: Failed to prefetch tide data for %s.", harbor_id)
            # Don't proceed with pruning if fetch failed, might lose last good data
            return
    else:
         _LOGGER.info("Marées France: Tide data cache is up to date for %s (yesterday to today+%d).", harbor_id, fetch_duration - 1)


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
         # Return a structured error response
         return {"error": "no_cached_data", "message": f"No cached tide data found for harbor '{harbor_id}'"}

    _LOGGER.debug("Marées France: Returning cached tide data for harbor '%s' (device: %s) via service call.", harbor_id, device_id)
    return harbor_data


# --- Coefficient Prefetch ---
async def async_check_and_prefetch_coefficients(
    hass: HomeAssistant,
    entry: ConfigEntry,
    store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check coefficient cache (today to today+364), prefetch missing, and prune old."""
    harbor_id = entry.data[CONF_HARBOR_ID]
    _LOGGER.info("Marées France: Starting coefficient data prefetch check for harbor: %s", harbor_id)
    cache = await store.async_load() or {}
    today = date.today()
    needs_save = False
    fetch_start_date = None
    fetch_days = 0

    # --- Pruning ---
    if harbor_id in cache:
        dates_to_prune = list(cache[harbor_id].keys())
        pruned_count = 0
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                # Prune if the date's year is before the current year,
                # or if the year is the same but the month is before the current month.
                if d_date.year < today.year or (d_date.year == today.year and d_date.month < today.month):
                    del cache[harbor_id][d_str]
                    needs_save = True
                    pruned_count += 1
            except ValueError: # Handle potential invalid date strings in cache
                 del cache[harbor_id][d_str]
                 needs_save = True
                 pruned_count += 1
                 _LOGGER.warning("Marées France: Removed coefficient cache entry with invalid date key: %s for %s", d_str, harbor_id)
        if pruned_count > 0:
             _LOGGER.info("Marées France: Pruned %d old coefficient data entries for %s.", pruned_count, harbor_id)
        # Remove harbor entry if empty after pruning
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True # Ensure save if harbor entry removed

    # --- Check and Fetch ---
    harbor_cache = cache.get(harbor_id, {})
    first_missing_date = None
    # Define the required range: 365 days starting from the 1st of the current month
    first_day_of_current_month = today.replace(day=1)
    required_start_date = first_day_of_current_month
    required_end_date = required_start_date + timedelta(days=364) # 365 days total including start date

    # Check from the required start date up to the required end date
    current_check_date = required_start_date
    while current_check_date <= required_end_date:
        check_date_str = current_check_date.strftime(DATE_FORMAT)
        if check_date_str not in harbor_cache:
            if first_missing_date is None:
                first_missing_date = current_check_date
            # Keep checking until the end of the required window to find the full range to fetch
        elif first_missing_date is not None:
            # We found data *after* finding a missing date. This shouldn't happen with contiguous fetching.
            # Log a warning and fetch from the first missing date anyway.
             _LOGGER.warning("Marées France: Found cached coefficient data for %s after missing date %s. Inconsistency detected.", check_date_str, first_missing_date.strftime(DATE_FORMAT))
             # Continue checking to ensure we fetch up to the required end date if needed
        current_check_date += timedelta(days=1)

    if first_missing_date is not None:
        fetch_start_date = first_missing_date
        # Calculate days needed: from first missing date up to the required end date
        fetch_days = (required_end_date - fetch_start_date).days + 1
        _LOGGER.info("Marées France: Missing coefficient data for %s starting %s (up to %s). Need to fetch %d days.", harbor_id, fetch_start_date.strftime(DATE_FORMAT), required_end_date.strftime(DATE_FORMAT), fetch_days)

        fetch_successful = await _async_fetch_and_store_coefficients(hass, store, cache, harbor_id, fetch_start_date, fetch_days)
        if fetch_successful:
            _LOGGER.info("Marées France: Successfully prefetched %d days of coefficient data for %s starting %s.", fetch_days, harbor_id, fetch_start_date.strftime(DATE_FORMAT))
            # Cache was saved by the helper
            needs_save = False # Reset needs_save as fetch helper saved it
        else:
            _LOGGER.error("Marées France: Failed to prefetch coefficient data for %s.", harbor_id)
            # Don't save if fetch failed, keep potentially pruned state from before fetch attempt
            if needs_save:
                 await store.async_save(cache)
                 _LOGGER.debug("Marées France: Saved pruned coefficients cache for %s after failed fetch.", harbor_id)
            return # Exit prefetch check
    else:
         _LOGGER.info("Marées France: Coefficient data cache is up to date for %s (from %s to %s).", harbor_id, required_start_date.strftime(DATE_FORMAT), required_end_date.strftime(DATE_FORMAT))

    # Save if only pruning occurred
    if needs_save:
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned coefficients cache for %s", harbor_id)

    _LOGGER.info("Marées France: Finished coefficient data prefetch check for harbor: %s", harbor_id)


# Specific Tide Date Prefetch Helper removed as logic is now handled by coordinator
# --- Service Handler for Coefficients (New) ---

async def async_handle_get_coefficients_data(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get cached coefficient data for a device."""
    device_id = call.data["device_id"]
    req_date_str = call.data.get(ATTR_DATE)
    req_days = call.data.get("days")
    hass = call.hass

    # Resolve harbor_id
    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get(device_id)
    if not device_entry or not device_entry.config_entries:
        raise HomeAssistantError(f"Device {device_id} not found or not linked to Marées France.")
    config_entry_id = next(iter(device_entry.config_entries))
    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry or config_entry.domain != DOMAIN:
         raise HomeAssistantError(f"Config entry {config_entry_id} not found or not for {DOMAIN}")
    harbor_id = config_entry.data[CONF_HARBOR_ID]

    _LOGGER.debug("Service call get_coefficients_data for device %s (harbor: %s), date: %s, days: %s",
                  device_id, harbor_id, req_date_str, req_days)

    # Load cache
    coeff_store = Store[dict[str, dict[str, Any]]](hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY)
    cache = await coeff_store.async_load() or {}
    harbor_cache = cache.get(harbor_id, {})

    if not harbor_cache:
         _LOGGER.warning("Marées France: No cached coefficient data found for harbor '%s' (device: %s).", harbor_id, device_id)
         return {} # Return empty dict

    # Determine date range and filter data
    results = {}
    today = date.today()

    if req_date_str:
        try:
            start_date = date.fromisoformat(req_date_str)
        except ValueError:
            raise HomeAssistantError(f"Invalid date format: {req_date_str}. Use YYYY-MM-DD.")
        if req_days:
            # Date and days provided
            end_date = start_date + timedelta(days=req_days - 1)
        else:
            # Only date provided
            end_date = start_date
    elif req_days:
        # Only days provided, start from today
        start_date = today
        end_date = start_date + timedelta(days=req_days - 1)
    else:
        # Neither provided, return all cached data (keys are dates)
        _LOGGER.debug("Marées France: Returning all cached coefficient data for harbor '%s'.", harbor_id)
        return harbor_cache # Return the full harbor cache directly

    # Filter data for the calculated range
    current_date = start_date
    while current_date <= end_date:
        current_date_str = current_date.strftime(DATE_FORMAT)
        if current_date_str in harbor_cache:
            results[current_date_str] = harbor_cache[current_date_str]
        current_date += timedelta(days=1)

    _LOGGER.debug("Marées France: Returning coefficient data for harbor '%s' from %s to %s.",
                  harbor_id, start_date.strftime(DATE_FORMAT), end_date.strftime(DATE_FORMAT))
    return results


# --- Component Setup ---

async def async_register_frontend_modules_when_ready(hass: HomeAssistant):
    """Register frontend modules once Home Assistant is started."""
    _LOGGER.debug("Home Assistant started, registering frontend modules.")
    module_register = JSModuleRegistration(hass)
    await module_register.async_register()
    _LOGGER.debug("Marées France: Registered Marées France frontend module.")


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Marées France component."""
    # Defer frontend registration until HA is started
    async def _setup_frontend(_event=None):
        """Register frontend modules."""
        await async_register_frontend_modules_when_ready(hass)

    if hass.state == CoreState.running:
        _LOGGER.debug("Home Assistant already running, registering frontend modules immediately.")
        await _setup_frontend()
    else:
        _LOGGER.debug("Home Assistant not running yet, scheduling frontend module registration.")
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _setup_frontend)

    # Return true immediately, registration is now handled asynchronously
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Marées France from a config entry."""
    _LOGGER.debug("Marées France: Setting up Marées France entry: %s", entry.entry_id)

    # --- Store Setup ---
    water_level_store = Store[dict[str, dict[str, Any]]](hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)
    tides_store = Store[dict[str, dict[str, Any]]](hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY) # Tides store
    coeff_store = Store[dict[str, dict[str, Any]]](hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY) # Add Coeff store

    # --- Coordinator Setup (Now uses Tides, Coeff, and Water Level Stores) ---
    # Pass all three stores to the coordinator
    coordinator = MareesFranceUpdateCoordinator(
        hass,
        entry,
        tides_store,
        coeff_store,
        water_level_store # Pass the water level store
    )

    # --- Prefetching (Run before first refresh) ---
    # Run initial prefetches sequentially
    await async_check_and_prefetch_water_levels(hass, entry, water_level_store)
    await async_check_and_prefetch_tides(hass, entry, tides_store)
    # Check coefficients first
    await async_check_and_prefetch_coefficients(hass, entry, coeff_store)
    # Specific tide prefetch removed


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

    # Coefficients Data Service (New)
    if not hass.services.has_service(DOMAIN, SERVICE_GET_COEFFICIENTS_DATA):
        hass.services.async_register(
            DOMAIN, SERVICE_GET_COEFFICIENTS_DATA, async_handle_get_coefficients_data,
            schema=SERVICE_GET_COEFFICIENTS_DATA_SCHEMA, supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug("Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_COEFFICIENTS_DATA)


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

    # Coefficients Prefetch (Daily - New), followed by specific tide prefetch
    async def _daily_coefficients_prefetch_job(*_):
        _LOGGER.debug("Marées France: Running daily coefficients prefetch job.")
        try:
            # Assuming async_check_and_prefetch_coefficients handles its own errors and logging
            await async_check_and_prefetch_coefficients(hass, entry, coeff_store)
            # Specific tide prefetch removed, coordinator handles finding dates now.
            _LOGGER.debug("Marées France: Coefficients check done.")
            # No need to trigger specific tide prefetch here anymore
        except Exception:
            _LOGGER.exception("Marées France: Error during scheduled coefficient prefetch job for %s", entry.data.get(CONF_HARBOR_ID))

    rand_c_hour = random.randint(1, 5)
    rand_c_min = random.randint(0, 59)
    # Ensure different time from others
    while (rand_c_hour == rand_wl_hour and rand_c_min == rand_wl_min) or \
          (rand_c_hour == rand_t_hour and rand_c_min == rand_t_min):
         rand_c_min = random.randint(0, 59) # Reroll minute first
         if rand_c_min == rand_wl_min and rand_c_hour == rand_wl_hour: continue # Avoid infinite loop if all slots taken in the hour
         if rand_c_min == rand_t_min and rand_c_hour == rand_t_hour: continue
    _LOGGER.info("Marées France: Scheduled daily coefficients prefetch check at %02d:%02d", rand_c_hour, rand_c_min)
    listeners.append(async_track_time_change(
        hass, _daily_coefficients_prefetch_job, hour=rand_c_hour, minute=rand_c_min, second=0
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
