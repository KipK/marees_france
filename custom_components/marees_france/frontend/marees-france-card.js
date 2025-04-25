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
      rising_until: "Rising until {time} ({duration})", // Keep for potential other uses
      falling_until: "Falling until {time} ({duration})", // Keep for potential other uses
      rising_prefix: "Rising until",
      falling_prefix: "Falling until",
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
      rising_until: "Monte jusqu'à {time} ({duration})", // Keep for potential other uses
      falling_until: "Descend jusqu'à {time} ({duration})", // Keep for potential other uses
      rising_prefix: "Monte jusqu'à",
      falling_prefix: "Descend jusqu'à",
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

  // Determine the coefficient to display
  let displayCoefficient = null;
  if (isRising) {
    // Find the next high tide after now
    const nextHighTide = allRelevantTides.find(tide => tide.dateTime > now && tide.type === 'high');
    if (nextHighTide) {
      displayCoefficient = nextHighTide.coefficient;
    }
  } else {
    // Find the last high tide at or before now (should be previousTide if it was high)
    const previousHighTide = allRelevantTides.slice().reverse().find(tide => tide.dateTime <= now && tide.type === 'high');
     if (previousHighTide) {
        displayCoefficient = previousHighTide.coefficient;
     } else if (previousTide && previousTide.type === 'high') {
        // Fallback just in case the reverse find fails but previousTide was high
        displayCoefficient = previousTide.coefficient;
     }
  }

  // Return data matching the plan's requirements
  return {
      currentTrendIcon: isRising ? 'mdi:wave-arrow-up' : 'mdi:wave-arrow-down',
      nextPeakTime: nextTide.time,
      nextPeakHeight: nextTide.height, // Keep as number for potential calculations
      displayCoefficient: displayCoefficient, // Use the determined coefficient
      nextPeakType: nextTide.type // 'high' or 'low'
  };
}


class MareesFranceCard extends LitElement {
  _svgDraw = null; // Property to hold the svg.js instance
  _svgContainer = null; // Reference to the SVG container div
  _elementsToKeepSize = []; // Store groups/elements that should not scale [NEW]
  _resizeObserver = null;    // Store the ResizeObserver instance [NEW]
  _isDraggingDot = false; // NEW: Track drag state
  _originalDotPosition = null; // NEW: Store original {x, y, timeStr, heightStr}
  _draggedPosition = null; // NEW: Store dragged {timeStr, heightStr} during drag

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
      _isDraggingDot: { state: true, type: Boolean }, // NEW: Added type for Lit
      _draggedPosition: { state: true, attribute: false }, // NEW: Added attribute: false for Lit
      // _originalDotPosition doesn't need to be reactive
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

