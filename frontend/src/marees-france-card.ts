import { LitElement, html, PropertyValues, TemplateResult, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localizeCard } from './localize';
import { getNextTideStatus } from './utils';
import {
  HomeAssistant,
  MareesFranceCardConfig,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
  GetCoefficientsDataResponseData,
  GetWaterTempResponseData,
  GetHarborMinDepthResponseData,
  NextTideStatus,
} from './types';
import { cardStyles } from './card-styles';
import { setCardConfig, getCardStubConfig, getCardConfigElement, CardInstanceForSetConfig } from './card-config';
import { DataManager, CardInstanceForDataManager } from './data-manager';
import { CalendarDialogManager, CardInstanceForCalendarDialog } from './calendar-dialog';
import { GraphInteractionManager, CardInstanceForGraphManager } from './graph-interaction';
import {
  renderHeader,
  renderNextTideStatus,
  renderDayTab,
  renderGraphContainer,
  CardInstanceForRenderers
} from './card-renderers';

// SyntheticPositionEvent is imported from graph-interaction.ts.
// CalendarDayInfo and PopStateEventState interfaces are in calendar-dialog.ts


/**
 * Main LitElement class for the Marées France card.
 * This class orchestrates various managers (data, calendar, graph interaction)
 * and uses dedicated renderer functions to build the card's UI.
 * It implements several interfaces to provide necessary properties and methods
 * to its managed components.
 */
@customElement('marees-france-card')
export class MareesFranceCard extends LitElement implements CardInstanceForSetConfig, CardInstanceForDataManager, CardInstanceForCalendarDialog, CardInstanceForGraphManager, CardInstanceForRenderers {
  // --- Properties ---
  @property({ attribute: false }) hass!: HomeAssistant; // Non-null assertion: Assume hass is always provided by HA
  @property({ attribute: false }) config!: MareesFranceCardConfig; // Non-null assertion: Assume config is set via setConfig

  // --- State Properties ---
  @state() _selectedDay: string = ''; // YYYY-MM-DD format
  @state() _waterLevels: GetWaterLevelsResponseData | { error: string } | null = null;
  @state() _tideData: GetTidesDataResponseData | { error: string } | null = null;
  @state() _coefficientsData: GetCoefficientsDataResponseData | { error: string } | null = null;
  @state() _waterTempData: GetWaterTempResponseData | { error: string } | null = null;
  @state() _harborMinDepth: GetHarborMinDepthResponseData | { error: string } | null = null;
  @state() _isLoadingWater: boolean = true;
  @state() _isLoadingTides: boolean = true;
  @state() _isLoadingCoefficients: boolean = true;
  @state() _isLoadingWaterTemp: boolean = true;
  @state() _isLoadingHarborMinDepth: boolean = true;
  @state() _isInitialLoading: boolean = true;
  @state() _deviceName: string | null = null;
  @state() _isGraphOverlayVisible: boolean = false;
  // _graphRenderer and _svgContainer are now managed by GraphInteractionManager
  // Calendar-specific state properties (_isCalendarDialogOpen, _calendarSelectedMonth, _touchStartX, _touchStartY,
  // _calendarHasPrevData, _calendarHasNextData, _calendarContentElement) and private members
  // (_boundHandlePopState, _boundHandleTouchStart, _boundHandleTouchMove, _boundHandleTouchEnd)
  // have been moved to CalendarDialogManager.

  // --- Private Members ---
  // _mutationObserver is now managed by GraphInteractionManager
  public _dataManager: DataManager | null = null; // Made public for CalendarDialogManager
  public _calendarDialogManager: CalendarDialogManager | null = null; // Made public for CardInstanceForRenderers
  private _graphInteractionManager: GraphInteractionManager | null = null;

  constructor() {
    super();
    this._selectedDay = new Date().toISOString().slice(0, 10);
    this._dataManager = new DataManager(this);
    this._calendarDialogManager = new CalendarDialogManager(this);
    this._graphInteractionManager = new GraphInteractionManager(this);
    // _boundHandlePopState initialization removed as it's handled by CalendarDialogManager
  }

  // --- Card Editor Configuration ---
  /**
   * Returns the custom element for the card configuration UI.
   * Delegates to `getCardConfigElement` from `card-config.ts`.
   * @returns {Promise<HTMLElement>} A promise that resolves to the config element.
   */
  static async getConfigElement(): Promise<HTMLElement> {
    return getCardConfigElement();
  }

  /**
   * Returns a stub configuration for the card.
   * Delegates to `getCardStubConfig` from `card-config.ts`.
   * @returns {MareesFranceCardConfig} The stub card configuration.
   */
  static getStubConfig(): MareesFranceCardConfig {
    return getCardStubConfig();
  }

