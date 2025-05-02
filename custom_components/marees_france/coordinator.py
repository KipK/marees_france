"""DataUpdateCoordinator for the Marées France integration."""

from __future__ import annotations

# Standard library imports
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

# Third-party imports
import pytz

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
# from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
# No longer fetching
# from homeassistant.helpers.aiohttp_client import async_get_clientsession # No longer fetching
# Needed for fetch helper (Session fetched within helper now)
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
    TIDE_LOW
)
# Import ALL helper functions from the new api_helpers module
from .api_helpers import (
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_tides,
    _async_fetch_and_store_coefficients,
)

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

        # Set a fixed update interval (e.g., 1 hour)
        # Sensor updates rely on this coordinator interval
        # Update coordinator more frequently to reflect 5-min water levels
        update_interval = timedelta(minutes=5)

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.harbor_id}",
            update_interval=update_interval,
        )

    async def _validate_and_repair_cache(
        self,
        store: Store[dict[str, dict[str, Any]]],
        cache_full: dict[str, dict[str, Any]],
        data_type: str, # "tides", "coefficients", "water_levels"
        fetch_function: callable,
        fetch_args: tuple, # Args needed for the specific fetch function
    ) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
        """Validate cache for the harbor, repair if needed, return full cache and harbor cache."""
        harbor_cache = cache_full.get(self.harbor_id, {})
        needs_repair = False

        if not isinstance(harbor_cache, dict):
            _LOGGER.warning(
                "Marées France Coordinator: Invalid cache format for %s harbor '%s': "
                "Expected dict, got %s.",
                data_type, self.harbor_id, type(harbor_cache).__name__
            )
            # is_valid = False # Unused variable
            needs_repair = True
        elif not harbor_cache and data_type != "water_levels":
            # Allow empty water level cache initially
            _LOGGER.warning(
                "Marées France Coordinator: Empty %s cache entry found for harbor '%s'.",
                data_type, self.harbor_id
            )
            # is_valid = False
            # Unused variable, treat empty as invalid for tides/coeffs for repair trigger
            needs_repair = True
        else:
            # --- Specific Validation Logic ---
            if data_type == "water_levels":
                # Water level data for a date should be a dict containing a 'data' list
                # REVERT: Expect the value associated with the date key to be a dict
                # containing the date key again
                for date_key, daily_data in harbor_cache.items():
                    if not isinstance(daily_data, dict): # <-- Check if daily_data is a dict
                        _LOGGER.warning(
                            "Marées France Coordinator: Invalid %s cache data for harbor '%s', "
                            "date '%s': Expected dict, got %s.",
                            data_type, self.harbor_id, date_key, type(daily_data).__name__
                        )
                        # is_valid = False # Unused variable
                        needs_repair = True
                        break
                    # Check for the date key within the dict and that its value is a list
                    # R1723: Unnecessary "elif" after "break"
                    if date_key not in daily_data or not isinstance(daily_data.get(date_key), list):
                        _LOGGER.warning(
                            "Marées France Coordinator: Invalid %s cache structure for "
                            "harbor '%s', date '%s': Missing or invalid inner list "
                            "for date key.",
                            data_type, self.harbor_id, date_key
                        )
                        # is_valid = False # Unused variable
                        needs_repair = True
                        break
            else: # Tides and Coefficients
                # Data for a date should be a list
                for date_key, daily_data in harbor_cache.items():
                    if not isinstance(daily_data, list):
                        _LOGGER.warning(
                            "Marées France Coordinator: Invalid %s cache data for harbor '%s', "
                            "date '%s': Expected list, got %s.",
                            data_type, self.harbor_id, date_key, type(daily_data).__name__
                        )
                        # is_valid = False # Unused variable
                        needs_repair = True
                        break # Stop checking on first invalid entry
            # --- End Specific Validation Logic ---

        if needs_repair:
            # Log message remains the same, indicating repair attempt
            _LOGGER.warning(
                "Marées France Coordinator: Invalid or empty %s cache detected "
                "for %s. Attempting repair.",
                data_type, self.harbor_id
            )
            try:
                # Remove the invalid entry from the full cache
                if self.harbor_id in cache_full:
                    del cache_full[self.harbor_id]
                # Save the cleaned cache
                await store.async_save(cache_full)
                _LOGGER.info(
                    "Marées France Coordinator: Removed invalid %s cache entry for %s.",
                    data_type, self.harbor_id
                )

                # Trigger the appropriate fetch function to repopulate
                _LOGGER.info(
                    "Marées France Coordinator: Triggering immediate fetch for %s data "
                    "for %s.", data_type, self.harbor_id
                )
                # Pass the *cleaned* full cache dictionary to the fetch function
                fetch_successful = await fetch_function(
                    self.hass, store, cache_full, self.harbor_id, *fetch_args
                )

                if fetch_successful:
                    _LOGGER.info(
                        "Marées France Coordinator: Successfully re-fetched %s data for %s "
                        "after cache repair.", data_type, self.harbor_id
                    )
                    # Reload the full cache and harbor-specific cache after successful fetch
                    cache_full = await store.async_load() or {}
                    harbor_cache = cache_full.get(self.harbor_id, {})
                else:
                    _LOGGER.error(
                        "Marées France Coordinator: Failed to re-fetch %s data for %s "
                        "after cache repair.", data_type, self.harbor_id
                    )
                    # Keep harbor_cache empty as repair failed
                    harbor_cache = {}

            except Exception: # W0612: Unused variable 'repair_err'
                _LOGGER.exception(
                    "Marées France Coordinator: Error during %s cache repair for %s.",
                    data_type, self.harbor_id
                )
                # Keep harbor_cache empty as repair failed
                harbor_cache = {}

        return cache_full, harbor_cache


    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch tide, coefficient, and water level data from cached stores."""
        _LOGGER.debug("Marées France Coordinator: Starting update cycle for %s", self.harbor_id)

        # --- Load Caches ---
        try:
            tides_cache_full = await self.tides_store.async_load() or {}
            coeff_cache_full = await self.coeff_store.async_load() or {}
            water_level_cache_full = await self.water_level_store.async_load() or {}
        except Exception as e:
            _LOGGER.exception(
                "Marées France Coordinator: Failed to load cache stores for %s", self.harbor_id
            )
            raise UpdateFailed(f"Failed to load cache: {e}") from e

        # --- Validate & Repair Caches ---
        today = date.today()
        today_str = today.strftime(DATE_FORMAT)
        yesterday = today - timedelta(days=1)
        yesterday_str = yesterday.strftime(DATE_FORMAT)
        fetch_duration = 8 # Default tide fetch duration

        # Validate/Repair Tides
        tides_cache_full, harbor_tides_cache = await self._validate_and_repair_cache(
            self.tides_store,
            tides_cache_full,
            "tides",
            _async_fetch_and_store_tides,
            (yesterday_str, fetch_duration) # Args for tides fetch
        )

        # Validate/Repair Coefficients
        # Fetch 365 days starting from the 1st of the current month
        first_day_of_current_month = today.replace(day=1)
        coeff_fetch_days = 365
        coeff_cache_full, harbor_coeff_cache = await self._validate_and_repair_cache(
            self.coeff_store,
            coeff_cache_full,
            "coefficients",
            _async_fetch_and_store_coefficients,
            (first_day_of_current_month, coeff_fetch_days) # Args for coeff fetch
        )

        # Validate/Repair Water Levels (less critical to repair full cache, focus on today)
        # We don't trigger a full repair fetch here, just validate the structure.
        # The check for *today's* data happens later.
        _, harbor_water_level_cache = await self._validate_and_repair_cache(
            self.water_level_store,
            water_level_cache_full,
            "water_levels",
            _async_fetch_and_store_water_level,
            (today_str,) # Args for water level fetch (only used if repair triggered)
            # Note: Repair fetch for water levels only gets today,
            # might need adjustment if full repair is desired
        )
        # Important: Reload the full water level cache after potential repair
        water_level_cache_full = await self.water_level_store.async_load() or {}
        harbor_water_level_cache = water_level_cache_full.get(self.harbor_id, {})


        # --- Prepare Data for Parser ---
        future_window_days = 366 # Look up to a year ahead for coeffs
        tides_data_for_parser = {}
        coeff_data_for_parser = {}
        # Try getting today's water levels
        water_level_data_for_parser = harbor_water_level_cache.get(today_str)

        # --- Check and Fetch Today's Water Levels if Missing (after validation) ---
        if water_level_data_for_parser is None:
            _LOGGER.info(
                "Marées France Coordinator: Today's (%s) water level data missing "
                "from cache for %s post-validation. Attempting fetch...",
                today_str, self.harbor_id
            )
            # Pass the potentially repaired full cache dict
            fetched_data = await _async_fetch_and_store_water_level(
                self.hass,
                self.water_level_store, # Use stored store object
                water_level_cache_full, # Pass the full cache dict
                self.harbor_id,
                today_str
            )
            if fetched_data:
                _LOGGER.info(
                    "Marées France Coordinator: Successfully fetched today's water "
                    "level data on demand."
                )
                water_level_data_for_parser = fetched_data # Use the freshly fetched data
                # Update the harbor-specific cache view
                harbor_water_level_cache[today_str] = fetched_data
            else:
                _LOGGER.warning(
                    "Marées France Coordinator: Failed to fetch today's water level data "
                    "on demand. Current height will be unavailable.",
                )
                # water_level_data_for_parser remains None

        # --- Continue preparing data for parser using validated/repaired caches ---
        for i in range(-1, future_window_days + 1): # -1 for yesterday's tides
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_tides_cache: # Use validated harbor cache
                tides_data_for_parser[check_date_str] = harbor_tides_cache[check_date_str]

        for i in range(future_window_days + 1): # 0 for today's coeffs
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_coeff_cache: # Use validated harbor cache
                coeff_data_for_parser[check_date_str] = harbor_coeff_cache[check_date_str]


        _LOGGER.debug(
            "Marées France Coordinator: Loaded %d days of tide data and %d days of "
            "coeff data for parser post-validation.",
            len(tides_data_for_parser), len(coeff_data_for_parser)
        )

        # Check if essential data is present *after* validation/repair attempts
        if not tides_data_for_parser:
            _LOGGER.error(
                "Marées France Coordinator: No tide data available for %s even after "
                "validation/repair.", self.harbor_id
            )
            raise UpdateFailed(
                f"No tide data available for {self.harbor_id} after validation/repair."
            )
        if not coeff_data_for_parser:
            _LOGGER.warning(
                "Marées France Coordinator: No coefficient data available for %s after "
                "validation/repair. Proceeding without it.", self.harbor_id
            )
            # Allow proceeding without coeffs


        # --- Parse Data ---
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
            _LOGGER.debug(
                "Marées France Coordinator: Calling _parse_tide_data with "
                "water_level_data_for_parser: %s", water_level_data_for_parser
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
            _LOGGER.exception(
                "Marées France Coordinator: Unexpected error processing data for %s",
                self.harbor_id
            )
            raise UpdateFailed(f"Error processing data: {err}") from err

    async def _parse_tide_data(
        self,
        tides_raw_data: dict[str, list[list[str]]], # Tides: yesterday -> future
        coeff_raw_data: dict[str, list[str]], # Coeffs: today -> future
        water_level_raw_data: dict | None, # Today's water levels {date: [[ts, h],...]}
        _translation_high: str, # W0613: Unused argument
        _translation_low: str, # W0613: Unused argument
    ) -> dict[str, Any]:
        """Parse tide, coefficient, and water level data for sensor states."""
        now_utc = datetime.now(timezone.utc)
        last_update_iso = now_utc.isoformat()

        if not tides_raw_data:
            _LOGGER.warning(
                "Marées France Coordinator: No tide data provided to _parse_tide_data."
            )
            # Return empty structure if no tides available, but include last update time
            return {"last_update": last_update_iso}

        all_tides_flat: list[dict[str, Any]] = []
        paris_tz = await self.hass.async_add_executor_job(pytz.timezone, "Europe/Paris")

        # --- Parse all available tide data ---
        for day_str, tides in tides_raw_data.items():
            for tide_info in tides:
                # Ensure tide_info is a list/tuple with exactly 4 elements
                if not isinstance(tide_info, (list, tuple)) or len(tide_info) != 4:
                    _LOGGER.warning(
                        "Marées France Coordinator: Skipping invalid tide_info format "
                        "for %s: %s", day_str, tide_info
                    )
                    continue

                tide_type, time_str, height_str, coeff_str = tide_info

                if time_str == "--:--" or height_str == "---":
                    continue

                try:
                    tide_dt_naive = datetime.strptime(
                        f"{day_str} {time_str}", f"{DATE_FORMAT} %H:%M"
                    )
                    tide_dt_local = paris_tz.localize(tide_dt_naive)
                    tide_dt_utc = tide_dt_local.astimezone(timezone.utc)
                except ValueError:
                    _LOGGER.warning(
                        "Marées France Coordinator: Could not parse datetime: %s %s",
                        day_str, time_str
                    )
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
                    "translated_type": (
                        TIDE_HIGH if tide_type == TIDE_HIGH
                        else TIDE_LOW if tide_type == TIDE_LOW
                        else "Unknown"
                    ),
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
                        valid_coeffs_int = [
                            int(c) for c in day_coeffs
                            if isinstance(c, str) and c.isdigit()
                        ]
                        if valid_coeffs_int:
                            max_coeff = max(valid_coeffs_int)
                            tide["coefficient"] = str(max_coeff)
                            _LOGGER.debug(
                                "Marées France Coordinator: Assigned max daily coeff %s to "
                                "tide on %s %s",
                                tide["coefficient"], tide["date_local"], tide["time_local"]
                            )
                        else:
                            tide["coefficient"] = None # No valid numeric coeffs found in the list
                    except (ValueError, TypeError):
                        _LOGGER.warning(
                            "Marées France Coordinator: Error processing daily coefficients "
                            "for %s %s: %s",
                            tide["date_local"], tide["time_local"], day_coeffs
                        )
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

        # --- Populate Next/Previous/Now ---
        if now_tide_index != -1: # Found a future tide
            next_tide_event = all_tides_flat[now_tide_index]
            # Determine starting height for next_tide (it's the height of the previous tide)
            next_starting_height = (
                all_tides_flat[now_tide_index - 1]["height"]
                if now_tide_index > 0 else None
            )
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
                # Determine starting height for previous_tide
                # (it's the height of the tide before previous)
                previous_starting_height = (
                    all_tides_flat[now_tide_index - 2]["height"]
                    if now_tide_index > 1 else None
                )
                previous_data = {
                    ATTR_TIDE_TREND: previous_tide_event["translated_type"], # Use raw constant
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: previous_tide_event["datetime_utc"],
                    # Use height of event before previous
                    ATTR_STARTING_HEIGHT: previous_starting_height,
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
        _LOGGER.debug(
            "Marées France Coordinator: Checking water level data for current height "
            "calculation. Received data: %s", water_level_raw_data
        )

        water_levels = None # Initialize
        today_str_check = date.today().strftime(DATE_FORMAT) # Get today's date string key

        # REVERT: Expect the raw data passed to be the dict {"YYYY-MM-DD": [...]},
        # extract list using date key
        if (isinstance(water_level_raw_data, dict) and
                isinstance(water_level_raw_data.get(today_str_check), list)):
            _LOGGER.debug(
                "Marées France Coordinator: Extracting water levels using key '%s'.",
                today_str_check
            )
            water_levels = water_level_raw_data[today_str_check] # Access the list via the date key
        elif water_level_raw_data is not None:
            _LOGGER.warning(
                "Marées France Coordinator: Received water level data, but it's not a "
                "dictionary or lacks the expected key '%s'. Data: %s",
                today_str_check, water_level_raw_data
            )
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

                        dt_naive = datetime.strptime(
                            f"{today_str_parse} {time_str}", f"{DATE_FORMAT} %H:%M:%S"
                        )
                        # Assume water level times are Europe/Paris like tide times
                        # paris_tz is defined earlier in the function
                        dt_local = paris_tz.localize(dt_naive)
                        entry_dt = dt_local.astimezone(timezone.utc)

                        diff = abs(now_utc - entry_dt)
                        if diff < min_diff:
                            min_diff = diff
                            closest_entry = entry
                    except (
                        ValueError, TypeError, pytz.exceptions.AmbiguousTimeError,
                        pytz.exceptions.NonExistentTimeError
                    ) as e:
                        # Add more detail to this warning, include the exception
                        _LOGGER.warning(
                            "Marées France Coordinator: Skipping water level entry due to "
                            "parsing/timezone error for %s: %s (%s)",
                            entry, e.__class__.__name__, e
                        )
                        continue

            if closest_entry:
                # Check if the closest entry is reasonably recent (e.g., within 15 minutes)
                if min_diff <= timedelta(minutes=15):
                    try:
                        # Height is the second element
                        current_water_height = float(closest_entry[1])
                        _LOGGER.debug(
                            "Marées France Coordinator: Found closest water level height: "
                            "%.2f m at %s (diff: %s)",
                            current_water_height, closest_entry[0], min_diff
                        )
                    except (ValueError, TypeError):
                        _LOGGER.warning(
                            "Marées France Coordinator: Could not parse height from "
                            "closest water level entry: %s", closest_entry
                        )
                else:
                    _LOGGER.warning(
                        "Marées France Coordinator: Closest water level entry is too old "
                        "(%s difference). Cannot determine current height.", min_diff
                    )
            else:
                # This log might trigger if all entries fail timestamp parsing
                _LOGGER.warning(
                    "Marées France Coordinator: Could not find any valid/parseable "
                    "water level entries for today."
                )
        # else: # This else corresponds to 'if water_levels:' - logging already handled above
            # if water_levels is None/empty
            # _LOGGER.warning(
            #     "Marées France Coordinator: No valid water level list available for today "
            #     "to determine current height."
            # )


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
                    valid_coeffs_int = [
                        int(c) for c in daily_coeffs
                        if isinstance(c, str) and c.isdigit()
                    ]
                    if not valid_coeffs_int:
                        continue # Skip day if no valid coefficients
                    max_coeff = max(valid_coeffs_int)

                    # Check for Spring Tide
                    if not found_spring and max_coeff >= SPRING_TIDE_THRESHOLD:
                        next_spring_date_str = day_str
                        next_spring_coeff = str(max_coeff) # Store as string
                        found_spring = True
                        _LOGGER.debug(
                            "Marées France Coordinator: Found next Spring Tide date: %s "
                            "(Coeff: %s)", next_spring_date_str, next_spring_coeff
                        )

                    # Check for Neap Tide
                    if not found_neap and max_coeff <= NEAP_TIDE_THRESHOLD:
                        next_neap_date_str = day_str
                        next_neap_coeff = str(max_coeff) # Store as string
                        found_neap = True
                        _LOGGER.debug(
                            "Marées France Coordinator: Found next Neap Tide date: %s "
                            "(Coeff: %s)", next_neap_date_str, next_neap_coeff
                        )

                except (ValueError, TypeError):
                    _LOGGER.warning(
                        "Marées France Coordinator: Error processing coefficients for %s: %s",
                        day_str, daily_coeffs
                    )

            # Stop if both found
            if found_spring and found_neap:
                break

        # --- Assemble final data structure ---
        # Convert date strings to date objects if they exist
        next_spring_date_obj = (
            date.fromisoformat(next_spring_date_str)
            if next_spring_date_str else None
        )
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