  // [NEW] Cleanup observer and references when element is disconnected
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    this._elementsToKeepSize = []; // Clear references
    // Optional: Consider clearing _svgDraw and _svgContainer if appropriate
    // if (this._svgDraw) this._svgDraw.remove(); // Removes the SVG element itself
    // this._svgDraw = null;
    // this._svgContainer = null;
    console.log("Marees Card: Disconnected and cleaned up observer.");
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
                  <div class="next-tide-text-container">
                      <span class="next-tide-trend-text">
                          ${localizeCard(nextTideInfo.currentTrendIcon === 'mdi:wave-arrow-up' ? 'ui.card.marees_france.rising_prefix' : 'ui.card.marees_france.falling_prefix', this.hass)}
                      </span>
                      <span class="next-tide-time">${nextTideInfo.nextPeakTime}</span>
                  </div>
              </div>
              <div class="next-tide-details">
                ${(() => {
                  let parts = [];
                  // Ensure height is a number before adding
                  if (nextTideInfo.nextPeakHeight !== null && !isNaN(parseFloat(nextTideInfo.nextPeakHeight))) {
                    parts.push(`${parseFloat(nextTideInfo.nextPeakHeight).toFixed(1)} m`);
                  }
                  // Always show coefficient if available (determined in getNextTideStatus)
                  if (nextTideInfo.displayCoefficient !== null) {
                    const coef = nextTideInfo.displayCoefficient;
                    const coefClass = coef >= 100 ? 'warning-coef' : '';
                    // Use secondary text color for coefficient like height, apply warning class if needed
                    parts.push(html`<span class="${coefClass}">Coef. ${coef}</span>`);
                  }
                  // Join with separator only if both parts exist
                  // Need to render the parts directly if one contains HTML
                  if (parts.length === 2) {
                    return html`${parts[0]} - ${parts[1]}`;
                  } else if (parts.length === 1) {
                    return parts[0];
                  }
                  return ''; // Return empty if no parts
                })()}
              </div>
            </div>
          ` : html`<div class="warning">${localizeCard('ui.card.marees_france.waiting_next_tide', this.hass)}</div>`}

          <!-- Day Tabs (Simplified) -->
          <div class="tabs">
            ${dayLabels.map(date => {
              const d = new Date(date);
              // Get 3-letter abbreviation, uppercase
              const dayLabel = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase();
              // Get dd/mm date format
              const dateLabel = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
              return html`
                <div
                  class="tab ${this._selectedDay === date ? 'active' : ''}"
                  data-date="${date}"
                  @click="${this._handleTabClick}"
                >
                  <div class="tab-day">${dayLabel}</div>
                  <div class="tab-date">${dateLabel}</div>
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
          <!-- HTML Tooltip Element -->
          <div id="marees-html-tooltip" class="chart-tooltip"></div>
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
            this._setupResizeObserver(); // [NEW] Setup observer here
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
        // Trigger scale update after drawing is complete using requestAnimationFrame
        // This ensures the DOM is updated and bounding boxes are available.
        window.requestAnimationFrame(() => { // [NEW]
             this._updateElementScale();       // [NEW]
        });                                 // [NEW]
    }
  }

  // [NEW] Method to setup the ResizeObserver
  _setupResizeObserver() {
    if (this._resizeObserver) {
      // Disconnect previous observer if setting up again (e.g., container changed)
      this._resizeObserver.disconnect();
    }
    if (!this._svgContainer) {
        console.warn("Marees Card: Cannot setup ResizeObserver, SVG container not found.");
        return;
    }

    this._resizeObserver = new ResizeObserver(entries => {
      // Use rAF to batch updates, improve performance, and avoid layout thrashing
      window.requestAnimationFrame(() => {
        this._updateElementScale();
      });
    });
    this._resizeObserver.observe(this._svgContainer);
    console.log("Marees Card: ResizeObserver setup.");
  }

  // [NEW] Method to apply the inverse scaling to designated elements
  _updateElementScale() {
    // Ensure container, SVG instance, and elements array are ready
    if (!this._svgContainer || !this._svgDraw || this._elementsToKeepSize.length === 0) {
      return;
    }

    const svgRect = this._svgContainer.getBoundingClientRect();
    // Ensure viewBox exists and has width before accessing
    const viewBox = this._svgDraw.viewbox(); // Use svg.js method to get viewBox
    const viewBoxWidth = viewBox ? viewBox.width : 500; // Default to 500 if somehow missing

    // Check for invalid dimensions
    if (svgRect.width <= 0 || viewBoxWidth <= 0) {
        // console.warn("Marees Card: Invalid dimensions for scaling.", svgRect.width, viewBoxWidth);
        return; // Avoid division by zero or invalid scaling
    }

    const scaleFactor = svgRect.width / viewBoxWidth;

    // Check for invalid scale factor
    if (scaleFactor <= 0 || !isFinite(scaleFactor)) {
        // console.warn("Marees Card: Invalid scale factor for scaling.", scaleFactor);
        return; // Avoid division by zero or NaN/Infinity
    }

    const inverseScale = 1 / scaleFactor;

    // Filter out potentially invalid elements before iterating
    this._elementsToKeepSize = this._elementsToKeepSize.filter(element =>
        element && element.node?.isConnected && typeof element.bbox === 'function'
    );

    this._elementsToKeepSize.forEach(element => {
      try {
        const bbox = element.bbox();
        // Use cx/cy provided by svg.js bbox for center
        const cx = bbox.cx;
        const cy = bbox.cy;

        // Check if center coordinates are valid numbers
        if (isNaN(cx) || isNaN(cy)) {
            console.warn("Marees Card: Invalid bbox center for scaling element:", element, bbox);
            return; // Skip this element if center is invalid
        }

        // Apply transform using translate/scale/translate for robust centering
        element.transform({}) // Reset existing transforms first
               .translate(cx, cy)
               .scale(inverseScale)
               .translate(-cx, -cy);

      } catch (e) {
        console.error("Marees Card: Error scaling element:", e, element);
        // Consider removing the element from _elementsToKeepSize if errors persist
        // (though the filter at the start should help prevent this)
      }
    });
  }

  // --- New method to draw graph using svg.js ---
  _drawGraphWithSvgJs() {
    // Ensure SVG instance and container are ready
    if (!this._svgDraw || !this._svgContainer) {
        // console.warn("Marees Card SVG: SVG drawing area not ready yet."); // Optional: keep for debugging
        return; // Exit if drawing area isn't set up
    }

    // Clear the canvas AND the list of elements to scale
    this._svgDraw.clear();
    this._elementsToKeepSize = []; // [NEW & RENAMED] Clear array at the start of redraw
    // Reset drag state on redraw
    this._isDraggingDot = false;
    this._originalDotPosition = null;
    this._draggedPosition = null;

    // Define viewBox dimensions here for use in error/no data positioning
    const viewBoxWidth = 500;
    const viewBoxHeight = 170;

    // --- 1. Check for Errors or Missing Data (after loading is false for BOTH) ---

    // Check Tide Data first (needed for markers)
    if (!this._tideData || this._tideData.error || !this._tideData.response) {
        const errorMessage = this._tideData?.error // Re-add variable declaration
            ? `Tide Error: ${this._tideData.error}`
            : localizeCard('ui.card.marees_france.no_tide_data', this.hass);
        const errorText = this._svgDraw.text(errorMessage) // [MODIFIED] Store reference
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
        this._elementsToKeepSize.push(errorText); // [NEW] Add error text to scale list
        return;
    }
    const tideResponse = this._tideData.response; // Store for use

    // Check Water Level Data (needed for curve)
    if (!this._waterLevels || this._waterLevels.error || !this._waterLevels.response) {
        const errorMessage = this._waterLevels?.error
            ? `Water Level Error: ${this._waterLevels.error}`
            : localizeCard('ui.card.marees_france.no_water_level_data', this.hass);
        const errorText = this._svgDraw.text(errorMessage) // [MODIFIED] Store reference
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
        this._elementsToKeepSize.push(errorText); // [NEW] Add error text to scale list
        return;
    }
    const waterLevelResponse = this._waterLevels.response; // Store for use

    // Access the actual water level data array for the selected day
    const levelsData = waterLevelResponse[this._selectedDay];

    // --- 2. Check for Water Level Data for the Selected Day ---
    if (!Array.isArray(levelsData) || levelsData.length === 0) {
        const noDataText = this._svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass)) // [MODIFIED] Store reference
            .move(viewBoxWidth / 2, viewBoxHeight / 2)
            .font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle' });
        this._elementsToKeepSize.push(noDataText); // [NEW] Add message to scale list
        return;
    }

    // --- SVG Dimensions and Margins (Store as class properties) ---
    this._graphMargin = { top: 55, right: 15, bottom: 35, left: 15 }; // Adjusted margins
    this._graphWidth = viewBoxWidth - this._graphMargin.left - this._graphMargin.right;
    this._graphHeight = viewBoxHeight - this._graphMargin.top - this._graphMargin.bottom; // Recalculated

    // --- Process Data (Store as class property) ---
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    this._pointsData = levelsData.map(item => { // Store processed points
        const timeStr = item[0];
        const heightNum = parseFloat(item[1]);
        if (isNaN(heightNum)) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        minHeight = Math.min(minHeight, heightNum);
        maxHeight = Math.max(maxHeight, heightNum);
        return { totalMinutes, heightNum };
    }).filter(p => p !== null);

    // --- 3. Check if enough points to draw & Store Boundaries ---
    if (this._pointsData.length < 2) {
         // Draw 'not enough data' message (canvas already cleared)
         const notEnoughDataText = this._svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass)) // [MODIFIED] Store reference
             .move(viewBoxWidth / 2, viewBoxHeight / 2) // Center roughly
             .font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle' });
         this._elementsToKeepSize.push(notEnoughDataText); // [NEW] Add message to scale list
        this._curveMinMinutes = null; // Reset boundaries if not enough data
        this._curveMaxMinutes = null;
        return;
   } else {
       // Store the actual time boundaries of the curve data
       this._curveMinMinutes = this._pointsData[0].totalMinutes;
       this._curveMaxMinutes = this._pointsData[this._pointsData.length - 1].totalMinutes;
   }

   // Adjust Y domain slightly for padding (Store as class properties)
   const yPadding = (maxHeight - minHeight) * 0.1 || 0.5; // Add 10% padding or 0.5m
   this._yDomainMin = Math.max(0, minHeight - yPadding); // Ensure min is not negative
   const yDomainMax = maxHeight + yPadding;
   this._yRange = Math.max(1, yDomainMax - this._yDomainMin); // Avoid division by zero

   // --- Coordinate Mapping Functions are now class methods ---

   // --- Generate SVG Path Data Strings ---
   const pathData = this._pointsData.map((p, index) => {
       const x = this._timeToX(p.totalMinutes); // Use class method
       const y = this._heightToY(p.heightNum); // Use class method
       return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
   }).join(' ');

   const xAxisY = this._graphMargin.top + this._graphHeight; // Use class properties
   const firstPointX = this._timeToX(this._pointsData[0].totalMinutes); // Use class method
   const lastPointX = this._timeToX(this._pointsData[this._pointsData.length - 1].totalMinutes); // Use class method
   // Fill path goes from first point X on axis, along curve, to last point X on axis, then closes
   const fillPathData = `M ${firstPointX.toFixed(2)} ${xAxisY} ${pathData.replace(/^M/, 'L')} L ${lastPointX.toFixed(2)} ${xAxisY} Z`;

   // --- Calculate Ticks and Markers Data ---
    // --- X-Axis Ticks and Labels ---
   const xTicks = [];
   const xLabelStep = 480; // Label every 8 hours (0, 8, 16, 24)
   for (let totalMinutes = 0; totalMinutes <= 24 * 60; totalMinutes += xLabelStep) {
       const x = this._timeToX(totalMinutes === 1440 ? 1439.9 : totalMinutes); // Use class method
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
           const x = this._timeToX(totalMinutes); // Use class method
           const y = this._heightToY(height); // Use class method

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
   let currentTotalMinutes = null; // Store total minutes for tooltip data
   if (this._selectedDay === now.toISOString().slice(0, 10)) {
       currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
       const currentHeight = this._interpolateHeight(currentTotalMinutes); // Use class method

       if (currentHeight !== null) {
           const currentX = this._timeToX(currentTotalMinutes); // Use class method
           const currentY = this._heightToY(currentHeight); // Use class method
           currentTimeMarker = { x: currentX, y: currentY, height: currentHeight, totalMinutes: currentTotalMinutes };
       }
   }


    // --- Drawing the Actual Graph --- (canvas already cleared)
    const draw = this._svgDraw; // Get the instance
    const locale = this.hass.language || 'en'; // Get locale for time formatting
    const axisColor = 'var(--secondary-text-color, grey)';
    const primaryTextColor = 'var(--primary-text-color, black)';
    const secondaryTextColor = 'var(--secondary-text-color, grey)';
    const curveColor = 'var(--primary-color, blue)';
    const bgColor = 'var(--ha-card-background, white)';
    const markerDotColor = 'var(--current_tide_color)'; // Yellow for current time marker dot
    const arrowAndTextColor = 'var(--primary-text-color, white)'; // White for arrows and text as per image request
    const coefBoxBgColor = 'var(--secondary-background-color, #f0f0f0)'; // Coefficient box background (using a lighter fallback)
    const coefBoxBorderColor = 'var(--ha-card-border-color, var(--divider-color, grey))'; // Coefficient box border
    const coefTextColor = 'var(--primary-text-color, black)'; // Coefficient text color - WILL BE OVERRIDDEN BELOW
    const coefLineColor = 'var(--primary-text-color, #212121)'; // Color for the dotted line (matching primary text fallback)
    // Use coef box colors for tooltip, but primary text color for tooltip text
    const tooltipBgColor = coefBoxBgColor;
    const tooltipBorderColor = coefBoxBorderColor;
    const tooltipTextColor = primaryTextColor; // Use primary text color

    const axisFontSize = 14; // Increased font size to match tabs
    const tideTimeFontSize = 14; // Reduced font size for tide time
    const tideHeightFontSize = 12; // Reduced font size for tide height
    const coefFontSize = 16; // Increased font size for coefficient significantly
    const tooltipFontSize = 12;
    const arrowSize = 8;
    const coefBoxPadding = { x: 6, y: 4 }; // Adjusted padding for larger font
    const coefBoxRadius = 4; // Rounded corners for coefficient box
    const coefBoxTopMargin = 10; // Fixed Y position for the top edge of all coefficient boxes
    const coefLineToPeakGap = 3; // Small gap between dotted line end and peak dot
    const tooltipPadding = { x: 6, y: 4 };
    const tooltipRadius = 4;
    // const tooltipOffset = 10; // Offset from the dot - Now handled conditionally in _showHtmlTooltip

    // Draw Base Elements First (Fill, Curve, Axis Labels)
    draw.path(fillPathData).fill({ color: curveColor, opacity: 0.4 }).stroke('none');
    draw.path(pathData).fill('none').stroke({ color: curveColor, width: 2 });

    // Draw X Axis Labels (Should NOT scale)
    xTicks.forEach(tick => {
         if (tick.label) {
            const textEl = draw.text(tick.label) // [MODIFIED] Store reference
                .font({ fill: axisColor, size: axisFontSize, anchor: 'middle', weight: 'normal' })
                .move(tick.x, xAxisY + 10); // Position further below axis line
            this._elementsToKeepSize.push(textEl); // [NEW] Add standalone text
         }
    });

    // --- Draw Tide Markers (Arrows & Text) ---
    // Store calculated positions first to check for collisions later
    const markerElements = []; // To store { element: svgElement, bbox: SVGRect } // Keep for potential future collision logic

    tideMarkers.forEach(marker => {
        // --- Coefficient Group (High Tides Only - Should NOT scale) ---
        if (marker.isHigh && marker.coefficient) {
            const coefGroup = draw.group(); // [NEW] Create group for coefficient elements
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
            const coefRect = coefGroup.rect(boxWidth, boxHeight) // [MODIFIED] Add to group
                .attr({ x: boxX, y: boxY, rx: coefBoxRadius, ry: coefBoxRadius })
                .fill(coefBoxBgColor)
                .stroke({ color: coefBoxBorderColor, width: 1 })
                .attr('vector-effect', 'non-scaling-stroke'); // [NEW] Keep stroke constant

            // Draw Coefficient Text
            const coefValue = marker.coefficient; // Get the numeric value
            const coefColor = coefValue >= 100 ? 'var(--warning-color)' : primaryTextColor; // Conditional color
            const coefTextElement = coefGroup.text(coefText) // [MODIFIED] Add to group
                // Use conditional text color for coefficient, anchor middle, dominant-baseline middle
                .font({ fill: coefColor, size: coefFontSize, weight: 'bold', anchor: 'middle' })
                .attr('dominant-baseline', 'central') // Vertical centering attribute
                // Set x and y attributes directly for precise positioning
                .attr({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });

            // Draw Dotted Line from Box to Peak
            const lineStartY = boxY + boxHeight; // Bottom of the box
            const lineEndY = marker.y - coefLineToPeakGap; // Slightly above the peak point
            if (lineEndY > lineStartY) { // Only draw if line has positive length
                 const dottedLine = coefGroup.line(marker.x, lineStartY, marker.x, lineEndY) // [MODIFIED] Add to group
                    // Use primary text color for the dotted line
                    .stroke({ color: coefLineColor, width: 1, dasharray: '2,2' })
                    .attr('vector-effect', 'non-scaling-stroke'); // [NEW] Keep stroke/dash constant
            }
            this._elementsToKeepSize.push(coefGroup); // [NEW] Add the coefficient group to the list
        }

        // --- Arrow & Text Group (Should NOT scale) ---
        const arrowYOffset = marker.isHigh ? arrowSize * 2.0 : -arrowSize * 2.2; // Offset from curve point
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

        // Store group for scaling and original markerElements for potential future collision logic
        this._elementsToKeepSize.push(arrowGroup); // [NEW] Add the arrow/text group
        markerElements.push({ element: arrowGroup, bbox: arrowGroup.bbox(), isHigh: marker.isHigh, markerY: marker.y });
    });


    // --- Draw Current Time Marker (Yellow Dot - Should NOT scale) ---
    if (currentTimeMarker) {
        const dotRadius = 5;
        const dotGroup = draw.group(); // [NEW] Group the dot and its stroke
        dotGroup.attr('id', 'current-time-marker');
        dotGroup.addClass('has-tooltip');
        dotGroup.addClass('draggable-dot'); // NEW: Add class for potential styling/selection

        // Draw an invisible larger circle for easier grabbing (sticky effect)
        const hitAreaRadius = dotRadius * 2.5; // Make hit area larger
        const hitAreaCircle = dotGroup.circle(hitAreaRadius * 2)
            .center(currentTimeMarker.x, currentTimeMarker.y)
            .fill('transparent') // Make it invisible
            // .fill({ color: 'blue', opacity: 0.2 }) // Optional: Semi-transparent for debugging
            .attr('cursor', 'grab');

        // Draw the visible fill circle on top
        const dotCircle = dotGroup.circle(dotRadius * 2) // Store reference to circle
            .center(currentTimeMarker.x, currentTimeMarker.y)
            .fill('var(--current_tide_color)') // Use CSS variable directly
            .attr('pointer-events', 'none'); // Visible dot shouldn't capture events

        // this._elementsToKeepSize.push(dotGroup); // REMOVED: Let the dot scale with the SVG to maintain relative position to the curve

        // Store data needed for original tooltip and reverting position
        const currentTimeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        const currentHeightStr = currentTimeMarker.height !== null ? currentTimeMarker.height.toFixed(2) : 'N/A';

        // --- Add Event Listeners for HTML Tooltip ---
        // NEW: Store original position and data
        this._originalDotPosition = {
            x: currentTimeMarker.x,
            y: currentTimeMarker.y,
            timeStr: currentTimeStr,
            heightStr: currentHeightStr
        };

        // --- Add Event Listeners for HTML Tooltip & Dragging ---
        // Attach listeners to the larger invisible hit area circle
        hitAreaCircle.node.addEventListener('mouseover', (e) => {
            // Only show hover tooltip if NOT dragging
            if (!this._isDraggingDot) {
                this._showHtmlTooltip(e, this._originalDotPosition.timeStr, this._originalDotPosition.heightStr);
            }
        });
        hitAreaCircle.node.addEventListener('mouseout', () => {
            // Hide tooltip if NOT dragging (drag move will handle tooltip otherwise)
             if (!this._isDraggingDot) {
                this._hideHtmlTooltip();
             }
        });

        // NEW: Add Drag Listeners (Remove helper function args) - Attach to hit area
        hitAreaCircle.node.addEventListener('mousedown', (e) => this._handleDragStart(e, dotGroup, dotCircle, hitAreaCircle)); // Pass hitAreaCircle too
        hitAreaCircle.node.addEventListener('touchstart', (e) => this._handleDragStart(e, dotGroup, dotCircle, hitAreaCircle), { passive: false }); // Need passive false to prevent scroll

    }
  } // End of _drawGraphWithSvgJs

  // --- Tooltip Helpers (Modified slightly) ---
  _showHtmlTooltip(evt, time, height, isDragging = false) { // Add isDragging flag
      const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
      if (!tooltip) return;

      // Format the content
      tooltip.innerHTML = `<strong>${time}</strong><br>${height} m`;

      // Positioning logic (remains mostly the same, might need adjustment based on event source if dragging)
      const targetElement = evt.currentTarget || evt.target; // Handle different event targets
      if (!targetElement) return;

      const cardRect = this.getBoundingClientRect();
      // Use the stored dot position if dragging, otherwise use event target bounds
      let targetRect;
      if (isDragging && this._draggedPosition) {
          // Need to estimate rect based on _draggedPosition's SVG coords
          // This is tricky without the actual element. Let's try using the event coords for now.
          // We might need to pass the SVG element reference during drag updates.
          // For simplicity, let's use the event page coordinates directly for positioning during drag.
           const svgPoint = this._getSVGCoordinates(evt); // Get SVG coords from event
           if (!svgPoint) return;

           // --- FIX: Extract clientX/clientY correctly for touch/mouse events ---
           let clientX, clientY;
           if (evt.touches && evt.touches.length > 0) {
               clientX = evt.touches[0].clientX;
               clientY = evt.touches[0].clientY;
           } else if (evt.clientX !== undefined && evt.clientY !== undefined) {
               clientX = evt.clientX;
               clientY = evt.clientY;
           } else {
               return; // Cannot determine event coordinates
           }
           // --- End FIX ---

           // Approximate target rect based on SVG point and dot radius (needs refinement)
           const dotRadiusPx = 5 * (cardRect.width / 500); // Estimate pixel radius based on scale
           targetRect = {
               left: clientX - dotRadiusPx, // Use extracted clientX
               top: clientY - dotRadiusPx,  // Use extracted clientY
               width: dotRadiusPx * 2,
               height: dotRadiusPx * 2
           };

      } else if (targetElement.getBoundingClientRect) {
           targetRect = targetElement.getBoundingClientRect();
      } else {
          return; // Cannot get bounds
      }


      const targetCenterX = targetRect.left + targetRect.width / 2 - cardRect.left;
      const targetTopY = targetRect.top - cardRect.top;

      // Temporarily display tooltip to measure its dimensions
      tooltip.style.visibility = 'hidden'; // Keep it from flashing
      tooltip.style.display = 'block';
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      tooltip.style.display = 'none'; // Hide again before final positioning
      tooltip.style.visibility = 'visible';

      // Determine offset based on event type (touch vs mouse)
      const isTouchEvent = evt.type.startsWith('touch');
      const offsetAbove = isTouchEvent ? 45 : 10; // 45px for touch, 10px for mouse

      // Calculate desired position
      let left = targetCenterX - tooltipWidth / 2;
      let top = targetTopY - tooltipHeight - offsetAbove;

      // Boundary checks (remain the same)
      const safetyMargin = 2; // Small margin

      // Check left boundary
      if (left < safetyMargin) {
          left = safetyMargin;
      }
      // Check right boundary
      if (left + tooltipWidth > cardRect.width - safetyMargin) {
          left = cardRect.width - tooltipWidth - safetyMargin;
      }
      // Check top boundary (if it goes above card, maybe position below instead?)
      if (top < safetyMargin) {
          // Option 1: Clamp to top
          // top = safetyMargin;
          // Option 2: Position below the dot
          top = targetTopY + targetRect.height + offsetAbove; // Position below
          if (top + tooltipHeight > cardRect.height - safetyMargin) {
              top = cardRect.height - tooltipHeight - safetyMargin;
          }
      }

     // Apply final position and display
     tooltip.style.left = `${left}px`;
     tooltip.style.top = `${top}px`;
     tooltip.style.display = 'block';
     tooltip.style.opacity = '1'; // Ensure visible
 }

 _hideHtmlTooltip() {
     const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
     if (tooltip) {
         tooltip.style.opacity = '0'; // Fade out
         // Use transitionend or setTimeout to set display: none after fade
         setTimeout(() => {
             if (tooltip.style.opacity === '0') { // Check if still hidden
                tooltip.style.display = 'none';
             }
         }, 150); // Match CSS transition duration if any
     }
 }

 // --- NEW: Drag Handlers (Remove helper function args) ---

 _handleDragStart(e, dotGroup, dotCircle, hitAreaCircle) { // Added hitAreaCircle
     if (e.button === 2) return; // Ignore right-clicks
     e.preventDefault(); // Prevent text selection/default drag

     this._isDraggingDot = true;
     this.requestUpdate('_isDraggingDot'); // Update state

     // Change color and cursor
     dotCircle.fill('var(--info-color, var(--primary-color))'); // Use info-color with fallback
     hitAreaCircle.attr('cursor', 'grabbing'); // Change cursor on the hit area

     // Hide hover tooltip immediately if it was shown
     this._hideHtmlTooltip();

     // Bind move/end listeners to window to capture events outside the element
     // Pass only necessary elements, helpers are now class methods
     this._boundHandleDragMove = (ev) => this._handleDragMove(ev, dotGroup, dotCircle, hitAreaCircle); // Pass hitAreaCircle
     this._boundHandleDragEnd = (ev) => this._handleDragEnd(ev, dotGroup, dotCircle, hitAreaCircle); // Pass hitAreaCircle

     if (e.type === 'touchstart') {
         window.addEventListener('touchmove', this._boundHandleDragMove, { passive: false });
         window.addEventListener('touchend', this._boundHandleDragEnd, { once: true });
         window.addEventListener('touchcancel', this._boundHandleDragEnd, { once: true });
     } else {
         window.addEventListener('mousemove', this._boundHandleDragMove);
         window.addEventListener('mouseup', this._boundHandleDragEnd, { once: true });
     }
 }

  _handleDragMove(e, dotGroup, dotCircle, hitAreaCircle) { // Added hitAreaCircle
     if (!this._isDraggingDot) return;
     e.preventDefault(); // Prevent scrolling on touch devices

     const svgPoint = this._getSVGCoordinates(e);
     if (!svgPoint || this._curveMinMinutes === null || this._curveMaxMinutes === null) return; // Exit if boundaries aren't set

     // Calculate the min/max X coordinates based on the actual curve data times
     const minX = this._timeToX(this._curveMinMinutes); // Use class method
     const maxX = this._timeToX(this._curveMaxMinutes); // Use class method

     // Clamp the pointer's X coordinate to the curve's boundaries
     const clampedX = Math.max(minX, Math.min(maxX, svgPoint.x));

     // Convert clamped X back to total minutes
     const draggedTotalMinutes = this._xToTotalMinutes(clampedX); // Use class method

     // Interpolate height based on the clamped dragged time
     const draggedHeight = this._interpolateHeight(draggedTotalMinutes); // Use class method

     if (draggedHeight !== null) {
         // Calculate the precise Y on the curve
         const draggedY = this._heightToY(draggedHeight); // Use class method

         // Move the dot visually using the clamped X and calculated Y
         dotCircle.center(clampedX, draggedY);
         // Also move the invisible hit area to keep it centered on the visible dot
         hitAreaCircle.center(clampedX, draggedY);

         // Format time and height for tooltip using the clamped time
         const hours = Math.floor(draggedTotalMinutes / 60);
         const minutes = Math.floor(draggedTotalMinutes % 60);
         const draggedTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
         const draggedHeightStr = draggedHeight.toFixed(2);

         // Store dragged position data
         this._draggedPosition = { timeStr: draggedTimeStr, heightStr: draggedHeightStr };
         this.requestUpdate('_draggedPosition'); // Update state

         // Update and show tooltip with dragged data
         // Pass the event 'e' for positioning, and isDragging = true
         this._showHtmlTooltip(e, draggedTimeStr, draggedHeightStr, true);
     }
  }

 _handleDragEnd(e, dotGroup, dotCircle, hitAreaCircle) { // Added hitAreaCircle
     if (!this._isDraggingDot) return;

     this._isDraggingDot = false;
     this.requestUpdate('_isDraggingDot'); // Update state

     // Revert color and cursor
     dotCircle.fill('var(--current_tide_color)');
     hitAreaCircle.attr('cursor', 'grab'); // Revert cursor on hit area

     // Move dot back to original position
     if (this._originalDotPosition) {
         dotCircle.center(this._originalDotPosition.x, this._originalDotPosition.y);
         // Also move the hit area back
         hitAreaCircle.center(this._originalDotPosition.x, this._originalDotPosition.y);
     }

     // Hide tooltip
     this._hideHtmlTooltip();

     // Clean up state
     this._draggedPosition = null;
     this.requestUpdate('_draggedPosition');

     // Remove window listeners
     if (this._boundHandleDragMove) {
         window.removeEventListener('mousemove', this._boundHandleDragMove);
         window.removeEventListener('touchmove', this._boundHandleDragMove);
     }
     if (this._boundHandleDragEnd) {
         // Mouseup listener was added with { once: true }, might not need removal
         // Touchend/cancel listeners were added with { once: true }, might not need removal
         // It's safer to remove them explicitly if they weren't {once: true}
         window.removeEventListener('mouseup', this._boundHandleDragEnd);
         window.removeEventListener('touchend', this._boundHandleDragEnd);
         window.removeEventListener('touchcancel', this._boundHandleDragEnd);
     }
     this._boundHandleDragMove = null;
     this._boundHandleDragEnd = null;
 }

 // --- NEW: Coordinate Conversion Helper ---
 _getSVGCoordinates(evt) {
     if (!this._svgDraw || !this._svgContainer) return null;

     const svg = this._svgContainer.querySelector('svg');
     if (!svg) return null;

     // Create an SVGPoint for transformations
     const pt = svg.createSVGPoint();

     // Get the screen coordinates from the event
     if (evt.touches && evt.touches.length > 0) {
         pt.x = evt.touches[0].clientX;
         pt.y = evt.touches[0].clientY;
     } else if (evt.clientX !== undefined && evt.clientY !== undefined) {
         pt.x = evt.clientX;
         pt.y = evt.clientY;
     } else {
         return null; // No coordinates found
     }

     // Transform the screen coordinates to SVG coordinates
     try {
         const svgPoint = pt.matrixTransform(svg.getScreenCTM().inverse());
         return { x: svgPoint.x, y: svgPoint.y };
     } catch (e) {
         console.error("Error transforming screen coordinates to SVG:", e);
         return null;
     }
 }

  // --- NEW: Coordinate/Interpolation Helper Methods ---

  _timeToX(totalMinutes) {
      if (!this._graphMargin || this._graphWidth === null) return 0; // Guard
      // Clamp totalMinutes to the allowed range (0 to 24*60) if needed, though clamping X is preferred
      // const clampedMinutes = Math.max(0, Math.min(1440, totalMinutes));
      return this._graphMargin.left + (totalMinutes / (24 * 60)) * this._graphWidth;
  }

  _heightToY(h) {
      if (!this._graphMargin || this._graphHeight === null || this._yDomainMin === null || !this._yRange) return 0; // Guard
      // Ensure height is within domain if necessary, though clamping X handles this indirectly
      // const clampedH = Math.max(this._yDomainMin, Math.min(this._yDomainMin + this._yRange, h));
      return this._graphMargin.top + this._graphHeight - ((h - this._yDomainMin) / this._yRange) * this._graphHeight;
  }

  _xToTotalMinutes(x) {
      if (!this._graphMargin || this._graphWidth === null || this._graphWidth <= 0) return 0; // Guard
      const clampedX = Math.max(this._graphMargin.left, Math.min(this._graphMargin.left + this._graphWidth, x));
      return ((clampedX - this._graphMargin.left) / this._graphWidth) * (24 * 60);
  }

  _interpolateHeight(targetTotalMinutes) {
      if (!this._pointsData || this._pointsData.length < 2) return null; // Guard, check _pointsData exists
      let prevPoint = null;
      let nextPoint = null;
      // Find the two points surrounding the target time
      for (let i = 0; i < this._pointsData.length; i++) {
          if (this._pointsData[i].totalMinutes <= targetTotalMinutes) prevPoint = this._pointsData[i];
          if (this._pointsData[i].totalMinutes > targetTotalMinutes) { nextPoint = this._pointsData[i]; break; }
      }
      // Handle edge cases (before first point or after last point)
      if (!prevPoint && nextPoint) return nextPoint.heightNum;
      if (prevPoint && !nextPoint) return prevPoint.heightNum;
      if (!prevPoint && !nextPoint) return null;

      // Interpolate
      const timeDiff = nextPoint.totalMinutes - prevPoint.totalMinutes;
      if (timeDiff <= 0) return prevPoint.heightNum;

      const timeProgress = (targetTotalMinutes - prevPoint.totalMinutes) / timeDiff;
      return prevPoint.heightNum + (nextPoint.heightNum - prevPoint.heightNum) * timeProgress;
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
        --current_tide_color: #FDD835;
        --tide-icon-color: var(--current_tide_color);
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
          padding: 0 16px 16px 16px; /* No top padding, standard sides/bottom */
      }

      /* Next Tide Status Display Styles */
      .next-tide-status {
        display: flex;
        flex-direction: column; /* Stack icon/time and details */
        align-items: flex-start; /* Align items to the left */
        gap: 4px; /* Smaller gap between lines */
        padding-bottom: 16px; /* Space before tabs */
        padding-left: 16px; /* Add left padding to match card content */
        padding-right: 16px; /* Add right padding */
        padding-top: 16px; /* Add top padding */
      }
      .next-tide-icon-time {
        display: flex;
        align-items: center; /* Vertically center icon and text block */
        align-content: center;
        gap: 8px;
      }
      .next-tide-icon-time ha-icon {
        color: var(--tide-icon-color);
        --mdc-icon-size: 2.4em; /* Adjusted size */
         /* margin-top removed for vertical centering */
         padding: 0;
      }
      .next-tide-text-container {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1; /* Tighten line height for the container */
      }
      .next-tide-trend-text {
        font-size: 1.0em; /* Smaller text for prefix */
        font-weight: 400;
        color: var(--tide-time-color); /* Same color as time */
        padding-bottom: 2px; /* Small space between text and time */
      }
      .next-tide-time {
        font-size: 1.5em; /* Adjusted time font size */
        font-weight: 400;
        color: var(--tide-time-color);
        line-height: 1; /* Keep tight line height */
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
      .next-tide-details .warning-coef {
         color: var(--warning-color);
         font-weight: bold; /* Make it stand out more */
      }
      /* Separator is now handled directly in the HTML template */


      .tabs {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 16px;
        gap: 4px;
        padding-left: 16px; /* Add left padding */
        padding-right: 16px; /* Add right padding */
      }
      .tab {
        display: flex; /* Use flexbox for vertical alignment */
        flex-direction: column; /* Stack day and date */
        justify-content: center; /* Center content vertically */
        align-items: center; /* Center content horizontally */
        text-align: center;
        padding: 6px 4px;
        border-radius: 6px;
        background: var(--tab-inactive-background);
        color: var(--tab-inactive-text-color);
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
        line-height: 1.2; /* Adjust line height for stacked text */
      }
      .tab-day {
        font-size: 14px; /* Keep original size */
        font-weight: inherit; /* Inherit weight from .tab or .tab.active */
      }
      .tab-date {
        font-size: 10px; /* Smaller font size for date */
        color: var(--secondary-text-color); /* Use secondary color */
        margin-top: 2px; /* Small space between day and date */
      }
      .tab:hover {
         filter: brightness(95%);
      }
      .tab.active {
        background: var(--tab-active-background);
        color: var(--tab-active-text-color);
        font-weight: bold;
      }
      .tab.active .tab-date {
         color: var(--text-primary-color); /* Make date color match active text color */
         opacity: 0.8; /* Slightly less prominent */
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
        aspect-ratio: 500 / 200; /* Updated aspect ratio */
        width: 100%;
        height: auto; /* Let aspect-ratio control height */
        max-height: 220px; /* Optional max height increased */
        margin-top: 10px; /* Space above graph */
        /* padding-left: 16px; */ /* REMOVED - Let card content padding handle alignment */
        /* padding-right: 16px; */ /* REMOVED - Let card content padding handle alignment */
      }
      .svg-graph-container .loading-icon {
        position: absolute; /* Position over the graph area */
        font-size: 3em; /* Adjust size as needed */
        color: var(--primary-color); /* Use primary color */
        animation: rotate 1.5s linear infinite; /* Apply rotation */
        z-index: 10; /* Ensure loader is above SVG content */
        opacity: 1; /* Final state */
        transition: opacity 1s ease-in; /* Fade-in effect */
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
      /* Add cursor pointer to elements with tooltips */
      .svg-graph-target svg .has-tooltip {
          cursor: pointer;
      }
      /* NEW: Style for draggable dot */
      .svg-graph-target svg .draggable-dot {
          /* Add specific styles if needed, e.g., hover effects */
      }
      /* Tooltip styles (within SVG) - Not used for HTML tooltip */
      #marker-tooltip {
          pointer-events: none; /* Tooltip should not capture mouse events */
          transition: opacity 0.1s ease-in-out;
      }

      /* HTML Tooltip Styles */
      .chart-tooltip {
        position: absolute; /* Position relative to the card content area */
        display: none; /* Hidden by default */
        background-color: var(--secondary-background-color, #f0f0f0); /* Match coef box background */
        color: var(--primary-text-color, black); /* Keep text color primary */
        border: 1px solid var(--ha-card-border-color, var(--divider-color, grey)); /* Match coef box border */
        border-radius: 4px;
        padding: 4px 6px; /* Reduced padding */
        font-size: 12px;
        white-space: nowrap; /* Prevent wrapping */
        z-index: 100; /* Ensure it's above the SVG */
        pointer-events: none; /* Tooltip should not interfere with mouse */
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        transition: opacity 0.1s ease-in-out; /* Add transition for fade */
        opacity: 0; /* Start hidden */
      }
      .chart-tooltip strong {
        font-weight: bold;
      }
    `;
  }
} // End of class

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
