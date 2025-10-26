"""Sensor platform for Marées France integration."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, cast

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import (
    ATTR_COEFFICIENT,
    ATTR_CURRENT_HEIGHT,
    ATTR_FINISHED_HEIGHT,
    ATTR_FINISHED_TIME,
    ATTR_STARTING_HEIGHT,
    ATTR_STARTING_TIME,
    ATTR_TIDE_TREND,
    ATTRIBUTION,
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    DOMAIN,
    MANUFACTURER,
)
from .coordinator import MareesFranceUpdateCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Marées France sensor entities from a config entry.

    Args:
        hass: The Home Assistant instance.
        entry: The config entry.
        async_add_entities: Callback to add entities.
    """
    coordinator: MareesFranceUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    harbor_id = entry.data[CONF_HARBOR_ID]

    sensors_to_add = [
        MareesFranceNowSensor(coordinator, entry),
        MareesFranceNextSensor(coordinator, entry),
        MareesFrancePreviousSensor(coordinator, entry),
        MareesFranceNextSpringTideSensor(coordinator, entry),
        MareesFranceNextNeapTideSensor(coordinator, entry),
        MareesFranceWaterTempSensor(coordinator, entry),
    ]

    async_add_entities(sensors_to_add, update_before_add=True)
    _LOGGER.debug("Added 6 Marées France sensors for harbor: %s", harbor_id)


class MareesFranceBaseSensor(
    CoordinatorEntity[MareesFranceUpdateCoordinator], SensorEntity
):
    """Base class for Marées France sensors.

    Provides common attributes and functionality for all sensors derived from it,
    such as device information, unique ID generation, and availability logic.
    """

    _attr_attribution = ATTRIBUTION
    _attr_has_entity_name = True  # Uses the name defined by `translation_key`.

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_key_suffix: str,
    ) -> None:
        """Initialize the base sensor.

        Args:
            coordinator: The data update coordinator.
            config_entry: The config entry.
            sensor_key_suffix: A suffix to make the sensor's unique ID and data key distinct
                               (e.g., "now", "next_tide", "next_spring_tide").
        """
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._harbor_id: str = config_entry.data[CONF_HARBOR_ID]
        self._harbor_name: str = config_entry.data.get(
            CONF_HARBOR_NAME, self._harbor_id
        )
        self._sensor_key_suffix = (
            sensor_key_suffix  # Used for unique ID and data access
        )

        self._attr_unique_id = (
            f"{DOMAIN}_{self._harbor_id.lower()}_{self._sensor_key_suffix}"
        )

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=self._harbor_name,
            manufacturer=MANUFACTURER,
            entry_type="service",  # Using "service" as it's data from an external service
            configuration_url=None,  # No specific URL for device configuration
        )
        _LOGGER.debug("Initialized base sensor with unique_id: %s", self.unique_id)

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and the specific sensor data exists.

        This checks the general coordinator availability and then verifies that the
        specific data block for this sensor (e.g., "now_data", "next_data")
        is present in the coordinator's data.
        """
        return (
            super().available  # Checks coordinator.last_update_success and coordinator.data
            and self.coordinator.data is not None
            # Check for the specific data key related to this sensor type
            # For "now", "next", "previous" sensors, data is under "now_data", "next_data", etc.
            # For "next_spring_date", "next_neap_date", data is directly under those keys.
            and (
                f"{self._sensor_key_suffix}_data" in self.coordinator.data
                if self._sensor_key_suffix in ["now", "next", "previous"]
                else self._sensor_key_suffix
                in self.coordinator.data  # For date sensors
            )
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator.

        This method is called by the CoordinatorEntity base class when new data
        is available. It logs the update and then calls the parent's update handler.
        """
        if self.available:
            _LOGGER.debug("Updating sensor state for %s", self.unique_id)
        else:
            _LOGGER.debug(
                "Sensor %s is unavailable. Coordinator data: %s. Coordinator last_update_success: %s",
                self.unique_id,
                self.coordinator.data,
                self.coordinator.last_update_success,
            )
        super()._handle_coordinator_update()


