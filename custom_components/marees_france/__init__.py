"""
Marées France integration.

This component provides tide, coefficient, and water level information for French harbors.
It sets up sensors, services, and handles data fetching and caching.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

# Third-party imports
import aiohttp
import homeassistant.helpers.config_validation as cv
import homeassistant.helpers.device_registry as dr
import voluptuous as vol
from homeassistant.components import websocket_api

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import (
    EVENT_HOMEASSISTANT_STARTED,
    CoreState,
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .api_helpers import (
    _async_fetch_and_store_water_level,
)

# Local application/library specific imports
from .const import (
    ATTR_DATE,
    COEFF_STORAGE_KEY,
    COEFF_STORAGE_VERSION,
    CONF_HARBOR_ID,
    CONF_HARBOR_MIN_DEPTH,
    CONF_HARBOR_NAME,
    DATE_FORMAT,
    DOMAIN,
    HARBORMINDEPTH_STORAGE_KEY,
    HARBORMINDEPTH_STORAGE_VERSION,
    HARBORSURL,
    HEADERS,
    INTEGRATION_VERSION,
    PLATFORMS,
    SERVICE_GET_COEFFICIENTS_DATA,
    SERVICE_GET_HARBOR_MIN_DEPTH,
    SERVICE_GET_TIDES_DATA,
    SERVICE_GET_WATER_LEVELS,
    SERVICE_GET_WATER_TEMP,
    SERVICE_REINITIALIZE_HARBOR_DATA,
    TIDES_STORAGE_KEY,
    TIDES_STORAGE_VERSION,
    WATERLEVELS_STORAGE_KEY,
    WATERLEVELS_STORAGE_VERSION,
    WATERTEMP_STORAGE_KEY,
    WATERTEMP_STORAGE_VERSION,
)
from .coordinator import MareesFranceUpdateCoordinator
from .frontend import JSModuleRegistration
from .harbor_timezone import harbor_timezone_from_properties

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
            async with websession.get(HARBORSURL, headers=HEADERS) as response:
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
                    "timezone": harbor_timezone_from_properties(properties),
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

    Migrate locally; background fetching enriches legacy harbor metadata.

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

        # A migration must work offline. Enrich the harbor metadata later.
        new_data.setdefault(CONF_HARBOR_NAME, harbor_id)
        hass.config_entries.async_update_entry(config_entry, data=new_data, version=2)

    if config_entry.version == 2:
        _LOGGER.debug(
            "Migrating config entry %s from version 2 to 3", config_entry.entry_id
        )
        new_data = {**config_entry.data}
        if CONF_HARBOR_MIN_DEPTH not in new_data:
            new_data[CONF_HARBOR_MIN_DEPTH] = 0.0

        hass.config_entries.async_update_entry(config_entry, data=new_data, version=3)
        _LOGGER.info(
            "Successfully migrated config entry %s to version 3, added default harbor_min_depth",
            config_entry.entry_id,
        )

    if config_entry.version > 3:
        _LOGGER.error(
            "Cannot migrate config entry %s: Config entry version %s is newer than "
            "integration version 3",
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

SERVICE_GET_HARBOR_MIN_DEPTH_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
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

WS_GET_HARBOR_MIN_DEPTH_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/get_harbor_min_depth",
        vol.Required("device_id"): cv.string,
    }
)

WS_GET_VERSION_SCHEMA = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "marees_france/version",
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
    # Prefer the current API; older HA versions expose a set of entries.
    if hasattr(device_entry, "config_entry_id"):
        config_entry_id = device_entry.config_entry_id
    else:
        config_entry_id = next(iter(device_entry.config_entries), None)
    if not config_entry_id:
        raise HomeAssistantError(
            f"Device {device_id} not associated with a config entry"
        )
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
async def ws_handle_get_harbor_min_depth(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting harbor min depth."""
    try:
        device_id = msg["device_id"]
        harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)
        _LOGGER.debug(
            "Websocket command get_harbor_min_depth for device %s (harbor: %s)",
            device_id,
            harbor_id,
        )
        result = await _get_harbor_min_depth_data(hass, harbor_id)
        connection.send_result(msg["id"], result)
    except HomeAssistantError as err:
        _LOGGER.error("Websocket get_harbor_min_depth error: %s", err)
        connection.send_error(msg["id"], "home_assistant_error", str(err))
    except Exception as err:
        _LOGGER.exception("Unexpected error in websocket get_harbor_min_depth")
        connection.send_error(msg["id"], "unknown_error", str(err))


