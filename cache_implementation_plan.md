# Plan: Implement Persistent Caching for SHOM Tide Data

This plan outlines the implementation of a persistent caching mechanism for daily tide data fetched from the SHOM API within the `marees_france` Home Assistant integration. The cache will use `hass.helpers.storage.Store` for persistence across restarts and will automatically prune data for past days.

## Revised Plan Details

1.  **No Separate Cache Module:** The caching logic will reside directly within the `MareesFranceUpdateCoordinator` in `custom_components/marees_france/coordinator.py`.
2.  **Integrate `hass.helpers.storage.Store`:**
    *   Import `Store` from `homeassistant.helpers.storage`.
    *   Define constants: `STORAGE_KEY = "marees_france_daily_tides_cache"` and `STORAGE_VERSION = 1`.
    *   Initialize the store in `__init__`: `self.store = Store(hass, STORAGE_VERSION, STORAGE_KEY)`.
    *   Modify `_async_update_data`:
        1.  **Load Cache:** `cached_data = await self.store.async_load() or {}`.
        2.  **Prune Cache:**
            *   Get `today_date = date.today()`.
            *   Identify keys to remove (`date.fromisoformat(key) < today_date`).
            *   If keys are removed, delete them from `cached_data` and set `needs_save = True`.
        3.  **Check Cache:** Check if `today_str = today_date.strftime(DATE_FORMAT)` exists in `cached_data`.
        4.  **Cache Hit:**
            *   If `today_str` exists:
                *   Log hit.
                *   If `needs_save` is `True`, call `await self.store.async_save(cached_data)`.
                *   Return `cached_data[today_str]`.
        5.  **Cache Miss:**
            *   If `today_str` does not exist:
                *   Log miss.
                *   Fetch data from API.
                *   Parse data (`parsed_data`).
                *   Add to cache: `cached_data[today_str] = parsed_data`.
                *   Save updated cache: `await self.store.async_save(cached_data)`.
                *   Return `parsed_data`.

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Coordinator
    participant Store as hass.helpers.storage.Store
    participant API as SHOM API

    Coordinator->>Coordinator: _async_update_data() called
    Coordinator->>Store: async_load()
    Store-->>Coordinator: cached_data (dict) or {}
    Coordinator->>Coordinator: Prune cached_data (remove keys < today)
    alt Pruning occurred
        Coordinator->>Coordinator: Mark cache as needs_save = True
    else No pruning
        Coordinator->>Coordinator: Mark cache as needs_save = False
    end
    Coordinator->>Coordinator: Get today's date string (today_str)
    alt Cache Hit (today_str in cached_data)
        Coordinator->>Coordinator: Log cache hit
        opt needs_save is True
             Coordinator->>Store: async_save(pruned_cached_data)
             Store-->>Coordinator: Save confirmation
        end
        Coordinator->>Coordinator: Return cached_data[today_str]
    else Cache Miss (today_str not in cached_data)
        Coordinator->>Coordinator: Log cache miss
        Coordinator->>API: GET /tides?date={today_str}
        API-->>Coordinator: Raw JSON data
        Coordinator->>Coordinator: _parse_tide_data(raw_data)
        Coordinator-->>Coordinator: parsed_data
        Coordinator->>Coordinator: Add to cache: cached_data[today_str] = parsed_data
        Coordinator->>Store: async_save(updated_cached_data)
        Store-->>Coordinator: Save confirmation
        Coordinator->>Coordinator: Return parsed_data
    end