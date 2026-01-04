"""API Fetching and Caching Helpers for Marées France integration."""

from __future__ import annotations

import logging
import asyncio
from datetime import date, timedelta
from typing import Any

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

from .const import (
    HEADERS,
    WATERLEVELS_URL_TEMPLATE,
    TIDESURL_TEMPLATE,
    COEFF_URL_TEMPLATE,
    WATERTEMP_URL_TEMPLATE,
    DATE_FORMAT,
    API_REQUEST_DELAY,
)

_LOGGER = logging.getLogger(__name__)


async def _async_fetch_with_retry(
    session: aiohttp.ClientSession,
    url: str,
    headers: dict[str, str],
    timeout: int,
    harbor_id: str,
    data_type: str,
) -> dict[str, Any] | list[Any] | None:
    """Fetch data from a URL with retry logic and a mandatory delay.

    This function attempts to fetch data from the given URL up to `max_retries`
    times, with an exponential backoff delay between attempts. It also enforces
    a minimum delay (`API_REQUEST_DELAY`) before each request.

    Args:
        session: The aiohttp client session.
        url: The URL to fetch data from.
        headers: The HTTP headers for the request.
        timeout: The timeout in seconds for each request attempt.
        harbor_id: The ID of the harbor, used for logging context.
        data_type: A string describing the type of data being fetched (e.g.,
                   "water levels", "tides"), used for logging context.

    Returns:
        The JSON response as a dictionary or list if successful, otherwise None.
    """
    max_retries = 5
    initial_delay = 5  # seconds

    await asyncio.sleep(API_REQUEST_DELAY)
    _LOGGER.debug(
        "Marées France Helper: Preparing to fetch %s for %s from %s",
        data_type,
        harbor_id,
        url,
    )

    for attempt in range(max_retries):
        current_delay = initial_delay * (2**attempt)
        try:
            async with asyncio.timeout(timeout):
                response = await session.get(url, headers=headers)
                response.raise_for_status()
                data = await response.json()
                _LOGGER.debug(
                    "Marées France Helper: Successfully fetched %s for %s (attempt %d/%d)",
                    data_type,
                    harbor_id,
                    attempt + 1,
                    max_retries,
                )
                return data

        except asyncio.TimeoutError:
            _LOGGER.warning(
                "Marées France Helper: Timeout fetching %s for %s (attempt %d/%d). "
                "Retrying in %ds...",
                data_type,
                harbor_id,
                attempt + 1,
                max_retries,
                current_delay,
            )
        except aiohttp.ClientResponseError as err:
            _LOGGER.warning(
                "Marées France Helper: HTTP error %s fetching %s for %s (attempt %d/%d): %s. "
                "Retrying in %ds...",
                err.status,
                data_type,
                harbor_id,
                attempt + 1,
                max_retries,
                err.message,
                current_delay,
            )
        except aiohttp.ClientError as err:
            _LOGGER.warning(
                "Marées France Helper: Client error fetching %s for %s (attempt %d/%d): %s. "
                "Retrying in %ds...",
                data_type,
                harbor_id,
                attempt + 1,
                max_retries,
                err,
                current_delay,
            )
        except Exception as err:
            _LOGGER.warning(
                "Marées France Helper: Unexpected error fetching %s for %s (attempt %d/%d): %s. "
                "Retrying in %ds...",
                data_type,
                harbor_id,
                attempt + 1,
                max_retries,
                err,
                current_delay,
            )

        if attempt < max_retries - 1:
            await asyncio.sleep(current_delay)
        else:
            _LOGGER.error(
                "Marées France Helper: Failed to fetch %s for %s after %d attempts.",
                data_type,
                harbor_id,
                max_retries,
            )
    return None


async def _async_fetch_and_store_water_level(
    hass: HomeAssistant,
    store: Store[dict[str, dict[str, Any]]],
    cache: dict[str, dict[str, Any]],
    harbor_name: str,
    date_str: str,
    websession: aiohttp.ClientSession | None = None,
) -> dict[str, list[list[str]]] | None:
    """Fetch water level data, validate, store in cache, and save.

    Args:
        hass: The Home Assistant instance.
        store: The data store for caching.
        cache: The current cache dictionary.
        harbor_name: The name/ID of the harbor for the API request.
        date_str: The date string (YYYY-MM-DD) for which to fetch data.
        websession: Optional aiohttp ClientSession. If not provided, one will be created.

    Returns:
        The fetched data if successful and valid, otherwise None.
    """
    url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
    session = websession or async_get_clientsession(hass)
    timeout_seconds = 30

    data = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_name,
        data_type="water levels",
    )

    if data is None:
        return None

    valid_structure = (
        isinstance(data, dict) and date_str in data and isinstance(data[date_str], list)
    )

    if not valid_structure:
        _LOGGER.error(
            "Marées France Helper: Fetched water level data for %s on %s has unexpected "
            "structure or is missing the date key. Discarding. Data: %s",
            harbor_name,
            date_str,
            data,
        )
        return None

    try:
        cache.setdefault(harbor_name, {})[date_str] = data
        await store.async_save(cache)
        _LOGGER.debug(
            "Marées France Helper: Cached new water level data for %s on %s and saved cache",
            harbor_name,
            date_str,
        )
        return data
    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving water level cache for %s on %s",
            harbor_name,
            date_str,
        )
        return None