@websocket_api.async_response
async def ws_handle_get_version(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Handle websocket command for getting integration version."""
    connection.send_result(msg["id"], {"version": INTEGRATION_VERSION})


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
    """Clear this harbor's cache and restart its background fetching."""
    hass = call.hass
    harbor_id, entry = await _get_device_and_harbor_id(hass, call.data["device_id"])
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator is None:
        raise HomeAssistantError(f"Marées France is not loaded for {harbor_id}")
    await coordinator.async_stop_fetching()
    try:
        for store in (
            coordinator.tides_store,
            coordinator.coeff_store,
            coordinator.water_level_store,
            coordinator.watertemp_store,
        ):
            locks = hass.data.setdefault(f"{DOMAIN}_cache_locks", {})
            async with locks.setdefault(store.key, asyncio.Lock()):
                cache = dict(await store.async_load() or {})
                cache.pop(harbor_id, None)
                await store.async_save(cache)
        await coordinator.async_refresh()
    finally:
        coordinator.async_start_fetching()


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


async def _get_harbor_min_depth_data(
    hass: HomeAssistant, harbor_id: str
) -> dict[str, Any]:
    """Get min depth to navigate for a harbor"""
    harborMinDepth_store = Store[dict[str, Any]](
        hass, HARBORMINDEPTH_STORAGE_VERSION, HARBORMINDEPTH_STORAGE_KEY
    )
    cache = await harborMinDepth_store.async_load() or {}
    harbor_cache = cache.get(harbor_id, {})
    return harbor_cache


async def async_handle_get_harbor_min_depth(call: ServiceCall) -> ServiceResponse:
    """Handle the service call to get min depth for a device, using caching."""
    device_id = call.data["device_id"]
    hass = call.hass
    harbor_id, _ = await _get_device_and_harbor_id(hass, device_id)
    _LOGGER.debug(
        "Service call get_harbor_min_depth for device %s (harbor: %s)",
        device_id,
        harbor_id,
    )
    return await _get_harbor_min_depth_data(hass, harbor_id)


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
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    # Metadata enrichment updates entry.data. Only options need a reload.
    if coordinator and coordinator.options != dict(entry.options):
        await hass.config_entries.async_reload(entry.entry_id)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Marées France from a config entry.

    This function is called by Home Assistant when a config entry is added or
    reloaded. It initializes data stores, sets up the data update coordinator,
    loads cached data, forwards setup to platforms (e.g., sensor), registers
    services, and starts independent background fetches and retries.

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
    harborMinDepth_store = Store[dict[str, Any]](
        hass, HARBORMINDEPTH_STORAGE_VERSION, HARBORMINDEPTH_STORAGE_KEY
    )

    websession = async_get_clientsession(hass)
    coordinator = MareesFranceUpdateCoordinator(
        hass,
        entry,
        tides_store,
        coeff_store,
        water_level_store,
        watertemp_store,
        harborMinDepth_store,
        websession=websession,
    )

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # This refresh reads local storage only, even when no cache is available.
    await coordinator.async_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    coordinator.async_start_fetching()
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

    if not hass.services.has_service(DOMAIN, SERVICE_GET_HARBOR_MIN_DEPTH):
        hass.services.async_register(
            DOMAIN,
            SERVICE_GET_HARBOR_MIN_DEPTH,
            async_handle_get_harbor_min_depth,
            schema=SERVICE_GET_HARBOR_MIN_DEPTH_SCHEMA,
            supports_response=SupportsResponse.ONLY,
        )
        _LOGGER.debug(
            "Marées France: Registered service: %s.%s",
            DOMAIN,
            SERVICE_GET_HARBOR_MIN_DEPTH,
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
    websocket_api.async_register_command(
        hass,
        "marees_france/get_harbor_min_depth",
        ws_handle_get_harbor_min_depth,
        WS_GET_HARBOR_MIN_DEPTH_SCHEMA,
    )
    websocket_api.async_register_command(
        hass,
        "marees_france/version",
        ws_handle_get_version,
        WS_GET_VERSION_SCHEMA,
    )
    _LOGGER.debug("Marées France: Registered websocket commands")

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
        if coordinator := hass.data.get(DOMAIN, {}).get(entry.entry_id):
            await coordinator.async_shutdown()
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
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
        "harbor_min_depth": Store[dict[str, Any]](
            hass, HARBORMINDEPTH_STORAGE_VERSION, HARBORMINDEPTH_STORAGE_KEY
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
        except Exception:
            _LOGGER.exception(
                "Error removing %s cache data for harbor %s",
                store_name,
                harbor_id,
            )

    _LOGGER.info("Finished removing cached data for harbor %s.", harbor_id)