  // --- Configuration Setter ---
  public setConfig(config: MareesFranceCardConfig): void {
    // setCardConfig will call _fetchData and _updateDeviceName, which are now on _dataManager
    // So, ensure _dataManager is initialized before calling setCardConfig.
    // The constructor already does this.
    setCardConfig(this, config);
  }

  // --- Lifecycle Callbacks ---
  connectedCallback(): void {
    super.connectedCallback();
    if (this.shadowRoot) { // _mutationObserver is now internal to GraphInteractionManager
      this._graphInteractionManager?.setupMutationObserver();
    }
    // Popstate listener for calendar is now handled by CalendarDialogManager.
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._graphInteractionManager?.disconnectObserver();
    // Popstate listener and touch listeners for calendar are handled by CalendarDialogManager.
    // The CalendarDialogManager handles its own listener cleanup when the dialog is closed.
  }

  protected firstUpdated(changedProperties: PropertyValues): void {
    super.firstUpdated(changedProperties);
    this._graphInteractionManager?.setupMutationObserver();
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    const configChanged = changedProperties.has('config');
    const hassChanged = changedProperties.has('hass');

    // Handle Data Fetching:
    // - If the configuration changes, always refetch data.
    // - If Home Assistant object changes (e.g., on initial load or HA restart)
    //   and data hasn't been fetched yet (all data states are null/empty)
    //   and we are not currently in a loading state, then fetch data.
    //   This ensures data is loaded when the card first appears or if HA state is refreshed.
    if (configChanged) {
      this._dataManager?.fetchData();
    } else if (
      hassChanged &&
      this.hass &&
      this.config?.device_id &&
      this._tideData === null && // Only fetch initially if data is null
      !this._isLoadingTides && !this._isLoadingWater && !this._isLoadingCoefficients && !this._isLoadingHarborMinDepth // And not already loading
    ) {
      this._dataManager?.fetchData();
    }

    // Update Device Name if hass or config changed
    if (hassChanged || configChanged) {
      this._dataManager?.updateDeviceName();
      this._dataManager?.fetchHarborMinDepth();
    }

    // Trigger Graph Draw on relevant data changes
    const dataOrLoadingChanged =
      changedProperties.has('_selectedDay') ||
      changedProperties.has('_waterLevels') ||
      changedProperties.has('_tideData') ||
      changedProperties.has('_harborMinDepth') ||
      changedProperties.has('_isLoadingWater') ||
      changedProperties.has('_isLoadingTides') ||
      changedProperties.has('_isLoadingWaterTemp');

    if (dataOrLoadingChanged) {
      this._graphInteractionManager?.drawGraphIfReady();
    }

    // Manage touch listeners for the calendar dialog content.
    // After the card's DOM updates (e.g., when the dialog is rendered or re-rendered),
    // if the calendar dialog is open, locate its main content area.
    // This content element is then passed to the CalendarDialogManager, which will
    // attach or detach touch event listeners for swipe navigation within the calendar.
    if (this._calendarDialogManager?.isCalendarDialogOpen) {
      const dialogElement = this.shadowRoot?.querySelector('ha-dialog');
      // The content element for touch listeners is nested inside .dialog-content, then .calendar-dialog-content
      const calendarContentElement = dialogElement?.querySelector<HTMLElement>('.dialog-content .calendar-dialog-content') ?? null;
      this._calendarDialogManager.setCalendarContentElement(calendarContentElement);
    } else {
      // If the dialog is not open, ensure any existing listeners are cleaned up
      // by passing null to the manager.
      this._calendarDialogManager?.setCalendarContentElement(null);
    }
  }

  // --- Data Fetching Methods (delegated to DataManager) ---
  // These methods are retained to satisfy CardInstanceForSetConfig.
  // setCardConfig (from card-config.ts) calls these methods on the card instance.

  public async _fetchData(): Promise<void> {
    // Delegate to the DataManager instance
    if (this._dataManager) {
      await this._dataManager.fetchData();
    } else {
      // This case should ideally not happen if _dataManager is initialized in constructor
      console.warn("MareesCard: _dataManager not initialized when attempting to call _fetchData.");
    }
  }

  public _updateDeviceName(): void {
    // Delegate to the DataManager instance
    if (this._dataManager) {
      this._dataManager.updateDeviceName();
    } else {
      // This case should ideally not happen
      console.warn("MareesCard: _dataManager not initialized when attempting to call _updateDeviceName.");
    }
  }

