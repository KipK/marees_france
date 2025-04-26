import {
  LitElement,
  html,
  css,
} from "lit"; // Use bare specifier

// Import shared localization function
import { localizeCard } from './localize.js';

// Helper function to fire events (Keep this local to the editor for now)
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

    // Define the schema dynamically here where hass is available
    const schema = [
      // --- Moved Show Header to top ---
      {
        name: "show_header",
        // Use shared localizeCard, passing hass object directly
        label: localizeCard('ui.card.marees_france.editor.show_header', this.hass),
        selector: { boolean: {} },
        default: true, // Default value for the checkbox
      },
      // --- Device Picker ---
      {
        name: "device_id",
        label: localizeCard('ui.card.marees_france.editor.device_label', this.hass),
        required: true,
        selector: {
          device: { // Use device selector
            integration: "marees_france", // Filter by integration
            // entity_domain: "sensor" // Optional: Further filter devices providing sensors? Might not be necessary.
            include_entities: false // We only need the device ID
          }
        },
        context: { // Add context for better filtering if needed (optional)
             integration: 'marees_france'
        }
      },
      // --- End Device Picker ---
      {
        name: "title",
        label: localizeCard('ui.card.marees_france.editor.title', this.hass),
        selector: { text: {} },
      },
    ];

    // Pass the hass object and current config to ha-form
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${schema}
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