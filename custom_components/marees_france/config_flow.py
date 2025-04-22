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
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv

# Local application/library specific imports
from .const import (
    CONF_HARBOR_ID,
    DEFAULT_HARBOR,
    DEFAULT_SCAN_INTERVAL_HOURS,
    DOMAIN,
    HARBORSURL,
    HEADERS,
    INTEGRATION_NAME,
)

_LOGGER = logging.getLogger(__name__)


async def fetch_harbors(
    websession: aiohttp.ClientSession,
) -> dict[str, str]:
    """Fetch the list of harbors from the SHOM API."""
    _LOGGER.debug("Fetching harbor list from %s", HARBORSURL)
    harbors: dict[str, str] = {}
    try:
        async with asyncio.timeout(20):  # Timeout for fetching harbor list
            response = await websession.get(HARBORSURL, headers=HEADERS)
            response.raise_for_status()  # Raise exception for bad status codes
            data = await response.json()

        if not data or "features" not in data:
            _LOGGER.error("Invalid harbor data received: %s", data)
            raise CannotConnect("Invalid harbor data received")

        for feature in data.get("features", []):
            properties = feature.get("properties")
            if properties and "cst" in properties and "toponyme" in properties:
                harbor_id = properties["cst"]
                harbor_name = properties["toponyme"]
                # Use format "Name (ID)" for clarity in selector
                harbors[harbor_id] = f"{harbor_name} ({harbor_id})"

        if not harbors:
            _LOGGER.error("No harbors found in the response.")
            raise CannotConnect("No harbors found")

        # Sort harbors by name for better UX
        return dict(sorted(harbors.items(), key=lambda item: item[1]))

    except asyncio.TimeoutError as err:
        _LOGGER.error("Timeout fetching harbor list: %s", err)
        raise CannotConnect(f"Timeout fetching harbor list: {err}") from err
    except aiohttp.ClientError as err:
        _LOGGER.error("Client error fetching harbor list: %s", err)
        raise CannotConnect(f"Client error fetching harbor list: {err}") from err
    except Exception as err:
        _LOGGER.exception("Unexpected error fetching harbor list")
        raise CannotConnect(f"Unexpected error fetching harbor list: {err}") from err


class MareesFranceConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Marées France."""

    VERSION = 1
    _harbors: dict[str, str] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if not self._harbors:
            try:
                websession = async_get_clientsession(self.hass)
                self._harbors = await fetch_harbors(websession)
            except CannotConnect as err:
                _LOGGER.error("Failed to connect to SHOM API to fetch harbors: %s", err)
                return self.async_abort(reason="cannot_connect")
            except Exception as err:  # Catch potential unexpected errors during fetch
                _LOGGER.exception("Unexpected error fetching harbors: %s", err)
                return self.async_abort(reason="unknown")

        if user_input is not None:
            # Validate harbor selection
            selected_harbor_id = user_input[CONF_HARBOR_ID]
            if selected_harbor_id not in self._harbors:
                errors["base"] = "invalid_harbor"  # Should not happen with selector
            else:
                # Use harbor ID as the unique ID for the config entry
                await self.async_set_unique_id(selected_harbor_id.lower())
                self._abort_if_unique_id_configured()

                # Get the full name for the title
                harbor_title = self._harbors.get(selected_harbor_id, selected_harbor_id)

                return self.async_create_entry(
                    title=f"{INTEGRATION_NAME} - {harbor_title}", data=user_input
                )

        # Define the schema for the user form
        data_schema = vol.Schema(
            {
                vol.Required(CONF_HARBOR_ID, default=DEFAULT_HARBOR): vol.In(
                    self._harbors
                ),
                vol.Required(
                    CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL_HOURS
                ): cv.positive_int,
            }
        )

        return self.async_show_form(
            step_id="user", data_schema=data_schema, errors=errors
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> OptionsFlow:
        """Get the options flow for this handler."""
        return MareesFranceOptionsFlowHandler(config_entry)


class MareesFranceOptionsFlowHandler(OptionsFlow):
    """Handle an options flow for Marées France. Allows changing scan interval."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        errors: dict[str, str] = {}

        if user_input is not None:
            # Update the config entry with new options
            return self.async_create_entry(title="", data=user_input)

        # Define the schema for the options form, pre-filled with current values
        options_schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=self.config_entry.options.get(
                        CONF_SCAN_INTERVAL
                    ),  # Use current option value
                ): cv.positive_int,
            }
        )

        return self.async_show_form(
            step_id="init", data_schema=options_schema, errors=errors
        )


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""


class InvalidAuth(HomeAssistantError):
    """Error to indicate there is invalid auth."""
