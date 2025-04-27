"""Config flow for Marées France integration."""

from __future__ import annotations

# Standard library imports
import asyncio
import logging
from typing import Any

# Third-party imports
import aiohttp
import voluptuous as vol

# Home Assistant core imports
from homeassistant import config_entries # Import config_entries
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
)
from homeassistant.core import HomeAssistant, callback # Add HomeAssistant import
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv

# Local application/library specific imports
# Import fetch_harbors from __init__.py
from . import fetch_harbors
from .const import (
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    DEFAULT_HARBOR,
    DOMAIN,
    HARBORSURL,
    HEADERS,
    INTEGRATION_NAME,
)

_LOGGER = logging.getLogger(__name__)


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""


class InvalidAuth(HomeAssistantError):
    """Error to indicate there is invalid auth."""


@config_entries.HANDLERS.register(DOMAIN)
class MareesFranceConfigFlow(ConfigFlow):
    """Handle a config flow for Marées France."""

    VERSION = 2 # Version bumped for migration
    # Store fetched harbors temporarily during the flow instance
    _harbors_cache: dict[str, dict[str, str]] | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if self._harbors_cache is None:
            try:
                websession = async_get_clientsession(self.hass)
                # Call imported function
                self._harbors_cache = await fetch_harbors(websession)
            except CannotConnect as err:
                _LOGGER.error("Failed to connect to SHOM API to fetch harbors: %s", err)
                return self.async_abort(reason="cannot_connect")
            except Exception as err:
                _LOGGER.exception("Unexpected error fetching harbors: %s", err)
                return self.async_abort(reason="unknown")

        if user_input is not None:
            selected_harbor_id = user_input[CONF_HARBOR_ID]
            if self._harbors_cache is None or selected_harbor_id not in self._harbors_cache:
                errors["base"] = "invalid_harbor"
            else:
                await self.async_set_unique_id(selected_harbor_id.lower())
                self._abort_if_unique_id_configured()

                harbor_name = self._harbors_cache[selected_harbor_id]["name"]

                return self.async_create_entry(
                    title=f"{INTEGRATION_NAME} - {harbor_name}",
                    data={CONF_HARBOR_ID: selected_harbor_id, CONF_HARBOR_NAME: harbor_name}
                )

        harbor_options = {k: v["display"] for k, v in (self._harbors_cache or {}).items()}
        data_schema = vol.Schema(
            {
                vol.Required(CONF_HARBOR_ID, default=DEFAULT_HARBOR): vol.In(
                    harbor_options
                ),
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

# Removed debug log for class registration
