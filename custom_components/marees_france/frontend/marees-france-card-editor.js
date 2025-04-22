import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@^2.0.0/lit-element.js?module";
// Import necessary HA components if not globally available
// Ensure these components are loaded in your Home Assistant environment
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-form/ha-form?module";
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-entity-picker?module";
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-checkbox?module";
// import "https://unpkg.com/home-assistant-frontend/src/components/ha-textfield?module";


// Helper function to fire events
const fireEvent = (node, type, detail = {}, options = {}) => {
  const event = new Event(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
};

class MareesFranceCardEditor extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: {},
    };
  }

  setConfig(config) {
    this._config = config;
  }

  // Define the schema for ha-form
  _schema = [
    {
      name: "entity",
      required: true,
      selector: {
        entity: {
          domain: "sensor", // Filter for sensor entities
          // Optional: Add integration filter if possible/reliable
          integration: "marees_france",
        },
      },
    },
    {
      name: "title",
      label: "Titre (Optionnel)",
      selector: { text: {} },
    },
    {
      name: "show_header",
      label: "Afficher l'en-tête ?",
      selector: { boolean: {} },
      default: true, // Default value for the checkbox
    },
  ];

  _computeLabel(schema) {
    // Simple label computation, can be expanded
    return schema.label || schema.name;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) {
      return;
    }
    const newConfig = ev.detail.value;

    // Fire event to let HA know the config changed
    fireEvent(this, "config-changed", { config: newConfig });
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    // Pass the hass object and current config to ha-form
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${this._schema}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  static get styles() {
    return css`
      /* Add any specific editor styles here if needed */
      ha-form {
        display: block;
        padding: 16px;
      }
    `;
  }
}

customElements.define("marees-france-card-editor", MareesFranceCardEditor);

// Registration is handled by frontend/__init__.py