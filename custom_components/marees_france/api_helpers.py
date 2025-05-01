"""API Fetching and Caching Helpers for Marées France."""

from __future__ import annotations

import logging
import asyncio
import aiohttp
from datetime import date, timedelta
from typing import Any

# Home Assistant core imports
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store

# Local constants
from .const import (
    HEADERS,
    WATERLEVELS_URL_TEMPLATE,
    TIDESURL_TEMPLATE,
    COEFF_URL_TEMPLATE,
    DATE_FORMAT,
    API_REQUEST_DELAY, # Add the new constant
)

_LOGGER = logging.getLogger(__name__)


# --- API Fetch Helper with Retry ---

async def _async_fetch_with_retry(
    session: aiohttp.ClientSession,
    url: str,
    headers: dict,
    timeout: int,
    harbor_id: str, # For logging context
    data_type: str, # For logging context (e.g., "water levels", "tides", "coefficients")
) -> dict | list | None:
    """Fetch data from URL with delay, retry logic, and detailed logging."""
    max_retries = 5
    initial_delay = 5 # seconds

    # Task 2: Always wait 1 second before making a request
    await asyncio.sleep(API_REQUEST_DELAY) # Use the constant
    _LOGGER.debug("Marées France Helper: Preparing to fetch %s for %s from %s", data_type, harbor_id, url)

    for attempt in range(max_retries):
        current_delay = initial_delay * (2 ** attempt)
        try:
            async with asyncio.timeout(timeout):
                response = await session.get(url, headers=headers)
                response.raise_for_status() # Raises ClientResponseError for 4xx/5xx
                data = await response.json()
                _LOGGER.debug("Marées France Helper: Successfully fetched %s for %s (attempt %d/%d)", data_type, harbor_id, attempt + 1, max_retries)
                return data # Success

        except asyncio.TimeoutError:
            _LOGGER.warning(
                "Marées France Helper: Timeout fetching %s for %s (attempt %d/%d). Retrying in %ds...",
                data_type, harbor_id, attempt + 1, max_retries, current_delay
            )
        except aiohttp.ClientResponseError as err:
             _LOGGER.warning(
                "Marées France Helper: HTTP error %s fetching %s for %s (attempt %d/%d): %s. Retrying in %ds...",
                err.status, data_type, harbor_id, attempt + 1, max_retries, err.message, current_delay
            )
        except aiohttp.ClientError as err:
            _LOGGER.warning(
                "Marées France Helper: Client error fetching %s for %s (attempt %d/%d): %s. Retrying in %ds...",
                data_type, harbor_id, attempt + 1, max_retries, err, current_delay
            )
        except Exception as err: # Catch unexpected errors during fetch/decode
             _LOGGER.warning(
                "Marées France Helper: Unexpected error fetching %s for %s (attempt %d/%d): %s. Retrying in %ds...",
                data_type, harbor_id, attempt + 1, max_retries, err, current_delay
            )

        # If not the last attempt, wait before retrying
        if attempt < max_retries - 1:
            await asyncio.sleep(current_delay)
        else:
            # Last attempt failed
            _LOGGER.error(
                "Marées France Helper: Failed to fetch %s for %s after %d attempts.",
                data_type, harbor_id, max_retries
            )

    return None # Return None if all retries fail


# --- Water Level Helpers ---

async def _async_fetch_and_store_water_level(
    hass: HomeAssistant,
    store: Store,
    cache: dict[str, dict[str, Any]],
    harbor_name: str, # API uses harbor name/ID
    date_str: str,
) -> Any | None:
    """Fetch water level data using retry helper, store in cache, and save."""
    url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
    session = async_get_clientsession(hass)
    timeout_seconds = 30 # Define timeout

    # Use the retry helper
    data = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_name,
        data_type="water levels"
    )

    if data is None:
        # Error already logged by the helper
        return None # Indicate failure

    # --- Validate fetched data structure (expecting {"YYYY-MM-DD": [...]}) before saving ---
    # Explicitly check each part of the expected structure.
    if not isinstance(data, dict):
        valid_structure = False
    elif date_str not in data:
        valid_structure = False
    elif not isinstance(data[date_str], list):
        valid_structure = False
    else:
        valid_structure = True # Structure is valid

    if not valid_structure:
        _LOGGER.error(
            "Marées France Helper: Fetched water level data for %s on %s has unexpected structure or is missing the date key. Discarding. Data: %s",
            harbor_name, date_str, data
        )
        return None # Indicate failure, do not save invalid data

    # Store in cache and save if fetch was successful
    try:
        # --- Add detailed logging before save ---
        cache.setdefault(harbor_name, {})[date_str] = data # Store the whole dictionary
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
        return None # Indicate failure even if fetch succeeded but save failed


# --- Tide Data Helpers ---

