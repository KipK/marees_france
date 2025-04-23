# Plan: Add `marees_france.get_water_levels` Service

**Goal:** Add a service `marees_france.get_water_levels` that fetches detailed tide height data for a specific port and date from the SHOM API and returns the data directly to the caller.

**Plan:**

1.  **Define Service Schema & Constants (`const.py`):**
    *   Define the service name: `SERVICE_GET_WATER_LEVELS = "get_water_levels"`
    *   Define input parameter keys: `ATTR_HARBOR_NAME = "harbor_name"` and `ATTR_DATE = "date"`.
    *   Define the new API URL template: `WATERLEVELS_URL_TEMPLATE = "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/wl?harborName={harbor_name}&duration=1&date={date}&utc=standard&nbWaterLevels=288"`
    *   Ensure `HEADERS` (imported from `.const`) is correctly defined and accessible.

2.  **Create Service Handler Function (in `__init__.py` or `services.py`):**
    *   Define `async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:`
    *   **Input:** Get `harbor_name` and `date` from `call.data`.
    *   **Validation:** Use `voluptuous` to define a schema (`SERVICE_GET_WATER_LEVELS_SCHEMA`) ensuring `harbor_name` is a non-empty string and `date` is a string matching 'YYYY-MM-DD'. Validate `call.data`.
    *   **API Call:**
        *   Get `aiohttp` client session from `call.hass`.
        *   Format the `WATERLEVELS_URL_TEMPLATE`.
        *   Make the `GET` request using the session and `HEADERS`.
        *   Include error handling (timeouts, HTTP errors via `response.raise_for_status()`, client errors). Raise `HomeAssistantError` on failure.
    *   **Response:**
        *   If successful, parse the JSON response: `data = await response.json()`.
        *   Return the parsed JSON data directly: `return data`.

3.  **Register the Service (`__init__.py`):**
    *   Inside `async_setup_entry`, register the service using `hass.services.async_register`.
    *   Import `SupportsResponse` from `homeassistant.const` and `ServiceCall`, `ServiceResponse` from `homeassistant.core`.
    *   Set `supports_response=SupportsResponse.ONLY` during registration.
        ```python
        # Example snippet for registration
        import asyncio
        import aiohttp
        from homeassistant.const import SupportsResponse
        from homeassistant.core import ServiceCall, ServiceResponse, HomeAssistant
        from homeassistant.helpers.aiohttp_client import async_get_clientsession
        from homeassistant.exceptions import HomeAssistantError
        import voluptuous as vol
        from .const import DOMAIN, SERVICE_GET_WATER_LEVELS, ATTR_HARBOR_NAME, ATTR_DATE, WATERLEVELS_URL_TEMPLATE, HEADERS
        import homeassistant.helpers.config_validation as cv
        import logging

        _LOGGER = logging.getLogger(__name__)

        SERVICE_GET_WATER_LEVELS_SCHEMA = vol.Schema({
            vol.Required(ATTR_HARBOR_NAME): cv.string,
            vol.Required(ATTR_DATE): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
        })

        async def async_handle_get_water_levels(call: ServiceCall) -> ServiceResponse:
            """Handle the service call to get water levels."""
            harbor_name = call.data[ATTR_HARBOR_NAME]
            date_str = call.data[ATTR_DATE]
            url = WATERLEVELS_URL_TEMPLATE.format(harbor_name=harbor_name, date=date_str)
            session = async_get_clientsession(call.hass)

            _LOGGER.debug("Calling SHOM water level API: %s", url)
            try:
                async with asyncio.timeout(30):
                    response = await session.get(url, headers=HEADERS)
                    response.raise_for_status() # Raise exception for bad status codes (4xx or 5xx)
                    data = await response.json()
                    _LOGGER.debug("Received water level data for %s on %s", harbor_name, date_str)
                    return data # Return the data directly
            except asyncio.TimeoutError as err:
                _LOGGER.error("Timeout fetching water levels for %s on %s", harbor_name, date_str)
                raise HomeAssistantError(f"Timeout fetching water levels: {err}") from err
            except aiohttp.ClientResponseError as err:
                 _LOGGER.error("HTTP error fetching water levels for %s on %s: %s %s", harbor_name, date_str, err.status, err.message)
                 raise HomeAssistantError(f"HTTP error fetching water levels: {err.status} {err.message}") from err
            except aiohttp.ClientError as err:
                _LOGGER.error("Client error fetching water levels for %s on %s: %s", harbor_name, date_str, err)
                raise HomeAssistantError(f"Client error fetching water levels: {err}") from err
            except Exception as err:
                _LOGGER.exception("Unexpected error fetching water levels for %s on %s", harbor_name, date_str)
                raise HomeAssistantError(f"Unexpected error fetching water levels: {err}") from err


        # In async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
        # hass.services.async_register(
        #     DOMAIN,
        #     SERVICE_GET_WATER_LEVELS,
        #     async_handle_get_water_levels,
        #     schema=SERVICE_GET_WATER_LEVELS_SCHEMA,
        #     supports_response=SupportsResponse.ONLY,
        # )
        ```

4.  **Describe the Service (`services.yaml`):**
    *   Create/update `custom_components/marees_france/services.yaml`.
    *   Describe the service, fields, and add a `response:` section with the example format.
        ```yaml
        get_water_levels:
          name: Get Water Levels
          description: Fetches detailed water level heights for a specific harbor and date from the SHOM API. Call with `return_response: true` to receive the data.
          fields:
            harbor_name:
              name: Harbor Name
              description: The official name of the harbor (e.g., LE_PALAIS).
              required: true
              example: "LE_PALAIS"
              selector:
                text:
            date:
              name: Date
              description: The date for which to fetch water levels (YYYY-MM-DD format).
              required: true
              example: "2025-04-24"
              selector:
                date:
          response:
            description: The raw water level data returned by the SHOM API, keyed by date.
            example: >
              {
                "2025-04-23": [
                  ["00:00:00", 3.8],
                  ["00:05:00", 3.83],
                  ["00:10:00", 3.86]
                ]
              }
        ```

**Flow Diagram:**

```mermaid
graph TD
    subgraph User Interaction
        A[Automation/Script/Card] -- Calls service w/ return_response=true --> B(Home Assistant Core);
    end

    subgraph Home Assistant Core
        B -- marees_france.get_water_levels(harbor_name, date) --> C{Service Registry};
        C -- Validates Schema --> C;
        C -- Invokes Handler --> D[Handler: async_handle_get_water_levels];
        D -- Gets HTTP Session --> B;
    end

    subgraph marees_france Integration
        E[__init__.py] -- Registers Service (supports_response=True) --> C;
        E -- Defines Handler --> D;
        F[const.py] -- Provides URL Template & Headers --> D;
        D -- Reads Constants --> F;
        D -- Makes API Call --> G((SHOM API /hdm/spm/wl));
        G -- Returns JSON Data --> D;
        D -- Parses Data/Handles Errors --> D;
        D -- Returns Data --> B;
    end

    subgraph External
        G;
    end

    B -- Returns ServiceResponse (contains data or error) --> A;