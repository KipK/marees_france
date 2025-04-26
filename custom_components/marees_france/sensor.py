"""Sensor platform for Marées France integration."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    # SensorEntityDescription, # No longer needed for individual sensors
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_ATTRIBUTION # Import standard attribution constant
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util # Import dt_util for timezone handling

from .const import (
    # ATTR_DATA, # No longer used directly by sensors
    # ATTR_NEXT_TIDE, # Replaced by specific sensor data keys
    # ATTR_PREVIOUS_TIDE, # Replaced by specific sensor data keys
    ATTR_COEFFICIENT,
    ATTR_CURRENT_HEIGHT, # Add the new constant
    ATTR_FINISHED_HEIGHT,
    ATTR_FINISHED_TIME,
    ATTR_STARTING_HEIGHT,
    ATTR_STARTING_TIME,
    ATTR_TIDE_TREND,
    ATTRIBUTION, # Keep custom attribution if needed, or use HA const
    CONF_HARBOR_ID,
    DOMAIN,
    MANUFACTURER,
    # TIDE_HIGH, # Logic moved to coordinator
    # TIDE_LOW, # Logic moved to coordinator
)
from .coordinator import MareesFranceUpdateCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Marées France sensor entries."""
    coordinator: MareesFranceUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    harbor_id = entry.data[CONF_HARBOR_ID]

    sensors_to_add = [
        MareesFranceNowSensor(coordinator, entry),
        MareesFranceNextSensor(coordinator, entry),
        MareesFrancePreviousSensor(coordinator, entry),
        MareesFranceNextSpringTideSensor(coordinator, entry),
        MareesFranceNextNeapTideSensor(coordinator, entry),
    ]

    async_add_entities(sensors_to_add, update_before_add=True)
    _LOGGER.debug("Added 5 Marées France sensors for harbor: %s", harbor_id)


