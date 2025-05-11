"""Test the Marees France config flow."""
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components import zeroconf
from homeassistant.config_entries import SOURCE_USER
from custom_components.marees_france.const import CONF_HARBOR_ID
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType

from custom_components.marees_france.const import DOMAIN
from custom_components.marees_france.config_flow import CannotConnect

from tests.conftest import MOCK_CONFIG_ENTRY_DATA, MOCK_PORT_DATA
# CONF_HARBOR_ID is already imported above and MOCK_CONFIG_ENTRY_DATA uses it.


async def test_async_step_user_success(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test a successful user initiated config flow."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result is not None
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] is None

    # Simulate user input
    result2 = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_HARBOR_ID: MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]},
    )
    await hass.async_block_till_done()

    assert result2 is not None
    assert result2["type"] == FlowResultType.CREATE_ENTRY
    assert result2["title"] == MOCK_PORT_DATA["nom_port"]
    assert result2["data"] == {
        CONF_HARBOR_ID: MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID],
    }
    # Check if the client was called
    mock_shom_client.get_port_info.assert_called_once_with(
        MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]
    )


async def test_async_step_user_invalid_port(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test user initiated flow with an invalid port ID."""
    # Mock the ShomClient to raise an error for an invalid port
    mock_shom_client.get_port_info.side_effect = CannotConnect("Simulated connection error")

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "user"

    result2 = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_HARBOR_ID: "INVALID_PORT"},
    )
    await hass.async_block_till_done()

    assert result2["type"] == FlowResultType.FORM
    assert result2["step_id"] == "user"
    assert result2["errors"] == {"base": "cannot_connect"}
    mock_shom_client.get_port_info.assert_called_once_with("INVALID_PORT")


async def test_async_step_user_api_error(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test user initiated flow with a general API error."""
    mock_shom_client.get_port_info.side_effect = Exception("API unavailable")

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] == FlowResultType.FORM

    result2 = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {CONF_HARBOR_ID: MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]},
    )
    await hass.async_block_till_done()

    assert result2["type"] == FlowResultType.FORM
    assert result2["errors"] == {"base": "unknown"}
    mock_shom_client.get_port_info.assert_called_once_with(
        MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]
    )


async def test_async_step_user_already_configured(
    hass: HomeAssistant, mock_shom_client: AsyncMock
) -> None:
    """Test user initiated flow when the port is already configured."""
    # Setup an existing entry
    with patch(
        "custom_components.marees_france.async_setup_entry", return_value=True
    ):
        # Initial successful flow
        result = await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_USER},
            data=MOCK_CONFIG_ENTRY_DATA,
        )
        assert result["type"] == FlowResultType.CREATE_ENTRY
        await hass.async_block_till_done()

    # Try to configure the same port again
    result2 = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result2["type"] == FlowResultType.FORM
    assert result2["step_id"] == "user"

    result3 = await hass.config_entries.flow.async_configure(
        result2["flow_id"],
        {CONF_HARBOR_ID: MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]},
    )
    await hass.async_block_till_done()

    assert result3["type"] == FlowResultType.ABORT
    assert result3["reason"] == "already_configured"
    # Ensure get_port_info was called for the first setup, but not for the second attempt before abort
    mock_shom_client.get_port_info.assert_called_once_with(
        MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]
    )

# Placeholder for options flow tests if the integration implements it.
# For now, we assume no options flow. If an options flow is added to
# marees_france, tests for it should be added here.
#
# async def test_options_flow_init(hass: HomeAssistant, mock_shom_client: AsyncMock) -> None:
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
# async def test_options_flow_submit_success(hass: HomeAssistant, mock_shom_client: AsyncMock) -> None:
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
# async def test_options_flow_validation_error(hass: HomeAssistant, mock_shom_client: AsyncMock) -> None:
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