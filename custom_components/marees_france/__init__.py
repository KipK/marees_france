"""
Marées France integration.

This component provides tide, coefficient, and water level information for French harbors.
It sets up sensors, services, and handles data fetching and caching.
"""

from __future__ import annotations

import logging
import asyncio
from datetime import date, timedelta
import random
from typing import Any

# Third-party imports
import aiohttp
import voluptuous as vol

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    CoreState,
    EVENT_HOMEASSISTANT_STARTED,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
import homeassistant.helpers.config_validation as cv
import homeassistant.helpers.device_registry as dr
from homeassistant.components import websocket_api

# Local application/library specific imports
from .const import (
    ATTR_DATE,
    COEFF_STORAGE_KEY,
    COEFF_STORAGE_VERSION,
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    DATE_FORMAT,
    DOMAIN,
    CONF_HARBOR_LAT,
    CONF_HARBOR_LON,
    HARBORSURL,
    HEADERS,
    PLATFORMS,
    SERVICE_GET_COEFFICIENTS_DATA,
    SERVICE_GET_TIDES_DATA,
    SERVICE_GET_WATER_LEVELS,
    SERVICE_REINITIALIZE_HARBOR_DATA,
    SERVICE_GET_WATER_TEMP,
    TIDES_STORAGE_KEY,
    TIDES_STORAGE_VERSION,
    WATERLEVELS_STORAGE_KEY,
    WATERLEVELS_STORAGE_VERSION,
    WATERTEMP_STORAGE_KEY,
    WATERTEMP_STORAGE_VERSION,
)
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration
from .api_helpers import (
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_tides,
    _async_fetch_and_store_coefficients,
    _async_fetch_and_store_water_temp,
)


_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema("marees_france")


class CannotConnect(HomeAssistantError):
    """Error to indicate a failure to connect to the SHOM API."""


async def fetch_harbors(
    websession: aiohttp.ClientSession,
) -> dict[str, dict[str, str]]:
    """Fetch the list of harbors from the SHOM API.

    Args:
        websession: The aiohttp client session to use for the request.

    Returns:
        A dictionary of harbors, where keys are harbor IDs and values are
        dictionaries containing 'display' (formatted name) and 'name' (harbor name).

    Raises:
        CannotConnect: If there's an issue fetching or parsing the harbor list.
    """
    _LOGGER.debug("Fetching harbor list from %s", HARBORSURL)
    harbors: dict[str, dict[str, str]] = {}
    result_harbors: dict[str, dict[str, str]] = {}
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
                if properties.get("ut") is None or properties.get("nota") == 6:
                    continue
                harbor_id = properties["cst"]
                harbor_name = properties["toponyme"]
                lat = properties.get("lat")
                lon = properties.get("lon")
                harbors[harbor_id] = {
                    "display": f"{harbor_name} ({harbor_id})",
                    "name": harbor_name,
                    "lat": lat,
                    "lon": lon,
                }

        if not harbors:
            _LOGGER.error("No harbors found in the response.")
            raise CannotConnect("No harbors found")

        result_harbors = dict(
            sorted(harbors.items(), key=lambda item: item[1]["display"])
        )

    except asyncio.TimeoutError as err:
        _LOGGER.error("Timeout fetching harbor list: %s", err)
        raise CannotConnect(f"Timeout fetching harbor list: {err}") from err
    except aiohttp.ClientError as err:
        _LOGGER.error("Client error fetching harbor list: %s", err)
        raise CannotConnect(f"Client error fetching harbor list: {err}") from err
    except Exception as err:
        _LOGGER.exception("Unexpected error fetching harbor list")
        raise CannotConnect(f"Unexpected error fetching harbor list: {err}") from err

    return result_harbors


async def async_migrate_entry(hass: HomeAssistant, config_entry: ConfigEntry) -> bool:
    """Migrate an old config entry to the current version.

    Currently supports migration from version 1 to version 2, which involves
    fetching and adding the harbor name based on the harbor ID.

    Args:
        hass: The Home Assistant instance.
        config_entry: The config entry to migrate.

    Returns:
        True if migration was successful or not needed, False otherwise.
    """
    _LOGGER.debug(
        "Migrating config entry %s from version %s",
        config_entry.entry_id,
        config_entry.version,
    )

    if config_entry.version == 1:
        new_data = {**config_entry.data}
        harbor_id = new_data.get(CONF_HARBOR_ID)

        if not harbor_id:
            _LOGGER.error(
                "Cannot migrate config entry %s: Missing harbor_id",
                config_entry.entry_id,
            )
            return False

        try:
            websession = async_get_clientsession(hass)
            all_harbors = await fetch_harbors(websession)
        except CannotConnect as err:
            _LOGGER.error(
                "Migration failed for entry %s: Could not fetch harbor list: %s",
                config_entry.entry_id,
                err,
            )
            return False
        except Exception:
            _LOGGER.exception(
                "Migration failed for entry %s: Unexpected error fetching harbor list",
                config_entry.entry_id,
            )
            return False

        harbor_details = all_harbors.get(harbor_id)
        if not harbor_details or "name" not in harbor_details:
            _LOGGER.error(
                "Migration failed for entry %s: Harbor ID '%s' not found "
                "in fetched list or missing 'name'",
                config_entry.entry_id,
                harbor_id,
            )
            return False

        harbor_name = harbor_details["name"]
        new_data[CONF_HARBOR_NAME] = harbor_name
        new_data[CONF_HARBOR_LAT] = harbor_details.get("lat")
        new_data[CONF_HARBOR_LON] = harbor_details.get("lon")

        hass.config_entries.async_update_entry(config_entry, data=new_data, version=2)
        _LOGGER.info(
            "Successfully migrated config entry %s to version 2, added harbor_name: %s",
            config_entry.entry_id,
            harbor_name,
        )

    elif config_entry.version > 2:
        _LOGGER.error(
            "Cannot migrate config entry %s: Config entry version %s is newer than "
            "integration version 2",
            config_entry.entry_id,
            config_entry.version,
        )
        return False

    _LOGGER.debug("Migration check complete for config entry %s", config_entry.entry_id)
    return True