async def _async_fetch_and_store_tides(
    hass: HomeAssistant,
    store: Store,
    cache: dict[str, dict[str, Any]],
    harbor_id: str, # API uses harbor_id for tides
    start_date_str: str,
    duration: int = 8, # Default duration if not specified
) -> bool:
    """Fetch tide data using retry helper, parse, store, and save."""
    url = f"{TIDESURL_TEMPLATE.format(harbor_id=harbor_id, date=start_date_str)}&duration={duration}"
    session = async_get_clientsession(hass)
    timeout_seconds = 15 + (duration * 5) # Keep dynamic timeout

    # Use the retry helper
    fetched_data_dict = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_id,
        data_type="tides"
    )

    if fetched_data_dict is None or not isinstance(fetched_data_dict, dict):
        # Error logged by helper or unexpected format
        _LOGGER.error("Marées France Helper: Failed to fetch or received invalid format for tide data for %s starting %s.", harbor_id, start_date_str)
        return False # Indicate failure

    # Update cache with fetched data, day by day
    try:
        cache.setdefault(harbor_id, {}) # Ensure harbor key exists
        for day_str, tides in fetched_data_dict.items():
            cache[harbor_id][day_str] = tides
            _LOGGER.debug("Marées France Helper: Updated tide cache for %s on %s", harbor_id, day_str)

        await store.async_save(cache)
        _LOGGER.debug("Marées France Helper: Saved updated tides cache for %s", harbor_id)
        return True # Indicate success
    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving tides cache for %s starting %s",
            harbor_id,
            start_date_str,
        )
        return False # Indicate failure even if fetch succeeded but save failed


# --- Coefficient Helpers ---

async def _async_fetch_and_store_coefficients(
    hass: HomeAssistant,
    store: Store,
    cache: dict[str, dict[str, Any]],
    harbor_id: str,
    start_date: date,
    days: int,
) -> bool:
    """Fetch coefficient data using retry helper, parse, store daily, and save."""
    start_date_str = start_date.strftime(DATE_FORMAT)
    url = COEFF_URL_TEMPLATE.format(harbor_name=harbor_id, date=start_date_str, days=days)
    session = async_get_clientsession(hass)
    timeout_seconds = 60 # Keep longer timeout

    # Use the retry helper
    fetched_data_list = await _async_fetch_with_retry(
        session=session,
        url=url,
        headers=HEADERS,
        timeout=timeout_seconds,
        harbor_id=harbor_id,
        data_type="coefficients"
    )

    if fetched_data_list is None or not isinstance(fetched_data_list, list):
        # Error logged by helper or unexpected format
        _LOGGER.error("Marées France Helper: Failed to fetch or received invalid format for coefficient data for %s starting %s (%d days).", harbor_id, start_date_str, days)
        return False # Indicate failure

    # Update cache with fetched data, day by day
    try:
        cache.setdefault(harbor_id, {}) # Ensure harbor key exists
        processed_days_count = 0
        # Iterate through each month's list
        for monthly_coeffs_list in fetched_data_list:
            if isinstance(monthly_coeffs_list, list):
                # Iterate through each day's list within the month
                for daily_coeffs in monthly_coeffs_list:
                    # Check if we have processed the requested number of days
                    if processed_days_count >= days:
                        break # Stop processing if we have enough days

                    day_str = (start_date + timedelta(days=processed_days_count)).strftime(DATE_FORMAT)
                    # Ensure daily_coeffs is a list containing coefficient strings (potentially nested in single-element lists)
                    parsed_coeffs = []
                    if isinstance(daily_coeffs, list):
                        for coeff_item in daily_coeffs:
                            if isinstance(coeff_item, str):
                                parsed_coeffs.append(coeff_item)
                            elif isinstance(coeff_item, list) and len(coeff_item) == 1 and isinstance(coeff_item[0], str):
                                parsed_coeffs.append(coeff_item[0])
                            else:
                                 _LOGGER.warning("Marées France Helper: Unexpected item format within daily coefficients for %s on %s: %s. Skipping item.", harbor_id, day_str, coeff_item)

                        if parsed_coeffs: # Only store if we successfully parsed coefficients for the day
                            cache[harbor_id][day_str] = parsed_coeffs
                            _LOGGER.debug("Marées France Helper: Updated coefficient cache for %s on %s: %s", harbor_id, day_str, parsed_coeffs)
                        else:
                             _LOGGER.warning("Marées France Helper: No valid coefficients found for %s on %s: %s. Skipping day.", harbor_id, day_str, daily_coeffs)
                    else:
                        _LOGGER.warning("Marées France Helper: Unexpected format for daily coefficients container for %s on %s: %s. Skipping day.", harbor_id, day_str, daily_coeffs)

                    processed_days_count += 1 # Increment day counter *after* processing a day's entry

            if processed_days_count >= days:
                break # Stop processing months if we have enough days

        # After processing all months (or breaking early)
        if processed_days_count == days:
            await store.async_save(cache)
            _LOGGER.debug("Marées France Helper: Saved updated coefficients cache for %s after processing %d days.", harbor_id, processed_days_count)
            return True # Indicate success
        else:
            _LOGGER.error("Marées France Helper: Processed %d days of coefficient data, but expected %d for %s starting %s. API data might be incomplete or parsing failed.", processed_days_count, days, harbor_id, start_date_str)
            # Save whatever was processed successfully before returning failure
            if processed_days_count > 0:
                 await store.async_save(cache)
                 _LOGGER.debug("Marées France Helper: Saved partially updated coefficients cache for %s (%d days processed).", harbor_id, processed_days_count)
            return False # Indicate failure (didn't get the expected number of days)

    except Exception:
        _LOGGER.exception(
            "Marées France Helper: Unexpected error saving coefficients cache for %s starting %s (%d days)",
            harbor_id,
            start_date_str,
            days
        )
        return False # Indicate failure