"""Module providing configuration for tests"""

from typing import Generator
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import timedelta
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.const import CONF_DEVICE_ID, CONF_FRIENDLY_NAME

from custom_components.marees_france.const import CONF_HARBOR_ID, DOMAIN
from custom_components.marees_france.coordinator import MareesFranceUpdateCoordinator
from pytest_homeassistant_custom_component.common import MockConfigEntry

# Mock data for config entries
MOCK_CONFIG_ENTRY_DATA = {
    CONF_HARBOR_ID: "BREST",
}

# Apply the enable_socket marker to all tests in this directory and subdirectories
pytestmark = [
    pytest.mark.enable_socket,
    pytest.mark.enable_custom_integrations,  # This is crucial for loading custom components
]
"""Fixtures for Marees France integration tests."""


# Mock modules needed for frontend dependency
@pytest.fixture(autouse=True)
def mock_hass_frontend():
    """Mock the hass_frontend module."""
    mock_module = MagicMock()
    modules = {
        "hass_frontend": mock_module,
        "hass_frontend_es5": mock_module,
    }
    with patch.dict("sys.modules", modules):
        yield


@pytest.fixture(autouse=True)
def mock_frontend_setup():
    """Mock the frontend setup."""
    with patch("homeassistant.components.frontend.async_setup", return_value=True):
        yield


@pytest.fixture(autouse=True)
def mock_js_module():
    """Mock the JSModuleRegistration class."""
    mock_instance = MagicMock()
    mock_instance.async_register = AsyncMock(return_value=True)

    with patch(
        "custom_components.marees_france.frontend.JSModuleRegistration",
        return_value=mock_instance,
    ):
        yield


@pytest.fixture(autouse=True)
def mock_config_flow():
    """Mock the config flow handler."""
    # Import the config flow class
    from custom_components.marees_france.config_flow import MareesFranceConfigFlow

    # Create a mock async_get_flow_handler function with the correct signature
    async def mock_async_get_flow_handler(hass, handler, context, data=None):
        # Return the class itself, not an instance
        return MareesFranceConfigFlow

    # Patch the _async_get_flow_handler function
    with patch(
        "homeassistant.config_entries._async_get_flow_handler",
        side_effect=mock_async_get_flow_handler,
    ):
        yield


MOCK_CONFIG_ENTRY_DATA = {
    CONF_HARBOR_ID: "BREST",
    CONF_DEVICE_ID: "Brest",
    CONF_FRIENDLY_NAME: "Maree Brest",
}

MOCK_PORT_DATA = {
    "nom_port": "BREST",
    "lat": 48.3833,
    "lon": -4.5,
    "coeff_maree": [
        {"valeur": 95, "jour": 1, "date": "2025-05-12T00:00:00Z"},
        {"valeur": 90, "jour": 2, "date": "2025-05-13T00:00:00Z"},
    ],
    "hauteurs_maree": [
        {
            "valeur": 1.5,
            "etat": "BM",
            "jour": 1,
            "heure": "03:00",
            "date": "2025-05-12T03:00:00Z",
        },
        {
            "valeur": 6.5,
            "etat": "PM",
            "jour": 1,
            "heure": "09:00",
            "date": "2025-05-12T09:00:00Z",
        },
    ],
}


@pytest.fixture
def mock_setup_entry() -> Generator[AsyncMock, None, None]:
    """Override async_setup_entry."""
    with patch(
        "custom_components.marees_france.async_setup_entry",
        return_value=AsyncMock(return_value=True),
    ) as mock_setup:
        yield mock_setup


@pytest.fixture(name="mock_api_fetchers")
def mock_api_fetchers_fixture() -> Generator[
    tuple[AsyncMock, AsyncMock, AsyncMock], None, None
]:
    """Mock the API helper fetch functions used by the coordinator."""
    with (
        patch(
            "custom_components.marees_france.coordinator._async_fetch_and_store_tides",
            autospec=True,
            return_value=True,  # Assume success for tests
        ) as mock_fetch_tides,
        patch(
            "custom_components.marees_france.coordinator._async_fetch_and_store_coefficients",
            autospec=True,
            return_value=True,  # Assume success for tests
        ) as mock_fetch_coeffs,
        patch(
            "custom_components.marees_france.coordinator._async_fetch_and_store_water_level",
            autospec=True,
            return_value=MOCK_PORT_DATA.get(
                "hauteurs_maree"
            ),  # Return some plausible data
        ) as mock_fetch_water,
    ):
        # Yield the mocks in case tests need to assert calls
        yield mock_fetch_tides, mock_fetch_coeffs, mock_fetch_water


