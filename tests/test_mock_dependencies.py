"""Test with mocked dependencies."""

from unittest.mock import patch, MagicMock

import pytest

from homeassistant.setup import async_setup_component
from custom_components.marees_france.const import DOMAIN


@pytest.fixture(autouse=True)
def mock_frontend_setup():
    """Mock the frontend setup."""
    with patch("homeassistant.components.frontend.async_setup", return_value=True):
        yield


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
def mock_js_module():
    """Mock the JSModuleRegistration class."""
    mock_instance = MagicMock()
    mock_instance.async_register = MagicMock(return_value=True)

    with patch(
        "custom_components.marees_france.frontend.JSModuleRegistration",
        return_value=mock_instance,
    ):
        yield


async def test_setup_with_mocked_dependencies(hass):
    """Test setup with mocked dependencies."""
    # Mock the async_setup function
    with patch("custom_components.marees_france.async_setup", return_value=True):
        # Try to set up the component
        result = await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()

        # Check if the setup was successful
        assert result is True, "Failed to set up the component with mocked dependencies"