# Service Schemas
SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
    }
)
SERVICE_GET_TIDES_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
    }
)
SERVICE_GET_COEFFICIENTS_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Optional(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
        vol.Optional("days"): cv.positive_int,
    }
)
SERVICE_REINITIALIZE_HARBOR_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
    }
)
SERVICE_GET_WATER_TEMP_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Optional(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
    }
)

# Websocket Command Schemas
WS_GET_WATER_LEVELS_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/get_water_levels",
        vol.Required("device_id"): cv.string,
        vol.Required("date"): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
    }
)

WS_GET_TIDES_DATA_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/get_tides_data",
        vol.Required("device_id"): cv.string,
    }
)

WS_GET_COEFFICIENTS_DATA_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/get_coefficients_data",
        vol.Required("device_id"): cv.string,
        vol.Optional("date"): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
        vol.Optional("days"): cv.positive_int,
    }
)
WS_GET_WATER_TEMP_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/get_water_temp",
        vol.Required("device_id"): cv.string,
        vol.Optional("date"): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
    }
)


# Shared Helper Functions for Services and Websocket Commands
async def _get_device_and_harbor_id(
    hass: HomeAssistant, device_id: str
) -> tuple[str, ConfigEntry]:
    """Get harbor_id and config_entry from device_id. Raises HomeAssistantError if not found."""
    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get(device_id)
    if not device_entry:
        raise HomeAssistantError(f"Device not found: {device_id}")
    if not device_entry.config_entries:
        raise HomeAssistantError(
            f"Device {device_id} not associated with a config entry"
        )
    config_entry_id = next(iter(device_entry.config_entries))
    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry or config_entry.domain != DOMAIN:
        raise HomeAssistantError(
            f"Config entry {config_entry_id} not found or not for {DOMAIN}"
        )
    harbor_id = config_entry.data[CONF_HARBOR_ID]
    return harbor_id, config_entry


async def _get_water_levels_data(
    hass: HomeAssistant, harbor_id: str, date_str: str
) -> dict[str, Any]:
    """Get water levels data for harbor and date. Returns the same format as service."""
    store = Store[dict[str, dict[str, Any]]](
        hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY
    )

    cache = await store.async_load() or {}
    needs_save = False
    today_date = date.today()

    if harbor_id in cache:
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
                        harbor_id,
                    )
            except ValueError:
                del cache[harbor_id][d_str]
                needs_save = True
                _LOGGER.warning(
                    "Marées France: Removed cache entry with invalid date key: %s for %s",
                    d_str,
                    harbor_id,
                )
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True

    cached_entry = cache.get(harbor_id, {}).get(date_str)

    if cached_entry is not None:
        _LOGGER.debug(
            "Marées France: Cache hit for water levels: %s on %s",
            harbor_id,
            date_str,
        )
        if needs_save:
            await store.async_save(cache)
            _LOGGER.debug("Marées France: Saved pruned cache during data fetch")
        return cached_entry

    _LOGGER.warning(
        "Marées France: Cache miss during data fetch for %s on %s. Fetching...",
        harbor_id,
        date_str,
    )
    if needs_save:
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned cache before fallback fetch")

    websession = async_get_clientsession(hass)
    fetched_data = await _async_fetch_and_store_water_level(
        hass, store, cache, harbor_id, date_str, websession=websession
    )

    if fetched_data is None:
        raise HomeAssistantError(
            f"Marées France: Failed to fetch water levels for {harbor_id} "
            f"on {date_str} after cache miss."
        )
    return fetched_data


async def _get_tides_data(hass: HomeAssistant, harbor_id: str) -> dict[str, Any]:
    """Get tides data for harbor. Returns the same format as service."""
    tides_store = Store[dict[str, dict[str, Any]]](
        hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY
    )
    cache = await tides_store.async_load() or {}

    harbor_data = cache.get(harbor_id, {})

    data_valid = True
    if not isinstance(harbor_data, dict):
        data_valid = False
        _LOGGER.warning(
            "Marées France: Invalid cache format for harbor '%s': "
            "Expected dict, got %s.",
            harbor_id,
            type(harbor_data).__name__,
        )
    elif not harbor_data:
        data_valid = False
        _LOGGER.warning(
            "Marées France: No cached tide data found for harbor '%s' "
            "(empty cache entry).",
            harbor_id,
        )
    else:
        for date_key, daily_tides in harbor_data.items():
            if not isinstance(daily_tides, list):
                data_valid = False
                _LOGGER.warning(
                    "Marées France: Invalid cache data for harbor '%s', date '%s': "
                    "Expected list, got %s.",
                    harbor_id,
                    date_key,
                    type(daily_tides).__name__,
                )
                break

    if not data_valid:
        return {
            "error": "invalid_or_missing_cache",
            "message": f"Invalid or missing cached tide data found for harbor '{harbor_id}'",
        }

    _LOGGER.debug(
        "Marées France: Returning valid cached tide data for harbor '%s'.",
        harbor_id,
    )
    return harbor_data


async def _get_coefficients_data(
    hass: HomeAssistant, harbor_id: str, date_str: str | None, days: int | None
) -> dict[str, Any]:
    """Get coefficients data for harbor. Returns the same format as service."""
    coeff_store = Store[dict[str, dict[str, Any]]](
        hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY
    )
    cache = await coeff_store.async_load() or {}
    harbor_cache = cache.get(harbor_id, {})

    if not harbor_cache:
        _LOGGER.warning(
            "Marées France: No cached coefficient data found for harbor '%s'.",
            harbor_id,
        )
        return {}

    results = {}
    today = date.today()
    start_date: date
    end_date: date

    if date_str:
        try:
            start_date = date.fromisoformat(date_str)
        except ValueError:
            raise HomeAssistantError(
                f"Invalid date format: {date_str}. Use YYYY-MM-DD."
            ) from None
        if days:
            end_date = start_date + timedelta(days=days - 1)
        else:
            end_date = start_date
    elif days:
        start_date = today
        end_date = start_date + timedelta(days=days - 1)
    else:
        _LOGGER.debug(
            "Marées France: Returning all cached coefficient data for harbor '%s'.",
            harbor_id,
        )
        return harbor_cache

    current_date_iter = start_date
    while current_date_iter <= end_date:
        current_date_str = current_date_iter.strftime(DATE_FORMAT)
        if current_date_str in harbor_cache:
            results[current_date_str] = harbor_cache[current_date_str]
        current_date_iter += timedelta(days=1)

    _LOGGER.debug(
        "Marées France: Returning coefficient data for harbor '%s' from %s to %s.",
        harbor_id,
        start_date.strftime(DATE_FORMAT),
        end_date.strftime(DATE_FORMAT),
    )
    return results


