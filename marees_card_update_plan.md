# Plan: Update Marees France Lovelace Card

**Goal:** Modify the card to fetch tide and water level data using service calls with `device_id` and update the configuration UI to use a device selector.

**Affected Files:**

1.  `custom_components/marees_france/frontend/marees-france-card.js` (Main card logic)
2.  `custom_components/marees_france/frontend/marees-france-card-editor.js` (Configuration UI)

---

## Phase 1: Modify `marees-france-card.js`

1.  **Update State Properties:**
    *   Add `_tideData: { state: true }` to store results from `get_tides_data`. Initialize to `null`.
    *   Potentially add a separate loading state for tide data, e.g., `_isTideLoading: { state: true }`.

2.  **Update `setConfig(config)`:**
    *   Change the check from `!config.entity` to `!config.device_id`.
    *   Update the error message key/text from `error_entity_required` to something like `error_device_required` (add this new key to the `translations` object).
    *   Store `config.device_id` instead of `config.entity`.
    *   Reset `_tideData` to `null` along with `_waterLevels`.
    *   Trigger initial fetches for both tide data and water levels (or handle in `updated`).

3.  **Implement `_fetchTideData()`:**
    *   Create a new async function `_fetchTideData`.
    *   Set `_isTideLoading = true`.
    *   Check if `this.hass` and `this.config.device_id` are available.
    *   Call `this.hass.callService('marees_france', 'get_tides_data', { device_id: this.config.device_id }, undefined, false, true)`.
    *   Store the `response` in `this._tideData`.
    *   Handle potential errors and set `_tideData = { error: ... }`.
    *   Set `_isTideLoading = false` in a `finally` block.
    *   Call `this.requestUpdate()`.

4.  **Modify `_fetchWaterLevels()`:**
    *   Remove the logic deriving `harborName` from `config.entity`.
    *   Update the `hass.callService` data payload to use `device_id: this.config.device_id` instead of `harbor_name: harborName`.
    *   Keep the `date: this._selectedDay` parameter.

5.  **Update `updated(changedProperties)`:**
    *   Trigger `_fetchTideData()` alongside `_fetchWaterLevels()` when `hass` becomes available or `config` changes, if `_tideData` is `null`.
    *   Ensure graph redraw logic considers both `_isLoading` (for water levels) and `_isTideLoading`. The graph should only draw when *both* fetches are complete and successful.

6.  **Adapt `getNextTideStatus(tideData, hass)`:**
    *   This function now receives `this._tideData.response` (the object keyed by date, containing arrays) instead of `entityState.attributes.data`.
    *   **Crucially, adapt the parsing logic:**
        *   Instead of accessing `tideData[dateStr].high_tides` and `low_tides`, iterate through the array `tideData[dateStr]`.
        *   For each item `[typeStr, timeStr, heightStr, coeffStr]` in the array:
            *   Determine `type` ('high' or 'low') from `typeStr` (e.g., `typeStr === 'tide.high'`).
            *   Extract `time`, `height`, `coefficient`.
            *   Construct the objects needed for sorting and finding the next/previous tides, similar to the existing logic but using the new array structure.

7.  **Adapt `_drawGraphWithSvgJs()`:**
    *   **Tide Markers:**
        *   Remove the access to `entityState.attributes.data`.
        *   Get tide events for the `_selectedDay` directly from `this._tideData.response[this._selectedDay]`.
        *   Iterate through the array `[typeStr, timeStr, heightStr, coeffStr]` for the selected day.
        *   Parse `type`, `time`, `height`, `coefficient` to create the `tideMarkers` array used for drawing arrows, text, and coefficient boxes.
    *   **Water Level Curve:** Continue using `this._waterLevels.response[this._selectedDay]` for the curve points (`levelsData`). This data comes from `get_water_levels`.
    *   **Error/Loading Handling:** Update the checks at the beginning to account for both `_waterLevels` and `_tideData` being loaded and valid before attempting to draw. Display appropriate messages if either fails.

8.  **Update `render()`:**
    *   Replace checks for `config.entity` and `entityState` with checks for `config.device_id`.
    *   Remove the direct access to `entityState.attributes.data`.
    *   Pass `this._tideData` (or its relevant part) to `getNextTideStatus`.
    *   Update loading indicators (`this._isLoading`) to potentially reflect the status of both fetches (e.g., show loading if either `_isLoading` or `_isTideLoading` is true).
    *   Display appropriate error/warning messages if `config.device_id` is missing, or if `_tideData` or `_waterLevels` fetches result in errors.

9.  **Update `getStubConfig()` (Optional but Recommended):**
    *   Change the stub config to return `{ device_id: "" }` or similar, instead of trying to find an entity.

10. **Add Translations:**
    *   Add new keys like `ui.card.marees_france.error_device_required` to the `translations` object for both 'en' and 'fr'.

---

## Phase 2: Modify `marees-france-card-editor.js`

*(Assuming standard LitElement structure for the editor)*

1.  **Import Device Picker:** Ensure `ha-device-picker` is available/imported if not already standard.
2.  **Update `render()` (or equivalent UI definition):**
    *   Replace the existing entity selector element (likely `<ha-entity-picker>`) with `<ha-device-picker>`.
    *   Set the `hass` property: `.hass=${this.hass}`.
    *   Set the `label`: `label="Harbor Device"` (or use localization).
    *   Set the `value`: `.value=${this._device_id}` (or however the editor stores the current value).
    *   Set the `deviceFilter` to limit selection to the `marees_france` integration: `.deviceFilter=${(device) => device.integration === 'marees_france'}`.
    *   Set the `includeDeviceEntities`: `includeDeviceEntities="false"` (We only need the device ID).
    *   Handle the change event (`@value-changed`) to update the internal state (`this._device_id`) and fire the configuration changed event.
3.  **Update Event Handling/Saving Logic:**
    *   Modify the function that fires the `config-changed` event (often called `_valueChanged` or similar).
    *   Ensure it reads the value from the device picker state (`this._device_id`).
    *   Ensure it saves the configuration object with the key `device_id`: `{ ...this._config, device_id: this._device_id }`. Remove the old `entity` key if present.
4.  **Update Initial Value Loading:**
    *   In the editor's `setConfig` (or equivalent), ensure it reads `config.device_id` to initialize the state (`this._device_id`) used by the picker, instead of `config.entity`.

---

## Phase 3: Review and Finalize

*(Steps 1-3 already completed)*

4.  **Proceed:** Request to switch to "Code" mode for implementation.

---