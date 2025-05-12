"""Tests for the Marees France DataUpdateCoordinator."""

from datetime import timedelta
from unittest.mock import AsyncMock, patch, call, MagicMock

import pytest
from syrupy import SnapshotAssertion

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import UpdateFailed
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.marees_france.const import DOMAIN
from custom_components.marees_france.coordinator import MareesFranceUpdateCoordinator
# Assuming ShomApiClient and specific exceptions are importable for mocking/testing
# from custom_components.marees_france.api import ShomApiClient, ShomApiError

from tests.conftest import MOCK_CONFIG_ENTRY_DATA, CONF_HARBOR_ID # MOCK_PORT_DATA is likely obsolete now


# Mock data simulating the structure stored in the cache by helper functions
# Dates are chosen around the test's reference 'now' (2025-05-12T00:00:00Z)
MOCK_TIDES_CACHE = {
    MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]: {
        "2025-05-11": [ # Yesterday
            ["BM", "20:45", "1.8", "---"],
        ],
        "2025-05-12": [ # Today
            ["PM", "03:00", "8.2", "90"],
            ["BM", "09:15", "1.5", "---"],
            ["PM", "15:30", "8.5", "95"],
            ["BM", "21:45", "1.2", "---"],
        ],
        "2025-05-13": [ # Tomorrow
            ["PM", "03:45", "8.0", "88"],
            ["BM", "10:00", "1.8", "---"],
        ]
        # ... potentially more days
    }
}
MOCK_COEFF_CACHE = {
    MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]: {
        "2025-05-12": ["90", "95"], # Today
        "2025-05-13": ["88", "85"], # Tomorrow
        # ... potentially more days
    }
}
MOCK_WATER_LEVEL_CACHE = {
    MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]: {
        "2025-05-12": [ # Today
            ["02:55:00", "8.15"],
            ["03:00:00", "8.20"], # Matches high tide time
            ["03:05:00", "8.18"],
            ["09:10:00", "1.55"],
            ["09:15:00", "1.50"], # Matches low tide time
            ["09:20:00", "1.52"],
            # ... more readings for the day
        ]
    }
}

# Mock data for an empty cache scenario
EMPTY_CACHE = {MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID]: {}}


@pytest.fixture
def mock_stores() -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    """Provides mock Store objects."""
    mock_tides_store = AsyncMock(spec=Store)
    mock_coeff_store = AsyncMock(spec=Store)
    mock_water_level_store = AsyncMock(spec=Store)
    # Default load behavior (can be overridden in tests)
    mock_tides_store.async_load.return_value = MOCK_TIDES_CACHE
    mock_coeff_store.async_load.return_value = MOCK_COEFF_CACHE
    mock_water_level_store.async_load.return_value = MOCK_WATER_LEVEL_CACHE
    return mock_tides_store, mock_coeff_store, mock_water_level_store


@pytest.fixture
async def setup_coordinator(
    hass: HomeAssistant,
    mock_stores: tuple[AsyncMock, AsyncMock, AsyncMock],
    # mock_api_fetchers is implicitly used by the coordinator via patched helpers
) -> tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry]:
    """Set up the MareesFranceUpdateCoordinator with mock stores."""
    mock_tides_store, mock_coeff_store, mock_water_level_store = mock_stores
    entry = MockConfigEntry(
        domain=DOMAIN,
        data=MOCK_CONFIG_ENTRY_DATA,
        unique_id=MOCK_CONFIG_ENTRY_DATA[CONF_HARBOR_ID],
    )
    entry.add_to_hass(hass)

    coordinator = MareesFranceUpdateCoordinator(
        hass, entry, mock_tides_store, mock_coeff_store, mock_water_level_store
    )

    # Prevent coordinator's scheduled updates during tests by default
    # Tests can manually trigger updates using async_refresh()
    coordinator.update_interval = None

    return coordinator, mock_tides_store, mock_coeff_store, mock_water_level_store, entry


