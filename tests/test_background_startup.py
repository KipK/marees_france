"""Exercise real setup and background fetching, without masking coordinator I/O."""

import asyncio
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

import aiohttp
import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import CoreState
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.marees_france import (
    _get_device_and_harbor_id,
    async_migrate_entry,
)
from custom_components.marees_france.api_helpers import (
    _async_fetch,
    _async_fetch_and_store_water_level,
    _async_fetch_and_store_water_temp,
    _async_merge_harbor_cache,
)
from custom_components.marees_france.availability import ServiceUnavailable
from custom_components.marees_france.const import (
    COEFF_STORAGE_KEY,
    CONF_HARBOR_ID,
    CONF_HARBOR_LAT,
    CONF_HARBOR_LON,
    CONF_HARBOR_MIN_DEPTH,
    CONF_HARBOR_NAME,
    CONF_HARBOR_TIMEZONE,
    DOMAIN,
    HARBORMINDEPTH_STORAGE_KEY,
    HEADERS,
    SERVICE_REINITIALIZE_HARBOR_DATA,
    TIDES_STORAGE_KEY,
    WATERLEVELS_STORAGE_KEY,
    WATERTEMP_STORAGE_KEY,
)
from custom_components.marees_france.coordinator import MareesFranceUpdateCoordinator

TODAY = "2026-10-22"
ENTRY_DATA = {
    CONF_HARBOR_ID: "BREST",
    CONF_HARBOR_NAME: "Brest",
    CONF_HARBOR_LAT: 48.38,
    CONF_HARBOR_LON: -4.5,
    CONF_HARBOR_TIMEZONE: "Europe/Paris",
    CONF_HARBOR_MIN_DEPTH: 2.5,
}
STORE_KEYS = (
    TIDES_STORAGE_KEY,
    COEFF_STORAGE_KEY,
    WATERLEVELS_STORAGE_KEY,
    WATERTEMP_STORAGE_KEY,
    HARBORMINDEPTH_STORAGE_KEY,
)


@pytest.fixture(autouse=True)
def mock_all_network_requests():
    """Override legacy global sleep/socket mocks; each test controls its I/O."""
    yield


@pytest.fixture(autouse=True)
def reduce_timeouts():
    """Run the real coordinator refresh and timers."""
    yield


@pytest.fixture(autouse=True)
def expected_lingering_timers():
    """Cleanup is part of the contract under test."""
    return False


@pytest.fixture(autouse=True)
def reference_time(freezer):
    freezer.move_to(f"{TODAY} 12:15:00+00:00")


@pytest.fixture
def entry(hass):
    entry = MockConfigEntry(domain=DOMAIN, data=ENTRY_DATA, version=3)
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
async def coordinator(hass, entry):
    stores = [Store(hass, 1, key) for key in STORE_KEYS]
    coordinator = MareesFranceUpdateCoordinator(hass, entry, *stores)
    yield coordinator
    await coordinator.async_shutdown()


def response_for(url):
    """Return the API's actual wire shapes for each requested date range."""
    query = parse_qs(urlparse(url).query)
    start = date.fromisoformat(query.get("date", [TODAY])[0])
    if "/hlt?" in url:
        return {
            (start + timedelta(days=i)).isoformat(): [
                ["tide.high", "02:00", "7.5", "80"],
                ["tide.low", "08:00", "1.5", "---"],
                ["tide.high", "16:00", "7.6", "81"],
                ["tide.low", "22:00", "1.4", "---"],
            ]
            for i in range(int(query["duration"][0]))
        }
    if "/coeff?" in url:
        return [[["80", "81"] for _ in range(int(query["duration"][0]))]]
    if "/wl?" in url:
        return {start.isoformat(): [["00:00:00", "2.0"], ["23:55:00", "7.0"]]}
    return {
        "contenu": {
            "previs": {
                "detail": [
                    {
                        "datetime": f"{(start + timedelta(days=i)).isoformat()}T00:00:00Z",
                        "teau": 15.5,
                    }
                    for i in range(7)
                ]
            }
        }
    }


async def successful_fetch(**kwargs):
    return response_for(kwargs["url"])


async def finish_fetches(coordinator):
    """Wait explicitly; HA's startup waiter must ignore these tasks."""
    await asyncio.gather(*list(coordinator._fetch_tasks.values()))


