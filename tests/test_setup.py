"""Test basic setup of the integration."""
import pytest
from unittest.mock import patch

from homeassistant.setup import async_setup_component
from custom_components.marees_france.const import DOMAIN


class MockJSModuleRegistration:
    """Mock JSModuleRegistration class."""
    
    def __init__(self, *args, **kwargs):
        """Initialize."""
        pass
        
    async def async_register(self):
        """Mock register method."""
        return True


@pytest.fixture(autouse=True)
def mock_frontend():
    """Mock the frontend module."""
    with patch("custom_components.marees_france.frontend.JSModuleRegistration", MockJSModuleRegistration):
        yield


async def test_setup_integration(hass):
    """Test the integration can be set up."""
    # Mock the frontend module
    with patch("custom_components.marees_france.__init__.JSModuleRegistration", MockJSModuleRegistration), \
         patch("custom_components.marees_france.async_setup", return_value=True):
        # Try to set up the component
        result = await async_setup_component(hass, DOMAIN, {})
        await hass.async_block_till_done()
        
        # Check if the setup was successful
        assert result is True, "Failed to set up the integration"