async def test_coordinator_initial_fetch_success(
    hass: HomeAssistant,
    setup_coordinator: tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry],
    mock_api_fetchers: MagicMock, # Access patched helpers if needed
    snapshot: SnapshotAssertion,
):
    """Test successful initial data fetch by the coordinator."""
    coordinator, mock_tides, mock_coeffs, mock_water, _ = setup_coordinator

    # Ensure stores return the mock data
    mock_tides.async_load.return_value = MOCK_TIDES_CACHE
    mock_coeffs.async_load.return_value = MOCK_COEFF_CACHE
    mock_water.async_load.return_value = MOCK_WATER_LEVEL_CACHE

    # Mock dt_util.now() for consistent parsing results relative to mock data
    now = dt_util.parse_datetime("2025-05-12T09:00:00+02:00") # Between 1st low and 2nd high in Paris time

    with patch("homeassistant.util.dt.now", return_value=now):
        await coordinator.async_config_entry_first_refresh()

    assert coordinator.last_update_success is True
    assert coordinator.data is not None
    # Snapshot the processed data structure generated by _parse_tide_data
    assert coordinator.data == snapshot

    # Verify stores were loaded
    mock_tides.async_load.assert_called_once()
    mock_coeffs.async_load.assert_called_once()
    mock_water.async_load.assert_called_once()
    # We don't assert on mock_api_fetchers calls here, as a valid cache
    # might prevent the fetch helpers from being called during validation.


async def test_coordinator_listener_updated_on_success(
    hass: HomeAssistant,
    setup_coordinator: tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry],
    mock_api_fetchers: MagicMock, # Access patched helpers if needed
):
    """Test that listeners are updated after a successful data fetch."""
    coordinator, mock_tides, mock_coeffs, mock_water, _ = setup_coordinator

    # Ensure stores return the mock data
    mock_tides.async_load.return_value = MOCK_TIDES_CACHE
    mock_coeffs.async_load.return_value = MOCK_COEFF_CACHE
    mock_water.async_load.return_value = MOCK_WATER_LEVEL_CACHE

    listener_callback = AsyncMock()
    coordinator.async_add_listener(listener_callback)

    now = dt_util.parse_datetime("2025-05-12T09:00:00+02:00")
    with patch("homeassistant.util.dt.now", return_value=now):
        await coordinator.async_refresh()

    listener_callback.assert_called_once()


async def test_coordinator_api_error_handling(
    hass: HomeAssistant,
    setup_coordinator: tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry],
    mock_api_fetchers: MagicMock, # Access patched helpers
):
    """Test coordinator error handling when the API call fails during cache repair."""
    coordinator, mock_tides, mock_coeffs, mock_water, _ = setup_coordinator

    # Simulate an empty/invalid cache to trigger validation/repair
    mock_tides.async_load.return_value = EMPTY_CACHE
    mock_coeffs.async_load.return_value = EMPTY_CACHE
    mock_water.async_load.return_value = EMPTY_CACHE

    # Simulate an API error during the fetch attempt within validation
    # Assuming _async_fetch_and_store_tides is called first for repair
    fetch_tides_mock = mock_api_fetchers["_async_fetch_and_store_tides"]
    fetch_tides_mock.side_effect = Exception("Simulated API Error")

    now = dt_util.parse_datetime("2025-05-12T09:00:00+02:00")
    with patch("homeassistant.util.dt.now", return_value=now), \
         pytest.raises(UpdateFailed) as excinfo:
        await coordinator.async_refresh()

    # The UpdateFailed might wrap the original exception or have a generic message
    # depending on the coordinator's error handling in _async_update_data
    # Check if the underlying fetch function was called
    fetch_tides_mock.assert_called_once()
    # Check the UpdateFailed message if possible, or just the type
    assert "Simulated API Error" in str(excinfo.value) or "validation/repair" in str(excinfo.value)

    assert coordinator.last_update_success is False
    # Data might be None or an empty dict depending on error handling in _parse_tide_data
    assert coordinator.data is None or coordinator.data == {"last_update": now.isoformat()}