@pytest.mark.parametrize("cached", [False, True])
async def test_home_assistant_starts_while_requests_are_pending(hass, entry, cached):
    """Neither entity addition nor the initial fetch may join the startup barrier."""
    hass.set_state(CoreState.not_running)
    if cached:
        tides = response_for(f"https://example/hlt?date={TODAY}&duration=1")
        await Store(hass, 1, TIDES_STORAGE_KEY).async_save({"BREST": tides})
    entered = asyncio.Event()
    release = asyncio.Event()

    async def pending_fetch(**kwargs):
        entered.set()
        await release.wait()
        return response_for(kwargs["url"])

    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=pending_fetch,
    ):
        async with asyncio.timeout(5):
            assert await hass.config_entries.async_setup(entry.entry_id)
            await entered.wait()
            await hass.async_start()
            await hass.async_block_till_done()
        assert hass.state is CoreState.running
        assert entry.state is ConfigEntryState.LOADED
        coordinator = hass.data[DOMAIN][entry.entry_id]
        assert not coordinator._fetch_tasks["tides"].done()
        entity_id = er.async_get(hass).async_get_entity_id(
            "sensor", DOMAIN, f"{DOMAIN}_brest_next"
        )
        assert entity_id is not None
        assert (hass.states.get(entity_id).state != "unavailable") is cached

        release.set()
        await finish_fetches(coordinator)
        assert hass.states.get(entity_id).state != "unavailable"
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize(
    "offline", [{"SHOM"}, {"Meteoconsult"}, {"SHOM", "Meteoconsult"}]
)
async def test_outages_and_automatic_recovery(hass, coordinator, offline):
    """One provider's failure leaves the other usable; retries clear notifications."""
    outage = set(offline)

    async def fetch(**kwargs):
        provider = "Meteoconsult" if "meteoconsult" in kwargs["url"] else "SHOM"
        if provider in outage:
            raise ServiceUnavailable("Service is offline")
        return response_for(kwargs["url"])

    with (
        patch(
            "custom_components.marees_france.api_helpers._async_fetch",
            side_effect=fetch,
        ),
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_create"
        ) as create,
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_dismiss"
        ) as dismiss,
        patch(
            "custom_components.marees_france.coordinator.async_call_later"
        ) as schedule,
    ):
        coordinator.async_start_fetching()
        await finish_fetches(coordinator)
        assert ("next_data" in coordinator.data) is ("SHOM" not in offline)
        assert ("water_temp_data" in coordinator.data) is (
            "Meteoconsult" not in offline
        )
        assert {call.kwargs["notification_id"] for call in create.call_args_list} == {
            f"{DOMAIN}_{provider.lower()}_unavailable" for provider in offline
        }
        # A successful coefficient request must not clear failed SHOM tide/level requests.
        if "SHOM" in offline:
            coordinator._availability.async_update(
                coordinator.config_entry.entry_id, "BREST", "coefficients", "SHOM", True
            )
            dismiss.assert_not_called()

        retry_callbacks = [
            call.args[2] for call in schedule.call_args_list if call.args[1] <= 30
        ]
        assert retry_callbacks
        outage.clear()
        for callback in retry_callbacks:
            callback(None)
        await finish_fetches(coordinator)
        assert "next_data" in coordinator.data
        assert "water_temp_data" in coordinator.data
        assert {call.args[1] for call in dismiss.call_args_list} == {
            f"{DOMAIN}_{provider.lower()}_unavailable" for provider in offline
        }


async def test_cache_survives_outage_and_repeated_failures_do_not_spam(
    hass, coordinator
):
    tides = response_for(f"https://example/hlt?date={TODAY}&duration=1")
    tides["broken"] = "invalid"
    await coordinator.tides_store.async_save({"BREST": tides})
    with (
        patch(
            "custom_components.marees_france.api_helpers._async_fetch",
            side_effect=ServiceUnavailable("offline"),
        ),
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_create"
        ) as create,
        patch(
            "custom_components.marees_france.coordinator.async_call_later"
        ) as schedule,
    ):
        coordinator._fetching = True
        for _ in range(7):
            await coordinator._async_refresh_source("tides")
        create.assert_called_once()
        delays = [call.args[1] for call in schedule.call_args_list]
        assert 24 <= delays[0] <= 30
        assert all(0 < delay <= 300 for delay in delays)
        assert delays[-1] >= 240
        assert "next_data" in coordinator.data
        assert await coordinator.tides_store.async_load() == {"BREST": tides}


