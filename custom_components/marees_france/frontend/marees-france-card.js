import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@^2.0.0/lit-element.js?module";
import { SVG } from "https://unpkg.com/@svgdotjs/svg.js@^3.0/dist/svg.esm.js";

// --- Embedded Translations ---
const translations = {
  en: {
    ui: { card: { marees_france: {
      default_title: "France Tides",
      missing_configuration: "Missing configuration",
      error_entity_required: "Missing entity, please configure the card first", // Kept for compatibility? Or remove? Let's keep for now, editor handles new config.
      error_device_required: "Missing device, please configure the card first",
      entity_not_found: "Entity not found: {entity}", // Keep for potential old configs?
      device_not_found: "Device not found: {device_id}",
      no_tide_data: "No tide data found for device.", // Updated message
      no_water_level_data: "No water level data found for device and date.", // Added message
      waiting_next_tide: "Waiting for next tide",
      rising_until: "Rising until {time} ({duration})",
      falling_until: "Falling until {time} ({duration})",
      high_tide_short: "High",
      low_tide_short: "Low",
      next_tide_at: "Next tide ({type}) at {time}",
      no_data_available: "Tide data unavailable",
      height: "Height",
      coefficient: "Coefficient",
      no_data_for_day: "No tide data for this day.",
      high_tide: "High",
      low_tide: "Low",
      tide_at_time: "{status} at {time}",
      chart_js_missing: "Error: Chart.js library not loaded. Please add it as a frontend resource in Home Assistant."
    }}}
  },
  fr: {
    ui: { card: { marees_france: {
      default_title: "Marées France",
      missing_configuration: "Configuration manquante",
      error_entity_required: "Entité manquante, veuillez d'abord configurer la carte", // Kept for compatibility? Or remove? Let's keep for now, editor handles new config.
      error_device_required: "Appareil manquant, veuillez d'abord configurer la carte",
      entity_not_found: "Entité non trouvée : {entity}", // Keep for potential old configs?
      device_not_found: "Appareil non trouvé : {device_id}",
      no_tide_data: "Aucune donnée de marée trouvée pour l'appareil.", // Updated message
      no_water_level_data: "Aucune donnée de niveau d'eau trouvée pour l'appareil et la date.", // Added message
      waiting_next_tide: "En attente de la prochaine marée",
      rising_until: "Monte jusqu'à {time} ({duration})",
      falling_until: "Descend jusqu'à {time} ({duration})",
      high_tide_short: "Haute",
      low_tide_short: "Basse",
      next_tide_at: "Prochaine marée ({type}) à {time}",
      no_data_available: "Données de marée non disponibles",
      height: "Hauteur",
      coefficient: "Coefficient",
      no_data_for_day: "Aucune donnée de marée pour ce jour.",
      high_tide: "Haute",
      low_tide: "Basse",
      tide_at_time: "{status} à {time}",
      chart_js_missing: "Erreur : Librairie Chart.js non chargée. Veuillez l'ajouter comme ressource frontend dans Home Assistant."
    }}}
  }
};

// --- Custom Localization Function ---
function localizeCard(key, hass, ...args) {
  const lang = hass?.language || 'en';
  const langTranslations = translations[lang] || translations.en; // Fallback to English
  let translated = key; // Default to key

  try {
    translated = key.split('.').reduce((o, i) => o[i], langTranslations) || key;
  } catch (e) {
    // Key not found, use the key itself
    translated = key;
  }

  // Replace placeholders like {entity}
  if (translated && args.length > 0) {
    for (let i = 0; i < args.length; i += 2) {
      const placeholder = `{${args[i]}}`;
      const value = args[i + 1];
      // Use a regex for global replacement to handle multiple occurrences
      translated = translated.replace(new RegExp(placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), value !== undefined ? value : '');
    }
  }
  return translated;
}


// Helper function to get localized weekday abbreviation
function getWeekdayShort(dayIndex, locale) {
    const date = new Date(2023, 0, 1 + dayIndex); // Use a known Sunday (Jan 1, 2023)
    return date.toLocaleDateString(locale, { weekday: 'short' });
}

