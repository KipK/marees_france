"""DataUpdateCoordinator for the Marées France integration."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any, Callable, Coroutine

import pytz

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.translation import async_get_translations
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    ATTR_COEFFICIENT,
    ATTR_CURRENT_HEIGHT,
    ATTR_FINISHED_HEIGHT,
    ATTR_FINISHED_TIME,
    ATTR_STARTING_HEIGHT,
    ATTR_STARTING_TIME,
    ATTR_TIDE_TREND,
    CONF_HARBOR_ID,
    DATE_FORMAT,
    DOMAIN,
    NEAP_TIDE_THRESHOLD,
    SPRING_TIDE_THRESHOLD,
    STATE_HIGH_TIDE,
    STATE_LOW_TIDE,
    TIDE_HIGH,
    TIDE_LOW,
)
from .api_helpers import (
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_tides,
    _async_fetch_and_store_coefficients,
)

_LOGGER = logging.getLogger(__name__)


class MareesFranceUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Manages fetching, caching, and processing of Marées France data.

    This coordinator is responsible for:
    - Loading tide, coefficient, and water level data from persistent storage (cache).
    - Validating the integrity of cached data and repairing it by fetching fresh data if necessary.
    - Periodically updating the data by fetching new information for the configured harbor.
    - Parsing the raw data into a structured format suitable for sensor entities.
    - Calculating derived information such as current tide trend, next spring/neap tides.
    """

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        tides_store: Store[dict[str, dict[str, Any]]],
        coeff_store: Store[dict[str, dict[str, Any]]],
        water_level_store: Store[dict[str, dict[str, Any]]],
    ) -> None:
        """Initialize the data update coordinator.

        Args:
            hass: The Home Assistant instance.
            entry: The config entry for this coordinator instance.
            tides_store: The store for caching tide data.
            coeff_store: The store for caching coefficient data.
            water_level_store: The store for caching water level data.
        """
        self.hass = hass
        self.config_entry = entry
        self.harbor_id: str = entry.data[CONF_HARBOR_ID]
        self.tides_store = tides_store
        self.coeff_store = coeff_store
        self.water_level_store = water_level_store

        update_interval = timedelta(minutes=5) # Frequent updates for water levels

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
        data_type: str,
        fetch_function: Callable[
            [HomeAssistant, Store[dict[str, dict[str, Any]]], dict[str, dict[str, Any]], str, Any],
            Coroutine[Any, Any, bool | Any | None]
        ],
        fetch_args: tuple,
    ) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
        """Validate cache for the harbor, repair if needed, and return caches.

        Checks if the cache for the specific harbor and data type is present and
        has a valid basic structure. If not, it attempts to clear the invalid
        entry and re-fetch the data using the provided `fetch_function`.

        Args:
            store: The data store instance (tides, coefficients, or water levels).
            cache_full: The entire cache dictionary loaded from the store.
            data_type: A string identifying the type of data ("tides",
                       "coefficients", "water_levels").
            fetch_function: The async function to call to re-fetch data if repair
                            is needed.
            fetch_args: A tuple of arguments to pass to the `fetch_function`
                        (excluding hass, store, cache_full, harbor_id which are
                        passed automatically).

        Returns:
            A tuple containing:
                - The (potentially modified) full cache dictionary.
                - The harbor-specific cache dictionary (potentially re-fetched).
        """
        harbor_cache = cache_full.get(self.harbor_id, {})
        needs_repair = False

        if not isinstance(harbor_cache, dict):
            _LOGGER.warning(
                "Marées France Coordinator: Invalid cache format for %s harbor '%s': "
                "Expected dict, got %s.",
                data_type, self.harbor_id, type(harbor_cache).__name__
            )
            needs_repair = True
        elif not harbor_cache and data_type != "water_levels": # Allow empty water_levels initially
            _LOGGER.warning(
                "Marées France Coordinator: Empty %s cache entry found for harbor '%s'.",
                data_type, self.harbor_id
            )
            needs_repair = True
        else:
            # Specific validation for data structures within the harbor_cache
            if data_type == "water_levels":
                for date_key, daily_data in harbor_cache.items():
                    if not isinstance(daily_data, dict) or \
                       date_key not in daily_data or \
                       not isinstance(daily_data.get(date_key), list):
                        _LOGGER.warning(
                            "Marées France Coordinator: Invalid %s cache structure for "
                            "harbor '%s', date '%s'.",
                            data_type, self.harbor_id, date_key
                        )
                        needs_repair = True
                        break
            else:  # Tides and Coefficients expect a list of items per date
                for date_key, daily_data in harbor_cache.items():
                    if not isinstance(daily_data, list):
                        _LOGGER.warning(
                            "Marées France Coordinator: Invalid %s cache data for harbor '%s', "
                            "date '%s': Expected list, got %s.",
                            data_type, self.harbor_id, date_key, type(daily_data).__name__
                        )
                        needs_repair = True
                        break

        if needs_repair:
            _LOGGER.warning(
                "Marées France Coordinator: Invalid or empty %s cache detected "
                "for %s. Attempting repair.",
                data_type, self.harbor_id
            )
            try:
                if self.harbor_id in cache_full:
                    del cache_full[self.harbor_id]
                await store.async_save(cache_full)
                _LOGGER.info(
                    "Marées France Coordinator: Removed invalid %s cache entry for %s.",
                    data_type, self.harbor_id
                )

                _LOGGER.info(
                    "Marées France Coordinator: Triggering immediate fetch for %s data "
                    "for %s.", data_type, self.harbor_id
                )
                fetch_successful = await fetch_function(
                    self.hass, store, cache_full, self.harbor_id, *fetch_args
                )

                if fetch_successful:
                    _LOGGER.info(
                        "Marées France Coordinator: Successfully re-fetched %s data for %s "
                        "after cache repair.", data_type, self.harbor_id
                    )
                    cache_full = await store.async_load() or {}
                    harbor_cache = cache_full.get(self.harbor_id, {})
                else:
                    _LOGGER.error(
                        "Marées France Coordinator: Failed to re-fetch %s data for %s "
                        "after cache repair.", data_type, self.harbor_id
                    )
                    harbor_cache = {}
            except Exception:
                _LOGGER.exception(
                    "Marées France Coordinator: Error during %s cache repair for %s.",
                    data_type, self.harbor_id
                )
                harbor_cache = {}
        return cache_full, harbor_cache


    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch and process tide, coefficient, and water level data.

        This is the core method called by DataUpdateCoordinator to refresh data.
        It loads data from caches, validates/repairs them, fetches today's
        water levels if missing, and then parses all data into a structured
        format for sensors.

        Returns:
            A dictionary containing the processed data for the harbor.

        Raises:
            UpdateFailed: If essential data (like tides) cannot be loaded or fetched.
        """
        _LOGGER.debug("Marées France Coordinator: Starting update cycle for %s", self.harbor_id)

        try:
            tides_cache_full = await self.tides_store.async_load() or {}
            coeff_cache_full = await self.coeff_store.async_load() or {}
            water_level_cache_full = await self.water_level_store.async_load() or {}
        except Exception as e:
            _LOGGER.exception(
                "Marées France Coordinator: Failed to load cache stores for %s", self.harbor_id
            )
            raise UpdateFailed(f"Failed to load cache: {e}") from e

        today = date.today()
        today_str = today.strftime(DATE_FORMAT)
        yesterday_str = (today - timedelta(days=1)).strftime(DATE_FORMAT)
        tide_fetch_duration = 8

        tides_cache_full, harbor_tides_cache = await self._validate_and_repair_cache(
            self.tides_store, tides_cache_full, "tides",
            _async_fetch_and_store_tides, (yesterday_str, tide_fetch_duration)
        )

        first_day_of_current_month = today.replace(day=1)
        coeff_fetch_days = 365
        coeff_cache_full, harbor_coeff_cache = await self._validate_and_repair_cache(
            self.coeff_store, coeff_cache_full, "coefficients",
            _async_fetch_and_store_coefficients,
            (first_day_of_current_month, coeff_fetch_days)
        )

        # Validate water levels, but repair fetch only targets today if triggered by validation.
        # Full prefetch is handled by scheduled jobs in __init__.py.
        _, harbor_water_level_cache_validated = await self._validate_and_repair_cache(
            self.water_level_store, water_level_cache_full, "water_levels",
            _async_fetch_and_store_water_level, (today_str,)
        )
        # Reload full water level cache as repair might have modified it.
        water_level_cache_full = await self.water_level_store.async_load() or {}
        # Use the potentially repaired harbor-specific cache for today's data.
        harbor_water_level_cache = water_level_cache_full.get(self.harbor_id, {})


        future_window_days = 366
        tides_data_for_parser = {}
        coeff_data_for_parser = {}
        water_level_data_for_parser = harbor_water_level_cache.get(today_str)

        if water_level_data_for_parser is None:
            _LOGGER.info(
                "Marées France Coordinator: Today's (%s) water level data missing "
                "from cache for %s post-validation. Attempting fetch...",
                today_str, self.harbor_id
            )
            fetched_data = await _async_fetch_and_store_water_level(
                self.hass, self.water_level_store, water_level_cache_full,
                self.harbor_id, today_str
            )
            if fetched_data:
                _LOGGER.info(
                    "Marées France Coordinator: Successfully fetched today's water "
                    "level data on demand."
                )
                water_level_data_for_parser = fetched_data
                harbor_water_level_cache[today_str] = fetched_data # Update local view
            else:
                _LOGGER.warning(
                    "Marées France Coordinator: Failed to fetch today's water level data "
                    "on demand. Current height will be unavailable.",
                )

        for i in range(-1, future_window_days + 1): # Yesterday for tides
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_tides_cache:
                tides_data_for_parser[check_date_str] = harbor_tides_cache[check_date_str]

        for i in range(future_window_days + 1): # Today for coeffs
            check_date = today + timedelta(days=i)
            check_date_str = check_date.strftime(DATE_FORMAT)
            if check_date_str in harbor_coeff_cache:
                coeff_data_for_parser[check_date_str] = harbor_coeff_cache[check_date_str]

        _LOGGER.debug(
            "Marées France Coordinator: Loaded %d days of tide data and %d days of "
            "coeff data for parser post-validation.",
            len(tides_data_for_parser), len(coeff_data_for_parser)
        )

        if not tides_data_for_parser:
            _LOGGER.error(
                "Marées France Coordinator: No tide data available for %s even after "
                "validation/repair.", self.harbor_id
            )
            raise UpdateFailed(
                f"No tide data available for {self.harbor_id} after validation/repair."
            )
        if not coeff_data_for_parser: # Allow proceeding without coeffs, but log warning
            _LOGGER.warning(
                "Marées France Coordinator: No coefficient data available for %s after "
                "validation/repair. Proceeding without it.", self.harbor_id
            )

        try:
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

            _LOGGER.debug(
                "Marées France Coordinator: Calling _parse_tide_data with "
                "water_level_data_for_parser: %s", water_level_data_for_parser
            )
            return await self._parse_tide_data(
                tides_data_for_parser,
                coeff_data_for_parser,
                water_level_data_for_parser,
                translation_high, # Though unused, kept for signature consistency
                translation_low   # Though unused, kept for signature consistency
            )
        except Exception as err:
            _LOGGER.exception(
                "Marées France Coordinator: Unexpected error processing data for %s",
                self.harbor_id
            )
            raise UpdateFailed(f"Error processing data: {err}") from err

    async def _parse_tide_data(
        self,
        tides_raw_data: dict[str, list[list[str]]],
        coeff_raw_data: dict[str, list[str]],
        water_level_raw_data: dict | None,
        _translation_high: str, # Parameter kept for signature, but not used directly
        _translation_low: str,  # Parameter kept for signature, but not used directly
    ) -> dict[str, Any]:
        """Parse raw tide, coefficient, and water level data into a structured format.

        This method takes the raw data fetched from the SHOM API (via cache)
        and transforms it into a dictionary containing:
        - Information about the current tide (if any).
        - Information about the next tide event.
        - Information about the previous tide event.
        - The date and coefficient of the next spring tide.
        - The date and coefficient of the next neap tide.
        - The current water height (if available).
        - A timestamp of the last update.

        Args:
            tides_raw_data: Raw tide data, mapping dates to lists of tide events.
                            Expected to cover yesterday through future dates.
            coeff_raw_data: Raw coefficient data, mapping dates to lists of coeffs.
                            Expected to cover today through future dates.
            water_level_raw_data: Raw water level data for today, structured as
                                  `{date_str: [[timestamp_str, height_str], ...]}`.
                                  Can be None if not available.
            _translation_high: Translation for "High Tide" (unused).
            _translation_low: Translation for "Low Tide" (unused).

        Returns:
            A dictionary containing parsed and processed tide information.
        """
        now_utc = datetime.now(timezone.utc)
        last_update_iso = now_utc.isoformat()

        if not tides_raw_data:
            _LOGGER.warning(
                "Marées France Coordinator: No tide data provided to _parse_tide_data."
            )
            return {"last_update": last_update_iso}

        all_tides_flat: list[dict[str, Any]] = []
        paris_tz = await self.hass.async_add_executor_job(pytz.timezone, "Europe/Paris")

        for day_str, tides in tides_raw_data.items():
            for tide_info in tides:
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

                coeff_value = coeff_str if coeff_str != "---" else None
                flat_entry = {
                    "type": tide_type,
                    "time_local": time_str,
                    "height": height_str,
                    "coefficient": coeff_value,
                    "datetime_utc": tide_dt_utc.isoformat(),
                    "date_local": day_str,
                    "translated_type": ( # Convert dots to underscores for frontend
                        "tide_high" if tide_type == TIDE_HIGH
                        else "tide_low" if tide_type == TIDE_LOW
                        else "Unknown"
                    ),
                }
                all_tides_flat.append(flat_entry)

        all_tides_flat.sort(key=lambda x: x["datetime_utc"])

        for tide in all_tides_flat:
            if tide["coefficient"] is None:
                day_coeffs = coeff_raw_data.get(tide["date_local"])
                if day_coeffs and isinstance(day_coeffs, list):
                    try:
                        valid_coeffs_int = [
                            int(c) for c in day_coeffs
                            if isinstance(c, str) and c.isdigit()
                        ]
                        if valid_coeffs_int:
                            tide["coefficient"] = str(max(valid_coeffs_int))
                            _LOGGER.debug(
                                "Marées France Coordinator: Assigned max daily coeff %s to "
                                "tide on %s %s",
                                tide["coefficient"], tide["date_local"], tide["time_local"]
                            )
                        else:
                            tide["coefficient"] = None
                    except (ValueError, TypeError):
                        _LOGGER.warning(
                            "Marées France Coordinator: Error processing daily coefficients "
                            "for %s %s: %s",
                            tide["date_local"], tide["time_local"], day_coeffs
                        )
                        tide["coefficient"] = None
                else:
                    tide["coefficient"] = None

        now_tide_index = -1
        for i, tide in enumerate(all_tides_flat):
            tide_dt = datetime.fromisoformat(tide["datetime_utc"])
            if tide_dt > now_utc:
                now_tide_index = i
                break

        now_data = None
        next_data = None
        previous_data = None

        if now_tide_index != -1:
            next_tide_event = all_tides_flat[now_tide_index]
            next_starting_height = (
                all_tides_flat[now_tide_index - 1]["height"]
                if now_tide_index > 0 else None
            )
            next_data = {
                ATTR_TIDE_TREND: next_tide_event["translated_type"],
                ATTR_STARTING_TIME: next_tide_event["datetime_utc"],
                ATTR_FINISHED_TIME: next_tide_event["datetime_utc"],
                ATTR_STARTING_HEIGHT: next_starting_height,
                ATTR_FINISHED_HEIGHT: next_tide_event["height"],
                ATTR_COEFFICIENT: next_tide_event["coefficient"],
            }

            if now_tide_index > 0:
                previous_tide_event = all_tides_flat[now_tide_index - 1]
                previous_starting_height = (
                    all_tides_flat[now_tide_index - 2]["height"]
                    if now_tide_index > 1 else None
                )
                previous_data = {
                    ATTR_TIDE_TREND: previous_tide_event["translated_type"],
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: previous_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_starting_height,
                    ATTR_FINISHED_HEIGHT: previous_tide_event["height"],
                    ATTR_COEFFICIENT: previous_tide_event["coefficient"],
                }

                tide_status = "rising" if previous_tide_event["type"] == TIDE_LOW else "falling"
                now_data = {
                    ATTR_TIDE_TREND: tide_status,
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: next_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_tide_event["height"],
                    ATTR_FINISHED_HEIGHT: next_tide_event["height"],
                    ATTR_COEFFICIENT: next_tide_event["coefficient"],
                }

        current_water_height = None
        _LOGGER.debug(
            "Marées France Coordinator: Checking water level data for current height "
            "calculation. Received data: %s", water_level_raw_data
        )
        water_levels = None
        today_str_key = date.today().strftime(DATE_FORMAT)

        if (isinstance(water_level_raw_data, dict) and
                isinstance(water_level_raw_data.get(today_str_key), list)):
            _LOGGER.debug(
                "Marées France Coordinator: Extracting water levels using key '%s'.",
                today_str_key
            )
            water_levels = water_level_raw_data[today_str_key]
        elif water_level_raw_data is not None: # Log if data is present but not in expected format
            _LOGGER.warning(
                "Marées France Coordinator: Received water level data, but it's not a "
                "dictionary or lacks the expected key '%s'. Data: %s",
                today_str_key, water_level_raw_data
            )

        if water_levels:
            closest_entry = None
            min_diff = timedelta.max
            for entry in water_levels:
                if isinstance(entry, list) and len(entry) == 2:
                    try:
                        time_str = entry[0]
                        if len(time_str) == 5:
                            time_str += ":00"
                        elif len(time_str) != 8:
                            raise ValueError(f"Unexpected time format: {time_str}")

                        dt_naive = datetime.strptime(
                            f"{today_str_key} {time_str}", f"{DATE_FORMAT} %H:%M:%S"
                        )
                        dt_local = paris_tz.localize(dt_naive)
                        entry_dt = dt_local.astimezone(timezone.utc)
                        diff = abs(now_utc - entry_dt)
                        if diff < min_diff:
                            min_diff = diff
                            closest_entry = entry
                    except (ValueError, TypeError, pytz.exceptions.AmbiguousTimeError,
                            pytz.exceptions.NonExistentTimeError) as e:
                        _LOGGER.warning(
                            "Marées France Coordinator: Skipping water level entry due to "
                            "parsing/timezone error for %s: %s (%s)",
                            entry, e.__class__.__name__, e
                        )
                        continue
            if closest_entry:
                if min_diff <= timedelta(minutes=15): # Check if recent enough
                    try:
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
            else: # No valid entry found in water_levels
                _LOGGER.warning(
                    "Marées France Coordinator: Could not find any valid/parseable "
                    "water level entries for today."
                )

        if now_data is not None and current_water_height is not None:
            now_data[ATTR_CURRENT_HEIGHT] = current_water_height

        next_spring_date_str = None
        next_spring_coeff = None
        next_neap_date_str = None
        next_neap_coeff = None
        found_spring = False
        found_neap = False
        today_str_compare = now_utc.strftime(DATE_FORMAT)
        sorted_coeff_dates = sorted(coeff_raw_data.keys())

        for day_str in sorted_coeff_dates:
            if day_str < today_str_compare:
                continue
            daily_coeffs = coeff_raw_data.get(day_str)
            if daily_coeffs and isinstance(daily_coeffs, list):
                try:
                    valid_coeffs_int = [
                        int(c) for c in daily_coeffs
                        if isinstance(c, str) and c.isdigit()
                    ]
                    if not valid_coeffs_int:
                        continue
                    max_coeff = max(valid_coeffs_int)

                    if not found_spring and max_coeff >= SPRING_TIDE_THRESHOLD:
                        next_spring_date_str = day_str
                        next_spring_coeff = str(max_coeff)
                        found_spring = True
                        _LOGGER.debug(
                            "Marées France Coordinator: Found next Spring Tide date: %s "
                            "(Coeff: %s)", next_spring_date_str, next_spring_coeff
                        )
                    if not found_neap and max_coeff <= NEAP_TIDE_THRESHOLD:
                        next_neap_date_str = day_str
                        next_neap_coeff = str(max_coeff)
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
            if found_spring and found_neap:
                break

        next_spring_date_obj = date.fromisoformat(next_spring_date_str) if next_spring_date_str else None
        next_neap_date_obj = date.fromisoformat(next_neap_date_str) if next_neap_date_str else None

        final_data = {
            "now_data": now_data,
            "next_data": next_data,
            "previous_data": previous_data,
            "next_spring_date": next_spring_date_obj,
            "next_spring_coeff": next_spring_coeff,
            "next_neap_date": next_neap_date_obj,
            "next_neap_coeff": next_neap_coeff,
            "last_update": last_update_iso,
        }
        return {k: v for k, v in final_data.items() if v is not None}
