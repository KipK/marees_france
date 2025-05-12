"""Test the Marees France config flow."""
from unittest.mock import AsyncMock, patch

import pytest

from homeassistant.components import zeroconf # Keep zeroconf for potential future tests
from homeassistant.config_entries import SOURCE_USER, ConfigEntry
from homeassistant.const import CONF_NAME # Import CONF_NAME if needed, or remove if not used elsewhere
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.marees_france.const import (
   CONF_HARBOR_ID,
    CONF_HARBOR_NAME,
    DOMAIN,
    INTEGRATION_NAME,
)
from custom_components.marees_france.config_flow import CannotConnect, MareesFranceConfigFlow

from tests.conftest import MOCK_CONFIG_ENTRY_DATA, MOCK_PORT_DATA

# Define a mock harbor cache based on MOCK_PORT_DATA
MOCK_HARBOR_ID = MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]
MOCK_HARBOR_NAME = MOCK_PORT_DATA["nom_port"] # Use the name from MOCK_PORT_DATA
MOCK_HARBORS_CACHE = {
    MOCK_HARBOR_ID: {"name": MOCK_HARBOR_NAME, "display": f"{MOCK_HARBOR_NAME} ({MOCK_HARBOR_ID})"},
    "OTHER_ID": {"name": "Other Port", "display": "Other Port (OTHER_ID)"},
}