async def _async_fetch_and_store_tides(
    hass: HomeAssistant,
    store: Store[dict[str, dict[str, Any]]],
    cache: dict[str, dict[str, Any]],
    harbor_id: str,
    start_date_str: str,
    duration: int = 8,
    websession: aiohttp.ClientSession | None = None,
) -> bool:
    """Fetch tide data, parse, store in cache, and save.

    Args:
        hass: The Home Assistant instance.
        store: The data store for caching.
        cache: The current cache dictionary.
        harbor_id: The ID of the harbor for the API request.
        start_date_str: The start date string (YYYY-MM-DD) for fetching data.
        duration: The number of days of tide data to fetch.
        websession: Optional aiohttp ClientSession. If not provided, one will be created.

    Returns:
        True if fetching and storing were successful, False otherwise.
    """
    url = (
        f"{TIDESURL_TEMPLATE.format(harbor_id=harbor_id, date=start_date_str)}"
        f"&duration={duration}"
    )
    session = websession or async_get_clientsession(hass)
    timeout_seconds = 15 + (duration * 5)

    fetched_data_dict = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_id,
        data_type="tides",
    )

    if fetched_data_dict is None or not isinstance(fetched_data_dict, dict):
        _LOGGER.error(
            "Marées France Helper: Failed to fetch or received invalid format for "
            "tide data for %s starting %s.",
            harbor_id,
            start_date_str,
        )
        return False

    try:
        cache.setdefault(harbor_id, {})
        for day_str, tides in fetched_data_dict.items():
            cache[harbor_id][day_str] = tides
            _LOGGER.debug(
                "Marées France Helper: Updated tide cache for %s on %s",
                harbor_id,
                day_str,
            )

        await store.async_save(cache)
        _LOGGER.debug(
            "Marées France Helper: Saved updated tides cache for %s", harbor_id
        )
        return True
    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving tides cache for %s starting %s",
            harbor_id,
            start_date_str,
        )
        return False


async def _async_fetch_and_store_coefficients(
    hass: HomeAssistant,
    store: Store[dict[str, dict[str, Any]]],
    cache: dict[str, dict[str, Any]],
    harbor_id: str,
    start_date: date,
    days: int,
    websession: aiohttp.ClientSession | None = None,
) -> bool:
    """Fetch coefficient data, parse, store daily entries in cache, and save.

    Args:
        hass: The Home Assistant instance.
        store: The data store for caching.
        cache: The current cache dictionary.
        harbor_id: The ID of the harbor for the API request.
        start_date: The start date (datetime.date object) for fetching data.
        days: The number of days of coefficient data to fetch.
        websession: Optional aiohttp ClientSession. If not provided, one will be created.

    Returns:
        True if fetching and storing were successful for the expected number
        of days, False otherwise.
    """
    start_date_str = start_date.strftime(DATE_FORMAT)
    url = COEFF_URL_TEMPLATE.format(
        harbor_name=harbor_id, date=start_date_str, days=days
    )
    session = websession or async_get_clientsession(hass)
    timeout_seconds = 60

    fetched_data_list = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_id,
        data_type="coefficients",
    )

    if fetched_data_list is None or not isinstance(fetched_data_list, list):
        _LOGGER.error(
            "Marées France Helper: Failed to fetch or received invalid format for "
            "coefficient data for %s starting %s (%d days).",
            harbor_id,
            start_date_str,
            days,
        )
        return False

    try:
        cache.setdefault(harbor_id, {})
        processed_days_count = 0
        for monthly_coeffs_list in fetched_data_list:
            if isinstance(monthly_coeffs_list, list):
                for daily_coeffs in monthly_coeffs_list:
                    if processed_days_count >= days:
                        break

                    day_str = (
                        start_date + timedelta(days=processed_days_count)
                    ).strftime(DATE_FORMAT)
                    parsed_coeffs = []
                    if isinstance(daily_coeffs, list):
                        for coeff_item in daily_coeffs:
                            if isinstance(coeff_item, str):
                                parsed_coeffs.append(coeff_item)
                            elif (
                                isinstance(coeff_item, list)
                                and len(coeff_item) == 1
                                and isinstance(coeff_item[0], str)
                            ):
                                parsed_coeffs.append(coeff_item[0])
                            else:
                                _LOGGER.warning(
                                    "Marées France Helper: Unexpected item format within daily "
                                    "coefficients for %s on %s: %s. Skipping item.",
                                    harbor_id,
                                    day_str,
                                    coeff_item,
                                )

                        if parsed_coeffs:
                            cache[harbor_id][day_str] = parsed_coeffs
                            _LOGGER.debug(
                                "Marées France Helper: Updated coefficient cache for %s on %s: %s",
                                harbor_id,
                                day_str,
                                parsed_coeffs,
                            )
                        else:
                            _LOGGER.warning(
                                "Marées France Helper: No valid coefficients found "
                                "for %s on %s: %s. Skipping day.",
                                harbor_id,
                                day_str,
                                daily_coeffs,
                            )
                    else:
                        _LOGGER.warning(
                            "Marées France Helper: Unexpected format for daily coefficients "
                            "container for %s on %s: %s. Skipping day.",
                            harbor_id,
                            day_str,
                            daily_coeffs,
                        )
                    processed_days_count += 1
            if processed_days_count >= days:
                break

        if processed_days_count == days:
            await store.async_save(cache)
            _LOGGER.debug(
                "Marées France Helper: Saved updated coefficients cache for %s "
                "after processing %d days.",
                harbor_id,
                processed_days_count,
            )
            return True

        _LOGGER.error(
            "Marées France Helper: Processed %d days of coefficient data, but expected %d "
            "for %s starting %s. API data might be incomplete or parsing failed.",
            processed_days_count,
            days,
            harbor_id,
            start_date_str,
        )
        if processed_days_count > 0:  # Save partial data if any was processed
            await store.async_save(cache)
            _LOGGER.debug(
                "Marées France Helper: Saved partially updated coefficients cache for %s "
                "(%d days processed).",
                harbor_id,
                processed_days_count,
            )
        return False

    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving coefficients cache for %s "
            "starting %s (%d days)",
            harbor_id,
            start_date_str,
            days,
        )
        return False