class MareesFranceNowSensor(MareesFranceBaseSensor):
    """Sensor representing the current tide status (e.g., rising, falling).

    The state of this sensor indicates the current trend of the tide.
    Attributes include current water height, coefficient, and start/end times
    and heights of the current tidal period.
    """

    _attr_translation_key = "now_tide"

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the 'current tide' sensor."""
        super().__init__(
            coordinator, config_entry, "now"
        )  # "now" is the sensor_key_suffix

    @property
    def _sensor_data(self) -> dict[str, Any] | None:
        """Helper to get the 'now_data' block from the coordinator."""
        if not self.coordinator.data:
            return None
        return cast(dict[str, Any] | None, self.coordinator.data.get("now_data"))

    @property
    def native_value(self) -> str | None:
        """Return the state of the sensor (current tide trend: 'rising' or 'falling')."""
        if self.available and self._sensor_data:
            return self._sensor_data.get(ATTR_TIDE_TREND)
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return attributes like current height, coefficient, start/end times and heights."""
        if self.available and self._sensor_data:
            attrs: dict[str, Any] = {}
            for key in [
                ATTR_TIDE_TREND,
                ATTR_CURRENT_HEIGHT,
                ATTR_COEFFICIENT,
                ATTR_STARTING_HEIGHT,
                ATTR_FINISHED_HEIGHT,
                ATTR_STARTING_TIME,
                ATTR_FINISHED_TIME,
            ]:
                if (value := self._sensor_data.get(key)) is not None:
                    attrs[key] = value
            return attrs if attrs else None
        return None

    @property
    def icon(self) -> str:
        """Return an icon based on the tide trend."""
        if self.available and self._sensor_data:
            trend = self._sensor_data.get(ATTR_TIDE_TREND)
            if trend == "rising":
                return "mdi:transfer-up"
            if trend == "falling":
                return "mdi:transfer-down"
        return "mdi:waves"  # Default icon


class MareesFranceTimestampSensor(MareesFranceBaseSensor):
    """Base sensor for tide events represented as a timestamp.

    Used for "Next Tide" and "Previous Tide" sensors. The state is the
    timestamp of the tide event. Attributes include the type of tide (high/low),
    height, and coefficient.
    """

    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_key_suffix: str,  # e.g., "next", "previous"
        translation_key: str,  # For entity name
    ) -> None:
        """Initialize the timestamp-based tide sensor."""
        super().__init__(coordinator, config_entry, sensor_key_suffix)
        self._attr_translation_key = translation_key

    @property
    def _sensor_data(self) -> dict[str, Any] | None:
        """Helper to get the specific data block (e.g., 'next_data') from coordinator."""
        if self.coordinator.data:
            return cast(
                dict[str, Any] | None,
                self.coordinator.data.get(f"{self._sensor_key_suffix}_data"),
            )
        return None

    @property
    def native_value(self) -> datetime | None:
        """Return the timestamp of the tide event (UTC datetime object)."""
        if self.available and self._sensor_data:
            # The state is the time of the event itself (ATTR_FINISHED_TIME from coordinator)
            event_time_str = self._sensor_data.get(ATTR_FINISHED_TIME)
            if event_time_str:
                try:
                    return dt_util.parse_datetime(event_time_str)
                except ValueError:
                    _LOGGER.warning(
                        "Could not parse event time for '%s' sensor: %s",
                        self._sensor_key_suffix,
                        event_time_str,
                    )
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return attributes like tide type, height, coefficient."""
        if self.available and self._sensor_data:
            return cast(
                dict[str, Any], self._sensor_data
            )  # The whole block is relevant
        return None


class MareesFranceNextSensor(MareesFranceTimestampSensor):
    """Sensor representing the next tide event."""

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the 'next tide' sensor."""
        super().__init__(coordinator, config_entry, "next", "next_tide")