@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Mark that we expect lingering timers in this test module."""
    return True

@pytest.fixture(name="mock_fetch_harbors")
def fixture_mock_fetch_harbors():
    """Mock the fetch_harbors function."""
    # Create a modified cache that includes the invalid harbor ID for testing
    test_harbors_cache = MOCK_HARBORS_CACHE.copy()
    
    with patch(
        "custom_components.marees_france.config_flow.fetch_harbors",
        return_value=test_harbors_cache,
    ) as mock:
        yield mock


async def test_async_step_user_success(
    hass: HomeAssistant, mock_fetch_harbors: AsyncMock
) -> None:
    """Test a successful user initiated config flow."""
    # Initialize the config flow
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    await hass.async_block_till_done() # Allow fetch_harbors mock to be called

    # Check that the form is shown
    assert result is not None
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    # In newer Home Assistant versions, errors is an empty dict instead of None
    assert result["errors"] == {}
    mock_fetch_harbors.assert_called_once() # Check fetch_harbors was called

    # Simulate user input selecting the mock harbor
    result2 = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_HARBOR_ID: MOCK_HARBOR_ID},
    )
    await hass.async_block_till_done()

    # Check that the entry is created
    assert result2 is not None
    assert result2["type"] == FlowResultType.CREATE_ENTRY
    # Title should be "Integration Name - Harbor Name"
    assert result2["title"] == f"{INTEGRATION_NAME} - {MOCK_HARBOR_NAME}"
    assert result2["data"] == {
        CONF_HARBOR_ID: MOCK_HARBOR_ID,
        CONF_HARBOR_NAME: MOCK_HARBOR_NAME, # Ensure name is also stored
    }
    # No second call to fetch_harbors expected here
    mock_fetch_harbors.assert_called_once()


async def test_async_step_user_invalid_harbor(
    hass: HomeAssistant, mock_fetch_harbors: AsyncMock
) -> None:
    """Test user initiated flow selecting an invalid harbor from the list."""
    # Create a direct instance of the config flow
    flow = MareesFranceConfigFlow()
    flow.hass = hass
    
    # Mock the _harbors_cache with a valid harbor
    flow._harbors_cache = {"BREST": {"name": "Brest", "display": "Brest (BREST)"}}
    
    # Test with an invalid harbor ID
    result = await flow.async_step_user({"harbor_id": "INVALID_HARBOR_ID"})
    
    # Check that the form is shown again with an error
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] == {"base": "invalid_harbor"}


async def test_async_step_user_cannot_connect(
    hass: HomeAssistant, mock_fetch_harbors: AsyncMock
) -> None:
    """Test user initiated flow when fetch_harbors fails with CannotConnect."""
    # Configure the mock to raise CannotConnect
    mock_fetch_harbors.side_effect = CannotConnect("Simulated connection error")

    # Initialize the config flow
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    await hass.async_block_till_done()

    # Check that the flow aborts with cannot_connect reason
    assert result["type"] == FlowResultType.ABORT
    assert result["reason"] == "cannot_connect"
    mock_fetch_harbors.assert_called_once()


async def test_async_step_user_unknown_error(
    hass: HomeAssistant, mock_fetch_harbors: AsyncMock
) -> None:
    """Test user initiated flow when fetch_harbors fails with an unexpected Exception."""
    # Configure the mock to raise a generic Exception
    mock_fetch_harbors.side_effect = Exception("Simulated unexpected error")

    # Initialize the config flow
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    await hass.async_block_till_done()

    # Check that the flow aborts with unknown reason
    assert result["type"] == FlowResultType.ABORT
    assert result["reason"] == "unknown"
    mock_fetch_harbors.assert_called_once()


async def test_async_step_user_already_configured(
    hass: HomeAssistant, mock_fetch_harbors: AsyncMock
) -> None:
    """Test user initiated flow when the harbor is already configured."""
    # Setup an existing entry using the mock data
    existing_entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=MOCK_HARBOR_ID.lower(), # unique_id is lowercase harbor_id
        data={CONF_HARBOR_ID: MOCK_HARBOR_ID, CONF_HARBOR_NAME: MOCK_HARBOR_NAME},
        title=f"{INTEGRATION_NAME} - {MOCK_HARBOR_NAME}",
    )
    existing_entry.add_to_hass(hass)

    # Initialize the config flow
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    await hass.async_block_till_done()

    # Check form is shown
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    # fetch_harbors is called to populate the form
    mock_fetch_harbors.assert_called_once()

    # Simulate user selecting the already configured harbor
    result2 = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_HARBOR_ID: MOCK_HARBOR_ID},
    )
    await hass.async_block_till_done()

    # Check that the flow aborts because it's already configured
    assert result2["type"] == FlowResultType.ABORT
    assert result2["reason"] == "already_configured"
    # fetch_harbors should still only be called once for this flow instance
    mock_fetch_harbors.assert_called_once()


# Placeholder for options flow tests if the integration implements it.
# For now, we assume no options flow. If an options flow is added to
# marees_france, tests for it should be added here.
#
# async def test_options_flow_init(hass: HomeAssistant, mock_api_fetchers: AsyncMock) -> None:
# """Test the options flow initialization."""
# # First, set up a config entry
# config_entry = MockConfigEntry(domain=DOMAIN, data=MOCK_CONFIG_ENTRY_DATA, entry_id="test_options")
# config_entry.add_to_hass(hass)
#
# with patch("custom_components.marees_france.async_setup_entry", return_value=True):
# await hass.config_entries.async_setup(config_entry.entry_id)
# await hass.async_block_till_done()
#
# result = await hass.config_entries.options.async_init(config_entry.entry_id)
#
# assert result["type"] == FlowResultType.FORM
# assert result["step_id"] == "init" # Or your specific options step_id
# # Add more assertions based on your options flow form
#
# async def test_options_flow_submit_success(hass: HomeAssistant, mock_api_fetchers: AsyncMock) -> None:
# """Test successful submission of options."""
# config_entry = MockConfigEntry(domain=DOMAIN, data=MOCK_CONFIG_ENTRY_DATA, entry_id="test_options_submit")
# config_entry.add_to_hass(hass)
#
# with patch("custom_components.marees_france.async_setup_entry", return_value=True):
# await hass.config_entries.async_setup(config_entry.entry_id)
# await hass.async_block_till_done()
#
#     # Initial options flow
# result = await hass.config_entries.options.async_init(config_entry.entry_id)
#
#     # Simulate user input for options
#     # Replace with actual options your flow expects
#     options_input = {"some_option": "new_value"}
# result2 = await hass.config_entries.options.async_configure(
# result["flow_id"],
# user_input=options_input,
#     )
# await hass.async_block_till_done()
#
# assert result2["type"] == FlowResultType.CREATE_ENTRY # Options flow creates an entry with an empty string title
# assert result2["data"] == options_input # Or however your options are stored
# assert config_entry.options == options_input
#
# async def test_options_flow_validation_error(hass: HomeAssistant, mock_api_fetchers: AsyncMock) -> None:
# """Test options flow with invalid input."""
# config_entry = MockConfigEntry(domain=DOMAIN, data=MOCK_CONFIG_ENTRY_DATA, entry_id="test_options_invalid")
# config_entry.add_to_hass(hass)
#
# with patch("custom_components.marees_france.async_setup_entry", return_value=True):
# await hass.config_entries.async_setup(config_entry.entry_id)
# await hass.async_block_till_done()
#
# result = await hass.config_entries.options.async_init(config_entry.entry_id)
#
#     # Simulate invalid user input
#     # Replace with actual invalid options
#     invalid_options_input = {"some_option": "invalid_value_that_should_fail"}
# result2 = await hass.config_entries.options.async_configure(
# result["flow_id"],
# user_input=invalid_options_input,
#     )
# await hass.async_block_till_done()
#
# assert result2["type"] == FlowResultType.FORM
# assert result2["step_id"] == "init" # Or your specific options step_id
# assert result2["errors"] is not None # Check for specific errors
#     # e.g., assert result2["errors"]["base"] == "invalid_option_value"