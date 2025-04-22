import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@^2.0.0/lit-element.js?module";
// mwc-icon should be globally available in Home Assistant
// Import ha-form and related components if not globally available
// These might be needed depending on the HA version and setup
// import "https://unpkg.com/@polymer/paper-input/paper-input.js?module";
// import "https://unpkg.com/@polymer/paper-item/paper-item.js?module";
// import "https://unpkg.com/@polymer/paper-listbox/paper-listbox.js?module";
// import "https://unpkg.com/@polymer/paper-dropdown-menu/paper-dropdown-menu.js?module";
// import "https://unpkg.com/@polymer/paper-checkbox/paper-checkbox.js?module";
// import "https://unpkg.com/home-assistant-js-websocket/dist/haws.umd.js?module"; // For hass object types if needed
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-form/ha-form?module";
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-entity-picker?module";
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-checkbox?module";


const weekdayShort = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// Helper function to get current tide status
function getCurrentTideStatus(tideData, hass) {
  if (!tideData || !hass) return null;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.setDate(now.getDate() + 1)).toISOString().slice(0, 10);
  now.setDate(now.getDate() -1); // Reset date back to today for calculations

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
          dateTime: new Date(`${tide.date}T${tide.time}:00`) // Assume local timezone
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
       return { statusText: "En attente de la prochaine marée", icon: "mdi:clock-outline", coefficient: null, height: null };
  }


  if (previousTide && nextTide) {
      const timeToNextTide = Math.round((nextTide.dateTime - now) / (1000 * 60)); // minutes
      const hours = Math.floor(timeToNextTide / 60);
      const minutes = timeToNextTide % 60;
      const timeStr = `${hours > 0 ? `${hours}h` : ''}${minutes}min`;

      if (previousTide.type === 'low') { // Rising tide
          const coefficient = nextTide.coefficient || null; // Coefficient is on the high tide
          currentStatus = {
              statusText: `Monte jusqu'à ${nextTide.time} (${timeStr})`,
              icon: 'mdi:waves-arrow-right',
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
              statusText: `Descend jusqu'à ${nextTide.time} (${timeStr})`,
              icon: 'mdi:waves-arrow-left',
              coefficient: coefficient, // Show next high tide's coeff
              height: nextTide.height // Height at low point
          };
      }
  } else if (nextTide) {
       // If only next tide is known (e.g., before the first tide)
       currentStatus = {
           statusText: `Prochaine marée (${nextTide.type === 'high' ? 'Haute' : 'Basse'}) à ${nextTide.time}`,
           icon: nextTide.type === 'high' ? 'mdi:waves-arrow-right' : 'mdi:waves-arrow-left',
           coefficient: nextTide.coefficient,
           height: nextTide.height
       };
  } else {
      currentStatus = { statusText: "Données de marée non disponibles", icon: "mdi:help-circle-outline", coefficient: null, height: null };
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
    // Dynamically import the editor module
    await import("./marees-france-card-editor.js");
    return document.createElement("marees-france-card-editor");
  }

  static getStubConfig(hass, entities) {
      const mareesEntities = entities.filter(eid => eid.startsWith("sensor.marees_france_"));
      return {
          entity: mareesEntities[0] || "sensor.marees_france_port_name", // Default or first found
          show_header: true,
          title: "Marées France"
      };
  }


  setConfig(config) {
    if (!config.entity) {
      throw new Error("You need to define an entity");
    }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10); // Default to today
  }

  _handleTabClick(ev) {
    this._selectedDay = ev.currentTarget.dataset.date;
  }

  render() {
    if (!this.hass || !this.config || !this.config.entity) {
      return html`<ha-card>Missing configuration</ha-card>`;
    }

    const entityState = this.hass.states[this.config.entity];
    if (!entityState) {
      return html`<ha-card header="${this.config.title || 'Marées France'}">
        <div class="warning">Entity not found: ${this.config.entity}</div>
      </ha-card>`;
    }

    const tideData = entityState.attributes.data;
    if (!tideData) {
      return html`<ha-card header="${this.config.title || 'Marées France'}">
        <div class="warning">No tide data found in entity attributes.</div>
      </ha-card>`;
    }

    const currentStatus = getCurrentTideStatus(tideData, this.hass);

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

    return html`
      <ha-card header="${this.config.show_header !== false ? (this.config.title || 'Marées France') : ''}">
        <div class="card-content">
          <!-- Current Status -->
          ${currentStatus ? html`
            <div class="current-status">
              <ha-icon .icon=${currentStatus.icon}></ha-icon>
              <div class="status-text">
                <span>${currentStatus.statusText}</span>
                <div class="status-details">
                  ${currentStatus.height !== null ? html`
                    <span title="Hauteur">
                      <ha-icon icon="mdi:waves-arrow-up"></ha-icon> ${currentStatus.height} m
                    </span>` : ''}
                  ${currentStatus.coefficient !== null ? html`
                    <span title="Coefficient">
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
              const label = weekdayShort[d.getDay()];
              const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
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
            ${allTides.length > 0
              ? allTides.map(tide => this._renderTide(tide))
              : html`<div class="empty">Aucune donnée de marée pour ce jour.</div>`
            }
          </div>
        </div>
      </ha-card>
    `;
  }

  _renderTide(tide) {
    const isHigh = tide.type === 'high';
    const icon = isHigh ? 'mdi:waves-arrow-right' : 'mdi:waves-arrow-left';
    const statusText = isHigh ? 'Haute' : 'Basse';

    return html`
      <div class="tide-entry">
        <div class="tide-main">
           <ha-icon .icon=${icon}></ha-icon>
           <span class="tide-status">${statusText} à ${tide.time}</span>
        </div>
        <div class="tide-details">
            <span class="tide-detail" title="Hauteur">
                <ha-icon icon="mdi:waves-arrow-up"></ha-icon> ${tide.height} m
            </span>
            ${isHigh && tide.coefficient ? html`
                <span class="tide-detail" title="Coefficient">
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
        gap: 15px;
        margin-top: 4px;
      }
      .status-details span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .status-details ha-icon {
         font-size: 1.2em;
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
        flex-direction: column;
        gap: 10px; /* Space between tide entries */
      }

      .tide-entry {
        display: flex;
        flex-direction: column; /* Stack main info and details */
        padding: 10px;
        background-color: var(--ha-card-background, var(--card-background-color, #ffffff)); /* Use card background */
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1); /* Subtle shadow */
        border-left: 5px solid var(--primary-color); /* Accent border */
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
        gap: 15px; /* Space between height and coefficient */
        padding-left: 32px; /* Indent details to align under status text (icon width + gap) */
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

customElements.define('marees-france-card', MareesFranceCard);

// Registration is handled by frontend/__init__.py
