import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@^2.0.0/lit-element.js?module";

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
      tide_at_time: "{status} at {time}"
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
      tide_at_time: "{status} à {time}"
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
    // console.warn(`Translation key not found: ${key} in language: ${lang}`);
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

// Pass hass directly
function getCurrentTideStatus(tideData, hass) {
  // Check hass availability
  if (!tideData || !hass) return null;

  const localize = (key, ...args) => localizeCard(key, hass, ...args);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(new Date(now).setDate(now.getDate() + 1)).toISOString().slice(0, 10);
  // No need to reset date back, calculations use specific strings

  const todayTides = tideData[todayStr] ? [
      ...(tideData[todayStr].high_tides?.map(t => ({ ...t, type: 'high', date: todayStr })) || []),
      ...(tideData[todayStr].low_tides?.map(t => ({ ...t, type: 'low', date: todayStr })) || [])
  ] : [];

  const tomorrowTides = tideData[tomorrowStr] ? [
      ...(tideData[tomorrowStr].high_tides?.map(t => ({ ...t, type: 'high', date: tomorrowStr })) || []),
      ...(tideData[tomorrowStr].low_tides?.map(t => ({ ...t, type: 'low', date: tomorrowStr })) || [])
  ] : [];

  const allRelevantTides = [...todayTides, ...tomorrowTides]
      .map(tide => ({
          ...tide,
          dateTime: new Date(`${tide.date}T${tide.time}:00`) // Assume local timezone from HA
      }))
      .sort((a, b) => a.dateTime - b.dateTime);

  let currentStatus = null;
  let nextTide = null;
  let previousTide = null;

  for (let i = 0; i < allRelevantTides.length; i++) {
      if (allRelevantTides[i].dateTime > now) {
          nextTide = allRelevantTides[i];
          if (i > 0) {
              previousTide = allRelevantTides[i - 1];
          }
          break;
      }
  }

  if (!previousTide && allRelevantTides.length > 0 && allRelevantTides[0].dateTime <= now) {
      // If 'now' is after the last tide of today but before the first of tomorrow
      // Find the last tide of today if available
      const lastTodayTide = todayTides.sort((a,b) => new Date(`${b.date}T${b.time}:00`) - new Date(`${a.date}T${a.time}:00`))[0];
       if (lastTodayTide) {
           previousTide = { ...lastTodayTide, dateTime: new Date(`${lastTodayTide.date}T${lastTodayTide.time}:00`) };
       }
       // nextTide should already be the first tide of tomorrow if it exists
  } else if (!previousTide && !nextTide && allRelevantTides.length > 0) {
      // Edge case: If 'now' is before the very first tide available
       nextTide = allRelevantTides[0];
       // Cannot determine status reliably without a previous tide
       return { statusText: localize('ui.card.marees_france.waiting_next_tide'), icon: "mdi:clock-outline", coefficient: null, height: null };
  }


  if (previousTide && nextTide) {
      const timeToNextTide = Math.round((nextTide.dateTime - now) / (1000 * 60)); // minutes
      const hours = Math.floor(timeToNextTide / 60);
      const minutes = timeToNextTide % 60;
      const timeStr = `${hours > 0 ? `${hours}h` : ''}${minutes}min`;

      if (previousTide.type === 'low') { // Rising tide
          const coefficient = nextTide.coefficient || null; // Coefficient is on the high tide
          currentStatus = {
              statusText: localize('ui.card.marees_france.rising_until', 'time', nextTide.time, 'duration', timeStr),
            icon: 'mdi:arrow-expand-up',
              coefficient: coefficient,
              height: nextTide.height // Height at peak
          };
      } else { // Falling tide
          // If falling, show coefficient of the *next* high tide if available
          let nextHighTide = null;
          for (let i = 0; i < allRelevantTides.length; i++) {
              if (allRelevantTides[i].dateTime > now && allRelevantTides[i].type === 'high') {
                  nextHighTide = allRelevantTides[i];
                  break;
              }
          }
          const coefficient = nextHighTide ? nextHighTide.coefficient : null;

          currentStatus = {
              statusText: localize('ui.card.marees_france.falling_until', 'time', nextTide.time, 'duration', timeStr),
            icon: 'mdi:arrow-expand-down',
              coefficient: coefficient, // Show next high tide's coeff
              height: nextTide.height // Height at low point
          };
      }
  } else if (nextTide) {
       // If only next tide is known (e.g., before the first tide)
       const tideType = nextTide.type === 'high' ? localize('ui.card.marees_france.high_tide_short') : localize('ui.card.marees_france.low_tide_short');
       currentStatus = {
           statusText: localize('ui.card.marees_france.next_tide_at', 'type', tideType, 'time', nextTide.time),
         icon: nextTide.type === 'high' ? 'mdi:arrow-expand-up' : 'mdi:arrow-expand-down',
           coefficient: nextTide.coefficient,
           height: nextTide.height
       };
  } else {
      currentStatus = { statusText: localize('ui.card.marees_france.no_data_available'), icon: "mdi:help-circle-outline", coefficient: null, height: null };
  }

  return currentStatus;
}


class MareesFranceCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _selectedDay: { state: true },
    };
  }

  // Define card editor
  static async getConfigElement() {
    return document.createElement("marees-france-card-editor");
  }

  static getStubConfig(hass, entities) {
      const mareesEntities = entities.filter(eid => eid.startsWith("sensor.marees_france_"));
      const localize = (key, ...args) => localizeCard(key, hass, ...args);
      return {
          entity: mareesEntities[0] || "sensor.marees_france_port_name", // Default or first found
          show_header: true,
          title: localize('ui.card.marees_france.default_title')
      };
  }

  // _localize helper is no longer needed

  setConfig(config) {
    // No longer throw error here, let render handle it.
    // if (!config.entity) {
    //   // Use localizeCard directly, hass might not be ready, so provide fallback text
    //   throw new Error(localizeCard('ui.card.marees_france.error_entity_required', this.hass) || "Entity required");
    // }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10); // Default to today
  }

  _handleTabClick(ev) {
    this._selectedDay = ev.currentTarget.dataset.date;
  }

  render() {
    if (!this.hass || !this.config || !this.config.entity) {
      // Use the more specific message when entity is missing
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.error_entity_required', this.hass)}</div></ha-card>`;
    }

    const entityState = this.hass.states[this.config.entity];
    const defaultTitle = localizeCard('ui.card.marees_france.default_title', this.hass);
    const cardTitle = this.config.show_header !== false ? (this.config.title || defaultTitle) : '';

    if (!entityState) {
      return html`<ha-card header="${cardTitle}">
        <div class="warning">${localizeCard('ui.card.marees_france.entity_not_found', this.hass, 'entity', this.config.entity)}</div>
      </ha-card>`;
    }

    const tideData = entityState.attributes.data;
    if (!tideData) {
      return html`<ha-card header="${cardTitle}">
        <div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div>
      </ha-card>`;
    }

    // Pass hass directly to getCurrentTideStatus
    const currentStatus = getCurrentTideStatus(tideData, this.hass);
    const locale = this.hass.language || 'en'; // Default to English if language not set

    const today = new Date();
    const dayLabels = [...Array(7).keys()].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().slice(0, 10);
    });

    const currentDayData = tideData[this._selectedDay];

    // Combine and sort tides for the selected day
    const allTides = currentDayData ? [
      ...(currentDayData.high_tides?.map(t => ({ ...t, type: 'high' })) || []),
      ...(currentDayData.low_tides?.map(t => ({ ...t, type: 'low' })) || [])
    ].sort((a, b) => a.time.localeCompare(b.time)) : [];

      // Process tides into rows [high, low]
      const tideRows = [];
      let currentRow = [null, null]; // [high, low]
      allTides.forEach(tide => {
        if (tide.type === 'high') {
          // If there's a pending high tide without a low, or a low tide without a high, push the previous row
          if (currentRow[0] !== null || currentRow[1] !== null) {
             // Avoid pushing empty [null, null] if the day starts with high tide
             if (currentRow[0] !== null || currentRow[1] !== null) {
                 tideRows.push([...currentRow]);
             }
          }
          // Start a new row with the high tide
          currentRow = [tide, null];
        } else if (tide.type === 'low') {
          if (currentRow[0] === null) {
            // If day starts with low or previous row was just completed
             // Push the previous row only if it wasn't empty [null, null] and wasn't just a low tide
             if (currentRow[1] !== null) { // Handles consecutive lows if data is weird
                tideRows.push([...currentRow]);
             }
            currentRow = [null, tide]; // Start new row with low tide in the second slot
          } else {
            // Pair the low tide with the pending high tide
            currentRow[1] = tide;
            tideRows.push([...currentRow]);
            currentRow = [null, null]; // Reset for the next pair
          }
        }
      });
      // Push the last row if it's not empty
      if (currentRow[0] !== null || currentRow[1] !== null) {
        tideRows.push([...currentRow]);
      }

    return html`
      <ha-card header="${cardTitle}">
        <div class="card-content">
          <!-- Current Status -->
          ${currentStatus ? html`
            <div class="current-status">
              <ha-icon .icon=${currentStatus.icon}></ha-icon>
              <div class="status-text">
                <span>${currentStatus.statusText}</span>
                <div class="status-details">
                  ${currentStatus.height !== null ? html`
                    <span title="${localizeCard('ui.card.marees_france.height', this.hass)}">
                      <ha-icon icon="mdi:arrow-expand-vertical"></ha-icon> ${currentStatus.height} m
                    </span>` : ''}
                  ${currentStatus.coefficient !== null ? html`
                    <span title="${localizeCard('ui.card.marees_france.coefficient', this.hass)}">
                      <ha-icon icon="mdi:gauge"></ha-icon> ${currentStatus.coefficient}
                    </span>` : ''}
                </div>
              </div>
            </div>
          ` : ''}

          <!-- Tabs -->
          <div class="tabs">
            ${dayLabels.map(date => {
              const d = new Date(date);
              // Use helper function for localized weekday
              const label = getWeekdayShort(d.getDay(), locale);
              // Use locale for date format
              const dateStr = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
              return html`
                <div
                  class="tab ${this._selectedDay === date ? 'active' : ''}"
                  data-date="${date}"
                  @click="${this._handleTabClick}"
                >
                  ${label}<br /><span class="tab-date">${dateStr}</span>
                </div>
              `;
            })}
          </div>

          <!-- Tide List -->
          <div class="tide-list">
            ${tideRows.length > 0
              ? tideRows.map(row => html`
                  <div class="tide-row">
                    <div class="tide-cell high-tide">
                      ${row[0] ? this._renderTide(row[0]) : ''}
                    </div>
                    <div class="tide-cell low-tide">
                      ${row[1] ? this._renderTide(row[1]) : ''}
                    </div>
                  </div>
                `)
              : html`<div class="empty">${localizeCard('ui.card.marees_france.no_data_for_day', this.hass)}</div>`
            }
          </div>
        </div>
      </ha-card>
    `;
  }

  _renderTide(tide) {
    const isHigh = tide.type === 'high';
    const icon = isHigh ? 'mdi:arrow-expand-up' : 'mdi:arrow-expand-down';
    // Use localizeCard directly
    const statusText = isHigh ? localizeCard('ui.card.marees_france.high_tide', this.hass) : localizeCard('ui.card.marees_france.low_tide', this.hass);

    return html`
      <div class="tide-entry">
        <div class="tide-main">
           <ha-icon .icon=${icon}></ha-icon>
           <span class="tide-status">${localizeCard('ui.card.marees_france.tide_at_time', this.hass, 'status', statusText, 'time', tide.time)}</span>
        </div>
        <div class="tide-details">
            <span class="tide-detail" title="${localizeCard('ui.card.marees_france.height', this.hass)}">
                <ha-icon icon="mdi:arrow-expand-vertical"></ha-icon> ${tide.height} m
            </span>
            ${isHigh && tide.coefficient ? html`
                <span class="tide-detail" title="${localizeCard('ui.card.marees_france.coefficient', this.hass)}">
                    <ha-icon icon="mdi:gauge"></ha-icon> ${tide.coefficient}
                </span>
            ` : ''}
        </div>
      </div>
    `;
  }


  getCardSize() {
    // Estimate based on content: header + current status + tabs + ~3 tides
    return 1 + 1 + 1 + 3;
  }

  static get styles() {
    return css`
      :host {
        --tide-icon-color: var(--primary-text-color);
        --tide-time-color: var(--primary-text-color);
        --tide-detail-color: var(--secondary-text-color);
        --tab-inactive-background: var(--ha-card-background, var(--card-background-color, #f0f0f0));
        --tab-active-background: var(--primary-color);
        --tab-inactive-text-color: var(--secondary-text-color);
        --tab-active-text-color: var(--text-primary-color, white); /* Color for text on active tab */
        --current-status-background: rgba(var(--rgb-primary-color), 0.1); /* Subtle background for status */
        display: block;
      }
      .warning {
        background-color: var(--error-color);
        color: var(--text-primary-color);
        padding: 8px;
        text-align: center;
        border-radius: 4px;
        margin-bottom: 10px;
      }
      .current-status {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        margin-bottom: 16px;
        background-color: var(--current-status-background);
        border-radius: 8px;
      }
      .current-status ha-icon {
        font-size: 2em; /* Larger icon for current status */
        color: var(--primary-color);
      }
      .status-text {
        flex-grow: 1;
        font-size: 1.1em;
      }
      .status-details {
        font-size: 0.9em;
        color: var(--secondary-text-color);
        display: flex;
        gap: 10px;
        margin-top: 4px;
      }
      .status-details span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .status-details ha-icon {
         font-size: 1em;
         color: var(--secondary-text-color);
      }

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
      .tab-date {
        font-size: 11px;
        color: var(--secondary-text-color); /* Ensure date color is subtle */
      }
      .tab.active {
        background: var(--tab-active-background);
        color: var(--tab-active-text-color);
        font-weight: bold;
      }
      .tab.active .tab-date {
         color: var(--tab-active-text-color); /* Make date color match active tab text */
         opacity: 0.8;
      }

      .tide-list {
        display: flex;
        flex-direction: column; /* Keep column flex for overall list */
        gap: 8px; /* Space between rows */
      }

      .tide-row { 
        display: grid;
        grid-template-columns: 1.2fr 1fr; /* Two columns */
        gap: 8px; /* Space between columns */
        align-items: start; /* Align items to the top of the cell */
      }

      .tide-cell {
        /* Cells will contain a tide-entry or be empty */
        min-height: 50px; /* Ensure empty cells have some height */
      }



      .tide-entry {
        display: flex;
        flex-direction: column; /* Stack main info and details */
        padding: 5px;
        background-color: var(--ha-card-background, var(--card-background-color, #ffffff)); /* Use card background */
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1); /* Subtle shadow */
      }

      .tide-main {
        display: flex;
        align-items: center;
        gap: 8px; /* Space between icon and text */
        margin-bottom: 6px; /* Space between main line and details */
      }

      .tide-main ha-icon {
        color: var(--tide-icon-color);
      }

      .tide-status {
        font-weight: 500; /* Slightly bolder status */
        color: var(--tide-time-color);
      }

      .tide-details {
        display: flex;
        align-items: center;
        gap: 10px; /* Space between height and coefficient */
        padding-left: 30px; /* Indent details to align under status text (icon width + gap) */
      }

      .tide-detail {
        display: flex;
        align-items: center;
        gap: 4px; /* Space between detail icon and value */
        font-size: 0.9em;
        color: var(--tide-detail-color);
      }

      .tide-detail ha-icon {
        font-size: 1.1em; /* Slightly larger detail icons */
        color: var(--tide-detail-color);
      }

      .empty {
        font-style: italic;
        color: var(--secondary-text-color);
        text-align: center;
        padding: 10px;
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