# Mock port data for testing
MOCK_PORT_DATA = {
    "nom_port": "BREST",
    "lat": 48.3833,
    "lon": -4.5,
    "coeff_maree": [
        {"valeur": 95, "jour": 1, "date": "2025-05-12T00:00:00Z"},
        {"valeur": 90, "jour": 2, "date": "2025-05-13T00:00:00Z"},
    ],
    "hauteurs_maree": [
        {
            "valeur": 1.5,
            "etat": "BM",
            "jour": 1,
            "heure": "03:00",
            "date": "2025-05-12T03:00:00Z",
        },
        {
            "valeur": 6.5,
            "etat": "PM",
            "jour": 1,
            "heure": "09:00",
            "date": "2025-05-12T09:00:00Z",
        },
    ],
}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable custom integrations defined in the test dir."""
    yield


@pytest.fixture(autouse=True)
def mock_all_network_requests():
    """Mock all network requests to prevent hanging tests."""
    # Create a mock response for get requests
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json = AsyncMock(return_value={"features": []})
    mock_response.text = AsyncMock(return_value="")
    mock_response.__aenter__.return_value = mock_response
    mock_response.__aexit__ = AsyncMock(return_value=None)

    # Create a more aggressive set of patches
    with (
        patch("aiohttp.ClientSession.get", return_value=mock_response),
        patch("aiohttp.ClientSession.post", return_value=mock_response),
        patch("aiohttp.ClientSession.request", return_value=mock_response),
        patch(
            "custom_components.marees_france.__init__.fetch_harbors",
            return_value={"BREST": {"name": "Brest", "id": "BREST"}},
        ),
        patch("socket.socket", side_effect=RuntimeError("Socket creation blocked")),
        patch("asyncio.sleep", return_value=None),
    ):  # Prevent any sleep delays
        yield


@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True


@pytest.fixture(autouse=True)
def reduce_timeouts():
    """Reduce timeouts to speed up tests."""
    # Instead of patching constants, we'll patch the update_interval in the coordinator
    # when it's instantiated
    original_init = MareesFranceUpdateCoordinator.__init__

    def patched_init(self, hass, entry, tides_store, coeff_store, water_level_store):
        original_init(self, hass, entry, tides_store, coeff_store, water_level_store)
        self.update_interval = timedelta(seconds=0.1)

    with (
        patch(
            "custom_components.marees_france.coordinator.MareesFranceUpdateCoordinator.__init__",
            patched_init,
        ),
        patch(
            "homeassistant.helpers.update_coordinator.DataUpdateCoordinator.async_refresh",
            return_value=None,
        ),
        patch("asyncio.sleep", return_value=None),
    ):
        yield


@pytest.fixture
def mock_api_fetchers_detailed():
    """Mock the API fetchers with detailed data for coordinator tests."""
    # Create mock data for the coordinator
    mock_tides_data = {
        "2025-05-11": [["BM", "20:45", "1.8", "---"]],
        "2025-05-12": [
            ["PM", "03:00", "8.2", "90"],
            ["BM", "09:15", "1.5", "---"],
            ["PM", "15:30", "8.5", "95"],
            ["BM", "21:45", "1.2", "---"],
        ],
        "2025-05-13": [
            ["PM", "03:45", "8.0", "88"],
            ["BM", "10:00", "1.8", "---"],
        ],
    }

    mock_coeffs_data = {
        "2025-05-12": ["90", "95"],
        "2025-05-13": ["88", "90"],
    }

    mock_water_level_data = {
        "2025-05-12": [
            ["02:55:00", "8.15"],
            ["03:00:00", "8.20"],
            ["03:05:00", "8.18"],
            ["09:10:00", "1.55"],
            ["09:15:00", "1.50"],
            ["09:20:00", "1.52"],
        ]
    }

    # Create a properly structured mock data for the coordinator
    mock_parsed_data = {
        "now_data": {
            "tide_trend": "rising",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
            "current_height": 5.0,
        },
        "next_data": {
            "tide_trend": "Low Tide",
            "starting_time": "2025-05-12T09:15:00+00:00",
            "finished_time": "2025-05-12T09:15:00+00:00",
            "starting_height": "8.2",
            "finished_height": "1.5",
            "coefficient": "90",
        },
        "previous_data": {
            "tide_trend": "High Tide",
            "starting_time": "2025-05-12T03:00:00+00:00",
            "finished_time": "2025-05-12T03:00:00+00:00",
            "starting_height": "1.8",
            "finished_height": "8.2",
            "coefficient": "90",
        },
        "next_spring_date": "2025-05-12",
        "next_spring_coeff": "95",
        "next_neap_date": "2025-05-13",
        "next_neap_coeff": "88",
        "last_update": "2025-05-12T00:00:00Z",
    }

    # Create a mock coordinator with data
    with (
        patch(
            "custom_components.marees_france.api_helpers._async_fetch_and_store_tides",
            return_value=True,
        ) as fetch_tides_mock,
        patch(
            "custom_components.marees_france.api_helpers._async_fetch_and_store_coefficients",
            return_value=True,
        ) as fetch_coeffs_mock,
        patch(
            "custom_components.marees_france.api_helpers._async_fetch_and_store_water_level",
            return_value=MOCK_PORT_DATA["hauteurs_maree"],
        ) as fetch_water_mock,
        patch(
            "custom_components.marees_france.coordinator.MareesFranceUpdateCoordinator._parse_tide_data",
            return_value=mock_parsed_data,
        ),
    ):
        # Mock the store objects
        mock_tides_store = MagicMock()
        mock_tides_store.async_load = AsyncMock(return_value={"BREST": mock_tides_data})
        mock_tides_store.async_save = AsyncMock(return_value=None)

        mock_coeffs_store = MagicMock()
        mock_coeffs_store.async_load = AsyncMock(
            return_value={"BREST": mock_coeffs_data}
        )
        mock_coeffs_store.async_save = AsyncMock(return_value=None)

        mock_water_store = MagicMock()
        mock_water_store.async_load = AsyncMock(
            return_value={"BREST": mock_water_level_data}
        )
        mock_water_store.async_save = AsyncMock(return_value=None)

        # Patch the store creation
        with patch(
            "custom_components.marees_france.__init__.Store",
            side_effect=[mock_tides_store, mock_coeffs_store, mock_water_store],
        ):
            yield (fetch_tides_mock, fetch_coeffs_mock, fetch_water_mock)


@pytest.fixture
async def init_integration(hass: HomeAssistant, mock_api_fetchers_detailed) -> None:
    """Set up the Marees France integration for testing."""
    # Mock the frontend module to prevent lingering timers
    with (
        patch(
            "custom_components.marees_france.__init__.JSModuleRegistration"
        ) as mock_js,
        patch(
            "custom_components.marees_france.frontend.JSModuleRegistration._async_wait_for_lovelace_resources",
            return_value=None,
        ),
        patch(
            "homeassistant.helpers.event.async_call_later", return_value=lambda: None
        ),
        patch(
            "custom_components.marees_france.__init__.fetch_harbors",
            return_value={"BREST": {"name": "Brest", "id": "BREST"}},
        ),
    ):
        mock_instance = MagicMock()
        mock_instance.async_register = MagicMock(return_value=True)
        mock_js.return_value = mock_instance

        # Create a mock config entry
        entry = MockConfigEntry(
            domain=DOMAIN,
            data=MOCK_CONFIG_ENTRY_DATA,
            entry_id="test",
            unique_id="BREST",
        )
        entry.add_to_hass(hass)

        # We need to remove the entry and add it again to avoid migration errors
        await hass.config_entries.async_remove(entry.entry_id)
        await hass.async_block_till_done()

        # Create a new entry
        entry = MockConfigEntry(
            domain=DOMAIN,
            data=MOCK_CONFIG_ENTRY_DATA,
            entry_id="test",
            unique_id="BREST",
            version=2,  # Skip migration
        )
        entry.add_to_hass(hass)

        # Set up the component first
        assert await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()

        # Then set up the entry
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
