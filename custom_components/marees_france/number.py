"""Number platform for Marées France integration."""

from __future__ import annotations

import logging

from homeassistant.components.number import (
    NumberDeviceClass,
    NumberMode,
    RestoreNumber
)

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.const import UnitOfLength

from .const import (
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    CONF_HARBOR_MIN_DEPTH,
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

    number_to_add = [
        MareesFranceDepthToBoatNumber(coordinator, entry),
    ]

    async_add_entities(number_to_add, update_before_add=True)
    _LOGGER.debug("Added 1 Marées France number for harbor: %s", harbor_id)


class MareesFranceDepthToBoatNumber(
    CoordinatorEntity[MareesFranceUpdateCoordinator], RestoreNumber
):
    """Sensor representing the depth needed to navigate."""

    _attr_native_step = 0.1
    _attr_device_class = NumberDeviceClass.DISTANCE
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = UnitOfLength.METERS
    _attr_translation_key = "min_depth"
    _attr_has_entity_name = True  # Uses the name defined by `translation_key`.

    def __init__(
        self,
        coordinator: MareesFranceUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialize the 'depth to boat' number."""
        super().__init__(coordinator)

        self._attr_native_min_value = 0
        self._config_entry = config_entry
        self._harbor_id: str = config_entry.data[CONF_HARBOR_ID]
        self._harbor_name: str = config_entry.data.get(
            CONF_HARBOR_NAME, self._harbor_id
        )
        self._attr_available = True
        self._attr_native_value: float = config_entry.data[CONF_HARBOR_MIN_DEPTH]

        self._attr_icon = "mdi:wave-arrow-up"
        self._attr_unique_id = f"{DOMAIN}_{self._harbor_id.lower()}_depth_to_boat"

        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=self._harbor_name,
            manufacturer=MANUFACTURER,
            entry_type="service",  # Using "service" as it's data from an external service
            configuration_url=None,  # No specific URL for device configuration
        )

        _LOGGER.debug("Initialized number with unique_id: %s", self.unique_id)

    async def async_added_to_hass(self) -> None:
        """When entity is added to Home Assistant."""
        await super().async_added_to_hass()

        state = await self.async_get_last_state()
        if state is not None and state.state != "unavailable":
            await self.async_set_native_value(float(state.state))

    async def async_update_coordinator(self, value: float) -> bool:
        await self.coordinator._async_update_from_number(self.unique_id, value)
        return True

    async def async_set_native_value(self, value: float) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
        await self.async_update_coordinator(value)
