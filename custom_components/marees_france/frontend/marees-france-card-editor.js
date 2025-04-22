import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@^2.0.0/lit-element.js?module";

const translations = {
  en: {
    title: "Title (Optional)",
    header: "Display header "
  },
  fr: {
    title: "Titre (Optionnel)",
    header: "Afficher l'en-tête"


  }
};

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

// --- Custom Localization Function ---
function localizeCard(key, language, ...args) {
  const lang = language || 'en';
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
      {
        name: "entity",
        required: true,
        selector: {
          entity: {
            domain: "sensor", // Filter for sensor entities
            integration: "marees_france",
          },
        },
      },
      {
        name: "title",
        label: localizeCard('title', this.hass.language), // Use this.hass here
        selector: { text: {} },
      },
      {
        name: "show_header",
        label: localizeCard('header', this.hass.language), // Use this.hass here
        selector: { boolean: {} },
        default: true, // Default value for the checkbox
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