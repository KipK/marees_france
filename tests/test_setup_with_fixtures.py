"""Test setup with explicit fixtures."""

from unittest.mock import patch, MagicMock

import pytest

from homeassistant.setup import async_setup_component
from custom_components.marees_france.const import DOMAIN


# This fixture is provided by pytest-homeassistant-custom-component
@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable custom integrations defined in the test dir."""
    yield


@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True


# Mock the frontend module
@pytest.fixture(autouse=True)
def mock_frontend():
    """Mock the frontend module."""
    mock_js_module = MagicMock()
    mock_js_module.async_register = MagicMock(return_value=True)

    with patch(
        "custom_components.marees_france.frontend.JSModuleRegistration",
        return_value=mock_js_module,
    ):
        yield


async def test_setup_with_fixtures(hass, aioclient_mock):
    """Test setup with fixtures."""
    # Set up the component
    # Mock the JSModuleRegistration to prevent lingering timers
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
    ):
        mock_instance = MagicMock()
        mock_instance.async_register = MagicMock(return_value=True)
        mock_js.return_value = mock_instance

        # Try to set up the component
        result = await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()

        # Check if the setup was successful
        assert result is True