  // Original _callServiceWithResponse, _fetchWaterLevels, _fetchTideData,
  // _fetchCoefficientsData, and _updateInitialLoadingFlag are now fully within DataManager.
  // Calls to specific fetch methods (e.g., fetchWaterLevels) from within this file
  // (e.g., in _handleTabClick) are already updated to use this._dataManager.

  // --- Event Handlers ---
  public _handleTabClick(ev: MouseEvent): void {
    const target = ev.currentTarget as HTMLElement;
    const newDay = target?.dataset?.date;
    if (newDay && newDay !== this._selectedDay) {
      this._selectedDay = newDay;
      this._dataManager?.fetchWaterLevels(); // Only fetch water levels for the new day
    }
  }

  // --- Dialog Handlers ---
  // All calendar dialog logic (_openCalendarDialog, _closeCalendarDialog, _handlePopState,
  // _changeCalendarMonth, _addCalendarTouchListeners, _removeCalendarTouchListeners,
  // _handleTouchStart, _handleTouchMove, _handleTouchEnd)
  // has been moved to CalendarDialogManager.
  public _toggleGraphOverlay(): void {
    this._isGraphOverlayVisible = !this._isGraphOverlayVisible;
  }

  // --- Graph Renderer Interaction (now handled by GraphInteractionManager) ---
  // _setupMutationObserver, _handleMutation, _handleContainerStateChange, _drawGraphIfReady,
  // _updateInteractionTooltip, _hideInteractionTooltip, _showHtmlTooltip, _hideHtmlTooltip
  // have been moved to GraphInteractionManager.

  // --- Card Size ---
  public getCardSize(): number {
    // Adjust size based on content? For now, keep original.
    return 7;
  }

  // --- Render Methods ---
  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this.config) return nothing;
    if (!this.config.device_id) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.error_device_required', this.hass)}</div></ha-card>`;
    }

    // Type guard for tide data error
    if (this._tideData && 'error' in this._tideData && this._tideData.error) {
      const errorString = String(this._tideData.error);
      const message = errorString.includes('not found')
        ? localizeCard('ui.card.marees_france.device_not_found', this.hass, 'device_id', this.config.device_id)
        : `${localizeCard('ui.card.marees_france.no_tide_data', this.hass)} Error: ${errorString}`;
      return html`<ha-card><div class="warning">${message}</div></ha-card>`;
    }

    // Type guard for tide data response
    const tideDataResponse = (this._tideData && !('error' in this._tideData)) ? this._tideData : null;
    if (!tideDataResponse || typeof tideDataResponse !== 'object') {
      return html`
        <ha-card>
          ${renderHeader(this)}
          <div class="card-content">
            ${this._isLoadingTides || this._isInitialLoading
          ? html`<div class="loader">Loading tide data...</div>`
          : html`<div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div>`}
          </div>
        </ha-card>
      `;
    }

    // Data is valid, proceed with rendering
    const tideDataForStatus = this._tideData as GetTidesDataResponseData; // Safe cast after checks
    const nextTideInfo: NextTideStatus | null = getNextTideStatus(tideDataForStatus, this.hass);
    const locale = this.hass.language || 'en';
    const today = new Date();
    const dayLabels = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return d.toISOString().slice(0, 10);
    });

    return html`
      <ha-card>
        ${renderHeader(this)}
        <div class="card-content">
          ${renderNextTideStatus(this, nextTideInfo)}
          ${(this.config.card_type || 'full') === 'condensed' && !this._isGraphOverlayVisible ? nothing : html`
            <div class="tabs-and-graph-container">
              <div class="tabs">
                ${dayLabels.map((date) => renderDayTab(this, date, locale))}
              </div>
              ${!this.hass?.editMode ? renderGraphContainer(this) : nothing}
            </div>
          `}
          <div id="marees-html-tooltip" class="chart-tooltip"></div>
        </div>
      </ha-card>
      ${this._calendarDialogManager?.renderCalendarDialog() ?? nothing}
    `;
  }

  // _renderHeader, _renderNextTideStatus, _renderDayTab, _renderGraphContainer
  // have been moved to card-renderers.ts

  // Calendar rendering methods (_renderCalendarDialog, _renderCalendarDialogContent, _renderCalendarDay)
  // have been moved to CalendarDialogManager.

  // --- Styles ---
  static styles = cardStyles;
}

// --- Card Registration ---
interface CustomCard { type: string; name: string; preview: boolean; description: string; documentationURL?: string; }
declare global { interface Window { customCards?: CustomCard[]; } }
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'marees-france-card',
  name: 'Carte Marées France',
  preview: true,
  description: "Carte pour l'integration Marées France",
  documentationURL: 'https://github.com/KipK/marees_france/blob/main/README-fr.md',
});