"""Module providing configuration for tests"""

from typing import Generator
from unittest.mock import AsyncMock, patch
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from homeassistant.const import CONF_DEVICE_ID, CONF_FRIENDLY_NAME

from custom_components.marees_france.const import CONF_HARBOR_ID, DOMAIN 

# Apply the enable_socket marker to all tests in this directory and subdirectories
pytestmark = pytest.mark.enable_socket
"""Fixtures for Marees France integration tests."""


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
        "custom_components.marees_france.async_setup_entry", return_value=AsyncMock(return_value=True)
    ) as mock_setup:
        yield mock_setup


@pytest.fixture(name="mock_api_fetchers")
def mock_api_fetchers_fixture() -> Generator[tuple[AsyncMock, AsyncMock, AsyncMock], None, None]:
    """Mock the API helper fetch functions used by the coordinator."""
    with patch(
        "custom_components.marees_france.coordinator._async_fetch_and_store_tides",
        autospec=True,
        return_value=True, # Assume success for tests
    ) as mock_fetch_tides, patch(
        "custom_components.marees_france.coordinator._async_fetch_and_store_coefficients",
        autospec=True,
        return_value=True, # Assume success for tests
    ) as mock_fetch_coeffs, patch(
        "custom_components.marees_france.coordinator._async_fetch_and_store_water_level",
        autospec=True,
        return_value=MOCK_PORT_DATA.get("hauteurs_maree"), # Return some plausible data
    ) as mock_fetch_water:
        # Yield the mocks in case tests need to assert calls
        yield mock_fetch_tides, mock_fetch_coeffs, mock_fetch_water


@pytest.fixture
async def init_integration(
    hass: HomeAssistant
) -> None:
    """Set up the Marees France integration for testing."""
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()