async def test_unload_cancels_pending_requests_and_retries(hass, entry):
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def blocked_fetch(**kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=blocked_fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        coordinator = hass.data[DOMAIN][entry.entry_id]
        await entered.wait()
        tasks = list(coordinator._fetch_tasks.values())
        assert await hass.config_entries.async_unload(entry.entry_id)
        assert cancelled.is_set()
        assert all(task.done() for task in tasks)
        assert not coordinator._fetch_tasks
        assert not coordinator._fetch_timers


async def test_legacy_migration_is_offline(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_HARBOR_ID: "BREST"}, version=1)
    entry.add_to_hass(hass)
    with patch(
        "custom_components.marees_france.fetch_harbors",
        side_effect=AssertionError("Network during migration"),
    ):
        assert await async_migrate_entry(hass, entry)
    assert entry.version == 3
    assert entry.data[CONF_HARBOR_NAME] == "BREST"


async def test_notifications_keep_other_harbors_failures(hass, coordinator):
    availability = coordinator._availability
    with (
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_create"
        ) as create,
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_dismiss"
        ) as dismiss,
    ):
        availability.async_update("one", "Brest", "tides", "SHOM", False)
        availability.async_update("two", "Lorient", "tides", "SHOM", False)
        availability.async_remove_entry("one")
        assert "Lorient" in create.call_args.args[1]
        dismiss.assert_not_called()
        availability.async_update("two", "Lorient", "tides", "SHOM", True)
        dismiss.assert_called_once_with(hass, f"{DOMAIN}_shom_unavailable")


async def test_parallel_cache_writes_preserve_other_harbors(hass, coordinator):
    store = coordinator.tides_store
    await asyncio.gather(
        _async_merge_harbor_cache(hass, store, {}, "BREST", {TODAY: ["one"]}),
        _async_merge_harbor_cache(
            hass, Store(hass, 1, TIDES_STORAGE_KEY), {}, "LORIENT", {TODAY: ["two"]}
        ),
    )
    assert await store.async_load() == {
        "BREST": {TODAY: ["one"]},
        "LORIENT": {TODAY: ["two"]},
    }


@pytest.mark.parametrize(
    "error",
    [TimeoutError(), aiohttp.ClientConnectionError(), ValueError("Invalid JSON")],
)
async def test_network_failure_is_one_bounded_attempt(error):
    response = MagicMock()
    response.json = AsyncMock(side_effect=error)
    session = MagicMock()
    session.get.return_value.__aenter__ = AsyncMock(return_value=response)
    session.get.return_value.__aexit__ = AsyncMock(return_value=None)
    with (
        patch("custom_components.marees_france.api_helpers.API_REQUEST_DELAY", 0),
        pytest.raises(ServiceUnavailable),
    ):
        await _async_fetch(session, "https://example.test", {}, 1, "BREST", "tides")
    session.get.assert_called_once()


async def test_water_temperature_uses_android_user_agent(hass):
    """The Android endpoint rejects the browser headers accepted by SHOM."""
    original_headers = dict(HEADERS)
    response = MagicMock()
    response.json = AsyncMock(return_value=response_for("https://example.test"))

    def get_response(url, *, headers):
        if headers.get("User-Agent") != "okhttp/4.12.0":
            response.raise_for_status.side_effect = aiohttp.ClientResponseError(
                MagicMock(), (), status=403, message="Forbidden"
            )
        else:
            response.raise_for_status.side_effect = None
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=response)
        context.__aexit__ = AsyncMock(return_value=None)
        return context

    session = MagicMock()
    session.get.side_effect = get_response
    store = Store(hass, 1, WATERTEMP_STORAGE_KEY)
    cache = {}
    with patch("custom_components.marees_france.api_helpers.API_REQUEST_DELAY", 0):
        assert await _async_fetch_and_store_water_temp(
            hass, store, cache, "BREST", "48.38", "-4.5", session
        )

    assert len(cache["BREST"]) == 7
    assert cache["BREST"][TODAY][0]["temp"] == 15.5
    assert await store.async_load() == cache
    assert HEADERS == original_headers
    session.get.assert_called_once()
    assert session.get.call_args.kwargs["headers"]["Referer"] == HEADERS["Referer"]


