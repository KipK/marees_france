"""DataUpdateCoordinator for the Marées France integration."""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store
from homeassistant.helpers.translation import async_get_translations
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api_helpers import (
    _async_fetch_and_store_coefficients,
    _async_fetch_and_store_tides,
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_water_temp,
    _async_store_harbor_min_depth,
)
from .availability import ServiceUnavailable, async_get_availability
from .const import (
    ATTR_COEFFICIENT,
    ATTR_CURRENT_HEIGHT,
    ATTR_FINISHED_HEIGHT,
    ATTR_FINISHED_TIME,
    ATTR_STARTING_HEIGHT,
    ATTR_STARTING_TIME,
    ATTR_TIDE_TREND,
    ATTR_WATER_TEMP,
    CONF_HARBOR_ID,
    CONF_HARBOR_LAT,
    CONF_HARBOR_LON,
    CONF_HARBOR_NAME,
    CONF_HARBOR_TIMEZONE,
    DATE_FORMAT,
    DOMAIN,
    NEAP_TIDE_THRESHOLD,
    SPRING_TIDE_THRESHOLD,
    STATE_HIGH_TIDE,
    STATE_LOW_TIDE,
    TIDE_HIGH,
    TIDE_LOW,
    PointData,
)
from .harbor_timezone import get_harbor_tzinfo

_LOGGER = logging.getLogger(__name__)

