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
      error_entity_required: "Missing entity, please configure the card first",
      entity_not_found: "Entity not found: {entity}",
      no_tide_data: "No tide data found in entity attributes.",
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
      error_entity_required: "Entité manquante, veuillez d'abord configurer la carte",
      entity_not_found: "Entité non trouvée : {entity}",
      no_tide_data: "Aucune donnée de marée trouvée dans les attributs de l'entité.",
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
function getNextTideStatus(tideData, hass) {
  if (!tideData || !hass) return null;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  // Look ahead 2 days to ensure we capture the next tide even if it's early tomorrow
  const tomorrowStr = new Date(new Date(now).setDate(now.getDate() + 1)).toISOString().slice(0, 10);
  const dayAfterTomorrowStr = new Date(new Date(now).setDate(now.getDate() + 2)).toISOString().slice(0, 10);

  const todayTides = tideData[todayStr] ? [
      ...(tideData[todayStr].high_tides?.map(t => ({ ...t, type: 'high', date: todayStr })) || []),
      ...(tideData[todayStr].low_tides?.map(t => ({ ...t, type: 'low', date: todayStr })) || [])
  ] : [];

  const tomorrowTides = tideData[tomorrowStr] ? [
      ...(tideData[tomorrowStr].high_tides?.map(t => ({ ...t, type: 'high', date: tomorrowStr })) || []),
      ...(tideData[tomorrowStr].low_tides?.map(t => ({ ...t, type: 'low', date: tomorrowStr })) || [])
  ] : [];

  const dayAfterTomorrowTides = tideData[dayAfterTomorrowStr] ? [
      ...(tideData[dayAfterTomorrowStr].high_tides?.map(t => ({ ...t, type: 'high', date: dayAfterTomorrowStr })) || []),
      ...(tideData[dayAfterTomorrowStr].low_tides?.map(t => ({ ...t, type: 'low', date: dayAfterTomorrowStr })) || [])
  ] : [];


  const allRelevantTides = [...todayTides, ...tomorrowTides, ...dayAfterTomorrowTides]
      .map(tide => ({
          ...tide,
          dateTime: new Date(`${tide.date}T${tide.time}:00`)
      }))
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
      _waterLevels: { state: true }, // Added state property for water level data
      _isLoading: { state: true }, // Added state property for loading status
      _isInitialLoading: { state: true }, // Track initial load vs subsequent loads
    };
  }

  // Define card editor
  static async getConfigElement() {
    return document.createElement("marees-france-card-editor");
  }

  static getStubConfig(hass, entities) {
      const mareesEntities = entities.filter(eid => eid.startsWith("sensor.marees_france_"));
      return {
          entity: mareesEntities[0] || "sensor.marees_france_port_name", // Default or first found
          show_header: true, // Keep header option, but we won't use the title from config
      };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error(localizeCard('ui.card.marees_france.error_entity_required', this.hass) || "Entity required");
    }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10); // Default to today
    this._waterLevels = null; // Reset water levels on config change
    this._isLoading = true; // Initialize loading state to true
    this._isInitialLoading = true; // Set initial loading flag
    // Fetch will be triggered by `updated`
  }

  async _fetchWaterLevels() {
    // Set loading true when fetch actually starts
    this._isLoading = true;
    this.requestUpdate(); // Show loader

    if (!this.hass || !this.config || !this.config.entity || !this._selectedDay) {
      console.warn("Marees Card: Fetch prerequisites not met.", { hass: !!this.hass, config: !!this.config, entity: this.config?.entity, day: this._selectedDay });
      this._waterLevels = null; // Keep null if prerequisites fail
      this._isLoading = false; // Set loading false
      this.requestUpdate(); // Update UI
      return;
    }

    // No need for immediate requestUpdate here, initial render/update cycle will handle loader

    // Derive harbor_name from entity_id (e.g., sensor.marees_france_le_palais -> LE_PALAIS)
    const entityParts = this.config.entity.split('.');
    let harborName = "unknown";
    if (entityParts.length === 2 && entityParts[0] === 'sensor' && entityParts[1].startsWith('marees_france_')) {
        // Convert to uppercase as API seems to expect it (based on example LE_PALAIS)
        harborName = entityParts[1].substring('marees_france_'.length).toUpperCase();
    } else {
        console.warn(`Marees France Card: Could not derive harbor name from entity: ${this.config.entity}`);
        this._waterLevels = { error: "Invalid entity for harbor name derivation" };
        this.requestUpdate(); // Request update to show error
        return;
    }
    try {
      // Using 6-argument callService based on user example
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_water_levels', // service
        { // data
          harbor_name: harborName,
          date: this._selectedDay
        },
        undefined, // target (not needed)
        false, // blocking (usually false for frontend calls)
        true // return_response
      );

      // Refinement: Check response structure before assigning
      if (response && response.response && typeof response.response === 'object') {
          this._waterLevels = response;
      } else {
          console.error('Marees Card: Invalid data structure received from get_water_levels:', response);
          this._waterLevels = { error: "Invalid data structure from service" };
      }
      this.requestUpdate(); // Explicitly request update after fetch attempt
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_water_levels service:', error); // Log error
      this._waterLevels = { error: error.message || "Service call failed" };
      // Let LitElement handle update via state change on error
      // No need for explicit requestUpdate here, state change handles it
    } finally {
        this._isLoading = false; // Set loading false after fetch completes or fails
        this._isInitialLoading = false; // Turn off initial loading flag after first attempt
        this.requestUpdate(); // Ensure UI updates after loading finishes
    }
  }


  _handleTabClick(ev) {
    this._selectedDay = ev.currentTarget.dataset.date;
    // Don't set loading here, _fetchWaterLevels will handle it
    this._fetchWaterLevels(); // Fetch data for the new day
  }

  render() {
    if (!this.hass || !this.config || !this.config.entity) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.error_entity_required', this.hass)}</div></ha-card>`;
    }

    const entityState = this.hass.states[this.config.entity];
    if (!entityState) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.entity_not_found', this.hass, 'entity', this.config.entity)}</div></ha-card>`;
    }

    const tideData = entityState.attributes.data;
    if (!tideData) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div></ha-card>`;
    }

    // Use the refined function to get status for the header display
    const nextTideInfo = getNextTideStatus(tideData, this.hass);
    const locale = this.hass.language || 'en';

    const today = new Date();
    const dayLabels = [...Array(7).keys()].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().slice(0, 10);
    });


    return html`
      <ha-card>
        <div class="card-header">${this.config.title || localizeCard('ui.card.marees_france.default_title', this.hass)}</div>
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
            ${this._isLoading ? html`
              <ha-icon icon="mdi:loading" class="loading-icon"></ha-icon>
            ` : ''}
            <!-- Target for svg.js -->
            <div id="marees-graph-target" class="svg-graph-target">
               <!-- SVG will be drawn here by svg.js -->
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

    // Trigger initial data fetch when hass becomes available and data hasn't been fetched yet
    if (changedProperties.has('hass') && this.hass && this._waterLevels === null) {
        // Removed !this._isLoading check - we want to fetch if hass is ready and data is null, regardless of initial loading state
        console.log("Marees Card: Hass available and no data yet, triggering initial fetch.");
        this._fetchWaterLevels();
        needsGraphRedraw = true; // Ensure graph updates after fetch starts
    }

    // Check if other relevant properties changed
    if (changedProperties.has('config') || changedProperties.has('_selectedDay') || changedProperties.has('_waterLevels') || changedProperties.has('_isLoading')) {
        needsGraphRedraw = true;
    }

    // Redraw graph if needed, SVG is ready, AND loading is finished
    if (needsGraphRedraw && this._svgDraw && this._svgContainer && !this._isLoading) {
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

    // --- 1. Check for Errors or Missing Data (after loading is false) ---
    // Check if the main response object exists, has an error, or lacks the 'response' property
    if (!this._waterLevels || this._waterLevels.error || !this._waterLevels.response) {
      // Draw error message in SVG container (canvas already cleared)
      const errorMessage = this._waterLevels?.error
          ? `Error: ${this._waterLevels.error}`
          : localizeCard('ui.card.marees_france.no_data_available', this.hass);
      this._svgDraw.text(errorMessage)
          .move(viewBoxWidth / 2, viewBoxHeight / 2) // Center roughly
          .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      return;
    }

    // Access the actual tide data array within the 'response' object using the selected day
    const levelsData = this._waterLevels.response[this._selectedDay];

    // --- 2. Check for Data for the Selected Day ---
    if (!Array.isArray(levelsData) || levelsData.length === 0) {
        // Draw 'no data' message (canvas already cleared)
        this._svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass))
            .move(viewBoxWidth / 2, viewBoxHeight / 2) // Center roughly
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
    // --- Tide Markers Data ---
    const entityState = this.hass.states[this.config.entity]; // Need entityState here
    const tideEvents = [];
    if (entityState && entityState.attributes.data && entityState.attributes.data[this._selectedDay]) {
        const dayData = entityState.attributes.data[this._selectedDay];
        (dayData.high_tides || []).forEach(t => tideEvents.push({ ...t, type: 'high' }));
        (dayData.low_tides || []).forEach(t => tideEvents.push({ ...t, type: 'low' }));
    }
    const tideMarkers = tideEvents.map(event => {
        const [hours, minutes] = event.time.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        const height = parseFloat(event.height);
        if (isNaN(height)) return null; // Skip if height is invalid
        const x = timeToX(totalMinutes);
        const y = heightToY(height);
        const isHigh = event.type === 'high';
        return { x: x, y: y, time: event.time, height: height, coefficient: isHigh ? event.coefficient : null, isHigh: isHigh };
    }).filter(m => m !== null); // Filter out invalid markers

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
          font-size: 1.2em; /* Slightly larger */
          font-weight: 500;
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
