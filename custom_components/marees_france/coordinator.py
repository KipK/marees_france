"""DataUpdateCoordinator for the Marées France integration."""

from __future__ import annotations

# Standard library imports
import asyncio
from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

# Third-party imports
import aiohttp
import pytz

# Home Assistant core imports
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.translation import async_get_translations
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_HARBOR_ID,
    CONF_SCAN_INTERVAL,
    DATE_FORMAT,
    DOMAIN,
    HEADERS,
    TIDESURL_TEMPLATE,
    TIDE_HIGH,
    TIDE_LOW,
    STATE_HIGH_TIDE,
    STATE_LOW_TIDE,
)

_LOGGER = logging.getLogger(__name__)


class MareesFranceUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Class to manage fetching Marées France data from SHOM API."""

    config_entry: ConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self.hass = hass
        self.config_entry = entry
        self.harbor_id = entry.data[CONF_HARBOR_ID]
        self.websession = async_get_clientsession(hass)

        update_interval_hours = entry.options.get(
            CONF_SCAN_INTERVAL, entry.data[CONF_SCAN_INTERVAL]
        )
        update_interval = timedelta(hours=update_interval_hours)

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{self.harbor_id}",
            update_interval=update_interval,
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from SHOM API."""
        today = date.today().strftime(DATE_FORMAT)
        url = TIDESURL_TEMPLATE.format(harbor_id=self.harbor_id, date=today)
        _LOGGER.debug("Fetching tide data for %s from %s", self.harbor_id, url)

        try:
            async with asyncio.timeout(
                30
            ):  # Increased timeout for potentially slow API
                response = await self.websession.get(url, headers=HEADERS)

                if response.status == 401:
                    raise ConfigEntryAuthFailed("Authentication failed with SHOM API")
                if response.status >= 400:
                    _LOGGER.error(
                        "Error fetching data from %s: %s %s",
                        url,
                        response.status,
                        await response.text(),
                    )
                    raise UpdateFailed(f"Error fetching data: {response.status}")

                data = await response.json()
                _LOGGER.debug("Received data: %s", data)

                # Fetch translations for the current language
                translations = await async_get_translations(
                    self.hass, self.hass.config.language, "entity", {DOMAIN}
                )
                # Extract specific state translations, providing fallbacks
                translation_high = translations.get(
                    f"component.{DOMAIN}.entity.sensor.tides.state.{STATE_HIGH_TIDE}",
                    STATE_HIGH_TIDE.replace("_", " ").title(),  # Fallback: "High Tide"
                )
                translation_low = translations.get(
                    f"component.{DOMAIN}.entity.sensor.tides.state.{STATE_LOW_TIDE}",
                    STATE_LOW_TIDE.replace("_", " ").title(),  # Fallback: "Low Tide"
                )

                return self._parse_tide_data(data, translation_high, translation_low)

        except asyncio.TimeoutError as err:
            _LOGGER.warning("Timeout fetching data for %s", self.harbor_id)
            raise UpdateFailed(f"Timeout communicating with API: {err}") from err
        except aiohttp.ClientError as err:
            _LOGGER.warning(
                "Client error fetching data for %s: %s", self.harbor_id, err
            )
            raise UpdateFailed(f"Error communicating with API: {err}") from err
        except Exception as err:
            _LOGGER.exception("Unexpected error fetching data for %s", self.harbor_id)
            raise UpdateFailed(f"Unexpected error: {err}") from err

    def _parse_tide_data(
        self,
        raw_data: dict[str, list[list[str]]],
        translation_high: str,
        translation_low: str,
    ) -> dict[str, Any]:
        """Parse the raw tide data from the API into the desired format."""
        parsed_data: dict[str, dict[str, list[dict[str, str]]]] = {}
        all_tides_flat: list[
            dict[str, Any]
        ] = []  # For easier next/previous calculation

        now_utc = datetime.now(timezone.utc)
        paris_tz = pytz.timezone("Europe/Paris") # Define Paris timezone
        
        for day_str, tides in raw_data.items():
            if day_str not in parsed_data:
                parsed_data[day_str] = {"high_tides": [], "low_tides": []}

            for tide_info in tides:
                tide_type, time_str, height_str, coeff_str = tide_info

                # Skip invalid entries
                if time_str == "--:--" or height_str == "---":
                    continue

                try:
                    # Combine day and time, assuming API provides local time for the harbor
                    # We need timezone info for comparison, but SHOM doesn't provide it directly.
                    # Assuming local time for now, might need refinement if harbors cross timezones significantly.
                    # For simplicity, we'll parse without timezone first.
                    tide_dt_naive = datetime.strptime(
                        f"{day_str} {time_str}", f"{DATE_FORMAT} %H:%M"
                    )
                    # Localize the naive datetime to the harbor's timezone (Europe/Paris)
                    tide_dt_local = paris_tz.localize(tide_dt_naive)
                    # Convert to UTC for consistent comparison and storage
                    tide_dt_utc = tide_dt_local.astimezone(timezone.utc)

                except ValueError:
                    _LOGGER.warning(
                        "Could not parse datetime: %s %s", day_str, time_str
                    )
                    continue

                tide_entry: dict[str, str] = {
                    "time": time_str,
                    "height": height_str,
                    "datetime_utc": tide_dt_utc.isoformat(),  # Store UTC datetime for sorting
                }
                if coeff_str != "---":
                    tide_entry["coefficient"] = coeff_str

                flat_entry = tide_entry.copy()
                flat_entry["type"] = tide_type  # Store original type key

                # Add translated type
                if tide_type == TIDE_HIGH:
                    flat_entry["translated_type"] = translation_high
                elif tide_type == TIDE_LOW:
                    flat_entry["translated_type"] = translation_low
                else:
                    flat_entry["translated_type"] = "Unknown"  # Fallback

                if tide_type == TIDE_HIGH:
                    parsed_data[day_str]["high_tides"].append(tide_entry)
                    all_tides_flat.append(flat_entry)
                elif tide_type == TIDE_LOW:
                    parsed_data[day_str]["low_tides"].append(tide_entry)
                    all_tides_flat.append(flat_entry)

        # Sort flat list by datetime
        all_tides_flat.sort(key=lambda x: x["datetime_utc"])

        # Find current, next, and previous tides
        current_tide = None
        next_tide = None
        previous_tide = None

        for i, tide in enumerate(all_tides_flat):
            tide_dt = datetime.fromisoformat(tide["datetime_utc"])
            if tide_dt > now_utc:
                next_tide = tide
                if i > 0:
                    previous_tide = all_tides_flat[i - 1]
                # The 'current' tide is the one just before the next future tide
                current_tide = previous_tide
                break
        else:
            # If loop finishes, all tides are in the past, current is the last one
            if all_tides_flat:
                current_tide = all_tides_flat[-1]
                if len(all_tides_flat) > 1:
                    previous_tide = all_tides_flat[-2]

        # Determine tide status based on the type of the most recent past tide
        tide_status = None
        if current_tide: # current_tide holds the most recent past tide event
            current_tide_type = current_tide.get("type")
            if current_tide_type == TIDE_LOW:
                tide_status = "rising" # If last tide was low, it's now rising
            elif current_tide_type == TIDE_HIGH:
                tide_status = "falling" # If last tide was high, it's now falling
            else:
                _LOGGER.warning("Unknown type for current_tide: %s", current_tide_type)
        else:
            # If there's no past tide (e.g., first data point), try to infer from next tide
            if next_tide:
                next_tide_type = next_tide.get("type")
                if next_tide_type == TIDE_HIGH:
                     tide_status = "rising" # Approaching high tide
                elif next_tide_type == TIDE_LOW:
                     tide_status = "falling" # Approaching low tide
            else:
                _LOGGER.debug("Cannot determine tide status: No current or next tide data.")
        
        
        return {
            "data": parsed_data,
            "current_tide": current_tide, # Note: current_tide is the last past tide
            "next_tide": next_tide,
            "previous_tide": previous_tide,
            "tide_status": tide_status, # Added status
            "last_update": now_utc.isoformat(),
        }
