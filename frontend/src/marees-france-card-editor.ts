import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localizeCard } from './localize';
import { HomeAssistant, MareesFranceCardConfig } from './types';

// Define the structure for the schema items used in ha-form
// This is a basic structure; official HA types might be more comprehensive
interface HaFormSchemaEntry {
  name: string;
  label: string;
  selector: object; // e.g., { boolean: {} }, { device: { ... } }, { text: {} }
  required?: boolean;
  default?: unknown;
  context?: object;
}

// Define the structure for the value-changed event detail
interface ValueChangedEventDetail {
  value: MareesFranceCardConfig;
}

// Helper function to fire events
const fireEvent = <T>(
  node: EventTarget,
  type: string,
  detail?: T,
  options?: {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }
): Event => {
  options = options || {};
  detail = detail === null || detail === undefined ? ({} as T) : detail;
  const event = new CustomEvent(type, {
    detail,
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  node.dispatchEvent(event);
  return event;
};

@customElement('marees-france-card-editor')
export class MareesFranceCardEditor extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant; // Use optional chaining for safety

  // Use @state decorator for internal configuration state
  @state() private _config?: MareesFranceCardConfig;

  public setConfig(config: MareesFranceCardConfig): void {
    this._config = config;
  }

  // Type the schema parameter
  private _computeLabel(schema: HaFormSchemaEntry): string {
    // Simple label computation, can be expanded
    // Use type assertion if schema structure varies significantly
    return schema.label || schema.name;
  }

  // Type the event parameter
  private _valueChanged(ev: CustomEvent<ValueChangedEventDetail>): void {
    if (!this._config || !this.hass) {
      return;
    }
    const newConfig = ev.detail.value;

    // Fire event to let HA know the config changed
    fireEvent(this, 'config-changed', { config: newConfig });
  }

  protected render(): TemplateResult | void {
    if (!this.hass || !this._config) {
      return html``;
    }

    // Define the schema dynamically here where hass is available
    // Type the schema array
    const schema: HaFormSchemaEntry[] = [
      // --- Moved Show Header to top ---
      {
        name: 'show_header',
        label: localizeCard(
          'ui.card.marees_france.editor.show_header',
          this.hass
        ),
        selector: { boolean: {} },
        default: true, // Default value for the checkbox
      },
      // --- Device Picker ---
      {
        name: 'device_id',
        label: localizeCard(
          'ui.card.marees_france.editor.device_label',
          this.hass
        ),
        required: true,
        selector: {
          device: {
            integration: 'marees_france', // Filter by integration
            include_entities: false, // We only need the device ID
          },
        },
        context: {
          integration: 'marees_france',
        },
      },
      // --- End Device Picker ---
      {
        name: 'title',
        label: localizeCard('ui.card.marees_france.editor.title', this.hass),
        selector: { text: {} },
      },
    ];

    // Pass the hass object and current config to ha-form
    // Use type assertion for ha-form if its properties are not strictly typed
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

  static styles = css`
    ha-form {
      display: block;
      padding: 16px;
    }
  `;
}

// Ensure the global window object is typed correctly if needed
// declare global {
//   interface Window {
//     customElements: CustomElementRegistry;
//   }
// }

// Registration is handled by frontend/__init__.py, but defining keeps TS happy
if (!window.customElements.get('marees-france-card-editor')) {
    window.customElements.define('marees-france-card-editor', MareesFranceCardEditor);
}
