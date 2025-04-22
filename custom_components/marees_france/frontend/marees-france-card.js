class MareesFranceCard extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.attachShadow({ mode: 'open' });
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  render() {
    if (!this._hass || !this.config || !this.config.entity) return;

    const entity = this._hass.states[this.config.entity];
    if (!entity) return;

    const tideData = entity.attributes.data;
    if (!tideData) return;

    const today = new Date();
    const dayLabels = [...Array(7).keys()].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().slice(0, 10);
    });

    const selectedDay = this._selectedDay || dayLabels[0];
    const currentData = tideData[selectedDay];

    const style = `
      <style>
        :host {
          --primary: var(--primary-color, #03a9f4);
          --card-bg: var(--card-background-color, #fff);
          --text-color: var(--primary-text-color, #000);
          --text-subtle: var(--secondary-text-color, #666);
          display: block;
        }

        ha-card {
          background: var(--card-bg);
          color: var(--text-color);
        }

        .tabs {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          margin-bottom: 12px;
          gap: 4px;
        }

        .tab {
          text-align: center;
          padding: 6px 4px;
          border-radius: 6px;
          background: var(--ha-card-background, #ddd);
          color: var(--text-subtle);
          font-weight: 500;
          cursor: pointer;
          user-select: none;
          font-size: 14px;
        }

        .tab-date {
          font-size: 11px;
        }
		

        .tab.active {
          background: var(--primary);
          color: var(--text-color);
        }

        .tide-entry {
          margin: 8px 0;
          padding: 6px 10px;
          border-left: 4px solid var(--primary);
          background: rgba(0, 0, 0, 0.05);
          border-radius: 4px;
        }

        .tide-type {
          font-weight: bold;
          margin-bottom: 2px;
        }

        .empty {
          font-style: italic;
          color: var(--text-subtle);
        }
      </style>
    `;

    const weekdayShort = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    const tabs = `
      <div class="tabs">
        ${dayLabels.map(date => {
          const d = new Date(date);
          const label = weekdayShort[d.getDay()];
          const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
          return `
            <div class="tab ${selectedDay === date ? 'active' : ''}" data-date="${date}">
              ${label}<br><span class="tab-date">${dateStr}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    // Fusionne marées hautes/basses + tri par heure
    const allTides = [
      ...(currentData?.high_tides?.map(t => ({ ...t, type: 'high' })) || []),
      ...(currentData?.low_tides?.map(t => ({ ...t, type: 'low' })) || [])
    ].sort((a, b) => a.time.localeCompare(b.time));

    const tides = allTides.length > 0 ? `
      <div>
        ${allTides.map(t => `
          <div class="tide-entry">
            <div class="tide-type">
              🌊 Marée ${t.type === 'high' ? 'haute' : 'basse'} — ${t.time}
            </div>
            <div>Hauteur : ${t.height} m</div>
            ${t.coefficient ? `<div>Coefficient : ${t.coefficient}</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '<div class="empty">Aucune donnée pour ce jour.</div>';

    this.shadowRoot.innerHTML = `
      <ha-card header="Marées">
        ${style}
        <div class="card-content">
          ${tabs}
          ${tides}
        </div>
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._selectedDay = tab.dataset.date;
        this.render();
      });
    });
  }

  getCardSize() {
    return 3;
  }
}

customElements.define('marees-france-card', MareesFranceCard);

// Register with Home Assistant
window.customCards = window.customCards || [];
window.customCards.push({
    type: 'marees-france-card',
    name: 'Carte Marées France',
    preview: true,
    description: 'Carte Custom pour l\'intégration Marées France',
});