// Returns data needed for the next tide peak display
// Returns data needed for the next tide peak display
// Adapts to the new service call format: { "YYYY-MM-DD": [ ["tide.type", "HH:MM", "H.HH", "CC"], ... ] }
function getNextTideStatus(tideServiceData, hass) {
  // Check if the main data object and the 'response' property exist
  if (!tideServiceData || !tideServiceData.response || !hass) return null;
  const tideData = tideServiceData.response; // Use the actual data within 'response'

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  // Look ahead 2 days to ensure we capture the next tide even if it's early tomorrow
  const tomorrowStr = new Date(new Date(now).setDate(now.getDate() + 1)).toISOString().slice(0, 10);
  const dayAfterTomorrowStr = new Date(new Date(now).setDate(now.getDate() + 2)).toISOString().slice(0, 10);

  // Helper function to parse the new array format for a given date
  const parseTidesForDate = (dateStr) => {
    if (!tideData[dateStr] || !Array.isArray(tideData[dateStr])) return [];
    return tideData[dateStr].map(tideArr => {
      if (!Array.isArray(tideArr) || tideArr.length < 3) return null; // Need at least type, time, height
      const typeStr = tideArr[0]; // "tide.high" or "tide.low"
      const time = tideArr[1]; // "HH:MM"
      const height = parseFloat(tideArr[2]); // "H.HH" -> number
      const coefficient = tideArr.length > 3 && tideArr[3] !== "---" ? parseInt(tideArr[3], 10) : null; // "CC" or "---" -> number or null
      const type = typeStr === 'tide.high' ? 'high' : (typeStr === 'tide.low' ? 'low' : null);

      if (!type || !time || isNaN(height)) return null; // Basic validation

      return {
        type: type,
        time: time,
        height: height,
        coefficient: coefficient,
        date: dateStr, // Add date for constructing dateTime
        dateTime: new Date(`${dateStr}T${time}:00`) // Construct Date object
      };
    }).filter(t => t !== null); // Remove invalid entries
  };

  // Parse tides for the relevant days
  const todayTides = parseTidesForDate(todayStr);
  const tomorrowTides = parseTidesForDate(tomorrowStr);
  const dayAfterTomorrowTides = parseTidesForDate(dayAfterTomorrowStr);

  // Combine and sort all valid tides
  const allRelevantTides = [...todayTides, ...tomorrowTides, ...dayAfterTomorrowTides]
      .sort((a, b) => a.dateTime - b.dateTime);

  let nextTide = null;
  let previousTide = null;

  // Find the first tide strictly after 'now'
  for (let i = 0; i < allRelevantTides.length; i++) {
      if (allRelevantTides[i].dateTime > now) {
          nextTide = allRelevantTides[i];
          // The tide immediately before this 'nextTide' is the 'previousTide' relative to now
          if (i > 0) {
              previousTide = allRelevantTides[i - 1];
          }
          break;
      }
  }

   // If no previous tide was found in the loop (meaning 'now' is before the first tide in our list),
   // and there are tides today before 'now', find the latest one that occurred before 'now'.
   if (!previousTide && allRelevantTides.length > 0 && allRelevantTides[0].dateTime > now) {
       const tidesBeforeNow = allRelevantTides.filter(t => t.dateTime <= now);
       if (tidesBeforeNow.length > 0) {
           previousTide = tidesBeforeNow[tidesBeforeNow.length - 1]; // Get the last one
       }
   }


  if (!nextTide) {
      // Return default/error state matching the new structure
      return {
          currentTrendIcon: "mdi:help-circle-outline",
          nextPeakTime: "--:--",
          nextPeakHeight: null,
          nextPeakCoefficient: null,
          nextPeakType: null // Indicate unknown type
      };
  }

  // Determine trend: If the previous tide was low, we are rising. If previous was high, we are falling.
  // If there's no previous tide (e.g., right at the start), infer trend from the type of the *next* tide.
  // If next is low, we must be falling towards it. If next is high, we must be rising towards it.
  const isRising = previousTide ? previousTide.type === 'low' : nextTide.type === 'high';

  // Return data matching the plan's requirements
  return {
      currentTrendIcon: isRising ? 'mdi:arrow-up' : 'mdi:arrow-down',
      nextPeakTime: nextTide.time,
      nextPeakHeight: nextTide.height, // Keep as number for potential calculations
      nextPeakCoefficient: nextTide.type === 'high' ? nextTide.coefficient : null, // Only show coeff if next tide is high
      nextPeakType: nextTide.type // 'high' or 'low'
  };
}


class MareesFranceCard extends LitElement {
  _svgDraw = null; // Property to hold the svg.js instance
  _svgContainer = null; // Reference to the SVG container div

  static get properties() {
    return {
      hass: {},
      config: {},
      _selectedDay: { state: true },
      _waterLevels: { state: true }, // State property for water level data (from get_water_levels)
      _tideData: { state: true }, // State property for tide data (from get_tides_data)
      _isLoadingWater: { state: true }, // Loading status for water levels
      _isLoadingTides: { state: true }, // Loading status for tide data
      _isInitialLoading: { state: true }, // Track initial load vs subsequent loads (maybe combine loaders?)
    };
  }

  // Define card editor
  static async getConfigElement() {
    return document.createElement("marees-france-card-editor");
  }

  // Updated Stub Config for Device Picker
  static getStubConfig() {
      return {
          device_id: "", // Use device_id now
          show_header: true,
          title: localizeCard('ui.card.marees_france.default_title', null) // Provide default title
      };
  }

  setConfig(config) {
    // Check for device_id now
    if (!config.device_id) {
      throw new Error(localizeCard('ui.card.marees_france.error_device_required', this.hass) || "Device required");
    }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10); // Default to today
    this._waterLevels = null; // Reset water levels on config change
    this._tideData = null; // Reset tide data on config change
    this._isLoadingWater = true; // Initialize loading state
    this._isLoadingTides = true; // Initialize loading state
    this._isInitialLoading = true; // Set initial loading flag