class MareesFranceBaseSensor(CoordinatorEntity[MareesFranceUpdateCoordinator], SensorEntity):
    """Base class for Marées France sensors."""

    _attr_attribution = ATTRIBUTION # Or use ATTR_ATTRIBUTION from const
    _attr_has_entity_name = True # Use the name defined in the entity

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_key: str, # e.g., "now", "next"
    ) -> None:
        """Initialize the base sensor."""
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._harbor_id = config_entry.data[CONF_HARBOR_ID]
        self._sensor_key = sensor_key # e.g., "now_data", "next_data"

        # Unique ID: harbor_id_sensorkey (e.g., pornichet_next_tide)
        self._attr_unique_id = f"{DOMAIN}_{self._harbor_id.lower()}_{self._sensor_key}"

        # Device Info linking all sensors to the same device
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=self._harbor_id.capitalize(), # Device name is the harbor
            manufacturer=MANUFACTURER,
            entry_type="service",
            configuration_url=None,
        )
        _LOGGER.debug("Initialized base sensor with unique_id: %s", self.unique_id)

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and the specific sensor data exists."""
        return (
            super().available
            and self.coordinator.data is not None
            and f"{self._sensor_key}_data" in self.coordinator.data
            and self.coordinator.data[f"{self._sensor_key}_data"] is not None
        )

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        if self.available:
             _LOGGER.debug("Updating sensor state for %s", self.unique_id)
        else:
             _LOGGER.debug("Sensor %s is unavailable, coordinator data: %s", self.unique_id, self.coordinator.data)
        super()._handle_coordinator_update()


class MareesFranceNowSensor(MareesFranceBaseSensor):
    """Representation of the current tide status sensor."""

    _attr_translation_key = "now_tide" # Used for entity name translation

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the 'now' sensor."""
        super().__init__(coordinator, config_entry, "now")

    @property
    def _sensor_data(self) -> dict[str, Any] | None:
        """Helper to get the specific data block for this sensor."""
        return self.coordinator.data.get("now_data") if self.coordinator.data else None

    @property
    def native_value(self) -> str | None:
        """Return the state of the sensor (raw trend)."""
        if not self.available or not self._sensor_data:
            return None

        trend = self._sensor_data.get(ATTR_TIDE_TREND)
        # Return the raw trend ('rising' or 'falling')
        # Home Assistant will use the translations defined in en.json/fr.json
        return trend

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the state attributes."""
        if not self.available or not self._sensor_data:
            return None

        attributes = {}
        # Explicitly add all desired attributes from the coordinator's now_data
        if (trend := self._sensor_data.get(ATTR_TIDE_TREND)) is not None:
            attributes[ATTR_TIDE_TREND] = trend
        if (current_height := self._sensor_data.get(ATTR_CURRENT_HEIGHT)) is not None:
            attributes[ATTR_CURRENT_HEIGHT] = current_height
        if (coeff := self._sensor_data.get(ATTR_COEFFICIENT)) is not None:
            attributes[ATTR_COEFFICIENT] = coeff
        if (start_h := self._sensor_data.get(ATTR_STARTING_HEIGHT)) is not None:
            attributes[ATTR_STARTING_HEIGHT] = start_h
        if (finish_h := self._sensor_data.get(ATTR_FINISHED_HEIGHT)) is not None:
            attributes[ATTR_FINISHED_HEIGHT] = finish_h
        if (start_t := self._sensor_data.get(ATTR_STARTING_TIME)) is not None:
            attributes[ATTR_STARTING_TIME] = start_t
        if (finish_t := self._sensor_data.get(ATTR_FINISHED_TIME)) is not None:
            attributes[ATTR_FINISHED_TIME] = finish_t

        return attributes if attributes else None

    @property
    def icon(self) -> str:
        """Return the icon based on the tide trend."""
        if self.available and self._sensor_data:
            trend = self._sensor_data.get(ATTR_TIDE_TREND)
            if trend == "rising":
                return "mdi:transfer-up" # Or mdi:arrow-up-bold-outline
            if trend == "falling":
                return "mdi:transfer-down" # Or mdi:arrow-down-bold-outline
        return "mdi:waves" # Default icon


class MareesFranceTimestampSensor(MareesFranceBaseSensor):
    """Base class for sensors representing a specific tide event time."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_key: str, # e.g., "next", "previous"
        translation_key: str,
    ) -> None:
        """Initialize the timestamp sensor."""
        super().__init__(coordinator, config_entry, sensor_key)
        self._attr_translation_key = translation_key

    @property
    def _sensor_data(self) -> dict[str, Any] | None:
        """Helper to get the specific data block for this sensor."""
        return self.coordinator.data.get(f"{self._sensor_key}_data") if self.coordinator.data else None

    @property
    def native_value(self) -> datetime | None:
        """Return the timestamp of the tide event."""
        if not self.available or not self._sensor_data:
            return None

        # For these sensors, the state is the time of the event itself
        event_time_str = self._sensor_data.get(ATTR_FINISHED_TIME)
        if not event_time_str:
            return None

        try:
            # Return datetime object as required by TIMESTAMP device class
            return dt_util.parse_datetime(event_time_str)
        except ValueError:
            _LOGGER.warning("Could not parse event time for '%s' sensor: %s", self._sensor_key, event_time_str)
            return None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the state attributes."""
        if not self.available or not self._sensor_data:
            return None
        # Return the whole data block as attributes
        return self._sensor_data


class MareesFranceNextSensor(MareesFranceTimestampSensor):
    """Representation of the next tide sensor."""
    def __init__(self, coordinator: MareesFranceUpdateCoordinator, config_entry: ConfigEntry) -> None:
        super().__init__(coordinator, config_entry, "next", "next_tide")

class MareesFrancePreviousSensor(MareesFranceTimestampSensor):
    """Representation of the previous tide sensor."""
    def __init__(self, coordinator: MareesFranceUpdateCoordinator, config_entry: ConfigEntry) -> None:
        super().__init__(coordinator, config_entry, "previous", "previous_tide")

class MareesFranceNextSpringTideSensor(MareesFranceBaseSensor):
    """Representation of the next spring tide sensor (date and coefficient)."""
    _attr_translation_key = "next_spring_tide"
    _attr_icon = "mdi:calendar-arrow-right" # Or mdi:waves-arrow-up

    def __init__(self, coordinator: MareesFranceUpdateCoordinator, config_entry: ConfigEntry) -> None:
        """Initialize the next spring tide sensor."""
        # Use "next_spring" as the base key for unique_id
        super().__init__(coordinator, config_entry, "next_spring")

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and the specific sensor data exists."""
        return (
            super(CoordinatorEntity, self).available # Use CoordinatorEntity's available check
            and self.coordinator.data is not None
            and self.coordinator.data.get("next_spring_date") is not None
        )

    @property
    def native_value(self) -> str | None:
        """Return the date string of the next spring tide."""
        if not self.available:
            return None
        return self.coordinator.data.get("next_spring_date")

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the coefficient as the only attribute."""
        if not self.available:
            return None
        coeff = self.coordinator.data.get("next_spring_coeff")
        if coeff is not None:
            return {ATTR_COEFFICIENT: coeff}
        return None


class MareesFranceNextNeapTideSensor(MareesFranceBaseSensor):
    """Representation of the next neap tide sensor (date and coefficient)."""
    _attr_translation_key = "next_neap_tide"
    _attr_icon = "mdi:calendar-arrow-right" # Or mdi:waves-arrow-down

    def __init__(self, coordinator: MareesFranceUpdateCoordinator, config_entry: ConfigEntry) -> None:
        """Initialize the next neap tide sensor."""
        # Use "next_neap" as the base key for unique_id
        super().__init__(coordinator, config_entry, "next_neap")

    @property
    def available(self) -> bool:
        """Return True if coordinator has data and the specific sensor data exists."""
        return (
            super(CoordinatorEntity, self).available # Use CoordinatorEntity's available check
            and self.coordinator.data is not None
            and self.coordinator.data.get("next_neap_date") is not None
        )

    @property
    def native_value(self) -> str | None:
        """Return the date string of the next neap tide."""
        if not self.available:
            return None
        return self.coordinator.data.get("next_neap_date")

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the coefficient as the only attribute."""
        if not self.available:
            return None
        coeff = self.coordinator.data.get("next_neap_coeff")
        if coeff is not None:
            return {ATTR_COEFFICIENT: coeff}
        return None