@websocket_api.async_response
async def ws_handle_get_water_temp(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting water temperature data."""
    try:
        device_id = msg["device_id"]
        date_str = msg.get("date")
        harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)
        _LOGGER.debug(
            "Websocket command get_water_temp for device %s (harbor: %s), date: %s",
            device_id,
            harbor_id,
            date_str,
        )
        result = await _get_water_temp_data(hass, harbor_id, date_str)
        connection.send_result(msg["id"], result)
    except HomeAssistantError as err:
        _LOGGER.error("Websocket get_water_temp error: %s", err)
        connection.send_error(msg["id"], "home_assistant_error", str(err))
    except Exception as err:
        _LOGGER.exception("Unexpected error in websocket get_water_temp")
        connection.send_error(msg["id"], "unknown_error", str(err))


# Websocket Command Handlers
@websocket_api.async_response
async def ws_handle_get_water_levels(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting water levels."""
    try:
        device_id = msg["device_id"]
        date_str = msg["date"]

        harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

        _LOGGER.debug(
            "Websocket command get_water_levels for device %s (harbor: %s), date: %s",
            device_id,
            harbor_id,
            date_str,
        )

        result = await _get_water_levels_data(hass, harbor_id, date_str)
        connection.send_result(msg["id"], result)

    except HomeAssistantError as err:
        _LOGGER.error("Websocket get_water_levels error: %s", err)
        connection.send_error(msg["id"], "home_assistant_error", str(err))
    except Exception as err:
        _LOGGER.exception("Unexpected error in websocket get_water_levels")
        connection.send_error(msg["id"], "unknown_error", str(err))


@websocket_api.async_response
async def ws_handle_get_tides_data(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting tides data."""
    try:
        device_id = msg["device_id"]

        harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

        _LOGGER.debug(
            "Websocket command get_tides_data for device %s (harbor: %s)",
            device_id,
            harbor_id,
        )

        result = await _get_tides_data(hass, harbor_id)
        connection.send_result(msg["id"], result)

    except HomeAssistantError as err:
        _LOGGER.error("Websocket get_tides_data error: %s", err)
        connection.send_error(msg["id"], "home_assistant_error", str(err))
    except Exception as err:
        _LOGGER.exception("Unexpected error in websocket get_tides_data")
        connection.send_error(msg["id"], "unknown_error", str(err))


@websocket_api.async_response
async def ws_handle_get_coefficients_data(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting coefficients data."""
    try:
        device_id = msg["device_id"]
        date_str = msg.get("date")
        days = msg.get("days")

        harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

        _LOGGER.debug(
            "Websocket command get_coefficients_data for device %s (harbor: %s), "
            "date: %s, days: %s",
            device_id,
            harbor_id,
            date_str,
            days,
        )

        result = await _get_coefficients_data(hass, harbor_id, date_str, days)
        connection.send_result(msg["id"], result)

    except HomeAssistantError as err:
        _LOGGER.error("Websocket get_coefficients_data error: %s", err)
        connection.send_error(msg["id"], "home_assistant_error", str(err))
    except Exception as err:
        _LOGGER.exception("Unexpected error in websocket get_coefficients_data")
        connection.send_error(msg["id"], "unknown_error", str(err))


async def async_handle_reinitialize_harbor_data(call: ServiceCall) -> None:
    """Handle the service call to reinitialize data for a specific harbor.

    This service clears cached data (tides, coefficients, water levels) for the
    specified harbor and triggers an immediate refetch of all data. It also
    requests an update from the coordinator if available.

    Args:
        call: The service call object, containing 'device_id'.

    Raises:
        HomeAssistantError: If the device or config entry is not found, or if
                            there's an error during cache clearing or data refetch.
    """
    device_id = call.data["device_id"]
    hass = call.hass

    dev_reg = dr.async_get(hass)
    device_entry = dev_reg.async_get(device_id)
    if not device_entry or not device_entry.config_entries:
        _LOGGER.error(
            "Reinitialize Service: Device %s not found or not linked to Marées France.",
            device_id,
        )
        raise HomeAssistantError(
            f"Device {device_id} not found or not linked to Marées France."
        )
    config_entry_id = next(iter(device_entry.config_entries))
    config_entry = hass.config_entries.async_get_entry(config_entry_id)
    if not config_entry or config_entry.domain != DOMAIN:
        _LOGGER.error(
            "Reinitialize Service: Config entry %s not found or not for %s.",
            config_entry_id,
            DOMAIN,
        )
        raise HomeAssistantError(
            f"Config entry {config_entry_id} not found or not for {DOMAIN}"
        )
    harbor_id = config_entry.data[CONF_HARBOR_ID]

    _LOGGER.info(
        "Reinitialize Service: Starting data reinitialization for device %s (harbor: %s)",
        device_id,
        harbor_id,
    )

    tides_store = Store[dict[str, dict[str, Any]]](
        hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY
    )
    coeff_store = Store[dict[str, dict[str, Any]]](
        hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY
    )
    water_level_store = Store[dict[str, dict[str, Any]]](
        hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY
    )
    watertemp_store = Store[dict[str, dict[str, Any]]](
        hass, WATERTEMP_STORAGE_VERSION, WATERTEMP_STORAGE_KEY
    )

    caches_cleared = []
    try:
        tides_cache_full = await tides_store.async_load() or {}
        if harbor_id in tides_cache_full:
            del tides_cache_full[harbor_id]
            await tides_store.async_save(tides_cache_full)
            caches_cleared.append("tides")
            _LOGGER.debug("Reinitialize Service: Cleared tides cache for %s", harbor_id)

        coeff_cache_full = await coeff_store.async_load() or {}
        if harbor_id in coeff_cache_full:
            del coeff_cache_full[harbor_id]
            await coeff_store.async_save(coeff_cache_full)
            caches_cleared.append("coefficients")
            _LOGGER.debug(
                "Reinitialize Service: Cleared coefficients cache for %s", harbor_id
            )

        water_level_cache_full = await water_level_store.async_load() or {}
        if harbor_id in water_level_cache_full:
            del water_level_cache_full[harbor_id]
            await water_level_store.async_save(water_level_cache_full)
            caches_cleared.append("water levels")
            _LOGGER.debug(
                "Reinitialize Service: Cleared water levels cache for %s", harbor_id
            )

        watertemp_cache_full = await watertemp_store.async_load() or {}
        if harbor_id in watertemp_cache_full:
            del watertemp_cache_full[harbor_id]
            await watertemp_store.async_save(watertemp_cache_full)
            caches_cleared.append("water temperature")
            _LOGGER.debug(
                "Reinitialize Service: Cleared water temperature cache for %s",
                harbor_id,
            )

        if caches_cleared:
            _LOGGER.info(
                "Reinitialize Service: Successfully cleared cache(s) for %s: %s",
                harbor_id,
                ", ".join(caches_cleared),
            )
        else:
            _LOGGER.info(
                "Reinitialize Service: No cache entries found to clear for %s",
                harbor_id,
            )

    except Exception as e:
        _LOGGER.exception(
            "Reinitialize Service: Error clearing cache for %s", harbor_id
        )
        raise HomeAssistantError(f"Error clearing cache for {harbor_id}: {e}") from e

    _LOGGER.info(
        "Reinitialize Service: Triggering immediate data refetch for %s", harbor_id
    )
    fetch_errors = []
    try:
        tides_cache_full = await tides_store.async_load() or {}
        coeff_cache_full = await coeff_store.async_load() or {}
        water_level_cache_full = await water_level_store.async_load() or {}
        watertemp_cache_full = await watertemp_store.async_load() or {}

        today = date.today()
        yesterday = today - timedelta(days=1)
        yesterday_str = yesterday.strftime(DATE_FORMAT)
        fetch_duration = 8
        websession = async_get_clientsession(hass)
        if not await _async_fetch_and_store_tides(
            hass,
            tides_store,
            tides_cache_full,
            harbor_id,
            yesterday_str,
            fetch_duration,
            websession=websession,
        ):
            fetch_errors.append("tides")

        first_day_of_current_month = today.replace(day=1)
        coeff_fetch_days = 365
        if not await _async_fetch_and_store_coefficients(
            hass,
            coeff_store,
            coeff_cache_full,
            harbor_id,
            first_day_of_current_month,
            coeff_fetch_days,
            websession=websession,
        ):
            fetch_errors.append("coefficients")

        today_str = today.strftime(DATE_FORMAT)
        if not await _async_fetch_and_store_water_level(
            hass,
            water_level_store,
            water_level_cache_full,
            harbor_id,
            today_str,
            websession=websession,
        ):
            fetch_errors.append("water levels")

        lat = config_entry.data.get(CONF_HARBOR_LAT)
        lon = config_entry.data.get(CONF_HARBOR_LON)
        if lat and lon:
            if not await _async_fetch_and_store_water_temp(
                hass,
                watertemp_store,
                watertemp_cache_full,
                harbor_id,
                lat,
                lon,
                websession=websession,
            ):
                fetch_errors.append("water temperature")
        else:
            _LOGGER.warning(
                "Reinitialize Service: Lat/lon missing for harbor %s, cannot refetch water temperature.",
                harbor_id,
            )

    except Exception as e:
        _LOGGER.exception(
            "Reinitialize Service: Unexpected error during data refetch for %s",
            harbor_id,
        )
        raise HomeAssistantError(
            f"Unexpected error during data refetch for {harbor_id}: {e}"
        ) from e

    if fetch_errors:
        _LOGGER.error(
            "Reinitialize Service: Failed to refetch the following data for %s: %s",
            harbor_id,
            ", ".join(fetch_errors),
        )
        raise HomeAssistantError(
            f"Failed to refetch data for {harbor_id}: {', '.join(fetch_errors)}"
        )

    _LOGGER.info(
        "Reinitialize Service: Successfully completed data reinitialization and refetch for %s",
        harbor_id,
    )

    coordinator: MareesFranceUpdateCoordinator | None = hass.data.get(DOMAIN, {}).get(
        config_entry.entry_id
    )
    if coordinator:
        _LOGGER.info(
            "Reinitialize Service: Requesting immediate coordinator update for %s",
            harbor_id,
        )
        await coordinator.async_request_refresh()
    else:
        _LOGGER.warning(
            "Reinitialize Service: Could not find coordinator instance for %s "
            "to trigger refresh.",
            harbor_id,
        )


async def async_check_and_prefetch_water_levels(
    hass: HomeAssistant, entry: ConfigEntry, store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check cache for the next 8 days and prefetch missing water level data.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry for the harbor.
        store: The store object for water level data.
    """
    harbor_id = entry.data[CONF_HARBOR_ID]
    _LOGGER.info("Starting water level prefetch check for harbor: %s", harbor_id)
    cache = await store.async_load() or {}
    today = date.today()
    missing_dates = []

    for i in range(8):  # Check today + next 7 days
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime("%Y-%m-%d")
        if check_date_str not in cache.get(harbor_id, {}):
            missing_dates.append(check_date_str)

    if not missing_dates:
        _LOGGER.info(
            "Marées France: Water level cache is up to date for the next 8 days for %s.",
            harbor_id,
        )
        return

    _LOGGER.info(
        "Marées France: Found missing water level data for %s on dates: %s. Starting prefetch.",
        harbor_id,
        ", ".join(missing_dates),
    )

    for i, date_str in enumerate(missing_dates):
        websession = async_get_clientsession(hass)
        await _async_fetch_and_store_water_level(
            hass, store, cache, harbor_id, date_str, websession=websession
        )
        if i < len(missing_dates) - 1:
            await asyncio.sleep(2)

    _LOGGER.info(
        "Marées France: Finished prefetching water level data for %s", harbor_id
    )


async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get water levels for a device, using caching.

    Retrieves water level data for a specific device and date. It uses a local
    cache, prunes old entries, and falls back to fetching from the API if data
    is not cached (though prefetching aims to minimize this).

    Args:
        call: The service call object, containing 'device_id' and 'date'.

    Returns:
        A dictionary containing the water level data for the requested date,
        or an error structure if data cannot be retrieved.

    Raises:
        HomeAssistantError: If the device, config entry is not found, or if
                            there's an error fetching data after a cache miss.
    """
    device_id = call.data["device_id"]
    date_str = call.data[ATTR_DATE]
    hass = call.hass

    harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

    _LOGGER.debug(
        "Service call get_water_levels for device %s (harbor: %s), date: %s",
        device_id,
        harbor_id,
        date_str,
    )

    return await _get_water_levels_data(hass, harbor_id, date_str)


async def async_check_and_prefetch_tides(
    hass: HomeAssistant, entry: ConfigEntry, store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check tide cache (yesterday to today+7 days) and prefetch if needed.

    Also prunes old data (before yesterday) from the cache.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry for the harbor.
        store: The store object for tide data.
    """
    harbor_id = entry.data[CONF_HARBOR_ID]
    _LOGGER.info(
        "Marées France: Starting tide data prefetch check for harbor: %s", harbor_id
    )
    cache = await store.async_load() or {}
    today = date.today()
    yesterday = today - timedelta(days=1)
    yesterday_str = yesterday.strftime(DATE_FORMAT)
    needs_fetch = False
    needs_save = False
    fetch_duration = 8  # Fetch 8 days (yesterday + 7 future)

    for i in range(-1, fetch_duration - 1):  # -1 (yesterday) to 6 (today+6)
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime(DATE_FORMAT)
        if check_date_str not in cache.get(harbor_id, {}):
            _LOGGER.info(
                "Marées France: Missing tide data for %s on %s. "
                "Triggering full %d-day fetch.",
                harbor_id,
                check_date_str,
                fetch_duration,
            )
            needs_fetch = True
            break

    if needs_fetch:
        websession = async_get_clientsession(hass)
        fetch_successful = await _async_fetch_and_store_tides(
            hass,
            store,
            cache,
            harbor_id,
            yesterday_str,
            duration=fetch_duration,
            websession=websession,
        )
        if fetch_successful:
            _LOGGER.info(
                "Marées France: Successfully prefetched %d days of tide data for %s "
                "starting %s.",
                fetch_duration,
                harbor_id,
                yesterday_str,
            )
            needs_save = True
        else:
            _LOGGER.error(
                "Marées France: Failed to prefetch tide data for %s.", harbor_id
            )
            return
    else:
        _LOGGER.info(
            "Marées France: Tide data cache is up to date for %s "
            "(yesterday to today+%d).",
            harbor_id,
            fetch_duration - 2,  # -1 for yesterday, -1 for 0-index
        )

    if harbor_id in cache:
        dates_to_prune = list(cache[harbor_id].keys())
        pruned_count = 0
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date < yesterday:
                    del cache[harbor_id][d_str]
                    needs_save = True
                    pruned_count += 1
            except ValueError:
                del cache[harbor_id][d_str]
                needs_save = True
                pruned_count += 1
                _LOGGER.warning(
                    "Marées France: Removed tide cache entry with invalid date key: "
                    "%s for %s",
                    d_str,
                    harbor_id,
                )
        if pruned_count > 0:
            _LOGGER.info(
                "Marées France: Pruned %d old tide data entries for %s.",
                pruned_count,
                harbor_id,
            )
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True

    if needs_save and not needs_fetch:  # Fetch already saved
        await store.async_save(cache)
        _LOGGER.debug("Marées France: Saved pruned tides cache for %s", harbor_id)

    _LOGGER.info(
        "Marées France: Finished tide data prefetch check for harbor: %s", harbor_id
    )


async def async_handle_get_tides_data(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get all cached tides data for a device.

    Retrieves all currently cached tide data for the specified device's harbor.
    Performs basic validation on the cache structure.

    Args:
        call: The service call object, containing 'device_id'.

    Returns:
        A dictionary where keys are dates (YYYY-MM-DD) and values are lists of
        tide events for that date. Returns an error structure if cache is
        invalid or missing.

    Raises:
        HomeAssistantError: If the device or config entry is not found.
    """
    device_id = call.data["device_id"]
    hass = call.hass

    harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

    _LOGGER.debug(
        "Service call get_tides_data for device %s (harbor: %s)", device_id, harbor_id
    )

    return await _get_tides_data(hass, harbor_id)


async def async_check_and_prefetch_coefficients(
    hass: HomeAssistant, entry: ConfigEntry, store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check coefficient cache, prefetch missing data, and prune old entries.

    The cache aims to store 365 days of coefficient data starting from the
    1st of the current month. Old data (previous years/months) is pruned.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry for the harbor.
        store: The store object for coefficient data.
    """
    harbor_id = entry.data[CONF_HARBOR_ID]
    _LOGGER.info(
        "Marées France: Starting coefficient data prefetch check for harbor: %s",
        harbor_id,
    )
    cache = await store.async_load() or {}
    today = date.today()
    needs_save = False
    fetch_start_date = None
    fetch_days = 0

    if harbor_id in cache:
        dates_to_prune = list(cache[harbor_id].keys())
        pruned_count = 0
        for d_str in dates_to_prune:
            try:
                d_date = date.fromisoformat(d_str)
                if d_date.year < today.year or (
                    d_date.year == today.year and d_date.month < today.month
                ):
                    del cache[harbor_id][d_str]
                    needs_save = True
                    pruned_count += 1
            except ValueError:
                del cache[harbor_id][d_str]
                needs_save = True
                pruned_count += 1
                _LOGGER.warning(
                    "Marées France: Removed coefficient cache entry with invalid "
                    "date key: %s for %s",
                    d_str,
                    harbor_id,
                )
        if pruned_count > 0:
            _LOGGER.info(
                "Marées France: Pruned %d old coefficient data entries for %s.",
                pruned_count,
                harbor_id,
            )
        if not cache[harbor_id]:
            del cache[harbor_id]
            needs_save = True

    harbor_cache = cache.get(harbor_id, {})
    first_missing_date = None
    first_day_of_current_month = today.replace(day=1)
    required_start_date = first_day_of_current_month
    required_end_date = required_start_date + timedelta(days=364)

    current_check_date = required_start_date
    while current_check_date <= required_end_date:
        check_date_str = current_check_date.strftime(DATE_FORMAT)
        if check_date_str not in harbor_cache:
            if first_missing_date is None:
                first_missing_date = current_check_date
        elif first_missing_date is not None:
            _LOGGER.warning(
                "Marées France: Found cached coefficient data for %s after missing "
                "date %s. Inconsistency detected.",
                check_date_str,
                first_missing_date.strftime(DATE_FORMAT),
            )
        current_check_date += timedelta(days=1)

    if first_missing_date is not None:
        fetch_start_date = first_missing_date
        fetch_days = (required_end_date - fetch_start_date).days + 1
        _LOGGER.info(
            "Marées France: Missing coefficient data for %s starting %s (up to %s). "
            "Need to fetch %d days.",
            harbor_id,
            fetch_start_date.strftime(DATE_FORMAT),
            required_end_date.strftime(DATE_FORMAT),
            fetch_days,
        )

        websession = async_get_clientsession(hass)
        fetch_successful = await _async_fetch_and_store_coefficients(
            hass,
            store,
            cache,
            harbor_id,
            fetch_start_date,
            fetch_days,
            websession=websession,
        )
        if fetch_successful:
            _LOGGER.info(
                "Marées France: Successfully prefetched %d days of coefficient data "
                "for %s starting %s.",
                fetch_days,
                harbor_id,
                fetch_start_date.strftime(DATE_FORMAT),
            )
            needs_save = False  # Fetch helper saved
        else:
            _LOGGER.error(
                "Marées France: Failed to prefetch coefficient data for %s.", harbor_id
            )
            if needs_save:  # Save pruned state if fetch failed
                await store.async_save(cache)
                _LOGGER.debug(
                    "Marées France: Saved pruned coefficients cache for %s "
                    "after failed fetch.",
                    harbor_id,
                )
            return
    else:
        _LOGGER.info(
            "Marées France: Coefficient data cache is up to date for %s (from %s to %s).",
            harbor_id,
            required_start_date.strftime(DATE_FORMAT),
            required_end_date.strftime(DATE_FORMAT),
        )

    if needs_save:  # Only pruning occurred
        await store.async_save(cache)
        _LOGGER.debug(
            "Marées France: Saved pruned coefficients cache for %s", harbor_id
        )

    _LOGGER.info(
        "Marées France: Finished coefficient data prefetch check for harbor: %s",
        harbor_id,
    )


async def async_handle_get_coefficients_data(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get cached coefficient data for a device.

    Retrieves coefficient data based on the provided 'device_id', optional
    'date' (YYYY-MM-DD), and optional 'days'.
    - If no date/days: returns all cached data for the harbor.
    - If date only: returns data for that specific date.
    - If days only: returns data for 'days' starting from today.
    - If date and days: returns data for 'days' starting from 'date'.

    Args:
        call: The service call object.

    Returns:
        A dictionary where keys are dates (YYYY-MM-DD) and values are coefficient
        data for that date. Returns an empty dictionary if no data is found.

    Raises:
        HomeAssistantError: If the device/config entry is not found or date format is invalid.
    """
    device_id = call.data["device_id"]
    req_date_str = call.data.get(ATTR_DATE)
    req_days = call.data.get("days")
    hass = call.hass

    harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)

    _LOGGER.debug(
        "Service call get_coefficients_data for device %s (harbor: %s), "
        "date: %s, days: %s",
        device_id,
        harbor_id,
        req_date_str,
        req_days,
    )

    return await _get_coefficients_data(hass, harbor_id, req_date_str, req_days)


async def _get_water_temp_data(
    hass: HomeAssistant, harbor_id: str, date_str: str | None = None
) -> dict[str, Any]:
    """Get water temperature data for a harbor, optionally filtered by date."""
    watertemp_store = Store[dict[str, dict[str, Any]]](
        hass, WATERTEMP_STORAGE_VERSION, WATERTEMP_STORAGE_KEY
    )
    cache = await watertemp_store.async_load() or {}
    harbor_cache = cache.get(harbor_id, {})

    if date_str:
        return {date_str: harbor_cache.get(date_str, [])}

    return harbor_cache


async def async_handle_get_water_temp(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get water temperature for a device, using caching."""
    device_id = call.data["device_id"]
    date_str = call.data.get(ATTR_DATE)
    hass = call.hass
    harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)
    _LOGGER.debug(
        "Service call get_water_temp for device %s (harbor: %s), date: %s",
        device_id,
        harbor_id,
        date_str,
    )
    return await _get_water_temp_data(hass, harbor_id, date_str)


async def async_check_and_prefetch_watertemp(
    hass: HomeAssistant, entry: ConfigEntry, store: Store[dict[str, dict[str, Any]]]
) -> None:
    """Check water temperature cache and prefetch if needed."""
    harbor_id = entry.data[CONF_HARBOR_ID]
    lat = entry.data.get(CONF_HARBOR_LAT)
    lon = entry.data.get(CONF_HARBOR_LON)

    if not lat or not lon:
        _LOGGER.warning(
            "Marées France: Lat/lon missing for harbor %s, cannot prefetch water temperature.",
            harbor_id,
        )
        return

    _LOGGER.info(
        "Marées France: Starting water temperature prefetch check for harbor: %s",
        harbor_id,
    )
    cache = await store.async_load() or {}
    today = date.today()
    needs_fetch = False

    for i in range(7):  # Check today + next 6 days
        check_date = today + timedelta(days=i)
        check_date_str = check_date.strftime(DATE_FORMAT)
        if check_date_str not in cache.get(harbor_id, {}):
            needs_fetch = True
            break

    if needs_fetch:
        websession = async_get_clientsession(hass)
        await _async_fetch_and_store_water_temp(
            hass, store, cache, harbor_id, lat, lon, websession=websession
        )
    else:
        _LOGGER.info(
            "Marées France: Water temperature cache is up to date for %s.", harbor_id
        )


async def async_register_frontend_modules_when_ready(hass: HomeAssistant):
    """Register frontend modules once Home Assistant has fully started.

    Args:
        hass: The Home Assistant instance.
    """
    _LOGGER.debug("Home Assistant started, registering frontend modules.")
    module_register = JSModuleRegistration(hass)
    await module_register.async_register()
    _LOGGER.debug("Marées France: Registered Marées France frontend module.")


async def async_setup(hass: HomeAssistant, _config: dict[str, Any]) -> bool:
    """Set up the Marées France component.

    This function is called by Home Assistant during the setup phase.
    It schedules the registration of frontend modules.

    Args:
        hass: The Home Assistant instance.
        _config: The component configuration (not used).

    Returns:
        True, indicating successful setup.
    """

    async def _setup_frontend(_event: Any = None) -> None:
        """Inner function to register frontend modules."""
        await async_register_frontend_modules_when_ready(hass)

    if hass.state == CoreState.running:
        _LOGGER.debug(
            "Home Assistant already running, registering frontend modules immediately."
        )
        await _setup_frontend()
    else:
        _LOGGER.debug(
            "Home Assistant not running yet, scheduling frontend module registration."
        )
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _setup_frontend)

    return True


async def async_process_updates(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Process updates for a config entry."""
    _LOGGER.debug("Marées France: Processing updates for entry: %s", entry.entry_id)
    # Add your update processing logic here
    await async_reload_entry(hass, entry)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Marées France from a config entry.

    This function is called by Home Assistant when a config entry is added or
    reloaded. It initializes data stores, sets up the data update coordinator,
    prefetches initial data, forwards setup to platforms (e.g., sensor),
    registers services, and schedules daily prefetch jobs.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry being set up.

    Returns:
        True if the setup was successful, False otherwise.
    """
    _LOGGER.debug("Marées France: Setting up Marées France entry: %s", entry.entry_id)

    water_level_store = Store[dict[str, dict[str, Any]]](
        hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY
    )
    tides_store = Store[dict[str, dict[str, Any]]](
        hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY
    )
    coeff_store = Store[dict[str, dict[str, Any]]](
        hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY
    )
    watertemp_store = Store[dict[str, dict[str, Any]]](
        hass, WATERTEMP_STORAGE_VERSION, WATERTEMP_STORAGE_KEY
    )

    websession = async_get_clientsession(hass)
    coordinator = MareesFranceUpdateCoordinator(
        hass,
        entry,
        tides_store,
        coeff_store,
        water_level_store,
        watertemp_store,
        websession=websession,
    )

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    hass.async_create_task(coordinator.async_config_entry_first_refresh())
    _LOGGER.debug("Marées France: Forwarded entry setup for platforms: %s", PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(async_process_updates))

    if not hass.services.has_service(DOMAIN, SERVICE_GET_WATER_LEVELS):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_WATER_LEVELS,
            async_handle_get_water_levels,
            schema=SERVICE_GET_WATER_LEVELS_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_WATER_LEVELS
        )
    if not hass.services.has_service(DOMAIN, SERVICE_GET_TIDES_DATA):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_TIDES_DATA,
            async_handle_get_tides_data,
            schema=SERVICE_GET_TIDES_DATA_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_TIDES_DATA
        )

    if not hass.services.has_service(DOMAIN, SERVICE_GET_COEFFICIENTS_DATA):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_COEFFICIENTS_DATA,
            async_handle_get_coefficients_data,
            schema=SERVICE_GET_COEFFICIENTS_DATA_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s",
            DOMAIN,
            SERVICE_GET_COEFFICIENTS_DATA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_REINITIALIZE_HARBOR_DATA):
        hass.services.async_register(
            DOMAIN,
            SERVICE_REINITIALIZE_HARBOR_DATA,
            async_handle_reinitialize_harbor_data,
            schema=SERVICE_REINITIALIZE_HARBOR_DATA_SCHEMA,
            supports_response=SupportsResponse.NONE,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s",
            DOMAIN,
            SERVICE_REINITIALIZE_HARBOR_DATA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_GET_WATER_TEMP):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_WATER_TEMP,
            async_handle_get_water_temp,
            schema=SERVICE_GET_WATER_TEMP_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s", DOMAIN, SERVICE_GET_WATER_TEMP
        )
    # Register websocket commands
    websocket_api.async_register_command(
        hass,
        "marees_france/get_water_levels",
        ws_handle_get_water_levels,
        WS_GET_WATER_LEVELS_SCHEMA,
    )
    websocket_api.async_register_command(
        hass,
        "marees_france/get_tides_data",
        ws_handle_get_tides_data,
        WS_GET_TIDES_DATA_SCHEMA,
    )
    websocket_api.async_register_command(
        hass,
        "marees_france/get_coefficients_data",
        ws_handle_get_coefficients_data,
        WS_GET_COEFFICIENTS_DATA_SCHEMA,
    )
    websocket_api.async_register_command(
        hass,
        "marees_france/get_water_temp",
        ws_handle_get_water_temp,
        WS_GET_WATER_TEMP_SCHEMA,
    )
    _LOGGER.debug("Marées France: Registered websocket commands")

    listeners = []

    async def _daily_water_level_prefetch_job(*_: Any) -> None:
        _LOGGER.debug("Marées France: Running daily water level prefetch job.")
        await async_check_and_prefetch_water_levels(hass, entry, water_level_store)

    rand_wl_hour = random.randint(1, 5)
    rand_wl_min = random.randint(0, 59)
    _LOGGER.info(
        "Marées France: Scheduled daily water level prefetch check at %02d:%02d",
        rand_wl_hour,
        rand_wl_min,
    )
    listeners.append(
        async_track_time_change(
            hass,
            _daily_water_level_prefetch_job,
            hour=rand_wl_hour,
            minute=rand_wl_min,
            second=0,
        )
    )

    async def _daily_tides_prefetch_job(*_: Any) -> None:
        _LOGGER.debug("Marées France: Running daily tides prefetch job.")
        await async_check_and_prefetch_tides(hass, entry, tides_store)

    rand_t_hour = random.randint(1, 5)
    rand_t_min = random.randint(0, 59)
    while rand_t_hour == rand_wl_hour and rand_t_min == rand_wl_min:
        rand_t_min = random.randint(0, 59)
    _LOGGER.info(
        "Marées France: Scheduled daily tides prefetch check at %02d:%02d",
        rand_t_hour,
        rand_t_min,
    )
    listeners.append(
        async_track_time_change(
            hass,
            _daily_tides_prefetch_job,
            hour=rand_t_hour,
            minute=rand_t_min,
            second=0,
        )
    )

    async def _daily_coefficients_prefetch_job(*_: Any) -> None:
        _LOGGER.debug("Marées France: Running daily coefficients prefetch job.")
        try:
            await async_check_and_prefetch_coefficients(hass, entry, coeff_store)
            _LOGGER.debug("Marées France: Coefficients check done.")
        except Exception:
            _LOGGER.exception(
                "Marées France: Error during scheduled coefficient prefetch job for %s",
                entry.data.get(CONF_HARBOR_ID),
            )

    rand_c_hour = random.randint(1, 5)
    rand_c_min = random.randint(0, 59)
    while (rand_c_hour == rand_wl_hour and rand_c_min == rand_wl_min) or (
        rand_c_hour == rand_t_hour and rand_c_min == rand_t_min
    ):
        rand_c_min = random.randint(0, 59)
        if (
            rand_c_min == rand_wl_min and rand_c_hour == rand_wl_hour
        ):  # pragma: no cover
            continue
        if rand_c_min == rand_t_min and rand_c_hour == rand_t_hour:  # pragma: no cover
            continue
    _LOGGER.info(
        "Marées France: Scheduled daily coefficients prefetch check at %02d:%02d",
        rand_c_hour,
        rand_c_min,
    )
    listeners.append(
        async_track_time_change(
            hass,
            _daily_coefficients_prefetch_job,
            hour=rand_c_hour,
            minute=rand_c_min,
            second=0,
        )
    )

    async def _daily_watertemp_prefetch_job(*_: Any) -> None:
        """Run daily job to prefetch water temperature data."""
        _LOGGER.debug("Marées France: Running daily water temperature prefetch job.")
        try:
            await async_check_and_prefetch_watertemp(hass, entry, watertemp_store)
        except Exception as e:
            _LOGGER.exception(
                "Marées France: Error during scheduled water temperature prefetch job: %s",
                e,
            )

    rand_wt_hour = random.randint(1, 5)
    rand_wt_min = random.randint(0, 59)
    listeners.append(
        async_track_time_change(
            hass,
            _daily_watertemp_prefetch_job,
            hour=rand_wt_hour,
            minute=rand_wt_min,
            second=0,
        )
    )

    def _unload_listeners() -> None:
        _LOGGER.debug("Marées France: Removing daily prefetch listeners.")
        for remove_listener in listeners:
            remove_listener()

    entry.async_on_unload(_unload_listeners)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry.

    This function is called by Home Assistant when a config entry is being
    unloaded (e.g., during a reload or removal). It unloads associated
    platforms and removes the coordinator instance from hass.data.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry being unloaded.

    Returns:
        True if the unload was successful, False otherwise.
    """
    _LOGGER.debug("Unloading Marées France entry: %s", entry.entry_id)

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(
            entry.entry_id, None
        )  # Use pop with default to avoid KeyError
        _LOGGER.debug(
            "Marées France: Successfully unloaded Marées France entry: %s",
            entry.entry_id,
        )

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload a config entry.

    This is typically called when the entry's options are updated. It unloads
    and then sets up the entry again.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry to reload.
    """
    _LOGGER.debug("Marées France: Reloading Marées France entry: %s", entry.entry_id)
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
    _LOGGER.debug(
        "Marées France: Finished reloading Marées France entry: %s", entry.entry_id
    )


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle removal of a config entry.

    This function is called by Home Assistant when a config entry is being
    removed. It cleans up any persistent data associated with the entry,
    such as cached tide, coefficient, and water level data.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry being removed.
    """
    harbor_id = entry.data.get(CONF_HARBOR_ID)
    if not harbor_id:
        _LOGGER.error(
            "Cannot remove cache for entry %s: Harbor ID not found in entry data.",
            entry.entry_id,
        )
        return

    _LOGGER.info(
        "Removing cached data for harbor %s (entry: %s)", harbor_id, entry.entry_id
    )

    stores_to_clean = {
        "tides": Store[dict[str, dict[str, Any]]](
            hass, TIDES_STORAGE_VERSION, TIDES_STORAGE_KEY
        ),
        "coefficients": Store[dict[str, dict[str, Any]]](
            hass, COEFF_STORAGE_VERSION, COEFF_STORAGE_KEY
        ),
        "water_levels": Store[dict[str, dict[str, Any]]](
            hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY
        ),
        "water_temp": Store[dict[str, dict[str, Any]]](
            hass, WATERTEMP_STORAGE_VERSION, WATERTEMP_STORAGE_KEY
        ),
    }

    for store_name, store_instance in stores_to_clean.items():
        try:
            cache_data = await store_instance.async_load() or {}
            if harbor_id in cache_data:
                del cache_data[harbor_id]
                await store_instance.async_save(cache_data)
                _LOGGER.debug(
                    "Removed %s cache data for harbor %s.", store_name, harbor_id
                )
            else:
                _LOGGER.debug(
                    "No %s cache data found for harbor %s to remove.",
                    store_name,
                    harbor_id,
                )
        except Exception as e:
            _LOGGER.exception(
                "Error removing %s cache data for harbor %s: %s",
                store_name,
                harbor_id,
                e,
            )

    _LOGGER.info("Finished removing cached data for harbor %s.", harbor_id)