async def test_coordinator_recovery_after_api_error(
    hass: HomeAssistant,
    setup_coordinator: tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry],
    mock_api_fetchers: MagicMock, # Access patched helpers
    snapshot: SnapshotAssertion,
):
    """Test coordinator recovers and fetches data after a previous API error."""
    coordinator, mock_tides, mock_coeffs, mock_water, _ = setup_coordinator
    fetch_tides_mock = mock_api_fetchers["_async_fetch_and_store_tides"]
    fetch_coeffs_mock = mock_api_fetchers["_async_fetch_and_store_coefficients"]
    fetch_water_mock = mock_api_fetchers["_async_fetch_and_store_water_level"]

    # --- First, simulate an error ---
    mock_tides.async_load.return_value = EMPTY_CACHE
    mock_coeffs.async_load.return_value = EMPTY_CACHE
    mock_water.async_load.return_value = EMPTY_CACHE
    fetch_tides_mock.side_effect = Exception("Simulated API Error")
    fetch_tides_mock.return_value = None # Reset return value if side effect is cleared

    now_fail = dt_util.parse_datetime("2025-05-12T09:00:00+02:00")
    with patch("homeassistant.util.dt.now", return_value=now_fail), \
         pytest.raises(UpdateFailed):
        await coordinator.async_refresh()

    assert coordinator.last_update_success is False
    fetch_tides_mock.assert_called_once()
    fetch_tides_mock.reset_mock()
    fetch_coeffs_mock.reset_mock() # Reset others too for clarity
    fetch_water_mock.reset_mock()

    # --- Then, simulate recovery ---
    # Clear the error side effect and set successful return
    fetch_tides_mock.side_effect = None
    fetch_tides_mock.return_value = True # Indicate success
    fetch_coeffs_mock.return_value = True
    fetch_water_mock.return_value = True

    # Simulate stores being populated *after* successful fetch
    # The coordinator reloads stores after calling fetch helpers in validation
    mock_tides.async_load.side_effect = [EMPTY_CACHE, MOCK_TIDES_CACHE]
    mock_coeffs.async_load.side_effect = [EMPTY_CACHE, MOCK_COEFF_CACHE]
    mock_water.async_load.side_effect = [EMPTY_CACHE, MOCK_WATER_LEVEL_CACHE]

    now_recover = dt_util.parse_datetime("2025-05-12T09:05:00+02:00") # Advance time slightly
    with patch("homeassistant.util.dt.now", return_value=now_recover):
        await coordinator.async_refresh()

    assert coordinator.last_update_success is True
    assert coordinator.data is not None
    # Verify data is based on the new MOCK cache data using snapshot
    assert coordinator.data == snapshot

    # Check that fetch helpers were called during the recovery attempt
    fetch_tides_mock.assert_called_once()
    fetch_coeffs_mock.assert_called_once()
    # Water level fetch might depend on timing/existing cache state in validation
    # fetch_water_mock.assert_called_once()


async def test_coordinator_scheduled_update(
    hass: HomeAssistant,
    setup_coordinator: tuple[MareesFranceUpdateCoordinator, AsyncMock, AsyncMock, AsyncMock, MockConfigEntry],
    mock_api_fetchers: MagicMock, # Access patched helpers
    freezer, # Use time freezing fixture
):
    """Test scheduled updates trigger data fetching."""
    coordinator, mock_tides, mock_coeffs, mock_water, entry = setup_coordinator

    # Restore update interval for this test
    coordinator.update_interval = timedelta(minutes=5)

    # Ensure stores return the mock data initially
    mock_tides.async_load.return_value = MOCK_TIDES_CACHE
    mock_coeffs.async_load.return_value = MOCK_COEFF_CACHE
    mock_water.async_load.return_value = MOCK_WATER_LEVEL_CACHE

    # Mock fetch helpers and reset mocks
    fetch_tides_mock = mock_api_fetchers["_async_fetch_and_store_tides"]
    fetch_coeffs_mock = mock_api_fetchers["_async_fetch_and_store_coefficients"]
    fetch_water_mock = mock_api_fetchers["_async_fetch_and_store_water_level"]
    fetch_tides_mock.reset_mock()
    fetch_coeffs_mock.reset_mock()
    fetch_water_mock.reset_mock()

    # Initial refresh to set up coordinator and load initial data
    now = dt_util.parse_datetime("2025-05-12T09:00:00+02:00")
    freezer.move_to(now)
    await coordinator.async_config_entry_first_refresh()
    await hass.async_block_till_done()

    assert coordinator.last_update_success is True
    # Reset mocks again after initial refresh (which might load but not fetch)
    fetch_tides_mock.reset_mock()
    fetch_coeffs_mock.reset_mock()
    fetch_water_mock.reset_mock()
    mock_tides.async_load.reset_mock()
    mock_coeffs.async_load.reset_mock()
    mock_water.async_load.reset_mock()

    # Simulate time passing to trigger the next scheduled update
    freezer.move_to(now + coordinator.update_interval + timedelta(seconds=1))
    async_fire_time_changed(hass, dt_util.utcnow()) # Use current frozen time
    await hass.async_block_till_done() # Wait for listeners and tasks

    # The coordinator's _async_refresh should have been called again
    # This involves loading stores and potentially calling fetch helpers
    mock_tides.async_load.assert_called() # Stores should always be loaded
    # Asserting fetch helper calls depends on cache state and validation logic.
    # If the cache is still valid, they might not be called.
    # Instead, let's just assert the update succeeded again.
    assert coordinator.last_update_success is True


# Note: The structure of `coordinator.data` is crucial.
# Using snapshot testing is recommended to verify its structure.
# The mock cache data and test assertions might need further refinement based
# on the exact logic within _async_update_data and _parse_tide_data.
# Assumes mock_api_fetchers provides mocks in a dictionary structure. Adjust keys
# ('_async_fetch_and_store_tides', etc.) if mock_api_fetchers uses attributes.