async def _async_fetch_and_store_water_temp(
    hass: HomeAssistant,
    store: Store[dict[str, dict[str, Any]]],
    cache: dict[str, dict[str, Any]],
    harbor_id: str,
    lat: str,
    lon: str,
    websession: aiohttp.ClientSession | None = None,
) -> bool:
    """Fetch water temperature data, validate, store in cache, and save."""
    url = WATERTEMP_URL_TEMPLATE.format(lat=lat, lon=lon)
    session = websession or async_get_clientsession(hass)
    timeout_seconds = 30

    data = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_id,
        data_type="water temperature",
    )

    if data is None:
        return False

    try:
        previsions = data.get("contenu", {}).get("previs", {}).get("detail")
        if not isinstance(previsions, list):
            _LOGGER.error(
                "Marées France Helper: Water temp 'detail' is not a list for %s. Data: %s",
                harbor_id,
                data,
            )
            return False
    except Exception as e:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error accessing water temp data for %s. Error: %s",
            harbor_id,
            e,
        )
        return False

    try:
        harbor_cache = cache.setdefault(harbor_id, {})

        today = date.today()
        for i in range(7):
            current_date = today + timedelta(days=i)
            date_str = current_date.strftime(DATE_FORMAT)
            daily_temps = []

            for prevision in previsions:
                prevision_date_str = prevision.get("datetime", "").split("T")[0]
                if prevision_date_str == date_str and "teau" in prevision:
                    daily_temps.append(
                        {
                            "datetime": prevision["datetime"],
                            "temp": prevision["teau"],
                        }
                    )

            if daily_temps:
                harbor_cache[date_str] = daily_temps

        await store.async_save(cache)
        _LOGGER.debug(
            "Marées France Helper: Cached new water temperature data for %s",
            harbor_id,
        )
        return True
    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving water temperature cache for %s",
            harbor_id,
        )
        return False


async def _async_store_harbor_min_depth(
    hass: HomeAssistant,
    store: Store[dict[str, dict[str, Any]]],
    harbor_id: str,
    min_depth: float
) -> bool:
    """Store harbor min depth entry in cache, and save.

    Args:
        hass: The Home Assistant instance.
        store: The data store for caching.
        harbor_id: The ID of the harbor for the API request.
        min_depth: The minimum depth value for the specified harbor to store.

    Returns:
        True if storing is successful, False otherwise.
    """
    if min_depth is None:
        return False
    try:
        if not isinstance(min_depth, float):
            _LOGGER.error(
                "Marées France Helper: Min depth is not a float for %s. Data: %s",
                harbor_id,
                min_depth,
            )
            return False
    except Exception as e:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error accessing min depth data for %s. Error: %s",
            harbor_id,
            e,
            "Marées France Helper: Min depth is not a float for %s. Data: %s",
            harbor_id,
            min_depth,
        )
        return False
    try:
        cache: dict[str, dict[str, Any]] = await store.async_load() or {}
        harbor_cache = cache.setdefault(harbor_id, {})
        harbor_cache["harborMinDepth"] = min_depth

        await store.async_save(cache)
        _LOGGER.debug(
            "Marées France Helper: Cached new harbor min depth data %s for %s",
            cache,
            harbor_id,
        )
        return True
    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving harbor min depth cache for %s",
            harbor_id,
        )
        return False