SOURCES = (
    "harbor metadata",
    "tides",
    "coefficients",
    "water levels",
    "water temperature",
)
FETCH_INTERVAL = 300
RETRY_INTERVAL = 30


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
        watertemp_store: Store[dict[str, dict[str, Any]]],
        harborMinDepth_store: Store[dict[str, dict[str, Any]]],
        websession: aiohttp.ClientSession | None = None,
    ) -> None:
        """Initialize the data update coordinator.
        Args:
            hass: The Home Assistant instance.
            entry: The config entry for this coordinator instance.
            tides_store: The store for caching tide data.
            coeff_store: The store for caching coefficient data.
            water_level_store: The store for caching water level data.
            watertemp_store: The store for caching water temperature data.
            harborMinDepth_store: The store for caching harbor minimum depth data.
            websession: Optional aiohttp ClientSession. If not provided, one will be created.
        """
        self.hass = hass
        self.config_entry = entry
        self.harbor_id: str = entry.data[CONF_HARBOR_ID]
        self.tides_store = tides_store
        self.coeff_store = coeff_store
        self.water_level_store = water_level_store
        self.watertemp_store = watertemp_store
        self.harborMinDepth_store = harborMinDepth_store
        self.pointsData: list[PointData] = []
        self.websession = websession or async_get_clientsession(hass)

        self._fetching = False
        self._fetch_tasks: dict[str, asyncio.Task] = {}
        self._fetch_timers: dict[str, Any] = {}
        self._retry_delays: dict[str, float] = {}
        self._availability = async_get_availability(hass)
        self.options = dict(entry.options)

        update_interval = timedelta(minutes=5)  # Frequent updates for water levels

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.harbor_id}",
            update_interval=update_interval,
            config_entry=entry,
        )

    @callback
    def async_start_fetching(self) -> None:
        """Start entry-owned tasks that Home Assistant never waits for at startup."""
        self._fetching = True
        for source in SOURCES:
            self._async_launch_source(source)

    @callback
    def _async_launch_source(self, source: str) -> None:
        if not self._fetching or self.hass.is_stopping:
            return
        task = self._fetch_tasks.get(source)
        if task is not None and not task.done():
            return
        if cancel := self._fetch_timers.pop(source, None):
            cancel()
        self._fetch_tasks[source] = self.config_entry.async_create_background_task(
            self.hass,
            self._async_refresh_source(source),
            f"{DOMAIN} {self.harbor_id} {source}",
        )

    async def async_stop_fetching(self) -> None:
        """Cancel requests and pending retries before unload or reinitialization."""
        self._fetching = False
        for cancel in self._fetch_timers.values():
            cancel()
        self._fetch_timers.clear()
        tasks = list(self._fetch_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._fetch_tasks.clear()

    async def async_shutdown(self) -> None:
        await self.async_stop_fetching()
        self._availability.async_remove_entry(self.config_entry.entry_id)
        await super().async_shutdown()

    async def _async_refresh_source(self, source: str) -> None:
        """Fetch one source, publish promptly, and schedule its next attempt."""
        provider = "Meteoconsult" if source == "water temperature" else "SHOM"
        delay = FETCH_INTERVAL
        try:
            result = await self._async_fetch_source(source)
            if result is False:
                # Local storage failures are logged by the helpers, not reported
                # as upstream outages.
                delay = self._retry_delays.get(source, RETRY_INTERVAL)
            else:
                self._retry_delays.pop(source, None)
                if result is True:
                    self._availability.async_update(
                        self.config_entry.entry_id,
                        self.harbor_id,
                        source,
                        provider,
                        True,
                    )
        except ServiceUnavailable as err:
            _LOGGER.warning("%s: %s", self.harbor_id, err)
            self._availability.async_update(
                self.config_entry.entry_id, self.harbor_id, source, provider, False
            )
            delay = self._retry_delays.get(source, RETRY_INTERVAL)
        except Exception:
            _LOGGER.exception("Error updating %s for %s", source, self.harbor_id)
            delay = self._retry_delays.get(source, RETRY_INTERVAL)
        finally:
            # Also publish partial results (e.g. today's levels before a future
            # day's request fails). Cancellation must propagate without retries.
            if self._fetching and not asyncio.current_task().cancelling():
                await self.async_refresh()
                if delay != FETCH_INTERVAL or source in self._retry_delays:
                    self._retry_delays[source] = min(delay * 2, FETCH_INTERVAL)
                    delay *= random.uniform(0.8, 1.0)

                @callback
                def _retry(_):
                    self._async_launch_source(source)

                self._fetch_timers[source] = async_call_later(self.hass, delay, _retry)

    async def _async_fetch_source(self, source: str) -> bool | None:
        """Fill gaps in one cache without waiting for another provider."""
        today = date.today()
        if source == "harbor metadata":
            data = self.config_entry.data
            if (
                data.get(CONF_HARBOR_LAT) is not None
                and data.get(CONF_HARBOR_LON) is not None
                and CONF_HARBOR_TIMEZONE in data
                and data.get(CONF_HARBOR_NAME) is not None
            ):
                return True
            from . import CannotConnect, fetch_harbors

            try:
                details = (await fetch_harbors(self.websession)).get(self.harbor_id)
            except CannotConnect as err:
                raise ServiceUnavailable(str(err)) from err
            if not details or details.get("lat") is None or details.get("lon") is None:
                raise ServiceUnavailable(f"Missing SHOM metadata for {self.harbor_id}")
            self.hass.config_entries.async_update_entry(
                self.config_entry,
                data={
                    **data,
                    CONF_HARBOR_NAME: details.get("name", self.harbor_id),
                    CONF_HARBOR_LAT: details["lat"],
                    CONF_HARBOR_LON: details["lon"],
                    CONF_HARBOR_TIMEZONE: details.get("timezone"),
                },
            )
            self._async_launch_source("water temperature")
            return True

        if source == "water temperature":
            lat = self.config_entry.data.get(CONF_HARBOR_LAT)
            lon = self.config_entry.data.get(CONF_HARBOR_LON)
            if lat is None or lon is None:
                return None
            store = self.watertemp_store
            start, days = today, 7
        elif source == "tides":
            store = self.tides_store
            start, days = today - timedelta(days=1), 8
        elif source == "coefficients":
            store = self.coeff_store
            start, days = today.replace(day=1), 365
        else:
            store = self.water_level_store
            start, days = today, 8

        cache = await store.async_load() or {}
        cache = dict(cache) if isinstance(cache, dict) else {}
        harbor_cache = self._valid_harbor_cache(cache, source)
        missing = [
            (start + timedelta(days=i)).strftime(DATE_FORMAT)
            for i in range(days)
            if (start + timedelta(days=i)).strftime(DATE_FORMAT) not in harbor_cache
        ]
        if not missing:
            return True
        # Repair in memory. Never delete usable cached dates before a fetch.
        cache[self.harbor_id] = harbor_cache
        if source == "tides":
            return await _async_fetch_and_store_tides(
                self.hass,
                store,
                cache,
                self.harbor_id,
                start.strftime(DATE_FORMAT),
                days,
                websession=self.websession,
            )
        if source == "coefficients":
            return await _async_fetch_and_store_coefficients(
                self.hass,
                store,
                cache,
                self.harbor_id,
                start,
                days,
                websession=self.websession,
            )
        if source == "water temperature":
            return await _async_fetch_and_store_water_temp(
                self.hass,
                store,
                cache,
                self.harbor_id,
                lat,
                lon,
                websession=self.websession,
            )
        for date_str in missing:
            if not await _async_fetch_and_store_water_level(
                self.hass,
                store,
                cache,
                self.harbor_id,
                date_str,
                websession=self.websession,
            ):
                return False
            await self.async_refresh()
        return True

    def _valid_harbor_cache(self, cache: Any, source: str) -> dict[str, Any]:
        """Ignore invalid or expired dates without destroying other cached data."""
        if not isinstance(cache, dict):
            return {}
        harbor_cache = cache.get(self.harbor_id)
        if not isinstance(harbor_cache, dict):
            return {}
        result = {}
        earliest = date.today() - timedelta(days=1 if source == "tides" else 0)
        if source == "coefficients":
            earliest = date.today().replace(day=1)
        for key, value in harbor_cache.items():
            try:
                if date.fromisoformat(key) < earliest:
                    continue
            except (TypeError, ValueError):
                continue
            if source == "water levels":
                valid = isinstance(value, dict) and isinstance(value.get(key), list)
            elif source == "water temperature":
                valid = (
                    isinstance(value, list)
                    and bool(value)
                    and all(
                        isinstance(item, dict) and "datetime" in item and "temp" in item
                        for item in value
                    )
                )
            else:
                valid = isinstance(value, list)
            if valid:
                result[key] = value
        return result

    async def _async_update_from_number(self, unique_id: str, value: float) -> None:
        """
        Docstring for _async_update_from_number

        :param self: Description
        :param number: The number entity that triggered the update
        :param value: The new value for the number
        """

        if value >= 0 and not await _async_store_harbor_min_depth(
            self.hass, self.harborMinDepth_store, self.harbor_id, value
        ):
            _LOGGER.error(
                "Marées France Coordinator: Failed to store new min depth to boat "
                "value for %s after update from number.",
                self.harbor_id,
            )

    async def _async_update_data(self) -> dict[str, Any]:
        """Process cached data only; network I/O belongs to background workers."""
        try:
            harbor_tides_cache = self._valid_harbor_cache(
                await self.tides_store.async_load(), "tides"
            )
            harbor_coeff_cache = self._valid_harbor_cache(
                await self.coeff_store.async_load(), "coefficients"
            )
            harbor_water_level_cache = self._valid_harbor_cache(
                await self.water_level_store.async_load(), "water levels"
            )
            harbor_watertemp_cache = self._valid_harbor_cache(
                await self.watertemp_store.async_load(), "water temperature"
            )
        except Exception as err:
            raise UpdateFailed(f"Failed to load cache: {err}") from err

        today_str = date.today().strftime(DATE_FORMAT)
        tides_data_for_parser = harbor_tides_cache
        coeff_data_for_parser = harbor_coeff_cache
        water_level_data_for_parser = harbor_water_level_cache.get(today_str)

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

            self.pointsData = await self._process_pointsData(
                (water_level_data_for_parser or {}).get(today_str) or []
            )

            _LOGGER.debug(
                "Marées France Coordinator: Calling _parse_tide_data with "
                "water_level_data_for_parser: %s",
                water_level_data_for_parser,
            )
            return await self._parse_tide_data(
                tides_data_for_parser,
                coeff_data_for_parser,
                water_level_data_for_parser,
                harbor_watertemp_cache,
                translation_high,  # Though unused, kept for signature consistency
                translation_low,  # Though unused, kept for signature consistency
            )
        except Exception as err:
            _LOGGER.exception(
                "Marées France Coordinator: Unexpected error processing data for %s",
                self.harbor_id,
            )
            raise UpdateFailed(f"Error processing data: {err}") from err

    async def _process_pointsData(
        self, levels_data: list[tuple[str, str]]
    ) -> list[PointData]:
        """
        Transform raw data to objet PointData(totalMinute;height)
        """
        if (
            hasattr(self, "_last_levels_input")
            and levels_data == self._last_levels_input
        ):
            return self.points_data

        results = []
        minHeight = float("inf")
        maxHeight = float("-inf")
        for item in levels_data:
            try:
                # Extraction et validation de base
                time_str = item[0]
                height_val = float(item[1])

                if not time_str or ":" not in time_str:
                    continue

                # Conversion du temps (HH:MM)
                hours_str, minutes_str, _seconds = time_str.split(":")
                hours, minutes = int(hours_str), int(minutes_str)
                total_min = hours * 60 + minutes

                # Mise à jour des extrêmes (min/max)
                minHeight = min(minHeight, height_val)
                maxHeight = max(maxHeight, height_val)

                # Création de l'instance Dataclass
                point = PointData(total_minutes=total_min, height_num=height_val)
                results.append(point)

            except (ValueError, IndexError, TypeError):
                continue

        self.points_data = results

        # Copy for cache comparison - avoid compute at each refresh
        self._last_levels_input = list(levels_data)

        return self.points_data

    async def _interpolateHeight(self, targetTotalMinutes: int) -> float | None:
        if not self.pointsData or len(self.pointsData) < 2:
            return None
        prevPoint: PointData | None = None
        nextPoint: PointData | None = None

        for i, pointData in enumerate(self.pointsData):
            if pointData.total_minutes <= targetTotalMinutes:
                prevPoint = pointData
            if pointData.total_minutes > targetTotalMinutes:
                nextPoint = pointData
                break

        if not prevPoint and nextPoint:
            return nextPoint.height_num
        if prevPoint and not nextPoint:
            return prevPoint.height_num
        if not prevPoint or not nextPoint:
            return None

        timeDiff = nextPoint.total_minutes - prevPoint.total_minutes
        if timeDiff <= 0:
            return prevPoint.height_num
        timeProgress = (targetTotalMinutes - prevPoint.total_minutes) / timeDiff
        return (
            prevPoint.height_num
            + (nextPoint.height_num - prevPoint.height_num) * timeProgress
        )

    async def _parse_tide_data(
        self,
        tides_raw_data: dict[str, list[list[str]]],
        coeff_raw_data: dict[str, list[str]],
        water_level_raw_data: dict[str, list[list[str]]] | None,
        water_temp_raw_data: dict[str, list[dict[str, Any]]] | None,
        _translation_high: str,  # Parameter kept for signature, but not used directly
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
            water_temp_raw_data: Raw water temperature data. Can be None.
            _translation_high: Translation for "High Tide" (unused).
            _translation_low: Translation for "Low Tide" (unused).
        Returns:
            A dictionary containing parsed and processed tide information.
        """
        now_utc = datetime.now(timezone.utc)
        last_update_iso = now_utc.isoformat()

        all_tides_flat: list[dict[str, Any]] = []
        harbor_tz = await self.hass.async_add_executor_job(
            get_harbor_tzinfo, self.config_entry.data.get(CONF_HARBOR_TIMEZONE)
        )

        for day_str, tides in tides_raw_data.items():
            for tide_info in tides:
                if not isinstance(tide_info, (list, tuple)) or len(tide_info) != 4:
                    _LOGGER.warning(
                        "Marées France Coordinator: Skipping invalid tide_info format "
                        "for %s: %s",
                        day_str,
                        tide_info,
                    )
                    continue
                tide_type, time_str, height_str, coeff_str = tide_info
                if time_str == "--:--" or height_str == "---":
                    continue
                try:
                    tide_dt_naive = datetime.strptime(
                        f"{day_str} {time_str}", f"{DATE_FORMAT} %H:%M"
                    )
                    tide_dt_local = harbor_tz.localize(tide_dt_naive)
                    tide_dt_utc = tide_dt_local.astimezone(timezone.utc)
                except ValueError:
                    _LOGGER.warning(
                        "Marées France Coordinator: Could not parse datetime: %s %s",
                        day_str,
                        time_str,
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
                    "translated_type": (  # Convert dots to underscores for frontend
                        "tide_high"
                        if tide_type == TIDE_HIGH
                        else "tide_low"
                        if tide_type == TIDE_LOW
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
                            int(c)
                            for c in day_coeffs
                            if isinstance(c, str) and c.isdigit()
                        ]
                        if valid_coeffs_int:
                            tide["coefficient"] = str(max(valid_coeffs_int))
                            _LOGGER.debug(
                                "Marées France Coordinator: Assigned max daily coeff %s to "
                                "tide on %s %s",
                                tide["coefficient"],
                                tide["date_local"],
                                tide["time_local"],
                            )
                        else:
                            tide["coefficient"] = None
                    except (ValueError, TypeError):
                        _LOGGER.warning(
                            "Marées France Coordinator: Error processing daily coefficients "
                            "for %s %s: %s",
                            tide["date_local"],
                            tide["time_local"],
                            day_coeffs,
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
                if now_tide_index > 0
                else None
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
                    if now_tide_index > 1
                    else None
                )
                previous_data = {
                    ATTR_TIDE_TREND: previous_tide_event["translated_type"],
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: previous_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_starting_height,
                    ATTR_FINISHED_HEIGHT: previous_tide_event["height"],
                    ATTR_COEFFICIENT: previous_tide_event["coefficient"],
                }

                tide_status = (
                    "rising" if previous_tide_event["type"] == TIDE_LOW else "falling"
                )
                now_data = {
                    ATTR_TIDE_TREND: tide_status,
                    ATTR_STARTING_TIME: previous_tide_event["datetime_utc"],
                    ATTR_FINISHED_TIME: next_tide_event["datetime_utc"],
                    ATTR_STARTING_HEIGHT: previous_tide_event["height"],
                    ATTR_FINISHED_HEIGHT: next_tide_event["height"],
                    ATTR_COEFFICIENT: next_tide_event["coefficient"],
                }

        # Keep water height calculation, but simplify water temp handling.
        today_str_key = date.today().strftime(DATE_FORMAT)

        if now_data:
            now_local = dt_util.now()
            currentMinutes = now_local.hour * 60 + now_local.minute

            now_data[ATTR_CURRENT_HEIGHT] = await self._interpolateHeight(
                currentMinutes
            )

            # Remove the old direct water_temp assignment
            if ATTR_WATER_TEMP in now_data:
                del now_data[ATTR_WATER_TEMP]

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
                        int(c)
                        for c in daily_coeffs
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
                            "(Coeff: %s)",
                            next_spring_date_str,
                            next_spring_coeff,
                        )
                    if not found_neap and max_coeff <= NEAP_TIDE_THRESHOLD:
                        next_neap_date_str = day_str
                        next_neap_coeff = str(max_coeff)
                        found_neap = True
                        _LOGGER.debug(
                            "Marées France Coordinator: Found next Neap Tide date: %s "
                            "(Coeff: %s)",
                            next_neap_date_str,
                            next_neap_coeff,
                        )
                except (ValueError, TypeError):
                    _LOGGER.warning(
                        "Marées France Coordinator: Error processing coefficients for %s: %s",
                        day_str,
                        daily_coeffs,
                    )
            if found_spring and found_neap:
                break

        next_spring_date_obj = (
            date.fromisoformat(next_spring_date_str) if next_spring_date_str else None
        )
        next_neap_date_obj = (
            date.fromisoformat(next_neap_date_str) if next_neap_date_str else None
        )

        final_data = {
            "now_data": now_data,
            "next_data": next_data,
            "previous_data": previous_data,
            "next_spring_date": next_spring_date_obj,
            "next_spring_coeff": next_spring_coeff,
            "next_neap_date": next_neap_date_obj,
            "next_neap_coeff": next_neap_coeff,
            "last_update": last_update_iso,
            # Pass the raw water temp data directly to the sensors
            "water_temp_data": water_temp_raw_data.get(today_str_key)
            if water_temp_raw_data
            else None,
        }
        return {k: v for k, v in final_data.items() if v is not None}
