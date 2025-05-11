import pytest

# Apply the enable_socket marker to all tests in this directory and subdirectories
pytestmark = pytest.mark.enable_socket
"""Fixtures for Marees France integration tests."""
from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest

from homeassistant.const import CONF_DEVICE_ID, CONF_FRIENDLY_NAME
from custom_components.marees_france.const import CONF_HARBOR_ID
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.marees_france.const import DOMAIN

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
        "custom_components.marees_france.async_setup_entry", return_value=True
    ) as mock_setup:
        yield mock_setup


@pytest.fixture
def mock_shom_client() -> Generator[AsyncMock, None, None]:
    """Mock a SHOM client."""
    with patch(
        "custom_components.marees_france.config_flow.ShomClient", autospec=True
    ) as mock_client_constructor, patch(
        "custom_components.marees_france.ShomClient", autospec=True
    ) as mock_client_instance:
        client = mock_client_constructor.return_value
        client.get_port_info.return_value = MOCK_PORT_DATA
        client.get_tide_data.return_value = MOCK_PORT_DATA # Assuming similar structure for now
        # Also mock the instance used in __init__.py
        instance_client = mock_client_instance.return_value
        instance_client.get_port_info.return_value = MOCK_PORT_DATA
        instance_client.get_tide_data.return_value = MOCK_PORT_DATA
        yield client # Return the one used in config_flow for most tests


@pytest.fixture
async def init_integration(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Set up the Marees France integration for testing."""
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()