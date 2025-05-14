"""Config flow for Marées France integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import fetch_harbors  # fetch_harbors is defined in __init__.py
from .const import (
    CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    DEFAULT_HARBOR,
    DOMAIN,
    INTEGRATION_NAME,
)

_LOGGER = logging.getLogger(__name__)


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect to the SHOM API."""


class InvalidAuth(
    HomeAssistantError
):  # Not currently used, but good for future API changes.
    """Error to indicate there is invalid authentication."""


class MareesFranceConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Marées France.

    This config flow allows users to select a French harbor for which to
    retrieve tide, coefficient, and water level data.
    """

    VERSION = 2
    _harbors_cache: dict[str, dict[str, str]] | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial user step of the config flow.

        This step fetches the list of available harbors from the SHOM API
        and presents them to the user for selection.

        Args:
            user_input: The user's input from the form, if any.

        Returns:
            A ConfigFlowResult, either showing the form or creating an entry.
        """
        errors: dict[str, str] = {}

        if self._harbors_cache is None:
            try:
                websession = async_get_clientsession(self.hass)
                self._harbors_cache = await fetch_harbors(websession)
            except CannotConnect as err:
                _LOGGER.error("Failed to connect to SHOM API to fetch harbors: %s", err)
                return self.async_abort(reason="cannot_connect")
            except Exception as err:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected error fetching harbors: %s", err)
                return self.async_abort(reason="unknown")

        if user_input is not None:
            selected_harbor_id = user_input[CONF_HARBOR_ID]
            # Ensure _harbors_cache is not None before accessing
            if (
                self._harbors_cache is None
                or selected_harbor_id not in self._harbors_cache
            ):
                errors["base"] = "invalid_harbor"
            else:
                await self.async_set_unique_id(selected_harbor_id.lower())
                self._abort_if_unique_id_configured()

                harbor_name = self._harbors_cache[selected_harbor_id]["name"]

                return self.async_create_entry(
                    title=f"{INTEGRATION_NAME} - {harbor_name}",
                    data={
                        CONF_HARBOR_ID: selected_harbor_id,
                        CONF_HARBOR_NAME: harbor_name,
                    },
                )

        harbor_options: dict[str, str] = {
            k: v.get("display", v.get("name", k))
            for k, v in (self._harbors_cache or {}).items()
            if isinstance(v, dict)
        }

        if not harbor_options:
            _LOGGER.error("No valid harbor options found after fetching. Aborting.")
            # This typically means the _harbors_cache was empty or malformed.
            return self.async_abort(reason="cannot_connect")

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