    // Fetch will be triggered by `updated` or explicitly call here if preferred
    // this._fetchData(); // Example: Call a combined fetch function
  }

  // --- Combined Fetch Function (Optional but cleaner) ---
  async _fetchData() {
      if (!this.hass || !this.config || !this.config.device_id) {
          console.warn("Marees Card: Fetch prerequisites not met (device_id).");
          this._isLoadingWater = false;
          this._isLoadingTides = false;
          this._waterLevels = { error: "Configuration incomplete" };
          this._tideData = { error: "Configuration incomplete" };
          this.requestUpdate();
          return;
      }
      // Reset states before fetching
      this._isLoadingWater = true;
      this._isLoadingTides = true;
      this._waterLevels = null;
      this._tideData = null;
      this.requestUpdate(); // Show loaders

      // Fetch both concurrently
      await Promise.all([
          this._fetchWaterLevels(),
          this._fetchTideData()
      ]);

      // No need to set loading false here, individual fetches handle it in finally blocks
      // No need for final requestUpdate here, individual fetches handle it
  }

  // --- Fetch Water Level Data ---
  async _fetchWaterLevels() {
    // Set loading true ONLY if not already loading (prevent loops if called rapidly)
    // if (this._isLoadingWater) return; // Maybe not needed if called carefully
    this._isLoadingWater = true;
    this.requestUpdate(); // Show loader if needed

    // Check for device_id and selectedDay
    if (!this.hass || !this.config || !this.config.device_id || !this._selectedDay) {
      console.warn("Marees Card: Water Level Fetch prerequisites not met.", { hass: !!this.hass, device_id: this.config?.device_id, day: this._selectedDay });
      this._waterLevels = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) }; // Use localized message
      this._isLoadingWater = false; // Set loading false
      this.requestUpdate(); // Update UI
      return;
    }

    try {
      console.log(`Marees Card: Fetching water levels for device ${this.config.device_id} on ${this._selectedDay}`);
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_water_levels', // service
        { // data
          device_id: this.config.device_id, // Use device_id
          date: this._selectedDay
        },
        undefined, // target (not needed)
        false, // blocking (usually false for frontend calls)
        true // return_response
      );

      // Check response structure
      if (response && response.response && typeof response.response === 'object') {
          this._waterLevels = response;
          console.log("Marees Card: Water levels received:", this._waterLevels);
      } else {
          console.error('Marees Card: Invalid data structure received from get_water_levels:', response);
          this._waterLevels = { error: "Invalid data structure from service" };
      }
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_water_levels service:', error);
      this._waterLevels = { error: error.message || "Service call failed" };
    } finally {
        this._isLoadingWater = false; // Set loading false after fetch completes or fails
        if (this._isInitialLoading && !this._isLoadingTides) { // Turn off initial flag only when both are done
             this._isInitialLoading = false;
        }
        this.requestUpdate(); // Ensure UI updates after loading finishes
    }
  }

  // --- Fetch Tide Data ---
  async _fetchTideData() {
    // if (this._isLoadingTides) return; // Maybe not needed
    this._isLoadingTides = true;
    this.requestUpdate(); // Show loader if needed

    // Check for device_id
    if (!this.hass || !this.config || !this.config.device_id) {
      console.warn("Marees Card: Tide Data Fetch prerequisites not met.", { hass: !!this.hass, device_id: this.config?.device_id });
      this._tideData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingTides = false; // Set loading false
      this.requestUpdate(); // Update UI
      return;
    }

    try {
      console.log(`Marees Card: Fetching tide data for device ${this.config.device_id}`);
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_tides_data', // service
        { // data
          device_id: this.config.device_id // Use device_id
        },
        undefined, // target (not needed)
        false, // blocking (usually false for frontend calls)
        true // return_response
      );

      // Check response structure
      if (response && response.response && typeof response.response === 'object') {
          this._tideData = response;
           console.log("Marees Card: Tide data received:", this._tideData);
      } else {
          console.error('Marees Card: Invalid data structure received from get_tides_data:', response);
          this._tideData = { error: "Invalid data structure from service" };
      }
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_tides_data service:', error);
      this._tideData = { error: error.message || "Service call failed" };
    } finally {
        this._isLoadingTides = false; // Set loading false after fetch completes or fails
         if (this._isInitialLoading && !this._isLoadingWater) { // Turn off initial flag only when both are done
             this._isInitialLoading = false;
        }
        this.requestUpdate(); // Ensure UI updates after loading finishes
    }
  }


  _handleTabClick(ev) {
    const newDay = ev.currentTarget.dataset.date;
    if (newDay !== this._selectedDay) {
        this._selectedDay = newDay;
        // Only need to fetch water levels, as tide data is for all days
        this._fetchWaterLevels();
    }
  }

  render() {
    // Check for device_id in config
    if (!this.hass || !this.config || !this.config.device_id) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.error_device_required', this.hass)}</div></ha-card>`;
    }

    // Check if tide data fetch resulted in an error
    if (this._tideData?.error) {
        // Optionally show a more specific error if device wasn't found vs other service errors
        const message = this._tideData.error.includes("not found")
            ? localizeCard('ui.card.marees_france.device_not_found', this.hass, 'device_id', this.config.device_id)
            : `${localizeCard('ui.card.marees_france.no_tide_data', this.hass)} Error: ${this._tideData.error}`;
        return html`<ha-card><div class="warning">${message}</div></ha-card>`;
    }

    // Check if tide data is loaded and valid before proceeding
    if (!this._tideData || !this._tideData.response) {
        // Show loading or initial message if still loading tides
        return html`
            <ha-card>
                <div class="card-header">${this.config.title || localizeCard('ui.card.marees_france.default_title', this.hass)}</div>
                <div class="card-content">
                    ${this._isLoadingTides ? html`<div class="loader">Loading tide data...</div>` : html`<div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div>`}
                </div>
            </ha-card>
        `;
    }

    // --- Tide data is available, proceed ---
    const tideDataForStatus = this._tideData; // Pass the whole object including 'response'
    const nextTideInfo = getNextTideStatus(tideDataForStatus, this.hass);
    const locale = this.hass.language || 'en';

    const today = new Date();
    const dayLabels = [...Array(7).keys()].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().slice(0, 10);
    });


    return html`
      <ha-card>
        ${this.config.show_header !== false ? html`
          <div class="card-header">${this.config.title || localizeCard('ui.card.marees_france.default_title', this.hass)}</div>
        ` : ''}
        <div class="card-content">
          <!-- Next Tide Status Display -->
          ${nextTideInfo ? html`
            <div class="next-tide-status">
              <div class="next-tide-icon-time">
                  <ha-icon .icon=${nextTideInfo.currentTrendIcon}></ha-icon>
                  <span class="next-tide-time">${nextTideInfo.nextPeakTime}</span>
              </div>
              <div class="next-tide-details">
                ${(() => {
                  let parts = [];
                  // Ensure height is a number before adding
                  if (nextTideInfo.nextPeakHeight !== null && !isNaN(parseFloat(nextTideInfo.nextPeakHeight))) {
                    parts.push(`${parseFloat(nextTideInfo.nextPeakHeight).toFixed(1)} m`);
                  }
                  // Coefficient is only shown for high tides (as per getNextTideStatus logic)
                  if (nextTideInfo.nextPeakCoefficient !== null) {
                    // Use secondary text color for coefficient like height
                    parts.push(`Coef. ${nextTideInfo.nextPeakCoefficient}`);
                  }
                  // Join with separator only if both parts exist
                  return parts.join(' - ');
                })()}
              </div>
            </div>
          ` : html`<div class="warning">${localizeCard('ui.card.marees_france.waiting_next_tide', this.hass)}</div>`}

          <!-- Day Tabs (Simplified) -->
          <div class="tabs">
            ${dayLabels.map(date => {
              const d = new Date(date);
              // Get 3-letter abbreviation, uppercase
              const label = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase();
              return html`
                <div
                  class="tab ${this._selectedDay === date ? 'active' : ''}"
                  data-date="${date}"
                  @click="${this._handleTabClick}"
                >
                  ${label}
                </div>
              `;
            })}
          </div>

          <!-- SVG Graph Container -->
          <div class="svg-graph-container">
            ${(this._isLoadingWater || this._isLoadingTides) ? html`
              <ha-icon icon="mdi:loading" class="loading-icon"></ha-icon>
            ` : ''}
            <!-- Target for svg.js -->
            <div id="marees-graph-target" class="svg-graph-target">
               <!-- SVG will be drawn here by _drawGraphWithSvgJs -->
            </div>
          </div>

        </div>
      </ha-card>
    `;
  }


  // --- Lifecycle method to handle updates and SVG drawing ---
  updated(changedProperties) {
    super.updated(changedProperties); // Always call super

    let needsGraphRedraw = false;

    // Initialize SVG on first update or if container ref is lost
    if (!this._svgDraw || !this.shadowRoot.contains(this._svgContainer)) {
        this._svgContainer = this.shadowRoot.querySelector('#marees-graph-target');
        if (this._svgContainer) {
            // Clear previous SVG content if any
            while (this._svgContainer.firstChild) {
                this._svgContainer.removeChild(this._svgContainer.firstChild);
            }
            // Initialize svg.js instance with viewBox for scaling
            this._svgDraw = SVG().addTo(this._svgContainer).viewbox(0, 0, 500, 170);
            needsGraphRedraw = true; // Need initial draw after SVG setup
        }
    }

    // Trigger initial data fetch when hass becomes available and config is set,
    // but only if data hasn't been fetched yet (check both tide and water levels)
    if (changedProperties.has('hass') && this.hass && this.config?.device_id && this._waterLevels === null && this._tideData === null) {
        console.log("Marees Card: Hass available, config ready, and no data yet. Triggering initial fetches.");
        // Use the combined fetch function if implemented, otherwise call individually
        this._fetchData(); // Assumes _fetchData exists
        // this._fetchWaterLevels();
        // this._fetchTideData();
        needsGraphRedraw = true; // Graph will redraw once loading finishes
    }

    // If config changes, trigger a full refetch
    if (changedProperties.has('config')) {
        console.log("Marees Card: Config changed, triggering data refetch.");
        this._fetchData(); // Assumes _fetchData exists
        needsGraphRedraw = true;
    }

    // Check if selected day changed (only need water levels) or if data/loading states changed
    if (changedProperties.has('_selectedDay') || changedProperties.has('_waterLevels') || changedProperties.has('_tideData') || changedProperties.has('_isLoadingWater') || changedProperties.has('_isLoadingTides')) {
        needsGraphRedraw = true;
    }

    // Redraw graph if needed, SVG is ready, AND NEITHER data source is loading
    if (needsGraphRedraw && this._svgDraw && this._svgContainer && !this._isLoadingWater && !this._isLoadingTides) {
        this._drawGraphWithSvgJs();
    }
  }


  // --- New method to draw graph using svg.js ---
  _drawGraphWithSvgJs() {
    // Ensure SVG instance and container are ready
    if (!this._svgDraw || !this._svgContainer) {
        // console.warn("Marees Card SVG: SVG drawing area not ready yet."); // Optional: keep for debugging
        return; // Exit if drawing area isn't set up
    }

    // Clear the canvas ONCE now that we know we are drawing the final state (not loading)
    this._svgDraw.clear();

    // Define viewBox dimensions here for use in error/no data positioning
    const viewBoxWidth = 500;
    const viewBoxHeight = 170;

    // --- 1. Check for Errors or Missing Data (after loading is false for BOTH) ---

    // Check Tide Data first (needed for markers)
    if (!this._tideData || this._tideData.error || !this._tideData.response) {
        const errorMessage = this._tideData?.error
            ? `Tide Error: ${this._tideData.error}`
            : localizeCard('ui.card.marees_france.no_tide_data', this.hass);
        this._svgDraw.text(errorMessage)
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
        return;
    }
    const tideResponse = this._tideData.response; // Store for use

    // Check Water Level Data (needed for curve)
    if (!this._waterLevels || this._waterLevels.error || !this._waterLevels.response) {
        const errorMessage = this._waterLevels?.error
            ? `Water Level Error: ${this._waterLevels.error}`
            : localizeCard('ui.card.marees_france.no_water_level_data', this.hass);
        this._svgDraw.text(errorMessage)
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
        return;
    }
    const waterLevelResponse = this._waterLevels.response; // Store for use

    // Access the actual water level data array for the selected day
    const levelsData = waterLevelResponse[this._selectedDay];

    // --- 2. Check for Water Level Data for the Selected Day ---
    if (!Array.isArray(levelsData) || levelsData.length === 0) {
        this._svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass)) // Keep using this key, context implies water level here
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle' });
        return;
    }

    // --- SVG Dimensions and Margins (Using already defined viewBoxWidth/Height) ---
    // Adjust margins for text/arrows: more top/bottom space needed
    const margin = { top: 55, right: 15, bottom: 35, left: 15 }; // Adjusted margins
    const graphWidth = viewBoxWidth - margin.left - margin.right;
    const graphHeight = viewBoxHeight - margin.top - margin.bottom; // Recalculated

    // --- Process Data ---
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    const points = levelsData.map(item => {
        const timeStr = item[0];
        const heightNum = parseFloat(item[1]);
        if (isNaN(heightNum)) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        minHeight = Math.min(minHeight, heightNum);
        maxHeight = Math.max(maxHeight, heightNum);
        return { totalMinutes, heightNum };
    }).filter(p => p !== null);

    // --- 3. Check if enough points to draw ---
    if (points.length < 2) {
         // Draw 'not enough data' message (canvas already cleared)
         this._svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass)) // Or a more specific message like "Not enough data points"
             .move(viewBoxWidth / 2, viewBoxHeight / 2) // Center roughly
             .font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle' });
        return;
    }

    // Adjust Y domain slightly for padding
    const yPadding = (maxHeight - minHeight) * 0.1 || 0.5; // Add 10% padding or 0.5m
    const yDomainMin = Math.max(0, minHeight - yPadding); // Ensure min is not negative
    const yDomainMax = maxHeight + yPadding;
    const yRange = Math.max(1, yDomainMax - yDomainMin); // Avoid division by zero

    // --- Coordinate Mapping Functions ---
    const timeToX = (totalMinutes) => margin.left + (totalMinutes / (24 * 60)) * graphWidth;
    // Y is inverted in SVG (0 is top)
    const heightToY = (h) => margin.top + graphHeight - ((h - yDomainMin) / yRange) * graphHeight;

    // --- Generate SVG Path Data Strings ---
    const pathData = points.map((p, index) => {
        const x = timeToX(p.totalMinutes);
        const y = heightToY(p.heightNum);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');

    const xAxisY = margin.top + graphHeight; // Y position of the X-axis line/labels
    const firstPointX = timeToX(points[0].totalMinutes);
    const lastPointX = timeToX(points[points.length - 1].totalMinutes);
    // Fill path goes from first point X on axis, along curve, to last point X on axis, then closes
    const fillPathData = `M ${firstPointX.toFixed(2)} ${xAxisY} ${pathData.replace(/^M/, 'L')} L ${lastPointX.toFixed(2)} ${xAxisY} Z`;

    // --- Calculate Ticks and Markers Data ---
     // --- X-Axis Ticks and Labels ---
    const xTicks = [];
    const xLabelStep = 480; // Label every 8 hours (0, 8, 16, 24)
    for (let totalMinutes = 0; totalMinutes <= 24 * 60; totalMinutes += xLabelStep) {
        const x = timeToX(totalMinutes === 1440 ? 1439.9 : totalMinutes); // Map 24:00 correctly
        const hour = Math.floor(totalMinutes / 60);
        const label = hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`;
        xTicks.push({ x: x, label: label });
    }
    // --- Tide Markers Data (using _tideData) ---
    const tideEventsForDay = tideResponse[this._selectedDay]; // Use data fetched earlier
    const tideMarkers = [];
    if (Array.isArray(tideEventsForDay)) {
        tideEventsForDay.forEach(tideArr => {
            // Parse the array format [typeStr, timeStr, heightStr, coeffStr]
            if (!Array.isArray(tideArr) || tideArr.length < 3) return;
            const typeStr = tideArr[0];
            const time = tideArr[1];
            const height = parseFloat(tideArr[2]);
            const coefficient = tideArr.length > 3 && tideArr[3] !== "---" ? parseInt(tideArr[3], 10) : null;
            const isHigh = typeStr === 'tide.high';
            const isLow = typeStr === 'tide.low';

            if ((!isHigh && !isLow) || !time || isNaN(height)) return; // Validate

            const [hours, minutes] = time.split(':').map(Number);
            const totalMinutes = hours * 60 + minutes;
            const x = timeToX(totalMinutes);
            const y = heightToY(height);

            tideMarkers.push({
                x: x,
                y: y,
                time: time,
                height: height,
                coefficient: isHigh ? coefficient : null, // Coeff only for high tides
                isHigh: isHigh
            });
        });
    }
    // No need to filter nulls here as we build the array directly

     // --- Current Time Marker Data ---
    const now = new Date();
    // Only show current time marker if the selected day is today
    let currentTimeMarker = null;
    if (this._selectedDay === now.toISOString().slice(0, 10)) {
        const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
        if (currentTotalMinutes >= 0 && currentTotalMinutes < 24 * 60 && points.length >= 2) {
            // Interpolation logic
            let prevPoint = null;
            let nextPoint = null;
            for (let i = 0; i < points.length; i++) {
                if (points[i].totalMinutes <= currentTotalMinutes) prevPoint = points[i];
                if (points[i].totalMinutes > currentTotalMinutes) { nextPoint = points[i]; break; }
            }
            let currentHeight = null;
            if (prevPoint && nextPoint) {
                const timeDiff = nextPoint.totalMinutes - prevPoint.totalMinutes;
                if (timeDiff > 0) {
                    const timeProgress = (currentTotalMinutes - prevPoint.totalMinutes) / timeDiff;
                    currentHeight = prevPoint.heightNum + (nextPoint.heightNum - prevPoint.heightNum) * timeProgress;
                } else { currentHeight = prevPoint.heightNum; }
            } else if (prevPoint) { currentHeight = prevPoint.heightNum; }
            else if (nextPoint) { currentHeight = nextPoint.heightNum; }

            if (currentHeight !== null) {
                const currentX = timeToX(currentTotalMinutes);
                const currentY = heightToY(currentHeight);
                // Store only position for the dot
                currentTimeMarker = { x: currentX, y: currentY };
            }
        }
    }


    // --- Drawing the Actual Graph --- (canvas already cleared)
    const draw = this._svgDraw; // Get the instance
    const axisColor = 'var(--secondary-text-color, grey)';
    const primaryTextColor = 'var(--primary-text-color, black)';
    const secondaryTextColor = 'var(--secondary-text-color, grey)';
    const curveColor = 'var(--primary-color, blue)';
    const bgColor = 'var(--ha-card-background, white)';
    const markerDotColor = '#FFEB3B'; // Yellow for current time marker dot
    const arrowAndTextColor = 'var(--primary-text-color, white)'; // White for arrows and text as per image request
    const coefBoxBgColor = 'var(--secondary-background-color, #f0f0f0)'; // Coefficient box background (using a lighter fallback)
    const coefBoxBorderColor = 'var(--ha-card-border-color, var(--divider-color, grey))'; // Coefficient box border
    const coefTextColor = 'var(--primary-text-color, black)'; // Coefficient text color - WILL BE OVERRIDDEN BELOW
    const coefLineColor = 'var(--primary-text-color, #212121)'; // Color for the dotted line (matching primary text fallback)

    const axisFontSize = 14; // Increased font size to match tabs
    const tideTimeFontSize = 18; // Increased font size for tide time
    const tideHeightFontSize = 16; // One size smaller than new tide time font size
    const coefFontSize = 16; // Increased font size for coefficient significantly
    const arrowSize = 8;
    const coefBoxPadding = { x: 6, y: 4 }; // Adjusted padding for larger font
    const coefBoxRadius = 4; // Rounded corners for coefficient box
    const coefBoxTopMargin = 10; // Fixed Y position for the top edge of all coefficient boxes
    const coefLineToPeakGap = 3; // Small gap between dotted line end and peak dot

    // Draw Base Elements First (Fill, Curve, Axis Labels)
    draw.path(fillPathData).fill({ color: curveColor, opacity: 0.4 }).stroke('none');
    draw.path(pathData).fill('none').stroke({ color: curveColor, width: 2 });

    // Draw X Axis Labels
    xTicks.forEach(tick => {
         if (tick.label) {
            draw.text(tick.label)
                .font({ fill: axisColor, size: axisFontSize, anchor: 'middle', weight: 'normal' })
                .move(tick.x, xAxisY + 10); // Position further below axis line
         }
    });

    // --- Draw Tide Markers (Arrows & Text) ---
    // Store calculated positions first to check for collisions later
    const markerElements = []; // To store { element: svgElement, bbox: SVGRect }

    tideMarkers.forEach(marker => {
        // --- Draw Coefficient for High Tides ---
        if (marker.isHigh && marker.coefficient) {
            const coefText = String(marker.coefficient);
            // Create temporary text to measure width/height for the box, ensure font settings match final text
            const tempText = draw.text(coefText)
                                 .font({ size: coefFontSize, weight: 'bold', anchor: 'middle' })
                                 .attr('dominant-baseline', 'central') // Match final text attributes
                                 .opacity(0); // Invisible
            const textBBox = tempText.bbox(); // Get bounding box
            tempText.remove(); // Remove temporary element

            const boxWidth = textBBox.width + 2 * coefBoxPadding.x;
            const boxHeight = textBBox.height + 2 * coefBoxPadding.y;
            const boxX = marker.x - boxWidth / 2;
            const boxY = coefBoxTopMargin; // Position box near the top

            // Draw Coefficient Box
            const coefRect = draw.rect(boxWidth, boxHeight)
                .attr({ x: boxX, y: boxY, rx: coefBoxRadius, ry: coefBoxRadius })
                .fill(coefBoxBgColor)
                .stroke({ color: coefBoxBorderColor, width: 1 });

            // Draw Coefficient Text
            const coefTextElement = draw.text(coefText)
                // Use primary text color for coefficient, anchor middle, dominant-baseline middle
                .font({ fill: primaryTextColor, size: coefFontSize, weight: 'bold', anchor: 'middle' })
                .attr('dominant-baseline', 'central') // Vertical centering attribute
                // Set x and y attributes directly for precise positioning
                .attr({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });

            // Draw Dotted Line from Box to Peak
            const lineStartY = boxY + boxHeight; // Bottom of the box
            const lineEndY = marker.y - coefLineToPeakGap; // Slightly above the peak point
            if (lineEndY > lineStartY) { // Only draw if line has positive length
                 draw.line(marker.x, lineStartY, marker.x, lineEndY)
                    // Use primary text color for the dotted line
                    .stroke({ color: coefLineColor, width: 1, dasharray: '2,2' });
            }
        }

        // --- Draw Arrows and Time/Height Text ---
        const arrowYOffset = marker.isHigh ? arrowSize * 2.0 : -arrowSize * 2.0; // Offset from curve point
        const textLineHeight = tideTimeFontSize * 1.1; // Adjusted line height factor
        const visualPadding = 8; // Desired visual gap between arrow tip and text edge

        const arrowGroup = draw.group(); // Group arrow and text

        // Arrow Path (Simple Triangle)
        let arrowPathData;
        const arrowY = marker.y + arrowYOffset;
        if (marker.isHigh) { // Up Arrow Triangle
            arrowPathData = `M ${marker.x - arrowSize/2},${arrowY + arrowSize*0.4} L ${marker.x + arrowSize/2},${arrowY + arrowSize*0.4} L ${marker.x},${arrowY - arrowSize*0.4} Z`;
        } else { // Down Arrow Triangle
            arrowPathData = `M ${marker.x - arrowSize/2},${arrowY - arrowSize*0.4} L ${marker.x + arrowSize/2},${arrowY - arrowSize*0.4} L ${marker.x},${arrowY + arrowSize*0.4} Z`;
        }
        const arrow = arrowGroup.path(arrowPathData)
           .fill(arrowAndTextColor)
           .stroke('none');

        // Text (Time and Height) - Positioning based on visual gap from arrow tip (Reverted Arrow Offset)
        let timeTextY, heightTextY;
        const arrowTipOffset = arrowSize * 0.4; // Vertical distance from arrowY center to the tip
        // Estimate ascent/descent based on font size (adjust factor if needed, 0.8 is common for ascent)
        const timeAscent = tideTimeFontSize * 0.8;
        const heightDescent = tideHeightFontSize * 0.2; // Smaller factor for descent below baseline

        if (marker.isHigh) { // High tide: Arrow points up, text below
            const arrowTipY = arrowY - arrowTipOffset; // Y-coordinate of the arrow tip (top point)
            // Position baseline of time text so its top edge (baseline - ascent) is 'visualPadding' below arrow tip
            timeTextY = arrowTipY + visualPadding + timeAscent - 10; // Move 10px higher
            heightTextY = timeTextY + textLineHeight;
        } else { // Low tide: Arrow points down, text above
            const arrowTipY = arrowY + arrowTipOffset; // Y-coordinate of the arrow tip (bottom point)
            // Position baseline of height text so its bottom edge (baseline + descent) is the same distance above the arrow tip
            // as the high tide's top edge is below its arrow tip (visualPadding - 22). Subtract 22 to move higher.
            heightTextY = arrowTipY - visualPadding - heightDescent - 22;
            timeTextY = heightTextY - textLineHeight;
        }

        // Use cx() for horizontal centering and y() for vertical positioning
        const timeText = arrowGroup.text(marker.time)
            .font({ fill: arrowAndTextColor, size: tideTimeFontSize, weight: 'bold' })
            .attr('text-anchor', 'middle')
            // Removed dominant-baseline
            .cx(marker.x) // Center horizontally at marker.x
            .y(timeTextY); // Set vertical position (baseline)

        const heightText = arrowGroup.text(`${marker.height.toFixed(1)}m`)
            .font({ fill: arrowAndTextColor, size: tideHeightFontSize })
            .attr('text-anchor', 'middle')
            // Removed dominant-baseline
            .cx(marker.x) // Center horizontally at marker.x
            .y(heightTextY); // Set vertical position (baseline)

        // Store for collision detection (use group's bbox)
        markerElements.push({ element: arrowGroup, bbox: arrowGroup.bbox(), isHigh: marker.isHigh, markerY: marker.y });
    });


    // --- Draw Current Time Marker (Yellow Dot) ---
    // Removed finalDotY variable and collision detection logic
    if (currentTimeMarker) {
        const dotRadius = 4;
        // Draw the dot directly at the calculated position
        draw.circle(dotRadius * 2) // diameter
            .center(currentTimeMarker.x, currentTimeMarker.y) // Use original calculated Y
            .fill(markerDotColor)
            .stroke({ color: bgColor, width: 1 }); // Add small background stroke for visibility
    }

  }


  getCardSize() {
    // Base size: header(1) + next_tide_status(1) + tabs(1) + graph(~4) = 7
    let size = 7; // Keep size, graph height increase is internal to SVG
    return size;
  }

  static get styles() {
    return css`
      :host {
        /* Card specific vars using HA vars */
        --tide-icon-color: var(--primary-text-color);
        --tide-time-color: var(--primary-text-color);
        --tide-detail-color: var(--secondary-text-color);
        /* Tab colors */
        --tab-inactive-background: var(--ha-card-background); /* Use card background for inactive tabs */
        --tab-active-background: var(--primary-color);
        --tab-inactive-text-color: var(--secondary-text-color);
        --tab-active-text-color: var(--text-primary-color);
        display: block;
      }
      ha-card {
        overflow: hidden; /* Prevent SVG overflow issues */
      }
      .warning {
        background-color: var(--error-color);
        color: var(--text-primary-color);
        padding: 8px;
        text-align: center;
        border-radius: 4px;
        margin: 10px 16px; /* Add horizontal margin */
      }
      .card-header {
          /* Standard HA card header style */
          padding: 16px 16px 8px 16px; /* Less bottom padding */
          color: var(--primary-text-color);
      }
      .card-content {
          padding: 16 16px 16px 16px; /* No top padding, standard sides/bottom */
      }

      /* Next Tide Status Display Styles */
      .next-tide-status {
        display: flex;
        flex-direction: column; /* Stack icon/time and details */
        align-items: flex-start; /* Align items to the left */
        gap: 4px; /* Smaller gap between lines */
        padding-bottom: 16px; /* Space before tabs */
      }
      .next-tide-icon-time {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .next-tide-icon-time ha-icon {
        font-size: 2.2em; /* Slightly smaller icon */
        color: var(--tide-icon-color);
      }
      .next-tide-time {
        font-size: 2.0em; /* Slightly smaller time */
        font-weight: 400; /* Normal weight */
        color: var(--tide-time-color);
        line-height: 1; /* Adjust line height */
      }
      .next-tide-details {
        display: flex; /* Keep details on one line if possible */
        flex-wrap: wrap; /* Allow wrapping */
        gap: 8px; /* Space between height and coef */
        padding-left: calc(2.2em + 8px); /* Indent details to align below time (icon width + gap) */
        font-size: 1.0em; /* Slightly smaller details */
        color: var(--tide-detail-color);
        line-height: 1.3; /* Adjust line height */
      }
      .next-tide-details span {
         display: inline-block; /* Keep height and coef box inline */
         vertical-align: middle; /* Align items vertically */
      }
      /* Separator is now handled directly in the HTML template */


      .tabs {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 16px;
        gap: 4px;
      }
      .tab {
        text-align: center;
        padding: 6px 4px;
        border-radius: 6px;
        background: var(--tab-inactive-background);
        color: var(--tab-inactive-text-color);
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        font-size: 14px;
        transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
      }
      .tab:hover {
         filter: brightness(95%);
      }
      .tab.active {
        background: var(--tab-active-background);
        color: var(--tab-active-text-color);
        font-weight: bold;
      }

      /* Styles for SVG graph container and loader */
      @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .svg-graph-container {
        position: relative; /* Needed for absolute positioning of loader */
        display: flex; /* Use flex to center loader */
        justify-content: center;
        align-items: center;
        /* Use aspect-ratio for responsive height based on width */
        aspect-ratio: 500 / 170; /* Updated aspect ratio */
        width: 100%;
        height: auto; /* Let aspect-ratio control height */
        max-height: 220px; /* Optional max height increased */
        margin-top: 10px; /* Space above graph */
      }
      .svg-graph-container .loading-icon {
        position: absolute; /* Position over the graph area */
        font-size: 3em; /* Adjust size as needed */
        color: var(--primary-color); /* Use primary color */
        animation: rotate 1.5s linear infinite; /* Apply rotation */
        z-index: 10; /* Ensure loader is above SVG content */
        opacity: 1; /* Final state */
        transition: opacity 0.4s ease-in-out; /* Fade-in effect */
      }
      /* When the icon is added via the template, it should fade from implicit 0 to 1 */

      .svg-graph-target {
         /* Ensure the SVG target takes up the container space */
         width: 100%;
         height: 100%;
         position: relative; /* Establish stacking context if needed */
         z-index: 1; /* Ensure graph is below loader */
      }
      /* Removed .hidden class rule */
      .svg-graph-target svg {
          display: block; /* Remove extra space below SVG */
          width: 100%;
          height: 100%;
      }
    `;
  }
}

customElements.define("marees-france-card", MareesFranceCard);

// Register with Home Assistant
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'marees-france-card',
  name: 'Carte Marées France',
  preview: true,
  description: 'Carte pour l\'integration Marées France',
  documentationURL: 'https://github.com/KipK/marees_france/blob/main/README-fr.md'
});
