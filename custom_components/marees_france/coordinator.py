"""DataUpdateCoordinator for the Marées France integration."""

from __future__ import annotations

# Standard library imports
import asyncio
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

# Third-party imports
import pytz

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
# from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady # No longer fetching
# from homeassistant.helpers.aiohttp_client import async_get_clientsession # No longer fetching
from homeassistant.helpers.aiohttp_client import async_get_clientsession # Needed for fetch helper
from homeassistant.helpers.storage import Store # Import Store
from homeassistant.helpers.translation import async_get_translations
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

# Import necessary components from __init__ for the fetch helper
from .const import (
    ATTR_COEFFICIENT, # Add attribute keys
    ATTR_CURRENT_HEIGHT, # Add current height attribute
    ATTR_FINISHED_HEIGHT,
    ATTR_FINISHED_TIME,
    ATTR_STARTING_HEIGHT,
    ATTR_STARTING_TIME,
    ATTR_TIDE_TREND,
    CONF_HARBOR_ID,
    DATE_FORMAT,
    DOMAIN,
    NEAP_TIDE_THRESHOLD, # Add Neap threshold
    SPRING_TIDE_THRESHOLD, # Add Spring threshold
    STATE_HIGH_TIDE,
    STATE_LOW_TIDE,
    TIDE_HIGH,
    TIDE_LOW,
    HEADERS, # Needed for fetch helper
    WATERLEVELS_STORAGE_KEY, # Needed for fetch helper store access
    WATERLEVELS_STORAGE_VERSION, # Needed for fetch helper store access
    WATERLEVELS_URL_TEMPLATE, # Needed for fetch helper URL
)
# Import the helper function from the new api_helpers module
from .api_helpers import _async_fetch_and_store_water_level

_LOGGER = logging.getLogger(__name__)


class MareesFranceUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Class to manage fetching and processing Marées France data."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        tides_store: Store[dict[str, dict[str, Any]]],
        coeff_store: Store[dict[str, dict[str, Any]]],
        water_level_store: Store[dict[str, dict[str, Any]]], # Add water_level_store parameter
    ) -> None:
        """Initialize the coordinator."""
        self.hass = hass
        self.config_entry = entry
        self.harbor_id = entry.data[CONF_HARBOR_ID]
        self.tides_store = tides_store
        self.coeff_store = coeff_store
        self.water_level_store = water_level_store # Store the water_level_store object

        # Set a fixed update interval (e.g., 1 hour) - Sensor updates rely on this coordinator interval
        update_interval = timedelta(minutes=5) # Update coordinator more frequently to reflect 5-min water levels

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.harbor_id}",
            update_interval=update_interval,
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch tide, coefficient, and water level data from the cached stores."""
        _LOGGER.debug("Marées France Coordinator: Reading tide, coefficient, and water level data from cache for %s", self.harbor_id)

        try:
            tides_cache_full = await self.tides_store.async_load() or {}
            coeff_cache_full = await self.coeff_store.async_load() or {}
            water_level_cache_full = await self.water_level_store.async_load() or {} # Load water level cache
        except Exception as e:
             _LOGGER.exception("Marées France Coordinator: Failed to load cache stores for %s", self.harbor_id)
             raise UpdateFailed(f"Failed to load cache: {e}") from e

        harbor_tides_cache = tides_cache_full.get(self.harbor_id, {})
        harbor_coeff_cache = coeff_cache_full.get(self.harbor_id, {})
        harbor_water_level_cache = water_level_cache_full.get(self.harbor_id, {}) # Get harbor specific water levels

        if not harbor_tides_cache:
             # Allow proceeding without tides if coeffs exist, parser should handle it
             _LOGGER.warning("Marées France Coordinator: No tide data found in cache for %s.", self.harbor_id)
             # raise UpdateFailed(f"Missing tide data in cache for {self.harbor_id}") # Don't fail here yet

        if not harbor_coeff_cache:
             # Allow proceeding without coeffs if tides exist, parser should handle it
             _LOGGER.warning("Marées France Coordinator: No coefficient data found in cache for %s.", self.harbor_id)
             # raise UpdateFailed(f"Missing coefficient data in cache for {self.harbor_id}") # Don't fail here yet


        # Prepare data for the parser:
        # Tides: yesterday through future window (e.g., 60 days)
        # Coeffs: today through future window (e.g., 60 days)
        today = date.today()
        today_str = today.strftime(DATE_FORMAT) # Get today's date string for water levels
        future_window_days = 366 # Look up to a year ahead for coeffs
        tides_data_for_parser = {}
        coeff_data_for_parser = {}
        water_level_data_for_parser = harbor_water_level_cache.get(today_str) # Try getting today's water levels first

        # --- Check and Fetch Today's Water Levels if Missing ---
        if water_level_data_for_parser is None:
            _LOGGER.info(
                "Marées France Coordinator: Today's (%s) water level data missing from cache for %s. Attempting fetch...",
                today_str, self.harbor_id
            )
            # We need the store object again here to pass to the helper
            # Note: Re-creating the Store object here is okay as it points to the same underlying file.
            # Alternatively, store it on self during __init__ if preferred.
            wl_store = Store[dict[str, dict[str, Any]]](self.hass, WATERLEVELS_STORAGE_VERSION, WATERLEVELS_STORAGE_KEY)
            # The helper needs the full cache dictionary to update it before saving.
            # We already loaded it as water_level_cache_full.
            fetched_data = await _async_fetch_and_store_water_level(
                self.hass,
                wl_store, # Pass the store object
                water_level_cache_full, # Pass the full cache dict
                self.harbor_id,
                today_str
            )
            if fetched_data:
                _LOGGER.info("Marées France Coordinator: Successfully fetched today's water level data.")
                water_level_data_for_parser = fetched_data # Use the freshly fetched data
                # Update the harbor-specific cache view as well, although it's less critical now
                harbor_water_level_cache[today_str] = fetched_data
            else:
                _LOGGER.warning(
                    "Marées France Coordinator: Failed to fetch today's water level data on demand. Current height will be unavailable.",
                )
                # water_level_data_for_parser remains None

        # --- Continue preparing data for parser ---
        for i in range(-1, future_window_days + 1): # -1 for yesterday's tides
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_tides_cache:
                tides_data_for_parser[check_date_str] = harbor_tides_cache[check_date_str]

        for i in range(future_window_days + 1): # 0 for today's coeffs
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_coeff_cache:
                 coeff_data_for_parser[check_date_str] = harbor_coeff_cache[check_date_str]


        _LOGGER.debug("Marées France Coordinator: Loaded %d days of tide data and %d days of coeff data for parser.",
                      len(tides_data_for_parser), len(coeff_data_for_parser))

        if not tides_data_for_parser:
             raise UpdateFailed(f"No relevant tide data found in cache for {self.harbor_id} for the required period.")


        try:
            # Fetch translations
            translations = await async_get_translations(
                self.hass, self.hass.config.language, "entity", {DOMAIN}
            )
            translation_high = translations.get(
                f"component.{DOMAIN}.entity.sensor.tides.state.{STATE_HIGH_TIDE}",
                STATE_HIGH_TIDE.replace("_", " ").title(),
            )
            translation_low = translations.get(
                f"component.{DOMAIN}.entity.sensor.tides.state.{STATE_LOW_TIDE}",
                STATE_LOW_TIDE.replace("_", " ").title(),
            )

            # Parse the combined tide and coefficient data
            # Pass only high/low translations needed for next/previous attributes initially
            # Pass water level data to the parser
            _LOGGER.debug(
                "Marées France Coordinator: Calling _parse_tide_data with water_level_data_for_parser: %s",
                water_level_data_for_parser
            )
            return await self._parse_tide_data(
                tides_data_for_parser,
                coeff_data_for_parser,
                water_level_data_for_parser, # Pass today's water levels
                translation_high,
                translation_low
            )

        except Exception as err:
            # Catch potential errors during parsing or translation fetching
            _LOGGER.exception("Marées France Coordinator: Unexpected error processing cached data for %s", self.harbor_id)
            raise UpdateFailed(f"Error processing cached data: {err}") from err

    async def _parse_tide_data(
        self,
        tides_raw_data: dict[str, list[list[str]]], # Tides for yesterday to future_window
        coeff_raw_data: dict[str, list[str]], # Coeffs for today to future_window
        water_level_raw_data: dict | None, # Today's water levels (e.g., {"metadata": ..., "data": [[ts, h],...]})
        translation_high: str,
        translation_low: str,
    ) -> dict[str, Any]:
        """Parse tide, coefficient, and water level data to generate state for all sensors."""
        now_utc = datetime.now(timezone.utc)
        last_update_iso = now_utc.isoformat()

        if not tides_raw_data:
             _LOGGER.warning("Marées France Coordinator: No tide data provided to _parse_tide_data.")
             # Return empty structure if no tides available, but include last update time
             return {"last_update": last_update_iso}

        all_tides_flat: list[dict[str, Any]] = []
        paris_tz = await self.hass.async_add_executor_job(pytz.timezone, "Europe/Paris")

        # --- Parse all available tide data ---
        for day_str, tides in tides_raw_data.items():
            for tide_info in tides:
                # Ensure tide_info is a list/tuple with exactly 4 elements
                if not isinstance(tide_info, (list, tuple)) or len(tide_info) != 4:
                    _LOGGER.warning("Marées France Coordinator: Skipping invalid tide_info format for %s: %s", day_str, tide_info)
                    continue

                tide_type, time_str, height_str, coeff_str = tide_info

                if time_str == "--:--" or height_str == "---":
                    continue

                try:
                    tide_dt_naive = datetime.strptime(f"{day_str} {time_str}", f"{DATE_FORMAT} %H:%M")
                    tide_dt_local = paris_tz.localize(tide_dt_naive)
                    tide_dt_utc = tide_dt_local.astimezone(timezone.utc)
                except ValueError:
                    _LOGGER.warning("Marées France Coordinator: Could not parse datetime: %s %s", day_str, time_str)
                    continue

                # Use coefficient from tide data if available, otherwise mark for lookup
                coeff_value = coeff_str if coeff_str != "---" else None

                flat_entry = {
                    "type": tide_type,
                    "time_local": time_str, # Keep local time string for display
                    "height": height_str,
                    "coefficient": coeff_value, # May be None initially
                    "datetime_utc": tide_dt_utc.isoformat(),
                    "date_local": day_str, # Keep local date string for coeff lookup
                    # Store the raw constant for type, not the translation, for attribute use
                    "translated_type": TIDE_HIGH if tide_type == TIDE_HIGH else TIDE_LOW if tide_type == TIDE_LOW else "Unknown",
                }
                all_tides_flat.append(flat_entry)

        # Sort flat list by datetime
        all_tides_flat.sort(key=lambda x: x["datetime_utc"])

        # --- Fill missing coefficients from coeff_raw_data ---
        for tide in all_tides_flat:
            if tide["coefficient"] is None:
                day_coeffs = coeff_raw_data.get(tide["date_local"])
                if day_coeffs and isinstance(day_coeffs, list):
                    # Find the maximum coefficient for the day to assign to tides missing one.
                    try:
                        # Convert valid strings to int, find max, convert back to string
                        valid_coeffs_int = [int(c) for c in day_coeffs if isinstance(c, str) and c.isdigit()]
                        if valid_coeffs_int:
                            max_coeff = max(valid_coeffs_int)
                            tide["coefficient"] = str(max_coeff)
                            _LOGGER.debug("Marées France Coordinator: Assigned max daily coeff %s to tide on %s %s", tide["coefficient"], tide["date_local"], tide["time_local"])
                        else:
                            tide["coefficient"] = None # No valid numeric coeffs found in the list
                    except (ValueError, TypeError):
                         _LOGGER.warning("Marées France Coordinator: Error processing daily coefficients for %s %s: %s",
                                       tide["date_local"], tide["time_local"], day_coeffs)
                         tide["coefficient"] = None # Ensure it remains None if lookup fails
                else:
                     tide["coefficient"] = None # Ensure it remains None if no daily coeffs found

        # --- Find key tide events ---
        now_tide_index = -1
        for i, tide in enumerate(all_tides_flat):
            tide_dt = datetime.fromisoformat(tide["datetime_utc"])
            if tide_dt > now_utc:
                now_tide_index = i
                break

        # Initialize data containers
        now_data = None
        next_data = None
        previous_data = None
        next_spring_data = None
        next_neap_data = None

        # --- Populate Next/Previous/Now ---
        if now_tide_index != -1: # Found a future tide
            next_tide_event = all_tides_flat[now_tide_index]
            # Determine starting height for next_tide (it's the height of the previous tide)
            next_starting_height = all_tides_flat[now_tide_index - 1]["height"] if now_tide_index > 0 else None
            next_data = {
                ATTR_TIDE_TREND: next_tide_event["translated_type"], # Use raw constant
                ATTR_STARTING_TIME: next_tide_event["datetime_utc"], # Use UTC for state
                ATTR_FINISHED_TIME: next_tide_event["datetime_utc"], # State is the event time
                ATTR_STARTING_HEIGHT: next_starting_height, # Use height of previous event
                ATTR_FINISHED_HEIGHT: next_tide_event["height"],
                ATTR_COEFFICIENT: next_tide_event["coefficient"],
            }

            if now_tide_index > 0:
                previous_tide_event = all_tides_flat[now_tide_index - 1]
                # Determine starting height for previous_tide (it's the height of the tide before previous)
                previous_starting_height = all_tides_flat[now_tide_index - 2]["height"] if now_tide_index > 1 else None
                previous_data = {
                    ATTR_TIDE_TREND: previous_tide_event["translated_type"], # Use raw constant
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: previous_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_starting_height, # Use height of event before previous
                    ATTR_FINISHED_HEIGHT: previous_tide_event["height"],
                    ATTR_COEFFICIENT: previous_tide_event["coefficient"],
                }

                # Now Sensor Data (represents the interval *between* previous and next)
                # Use raw status for the attribute, HA translates the *state*
                tide_status = "rising" if previous_tide_event["type"] == TIDE_LOW else "falling"
                now_data = {
                    ATTR_TIDE_TREND: tide_status, # Use raw value
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: next_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_tide_event["height"],
                    ATTR_FINISHED_HEIGHT: next_tide_event["height"],
                    # Coefficient for 'now' is usually associated with the *next* tide event
                    ATTR_COEFFICIENT: next_tide_event["coefficient"],
                    # Current height will be added below using water level data
                }

        # --- Calculate Current Height from Water Levels ---
        current_water_height = None
        # Add detailed logging before the check
        _LOGGER.debug("Marées France Coordinator: Checking water level data for current height calculation. Received data: %s", water_level_raw_data)

        water_levels = None # Initialize
        today_str_check = date.today().strftime(DATE_FORMAT) # Get today's date string key

        if isinstance(water_level_raw_data, dict) and isinstance(water_level_raw_data.get(today_str_check), list):
            # Directly access the list using today's date string as the key
            _LOGGER.debug("Marées France Coordinator: Extracting water levels using key '%s'.", today_str_check)
            water_levels = water_level_raw_data[today_str_check]
        elif water_level_raw_data is not None:
             _LOGGER.warning("Marées France Coordinator: Received water level data, but it's not a dictionary or lacks the expected key '%s'. Data: %s", today_str_check, water_level_raw_data)
        # else: water_level_raw_data is None, already logged before calling parse

        # Proceed only if we successfully extracted water_levels list
        if water_levels:
            closest_entry = None
            min_diff = timedelta.max
            # Use the date string key for parsing
            today_str_parse = today_str_check

            for entry in water_levels:
                if isinstance(entry, list) and len(entry) == 2:
                    try:
                        # Combine date and time, parse, localize, convert to UTC
                        time_str = entry[0]
                        # Ensure time_str has seconds if missing (strptime needs %S)
                        if len(time_str) == 5: # HH:MM
                            time_str += ":00" # Append :00 for seconds
                        elif len(time_str) != 8: # Not HH:MM:SS
                            raise ValueError(f"Unexpected time format: {time_str}")

                        dt_naive = datetime.strptime(f"{today_str_parse} {time_str}", f"{DATE_FORMAT} %H:%M:%S")
                        # Assume water level times are Europe/Paris like tide times
                        dt_local = paris_tz.localize(dt_naive) # paris_tz is defined earlier in the function
                        entry_dt = dt_local.astimezone(timezone.utc)

                        diff = abs(now_utc - entry_dt)
                        if diff < min_diff:
                            min_diff = diff
                            closest_entry = entry
                    except (ValueError, TypeError, pytz.exceptions.AmbiguousTimeError, pytz.exceptions.NonExistentTimeError) as e:
                        # Add more detail to this warning, include the exception
                        _LOGGER.warning("Marées France Coordinator: Skipping water level entry due to parsing/timezone error for %s: %s (%s)",
                                        entry, e.__class__.__name__, e)
                        continue

            if closest_entry:
                # Check if the closest entry is reasonably recent (e.g., within 15 minutes)
                if min_diff <= timedelta(minutes=15):
                    try:
                        current_water_height = float(closest_entry[1]) # Height is the second element
                        _LOGGER.debug("Marées France Coordinator: Found closest water level height: %.2f m at %s (diff: %s)",
                                      current_water_height, closest_entry[0], min_diff)
                    except (ValueError, TypeError):
                         _LOGGER.warning("Marées France Coordinator: Could not parse height from closest water level entry: %s", closest_entry)
                else:
                     _LOGGER.warning("Marées France Coordinator: Closest water level entry is too old (%s difference). Cannot determine current height.", min_diff)
            else:
                 # This log might trigger if all entries fail timestamp parsing
                 _LOGGER.warning("Marées France Coordinator: Could not find any valid/parseable water level entries for today.")
        # else: # This else corresponds to 'if water_levels:' - logging already handled above if water_levels is None/empty
             # _LOGGER.warning("Marées France Coordinator: No valid water level list available for today to determine current height.")


        # Add current height to now_data if available
        if now_data is not None and current_water_height is not None:
            now_data[ATTR_CURRENT_HEIGHT] = current_water_height


        # --- Find Next Spring/Neap Tide Dates from Coefficients ---
        next_spring_date_str = None
        next_spring_coeff = None
        next_neap_date_str = None
        next_neap_coeff = None
        found_spring = False
        found_neap = False
        today_str = now_utc.strftime(DATE_FORMAT)

        # Sort coefficient data by date string
        sorted_coeff_dates = sorted(coeff_raw_data.keys())

        for day_str in sorted_coeff_dates:
            # Only consider today or future dates
            if day_str < today_str:
                continue

            daily_coeffs = coeff_raw_data.get(day_str)
            if daily_coeffs and isinstance(daily_coeffs, list):
                try:
                    # Use max coefficient for the day to determine Spring/Neap status
                    valid_coeffs_int = [int(c) for c in daily_coeffs if isinstance(c, str) and c.isdigit()]
                    if not valid_coeffs_int:
                        continue # Skip day if no valid coefficients
                    max_coeff = max(valid_coeffs_int)

                    # Check for Spring Tide
                    if not found_spring and max_coeff >= SPRING_TIDE_THRESHOLD:
                        next_spring_date_str = day_str
                        next_spring_coeff = str(max_coeff) # Store as string
                        found_spring = True
                        _LOGGER.debug("Marées France Coordinator: Found next Spring Tide date: %s (Coeff: %s)", next_spring_date_str, next_spring_coeff)

                    # Check for Neap Tide
                    if not found_neap and max_coeff <= NEAP_TIDE_THRESHOLD:
                        next_neap_date_str = day_str
                        next_neap_coeff = str(max_coeff) # Store as string
                        found_neap = True
                        _LOGGER.debug("Marées France Coordinator: Found next Neap Tide date: %s (Coeff: %s)", next_neap_date_str, next_neap_coeff)

                except (ValueError, TypeError):
                    _LOGGER.warning("Marées France Coordinator: Error processing coefficients for %s: %s", day_str, daily_coeffs)

            # Stop if both found
            if found_spring and found_neap:
                break

        # --- Assemble final data structure ---
        # Convert date strings to date objects if they exist
        next_spring_date_obj = date.fromisoformat(next_spring_date_str) if next_spring_date_str else None
        next_neap_date_obj = date.fromisoformat(next_neap_date_str) if next_neap_date_str else None

        final_data = {
            "now_data": now_data,
            "next_data": next_data,
            "previous_data": previous_data,
            # Use date objects for HA compatibility
            "next_spring_date": next_spring_date_obj,
            "next_spring_coeff": next_spring_coeff,
            "next_neap_date": next_neap_date_obj,
            "next_neap_coeff": next_neap_coeff,
            "last_update": last_update_iso, # Use stored ISO string
        }

        # Filter out top-level keys where the value is None
        return {k: v for k, v in final_data.items() if v is not None}
