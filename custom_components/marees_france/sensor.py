"""Sensor platform for Marées France integration."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorEntityDescription
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    ATTR_DATA,
    ATTR_NEXT_TIDE,
    ATTR_PREVIOUS_TIDE,
    ATTRIBUTION,
    CONF_HARBOR_ID,
    DOMAIN,
    MANUFACTURER,
    TIDE_HIGH,
    TIDE_LOW,
)
from .coordinator import MareesFranceUpdateCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Marées France sensor entry."""
    coordinator: MareesFranceUpdateCoordinator = hass.data[DOMAIN][entry.entry_id]
    harbor_id = entry.data[CONF_HARBOR_ID]

    # Define the entity description
    entity_description = SensorEntityDescription(
        key="tides",  # Simplified key for the sensor type
        name=None,  # Explicitly set name to None
        # translation_key="tides", # Removed as state is formatted manually
    )

    async_add_entities(
        [MareesFranceSensor(coordinator, entry, entity_description)],
        update_before_add=True,  # Fetch data before adding entity
    )
    _LOGGER.debug("Added Marées France sensor for harbor: %s", harbor_id)


# Removed _format_tide_state function as state translation is handled by HA core
# based on native_value returning a state key and translation_key being set.


class MareesFranceSensor(
    CoordinatorEntity[MareesFranceUpdateCoordinator], SensorEntity
):
    """Representation of a Marées France Sensor."""

    _attr_has_entity_name = False  # Entity name comes from device name
    _attr_attribution = ATTRIBUTION

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
        entity_description: SensorEntityDescription,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_description = entity_description
        self._config_entry = config_entry
        self._harbor_id = config_entry.data[CONF_HARBOR_ID]

        # Set unique ID based only on the harbor_id for simplicity
        self._attr_unique_id = self._harbor_id.lower()

        # Set device info
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            # Set device name to just the harbor, as domain is implied
            name=self._harbor_id.capitalize(),
            manufacturer=MANUFACTURER,
            entry_type="service",  # Link to config entry
            configuration_url=None,  # No specific device config URL
        )
        _LOGGER.debug("Initialized sensor with unique_id: %s", self._attr_unique_id)

    @property
    def native_value(self) -> str | None:
        """Return the state of the sensor (formatted string)."""
        current_tide = self.coordinator.data.get("current_tide")
        if not current_tide:
            return None

        # Use translated_type provided by coordinator
        type_label = current_tide.get("translated_type", "Unknown")
        time_str = current_tide.get("time")
        coeff_str = current_tide.get("coefficient")

        if not time_str:  # Time is essential
            return None

        state_parts = [type_label, time_str]
        if coeff_str:
            state_parts.append(coeff_str)

        return " ".join(state_parts)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the state attributes."""
        if not self.coordinator.data:
            return None

        # Format next/previous tide info using translated_type from coordinator
        next_tide_data = self.coordinator.data.get("next_tide")
        prev_tide_data = self.coordinator.data.get("previous_tide")

        def format_attribute_tide(tide_data):
            if not tide_data or not tide_data.get("time"):
                return None
            # Use translated_type provided by coordinator
            type_label = tide_data.get("translated_type", "Unknown")
            time_str = tide_data.get("time")
            coeff_str = tide_data.get("coefficient")
            parts = [type_label, time_str]
            if coeff_str:
                parts.append(coeff_str)
            return " ".join(parts)

        attrs = {
            ATTR_DATA: self.coordinator.data.get("data"),
            ATTR_NEXT_TIDE: format_attribute_tide(next_tide_data),
            ATTR_PREVIOUS_TIDE: format_attribute_tide(prev_tide_data),
            "last_update": self.coordinator.data.get("last_update"),
            "harbor_id": self._harbor_id,
        }
        # Filter out None values for next/previous if they don't exist
        return {k: v for k, v in attrs.items() if v is not None}

    @property
    def icon(self) -> str:
        """Return the icon to use in the frontend."""
        # Dynamically change icon based on current tide type if available
        current_tide = self.coordinator.data.get("current_tide")
        if current_tide:
            tide_type = current_tide.get("type")
            if tide_type == TIDE_HIGH:
                return "mdi:waves-arrow-up"
            if tide_type == TIDE_LOW:
                return "mdi:waves-arrow-down"
        return "mdi:waves"  # Default icon

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle updated data from the coordinator."""
        _LOGGER.debug("Updating sensor state for %s", self.unique_id)
        super()._handle_coordinator_update()