class MareesFrancePreviousSensor(MareesFranceTimestampSensor):
    """Sensor representing the previous tide event."""

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the 'previous tide' sensor."""
        super().__init__(coordinator, config_entry, "previous", "previous_tide")


class MareesFranceNextSpecialTideSensor(MareesFranceBaseSensor):
    """Base sensor for next spring/neap tide dates.

    The state is the date of the next special tide (spring or neap).
    The coefficient is an attribute.
    """

    _attr_icon = "mdi:calendar-arrow-right"  # Generic icon for future date

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_key_suffix: str,  # "next_spring_date" or "next_neap_date"
        translation_key: str,
    ) -> None:
        """Initialize the special tide date sensor."""
        # The sensor_key_suffix here directly matches the key in coordinator.data
        super().__init__(coordinator, config_entry, sensor_key_suffix)
        self._attr_translation_key = translation_key

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and the specific date exists."""
        # Overrides base availability to check for the direct key (e.g., "next_spring_date")
        return (
            super(CoordinatorEntity, self).available  # Check coordinator health
            and self.coordinator.data is not None
            and self.coordinator.data.get(self._sensor_key_suffix) is not None
        )

    @property
    def native_value(self) -> str | None:
        """Return the date string of the next special tide."""
        if self.available:
            # The value is the date object, which HA will format as a string.
            date_obj = self.coordinator.data.get(self._sensor_key_suffix)
            if date_obj:
                # Handle both datetime objects and strings
                if hasattr(date_obj, "isoformat"):
                    return date_obj.isoformat()
                else:
                    # If it's already a string, just return it
                    return date_obj
            return None
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the coefficient as an attribute."""
        if self.available and self.coordinator.data:
            # Determine attribute key based on sensor type
            coeff_key = (
                "next_spring_coeff"
                if "spring" in self._sensor_key_suffix
                else "next_neap_coeff"
            )
            coeff = self.coordinator.data.get(coeff_key)
            if coeff is not None:
                return {ATTR_COEFFICIENT: coeff}
        return None


class MareesFranceNextSpringTideSensor(MareesFranceNextSpecialTideSensor):
    """Sensor for the date and coefficient of the next spring tide."""

    _attr_translation_key = "next_spring_tide"
    # Consider a more specific icon if desired, e.g., mdi:waves-arrow-up

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the next spring tide sensor."""
        super().__init__(
            coordinator, config_entry, "next_spring_date", "next_spring_tide"
        )


class MareesFranceNextNeapTideSensor(MareesFranceNextSpecialTideSensor):
    """Sensor for the date and coefficient of the next neap tide."""

    _attr_translation_key = "next_neap_tide"
    # Consider a more specific icon if desired, e.g., mdi:waves-arrow-down

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the next neap tide sensor."""
        super().__init__(coordinator, config_entry, "next_neap_date", "next_neap_tide")


class MareesFranceWaterTempSensor(MareesFranceBaseSensor):
    """Sensor representing the current water temperature.

    The state of this sensor indicates the current water temperature in degrees Celsius.
    """

    _attr_translation_key = "water_temp"
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = "°C"
    _attr_icon = "mdi:thermometer-water"
    _attr_suggested_display_precision = 1

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the water temperature sensor."""
        super().__init__(coordinator, config_entry, "water_temp")

    @property
    def _sensor_data(self) -> dict[str, Any] | None:
        """Helper to get the 'now_data' block from the coordinator."""
        if not self.coordinator.data:
            return None
        return cast(dict[str, Any] | None, self.coordinator.data.get("now_data"))

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and water temp data is available."""
        return (
            self.coordinator.data is not None
            and self.coordinator.data.get("water_temp_data") is not None
        )

    @property
    def native_value(self) -> float | None:
        """Return the current water temperature from the hourly forecast."""
        if not self.available or not self.coordinator.data:
            return None

        water_temp_data = self.coordinator.data.get("water_temp_data", [])
        if not water_temp_data:
            return None

        now_utc = dt_util.utcnow()
        latest_temp = None

        # Find the most recent temperature forecast that is not in the future
        for forecast in water_temp_data:
            forecast_time_str = forecast.get("datetime")
            temp_value = forecast.get("temp")

            if not forecast_time_str or temp_value is None:
                continue

            try:
                forecast_time = dt_util.parse_datetime(forecast_time_str)
                if forecast_time <= now_utc:
                    latest_temp = float(temp_value)
                else:
                    # Stop when we reach future forecasts
                    break
            except (ValueError, TypeError):
                _LOGGER.warning(
                    "Could not parse water temperature data: time=%s, temp=%s",
                    forecast_time_str,
                    temp_value,
                )
                continue

        return latest_temp

    async def async_added_to_hass(self) -> None:
        """Request a refresh when added to hass."""
        await super().async_added_to_hass()
        if self.native_value is None:
            await self.coordinator.async_request_refresh()

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return additional attributes like current height and tide trend."""
        if self.available and self.coordinator.data:
            now_data = self.coordinator.data.get("now_data", {})
            attrs = {}

            # Include current water height if available
            if (
                ATTR_CURRENT_HEIGHT in now_data
                and now_data[ATTR_CURRENT_HEIGHT] is not None
            ):
                attrs[ATTR_CURRENT_HEIGHT] = now_data[ATTR_CURRENT_HEIGHT]

            # Include tide trend if available
            if ATTR_TIDE_TREND in now_data and now_data[ATTR_TIDE_TREND] is not None:
                attrs[ATTR_TIDE_TREND] = now_data[ATTR_TIDE_TREND]

            return attrs if attrs else None
        return None