async def test_storage_failure_is_not_reported_as_service_outage(hass, coordinator):
    with (
        patch(
            "custom_components.marees_france.api_helpers._async_fetch",
            side_effect=successful_fetch,
        ),
        patch.object(
            coordinator.tides_store, "async_save", side_effect=OSError("Disk full")
        ),
        patch(
            "custom_components.marees_france.availability.persistent_notification.async_create"
        ) as create,
    ):
        coordinator._fetching = True
        await coordinator._async_refresh_source("tides")
        create.assert_not_called()
        assert "tides" in coordinator._fetch_timers


async def test_real_retry_timer_recovers_and_removes_notification(hass, coordinator):
    """Exercise the actual HA timer and persistent-notification implementations."""
    coordinator._fetching = True
    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=ServiceUnavailable("offline"),
    ):
        await coordinator._async_refresh_source("water temperature")
    notification_id = f"{DOMAIN}_meteoconsult_unavailable"
    assert notification_id in hass.data["persistent_notification"]
    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=successful_fetch,
    ) as fetch:
        async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=31))
        await hass.async_block_till_done(wait_background_tasks=True)
        assert fetch.call_count == 1
        assert "water_temp_data" in coordinator.data
        assert notification_id not in hass.data["persistent_notification"]


async def test_water_level_requests_are_shared(hass, coordinator):
    """A card request racing with prefetch must reuse the completed cache write."""
    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=successful_fetch,
    ) as fetch:
        results = await asyncio.gather(
            *(
                _async_fetch_and_store_water_level(
                    hass, coordinator.water_level_store, {}, "BREST", TODAY
                )
                for _ in range(2)
            )
        )
    assert results[0] == results[1]
    fetch.assert_called_once()


async def test_metadata_enrichment_does_not_reload_entry(hass, entry):
    """Legacy entries enrich their metadata after setup without cancelling workers."""
    legacy_data = {CONF_HARBOR_ID: "BREST", CONF_HARBOR_MIN_DEPTH: 2.5}
    hass.config_entries.async_update_entry(entry, data=legacy_data)
    with (
        patch(
            "custom_components.marees_france.fetch_harbors",
            return_value={
                "BREST": {
                    "name": "Brest",
                    "lat": 48.38,
                    "lon": -4.5,
                    "timezone": "Europe/Paris",
                }
            },
        ),
        patch(
            "custom_components.marees_france.api_helpers._async_fetch",
            side_effect=successful_fetch,
        ),
        patch.object(hass.config_entries, "async_reload") as reload_entry,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        coordinator = hass.data[DOMAIN][entry.entry_id]
        await finish_fetches(coordinator)
        await hass.async_block_till_done()
        assert entry.data[CONF_HARBOR_LAT] == 48.38
        assert entry.state is ConfigEntryState.LOADED
        assert "water_temp_data" in coordinator.data
        reload_entry.assert_not_called()
        assert await hass.config_entries.async_unload(entry.entry_id)


async def test_reinitialize_restarts_background_fetches(hass, entry):
    """Reinitialization cancels old requests and returns while new ones are pending."""
    entered = asyncio.Event()

    async def blocked_fetch(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    with patch(
        "custom_components.marees_france.api_helpers._async_fetch",
        side_effect=blocked_fetch,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        coordinator = hass.data[DOMAIN][entry.entry_id]
        await entered.wait()
        await coordinator.tides_store.async_save({"OTHER": {TODAY: []}})
        tasks = list(coordinator._fetch_tasks.values())
        device = dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)[
            0
        ]
        async with asyncio.timeout(5):
            await hass.services.async_call(
                DOMAIN,
                SERVICE_REINITIALIZE_HARBOR_DATA,
                {"device_id": device.id},
                blocking=True,
            )
        assert all(task.done() for task in tasks)
        assert not coordinator._fetch_tasks["tides"].done()
        assert await coordinator.tides_store.async_load() == {"OTHER": {TODAY: []}}
        assert await hass.config_entries.async_unload(entry.entry_id)


@pytest.mark.parametrize("modern_api", [False, True])
async def test_device_lookup_supports_old_and_new_home_assistant(
    hass, entry, modern_api
):
    """Preserve the upstream API fix and compatibility with older HA versions."""
    device = (
        SimpleNamespace(config_entry_id=entry.entry_id)
        if modern_api
        else SimpleNamespace(config_entries={entry.entry_id})
    )
    registry = MagicMock()
    registry.async_get.return_value = device
    with patch("custom_components.marees_france.dr.async_get", return_value=registry):
        assert await _get_device_and_harbor_id(hass, "device-id") == ("BREST", entry)
