import { LitElement, html, css, PropertyValues, TemplateResult, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { localizeCard } from './localize'; // Assuming .ts extension resolution works
import { getWeekdayShort3Letters, getNextTideStatus } from './utils'; // Assuming .ts extension resolution works
import { GraphRenderer } from './graph-renderer'; // Assuming .ts extension resolution works
import {
  HomeAssistant,
  MareesFranceCardConfig,
  ServiceResponseWrapper,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
  GetCoefficientsDataResponseData,
  NextTideStatus,
  ServiceCallRequest, // Added for the new helper
  ServiceCallResponse, // Added for the new helper
} from './types'; // Assuming .ts extension resolution works

// Define types for calendar day info used in render
interface CalendarDayInfo {
  day: number;
  isPadding: boolean;
  isCurrentMonth: boolean;
  coeffs?: string[];
  dateStr?: string;
}

// Define type for the popstate event state
interface PopStateEventState {
  mareesCalendarOpen?: boolean;
}

// Define type for synthetic event used in tooltip positioning
interface SyntheticPositionEvent {
    clientX?: number;
    clientY?: number;
    type: string;
}


@customElement('marees-france-card')
export class MareesFranceCard extends LitElement {
  // --- Properties ---
  @property({ attribute: false }) hass!: HomeAssistant; // Non-null assertion: Assume hass is always provided by HA
  @property({ attribute: false }) config!: MareesFranceCardConfig; // Non-null assertion: Assume config is set via setConfig

  // --- State Properties ---
  @state() private _selectedDay: string = ''; // YYYY-MM-DD format
  @state() private _waterLevels: ServiceResponseWrapper<GetWaterLevelsResponseData> | { error: string } | null = null;
  @state() private _tideData: ServiceResponseWrapper<GetTidesDataResponseData> | { error: string } | null = null;
  @state() private _coefficientsData: ServiceResponseWrapper<GetCoefficientsDataResponseData> | { error: string } | null = null;
  @state() private _isLoadingWater: boolean = true;
  @state() private _isLoadingTides: boolean = true;
  @state() private _isLoadingCoefficients: boolean = true;
  @state() private _isInitialLoading: boolean = true;
  @state() private _isCalendarDialogOpen: boolean = false;
  @state() private _calendarSelectedMonth: Date = new Date();
  @state() private _deviceName: string | null = null;
  @state() private _graphRenderer: GraphRenderer | null = null;
  @state() private _svgContainer: HTMLDivElement | null = null;
  @state() private _touchStartX: number | null = null;
  @state() private _touchStartY: number | null = null;
  @state() private _calendarHasPrevData: boolean = false;
  @state() private _calendarHasNextData: boolean = false;
  @state() private _calendarContentElement: HTMLElement | null = null;

  // --- Private Members ---
  private _boundHandlePopState: (event: PopStateEvent) => void;
  private _mutationObserver: MutationObserver | null = null;
  private _boundHandleTouchStart?: (ev: TouchEvent) => void;
  private _boundHandleTouchMove?: (ev: TouchEvent) => void;
  private _boundHandleTouchEnd?: (ev: TouchEvent) => void;

  constructor() {
    super();
    this._boundHandlePopState = this._handlePopState.bind(this);
  }

  // --- Card Editor Configuration ---
  static async getConfigElement(): Promise<HTMLElement> {
    // -- No need to import the editor here, it's handled in the main file --
    return document.createElement('marees-france-card-editor');
  }

  static getStubConfig(): MareesFranceCardConfig {
    return {
      type: 'custom:marees-france-card',
      device_id: '',
      show_header: true,
      title: null,
    };
  }

  // --- Configuration Setter ---
  public setConfig(config: MareesFranceCardConfig): void {
    if (!config.device_id) {
      throw new Error(
        localizeCard(
          'ui.card.marees_france.error_device_required',
          this.hass // Assuming hass might be available early, otherwise handle potential null
        ) || 'Device required'
      );
    }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10);
    this._waterLevels = null;
    this._tideData = null;
    this._coefficientsData = null;
    this._isLoadingWater = true;
    this._isLoadingTides = true;
    this._isLoadingCoefficients = true;
    this._isInitialLoading = true;
    this._isCalendarDialogOpen = false;
    this._calendarSelectedMonth = new Date();
    this._deviceName = null;

    // Fetch data immediately if hass is available
    if (this.hass) {
        this._fetchData();
        this._updateDeviceName();
    }
  }

  // --- Lifecycle Callbacks ---
  connectedCallback(): void {
    super.connectedCallback();
    if (!this._mutationObserver && this.shadowRoot) {
      this._setupMutationObserver();
    }
    if (this._isCalendarDialogOpen) {
        window.addEventListener('popstate', this._boundHandlePopState);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._mutationObserver) {
      this._mutationObserver.disconnect();
      this._mutationObserver = null;
    }
    if (this._graphRenderer) {
      this._graphRenderer.destroy();
      this._graphRenderer = null;
    }
    this._svgContainer = null;
    window.removeEventListener('popstate', this._boundHandlePopState);
    this._removeCalendarTouchListeners();
  }

  protected firstUpdated(changedProperties: PropertyValues): void {
    super.firstUpdated(changedProperties);
    this._setupMutationObserver();
  }

  protected updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    const configChanged = changedProperties.has('config');
    const hassChanged = changedProperties.has('hass');

    // Handle Data Fetching on config change or initial load
    if (configChanged) {
      this._fetchData();
    } else if (
      hassChanged &&
      this.hass &&
      this.config?.device_id &&
      this._tideData === null && // Only fetch initially if data is null
      !this._isLoadingTides && !this._isLoadingWater && !this._isLoadingCoefficients // And not already loading
    ) {
      this._fetchData();
    }

    // Update Device Name if hass or config changed
    if (hassChanged || configChanged) {
        this._updateDeviceName();
    }

    // Trigger Graph Draw on relevant data changes
    const dataOrLoadingChanged =
      changedProperties.has('_selectedDay') ||
      changedProperties.has('_waterLevels') ||
      changedProperties.has('_tideData') ||
      changedProperties.has('_isLoadingWater') ||
      changedProperties.has('_isLoadingTides');

    if (dataOrLoadingChanged && this._graphRenderer) {
      this._drawGraphIfReady();
    }
  }

  // --- Data Fetching Methods ---
  private async _fetchData(): Promise<void> {
    if (!this.hass || !this.config?.device_id) {
      console.warn('Marees Card: Fetch prerequisites not met.');
      this._isLoadingWater = false;
      this._isLoadingTides = false;
      this._isLoadingCoefficients = false;
      this._waterLevels = { error: 'Configuration incomplete' };
      this._tideData = { error: 'Configuration incomplete' };
      this._coefficientsData = { error: 'Configuration incomplete' };
      this._isInitialLoading = false;
      return;
    }

    this._isLoadingWater = true;
    this._isLoadingTides = true;
    this._isLoadingCoefficients = true;
    this._waterLevels = null;
    this._tideData = null;
    this._coefficientsData = null;
    // No explicit requestUpdate needed due to @state decorators

    try {
        await Promise.all([
            this._fetchWaterLevels(),
            this._fetchTideData(),
            this._fetchCoefficientsData(),
        ]);
    } catch (error) {
        console.error("Marees Card: Error during concurrent data fetch", error);
    }
  }

  /**
   * Calls the specified Marées France service and returns response data.
   * The service is called via a script, as there is currently no way to return service
   * response data from a call to "hass.callService()" for services that require it.
   */
  private async _callServiceWithResponse<T>(
    serviceName: string,
    // Ensure serviceData includes device_id when calling this helper
    serviceDataWithDeviceId: Record<string, unknown>
  ): Promise<ServiceResponseWrapper<T>> {
    if (!this.hass) {
      throw new Error("Home Assistant object (hass) is not available.");
    }

    // serviceDataWithDeviceId should already contain device_id
    const serviceRequest: ServiceCallRequest = {
      domain: 'marees_france',
      service: serviceName,
      serviceData: serviceDataWithDeviceId,
      // Target for execute_script can be empty or specific if script itself needs targeting,
      // but the service *inside* the script gets its target from its own data.
      target: {}
    };

    try {
      const conn = 'conn' in this.hass.connection ? this.hass.connection.conn : this.hass.connection;
      const serviceResponse = await conn.sendMessagePromise<ServiceCallResponse<T>>({
        type: "execute_script",
        sequence: [{
          "service": `${serviceRequest.domain}.${serviceRequest.service}`,
          "data": serviceRequest.serviceData,
          "target": serviceRequest.target,
          "response_variable": "service_result"
        },
        {
          "stop": "done",
          "response_variable": "service_result"
        }]
      });

      // serviceResponse is of type ServiceCallResponse<T> from types.ts,
      // where serviceResponse.response is of type T (the actual data).
      // The _callServiceWithResponse method must return a ServiceResponseWrapper<T>,
      // which has the structure { response: T | { error: string } }.
      if (typeof serviceResponse.response !== 'undefined') {
        return { response: serviceResponse.response };
      } else {
        // This case handles if sendMessagePromise resolves but serviceResponse.response is undefined.
        console.error(`Marees Card: Service ${serviceName} executed but returned undefined response data:`, serviceResponse);
        throw new Error(`Service ${serviceName} executed but returned undefined response data`);
      }

    } catch (error: unknown) {
        console.error(`Marees Card: Error calling ${serviceName} via script:`, error);
        // Rethrow or handle as appropriate for your error strategy
        // It's important to ensure the calling function can catch this
        if (error instanceof Error) {
            // Check if it's an HA-style error object with a code
            const haError = error as Error & { code?: string | number };
            if (haError.code) {
                throw new Error(`${haError.message} (Code: ${haError.code})`);
            }
            throw haError; // rethrow original error if not HA-style
        }
        throw new Error(`Unknown error calling ${serviceName}`);
    }
  }


  private async _fetchWaterLevels(): Promise<void> {
    this._isLoadingWater = true;

    if (!this.hass || !this.config?.device_id || !this._selectedDay) {
      this._waterLevels = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingWater = false;
      this._updateInitialLoadingFlag();
      return;
    }

    try {
      const response = await this._callServiceWithResponse<GetWaterLevelsResponseData>(
        'get_water_levels',
        {
          device_id: this.config.device_id,
          date: this._selectedDay
        }
      );

      if (response?.response && typeof response.response === 'object' && !response.response.error) {
        this._waterLevels = response;
      } else {
        const errorMsg = response?.response?.error ?? 'Invalid data structure from service';
        console.error('Marees Card: Invalid data from get_water_levels:', response);
        this._waterLevels = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card: Error calling get_water_levels:', error);
      this._waterLevels = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this._isLoadingWater = false;
      this._updateInitialLoadingFlag();
    }
  }

  private async _fetchTideData(): Promise<void> {
    this._isLoadingTides = true;

    if (!this.hass || !this.config?.device_id) {
      this._tideData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingTides = false;
      this._updateInitialLoadingFlag();
      return;
    }

    try {
      const response = await this._callServiceWithResponse<GetTidesDataResponseData>(
        'get_tides_data',
        {
          device_id: this.config.device_id
        }
      );

      if (response?.response && typeof response.response === 'object' && !response.response.error) {
        this._tideData = response;
      } else {
        const errorMsg = response?.response?.error ?? 'Invalid data structure from service';
        console.error('Marees Card: Invalid data from get_tides_data:', response);
        this._tideData = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card: Error calling get_tides_data:', error);
      this._tideData = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this._isLoadingTides = false;
      this._updateInitialLoadingFlag();
    }
  }

  private async _fetchCoefficientsData(): Promise<void> {
    this._isLoadingCoefficients = true;

    if (!this.hass || !this.config?.device_id) {
      this._coefficientsData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingCoefficients = false;
      this._updateInitialLoadingFlag();
      return;
    }

    try {
      const today = new Date();
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDateStr = firstDayOfMonth.toISOString().slice(0, 10);

      const response = await this._callServiceWithResponse<GetCoefficientsDataResponseData>(
        'get_coefficients_data',
        {
          device_id: this.config.device_id,
          date: startDateStr, days: 365
        }
      );

      if (response?.response && typeof response.response === 'object' && !response.response.error) {
        if (Object.keys(response.response).length === 0) {
             console.warn('Marees Card: Received empty coefficient data.');
             this._coefficientsData = response;
        } else {
            this._coefficientsData = response;
        }
      } else {
        const errorMsg = response?.response?.error ?? 'Invalid data structure from service';
        console.error('Marees Card: Invalid data from get_coefficients_data:', response);
        this._coefficientsData = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card: Error calling get_coefficients_data:', error);
      this._coefficientsData = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this._isLoadingCoefficients = false;
      this._updateInitialLoadingFlag();
    }
  }

  private _updateInitialLoadingFlag(): void {
      if (this._isInitialLoading && !this._isLoadingWater && !this._isLoadingTides && !this._isLoadingCoefficients) {
          this._isInitialLoading = false;
      }
  }

  private _updateDeviceName(): void {
      if (this.hass && this.config?.device_id) {
          const device = this.hass.devices?.[this.config.device_id];
          const newName = device?.name ?? null;
          if (newName !== this._deviceName) {
              this._deviceName = newName;
          }
      } else if (this._deviceName !== null) {
          this._deviceName = null;
      }
  }

  // --- Event Handlers ---
  private _handleTabClick(ev: MouseEvent): void {
    const target = ev.currentTarget as HTMLElement;
    const newDay = target?.dataset?.date;
    if (newDay && newDay !== this._selectedDay) {
      this._selectedDay = newDay;
      this._fetchWaterLevels(); // Only fetch water levels for the new day
    }
  }

  // --- Dialog Handlers ---
  private async _openCalendarDialog(): Promise<void> {
    if (this._isCalendarDialogOpen) return;

    // Type guard for error check
    const hasCoeffError = this._coefficientsData && 'error' in this._coefficientsData && this._coefficientsData.error;
    if (!this._coefficientsData || hasCoeffError) {
      await this._fetchCoefficientsData();
    }
    this._isCalendarDialogOpen = true;
    this._calendarSelectedMonth = new Date();

    history.pushState({ mareesCalendarOpen: true } as PopStateEventState, '', '#marees-calendar');
    window.addEventListener('popstate', this._boundHandlePopState);

    await this.updateComplete;

    // Ensure the result is explicitly null if not found or undefined
    this._calendarContentElement = this.shadowRoot?.querySelector<HTMLElement>('ha-dialog .calendar-dialog-content') ?? null;
    this._addCalendarTouchListeners();
  }

  private _handlePopState(event: PopStateEvent): void {
    const state = event.state as PopStateEventState | null;
    if (this._isCalendarDialogOpen && !state?.mareesCalendarOpen) {
      this._closeCalendarDialog(true);
    }
  }

  private _closeCalendarDialog(isFromPopstate: boolean = false): void {
    if (!this._isCalendarDialogOpen) return;

    this._isCalendarDialogOpen = false;
    window.removeEventListener('popstate', this._boundHandlePopState);

    const currentState = history.state as PopStateEventState | null;
    if (!isFromPopstate && currentState?.mareesCalendarOpen) {
      history.back();
    }

    this._removeCalendarTouchListeners();
    this._touchStartX = null;
    this._touchStartY = null;
  }

  private _changeCalendarMonth(monthOffset: number): void {
    const newMonth = new Date(this._calendarSelectedMonth);
    newMonth.setMonth(newMonth.getMonth() + monthOffset);
    newMonth.setDate(1);
    this._calendarSelectedMonth = newMonth;
  }

  // --- Calendar Touch Handlers ---
  private _addCalendarTouchListeners(): void {
      if (!this._calendarContentElement) return;
      this._boundHandleTouchStart = this._handleTouchStart.bind(this);
      this._boundHandleTouchMove = this._handleTouchMove.bind(this);
      this._boundHandleTouchEnd = this._handleTouchEnd.bind(this);
      this._calendarContentElement.addEventListener('touchstart', this._boundHandleTouchStart, { passive: true });
      this._calendarContentElement.addEventListener('touchmove', this._boundHandleTouchMove, { passive: false });
      this._calendarContentElement.addEventListener('touchend', this._boundHandleTouchEnd, { passive: true });
  }

  private _removeCalendarTouchListeners(): void {
      if (this._calendarContentElement && this._boundHandleTouchStart && this._boundHandleTouchMove && this._boundHandleTouchEnd) {
          this._calendarContentElement.removeEventListener('touchstart', this._boundHandleTouchStart);
          this._calendarContentElement.removeEventListener('touchmove', this._boundHandleTouchMove);
          this._calendarContentElement.removeEventListener('touchend', this._boundHandleTouchEnd);
      }
      this._boundHandleTouchStart = undefined;
      this._boundHandleTouchMove = undefined;
      this._boundHandleTouchEnd = undefined;
      this._calendarContentElement = null;
  }

  private _handleTouchStart(ev: TouchEvent): void {
    if (ev.touches.length === 1) {
      this._touchStartX = ev.touches[0].clientX;
      this._touchStartY = ev.touches[0].clientY;
    } else {
      this._touchStartX = null;
      this._touchStartY = null;
    }
  }

  private _handleTouchMove(ev: TouchEvent): void {
    if (this._touchStartX === null || this._touchStartY === null || ev.touches.length !== 1) return;
    const deltaX = ev.touches[0].clientX - this._touchStartX;
    const deltaY = ev.touches[0].clientY - this._touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) ev.preventDefault();
  }

  private _handleTouchEnd(ev: TouchEvent): void {
    if (this._touchStartX === null || this._touchStartY === null || ev.changedTouches.length !== 1) {
      this._touchStartX = null; this._touchStartY = null; return;
    }
    const deltaX = ev.changedTouches[0].clientX - this._touchStartX;
    const deltaY = ev.changedTouches[0].clientY - this._touchStartY;
    const swipeThreshold = 50;
    if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaY) < swipeThreshold) {
      if (deltaX > 0 && this._calendarHasPrevData) this._changeCalendarMonth(-1);
      else if (deltaX < 0 && this._calendarHasNextData) this._changeCalendarMonth(1);
    }
    this._touchStartX = null; this._touchStartY = null;
  }

  // --- Graph Renderer Interaction ---
  private _setupMutationObserver(): void {
    if (!this.shadowRoot || this._mutationObserver) return;
    this._mutationObserver = new MutationObserver(this._handleMutation.bind(this));
    this._mutationObserver.observe(this.shadowRoot, { childList: true, subtree: true });
    this._handleContainerStateChange(this.shadowRoot.querySelector<HTMLDivElement>('#marees-graph-target'));
  }

  private _handleMutation(mutationsList: MutationRecord[]): void {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        let containerAdded: HTMLDivElement | null = null;
        let containerRemoved = false;
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const found = el.id === 'marees-graph-target' ? el : el.querySelector<HTMLDivElement>('#marees-graph-target');
            if (found) {
              // Ensure it's the specific type expected by _handleContainerStateChange
              if (found instanceof HTMLDivElement) {
                  containerAdded = found;
              } else {
                  // Log a warning if the found element isn't the expected type
                  console.warn("Marees Card: Found potential graph target container but it's not an HTMLDivElement:", found);
              }
            }
          }
        });
        mutation.removedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.id === 'marees-graph-target' || (this._svgContainer && el.contains(this._svgContainer))) {
              containerRemoved = true;
            }
          }
        });
        if (containerAdded) this._handleContainerStateChange(containerAdded);
        else if (containerRemoved) this._handleContainerStateChange(null);
      }
    }
  }

  private _handleContainerStateChange(containerElement: HTMLDivElement | null): void {
    if (!containerElement && this._graphRenderer) {
      this._graphRenderer.destroy();
      this._graphRenderer = null;
      this._svgContainer = null;
    } else if (containerElement && !this._graphRenderer) {
      this._svgContainer = containerElement;
      this._graphRenderer = new GraphRenderer(this, this._svgContainer, this.hass);
      this._drawGraphIfReady();
    } else if (containerElement && this._graphRenderer) {
      // Ensure container reference is updated if it somehow changed
      if (this._svgContainer !== containerElement) {
          this._svgContainer = containerElement;
          // Potentially re-initialize or update renderer if container instance changes
          // For now, assume redraw is sufficient
      }
      this._drawGraphIfReady();
    }
  }

  private _drawGraphIfReady(): void {
    const waterDataValid = this._waterLevels && 'response' in this._waterLevels && this._waterLevels.response;
    const tideDataValid = this._tideData && 'response' in this._tideData && this._tideData.response;
    const dataIsReady = !this._isLoadingWater && !this._isLoadingTides && waterDataValid && tideDataValid;
    const containerStillExists = this._svgContainer && this.shadowRoot?.contains(this._svgContainer);

    if (this._graphRenderer && containerStillExists && dataIsReady) {
      try {
        // Type assertions are safe here due to checks above
        this._graphRenderer.drawGraph(
          this._tideData as ServiceResponseWrapper<GetTidesDataResponseData>,
          this._waterLevels as ServiceResponseWrapper<GetWaterLevelsResponseData>,
          this._selectedDay
        );
        this._graphRenderer.refreshDimensionsAndScale();
      } catch (e) {
        console.error('[MareesCard] Error during graph draw/refresh:', e);
      }
    }
  }

  // --- Tooltip Handlers (Called by GraphRenderer) ---
  public _updateInteractionTooltip(svgX: number, svgY: number, timeMinutes: number, height: number, isSnapped: boolean = false): void {
    if (this.hass?.editMode) return;
    const svg = this._svgContainer?.querySelector('svg');
    if (!svg) return;

    const hours = Math.floor(timeMinutes / 60);
    const minutes = Math.floor(timeMinutes % 60);
    const formattedTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const formattedHeightStr = height.toFixed(2);

    try {
      const ctm = svg.getScreenCTM();
      if (!ctm) { this._hideHtmlTooltip(); return; }
      const svgPt = svg.createSVGPoint();
      svgPt.x = svgX; svgPt.y = svgY;
      const screenPt = svgPt.matrixTransform(ctm);

      const syntheticEvent: SyntheticPositionEvent = { clientX: screenPt.x, clientY: screenPt.y, type: 'interactionMove' };
      const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
      if (tooltip) tooltip.classList.toggle('snapped-tooltip', isSnapped);
      this._showHtmlTooltip(syntheticEvent, formattedTimeStr, formattedHeightStr);

      // --- BEGIN: Calculate and set tooltip bottom Y for renderer ---
      // Use the 'tooltip' and 'svg' variables declared earlier in the function scope
      if (tooltip && svg && this._graphRenderer) { // Use existing tooltip (L569) and svg (L553)
        const tooltipRect = tooltip.getBoundingClientRect();
        const ctmForTooltip = svg.getScreenCTM(); // Use existing svg (L553)
        if (ctmForTooltip) {
          const pt = svg.createSVGPoint();
          // Use the tooltip's bottom-left screen coordinates
          pt.x = tooltipRect.left;
          pt.y = tooltipRect.bottom;
          try {
            const svgPoint = pt.matrixTransform(ctmForTooltip.inverse());
            // Pass the calculated SVG Y coordinate to the renderer
            this._graphRenderer.setTooltipBottomY(svgPoint.y);
          } catch (inverseError) {
             console.error('Marees Card: Error inverting CTM for tooltip Y:', inverseError);
             // Optionally hide the line if calculation fails
             this._graphRenderer.setTooltipBottomY(-1); // Or some indicator value
          }
        } else {
           // Optionally hide the line if CTM is null
           this._graphRenderer.setTooltipBottomY(-1);
        }
      }
      // --- END: Calculate and set tooltip bottom Y for renderer ---

    } catch (transformError) {
      console.error('Marees Card: Error transforming SVG point for tooltip:', transformError);
      this._hideHtmlTooltip();
    }
  }

  public _hideInteractionTooltip(): void {
    const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
    if (tooltip) tooltip.classList.remove('snapped-tooltip');
    this._hideHtmlTooltip();
  }

  private _showHtmlTooltip(evt: SyntheticPositionEvent, time: string, height: string): void {
    const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
    if (!tooltip) return;

    tooltip.style.visibility = 'visible';
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong>${time}</strong><br>${height} m`;

    if (evt.clientX === undefined || evt.clientY === undefined) { this._hideHtmlTooltip(); return; }

    const cardRect = this.getBoundingClientRect();
    const targetCenterX = evt.clientX - cardRect.left;
    const targetTopY = evt.clientY - cardRect.top;
    const targetHeight = 1;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    if (tooltipWidth <= 0 || tooltipHeight <= 0) { this._hideHtmlTooltip(); return; }

    const isTouchEvent = evt.type.startsWith('touch') || evt.type === 'interactionMove';
    const offsetAbove = isTouchEvent ? 45 : 10;
    let left = targetCenterX - tooltipWidth / 2;
    let top = targetTopY - tooltipHeight - offsetAbove;
    const safetyMargin = 2;

    if (left < safetyMargin) left = safetyMargin;
    if (left + tooltipWidth > cardRect.width - safetyMargin) left = cardRect.width - tooltipWidth - safetyMargin;
    if (top < safetyMargin) {
      top = targetTopY + targetHeight + offsetAbove;
      if (top + tooltipHeight > cardRect.height - safetyMargin) top = cardRect.height - tooltipHeight - safetyMargin;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  private _hideHtmlTooltip(): void {
    const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.style.visibility = 'hidden';
    }
  }

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
    const tideDataResponse = (this._tideData && 'response' in this._tideData) ? this._tideData.response : null;
    if (!tideDataResponse || typeof tideDataResponse !== 'object') {
      return html`
        <ha-card>
          ${this._renderHeader()}
          <div class="card-content">
            ${this._isLoadingTides || this._isInitialLoading
              ? html`<div class="loader">Loading tide data...</div>`
              : html`<div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div>`}
          </div>
        </ha-card>
      `;
    }

    // Data is valid, proceed with rendering
    const tideDataForStatus = this._tideData as ServiceResponseWrapper<GetTidesDataResponseData>; // Safe cast after checks
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
        ${this._renderHeader()}
        <div class="card-content">
          ${this._renderNextTideStatus(nextTideInfo)}
          <div class="tabs">
            ${dayLabels.map((date) => this._renderDayTab(date, locale))}
          </div>
          ${!this.hass?.editMode ? this._renderGraphContainer() : nothing}
          <div id="marees-html-tooltip" class="chart-tooltip"></div>
        </div>
      </ha-card>
      ${this._renderCalendarDialog()}
    `;
  }

  private _renderHeader(): TemplateResult | typeof nothing {
      if (this.config.show_header === false) return nothing;
      const title = this.config.title ?? this._deviceName ?? localizeCard('ui.card.marees_france.default_title', this.hass);
      return html`<div class="card-header">${title}</div>`;
  }

  private _renderNextTideStatus(nextTideInfo: NextTideStatus | null): TemplateResult {
      if (!nextTideInfo) {
          return html`<div class="warning">${localizeCard('ui.card.marees_france.waiting_next_tide', this.hass)}</div>`;
      }
      const detailParts: (string | TemplateResult)[] = [];
      if (nextTideInfo.nextPeakHeight !== null) detailParts.push(`${Number(nextTideInfo.nextPeakHeight).toFixed(1)} m`);
      if (nextTideInfo.displayCoefficient !== null) {
          const coef = nextTideInfo.displayCoefficient;
          const coefClass = coef >= 100 ? 'warning-coef' : '';
          detailParts.push(html`<span class="${coefClass}">Coef. ${coef}</span>`);
      }
      return html`
        <div class="next-tide-status">
          <div class="next-tide-main">
            <div class="next-tide-icon-time">
              <ha-icon .icon=${nextTideInfo.currentTrendIcon}></ha-icon>
              <div class="next-tide-text-container">
                <span class="next-tide-trend-text">${localizeCard(nextTideInfo.currentTrendIcon === 'mdi:wave-arrow-up' ? 'ui.card.marees_france.rising_prefix' : 'ui.card.marees_france.falling_prefix', this.hass)}</span>
                <span class="next-tide-time">${nextTideInfo.nextPeakTime}</span>
              </div>
            </div>
            <div class="next-tide-details">${detailParts.length === 2 ? html`${detailParts[0]} - ${detailParts[1]}` : detailParts[0] ?? ''}</div>
          </div>
          <ha-icon class="calendar-icon" icon="mdi:calendar-month" @click="${this._openCalendarDialog}" title="${localizeCard('ui.card.marees_france.open_calendar', this.hass)}"></ha-icon>
        </div>`;
  }

  private _renderDayTab(date: string, locale: string): TemplateResult {
      const d = new Date(date);
      const dayLabel = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase();
      const dateLabel = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
      return html`
        <div class="tab ${this._selectedDay === date ? 'active' : ''}" data-date="${date}" @click="${this._handleTabClick}">
          <div class="tab-day">${dayLabel}</div>
          <div class="tab-date">${dateLabel}</div>
        </div>`;
  }

  private _renderGraphContainer(): TemplateResult {
      return html`
        <div class="svg-graph-container">
          ${this._isLoadingWater || this._isLoadingTides ? html`<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon>` : nothing}
          <div id="marees-graph-target" class="svg-graph-target"></div>
        </div>`;
  }

  private _renderCalendarDialog(): TemplateResult {
      return html`
        <ha-dialog ?open=${this._isCalendarDialogOpen} @closed="${this._closeCalendarDialog}" heading="${localizeCard('ui.card.marees_france.coefficient_calendar_title', this.hass)}">
          <div class="dialog-content">${this._renderCalendarDialogContent()}</div>
          <mwc-button slot="primaryAction" @click="${this._closeCalendarDialog}">${this.hass.localize('ui.common.close')}</mwc-button>
        </ha-dialog>`;
  }

  private _renderCalendarDialogContent(): TemplateResult {
    if (this._isLoadingCoefficients) return html`<div class="dialog-loader">Loading...</div>`;

    // Type guard for error
    if (this._coefficientsData && 'error' in this._coefficientsData && this._coefficientsData.error) {
        this._calendarHasPrevData = false; this._calendarHasNextData = false;
        return html`<div class="dialog-warning">${String(this._coefficientsData.error)}</div>`;
    }
    // Type guard for response
    const coeffResponse = (this._coefficientsData && 'response' in this._coefficientsData) ? this._coefficientsData.response : null;
    if (!coeffResponse || typeof coeffResponse !== 'object') {
        this._calendarHasPrevData = false; this._calendarHasNextData = false;
        return html`<div class="dialog-warning">${localizeCard('ui.card.marees_france.no_coefficient_data', this.hass)}</div>`;
    }

    // Data is valid
    const actualCoeffData = coeffResponse as GetCoefficientsDataResponseData;
    const locale = this.hass.language || 'en';
    const currentMonthDate = this._calendarSelectedMonth;
    const currentYear = currentMonthDate.getFullYear();
    const currentMonth = currentMonthDate.getMonth();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const startingDayRaw = firstDayOfMonth.getDay();
    const startingDay = startingDayRaw === 0 ? 6 : startingDayRaw - 1;
    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const weekdays = Array.from({ length: 7 }, (_, i) => getWeekdayShort3Letters(i, locale));
    const calendarDays: CalendarDayInfo[] = [];
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = 0; i < startingDay; i++) calendarDays.push({ day: daysInPrevMonth - startingDay + 1 + i, isPadding: true, isCurrentMonth: false });
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
        calendarDays.push({ day, isPadding: false, isCurrentMonth: true, coeffs: actualCoeffData[dateStr] || [], dateStr });
    }
    const remainingCells = 42 - (startingDay + daysInMonth);
    for (let i = 1; i <= remainingCells; i++) calendarDays.push({ day: i, isPadding: true, isCurrentMonth: false });

    // Check prev/next month data availability
    const availableDates = Object.keys(actualCoeffData).sort();
    let hasPrev = false, hasNext = false;
    if (availableDates.length > 0) {
        const prevMonthDateObj = new Date(currentYear, currentMonth - 1, 1);
        const nextMonthDateObj = new Date(currentYear, currentMonth + 1, 1);
        const prevMonthYear = prevMonthDateObj.getFullYear(), prevMonthMonth = prevMonthDateObj.getMonth();
        const nextMonthYear = nextMonthDateObj.getFullYear(), nextMonthMonth = nextMonthDateObj.getMonth();
        try {
            hasPrev = availableDates.some(dStr => { const d = new Date(dStr); return d.getFullYear() === prevMonthYear && d.getMonth() === prevMonthMonth; });
            hasNext = availableDates.some(dStr => { const d = new Date(dStr); return d.getFullYear() === nextMonthYear && d.getMonth() === nextMonthMonth; });
        } catch (e) { console.error("Error checking month data:", e); }
    }
    this._calendarHasPrevData = hasPrev; this._calendarHasNextData = hasNext;

    return html`
      <div class="calendar-dialog-content">
        <div class="calendar-header">
          <ha-icon-button @click="${() => this._changeCalendarMonth(-1)}" .disabled=${!hasPrev} title="${localizeCard('ui.card.marees_france.previous_month', this.hass)}"><ha-icon icon="mdi:chevron-left"></ha-icon></ha-icon-button>
          <span class="calendar-month-year">${currentMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
          <ha-icon-button @click="${() => this._changeCalendarMonth(1)}" .disabled=${!hasNext} title="${localizeCard('ui.card.marees_france.next_month', this.hass)}"><ha-icon icon="mdi:chevron-right"></ha-icon></ha-icon-button>
        </div>
        <div class="calendar-grid">
          ${weekdays.map(day => html`<div class="calendar-weekday">${day}</div>`)}
          ${calendarDays.map(dayInfo => this._renderCalendarDay(dayInfo))}
        </div>
        ${calendarDays.filter(d => d.isCurrentMonth && d.coeffs && d.coeffs.length > 0).length === 0 && !this._isLoadingCoefficients
          ? html`<div class="no-data-month">${localizeCard('ui.card.marees_france.no_data_for_month', this.hass)}</div>`
          : nothing}
      </div>`;
  }

  private _renderCalendarDay(dayInfo: CalendarDayInfo): TemplateResult {
      const dayClass = `calendar-day ${dayInfo.isPadding ? 'padding' : ''} ${dayInfo.isCurrentMonth ? 'current-month' : ''}`;
      return html`
        <div class=${dayClass}>
          <div class="day-number">${dayInfo.isCurrentMonth ? dayInfo.day : ''}</div>
          ${dayInfo.isCurrentMonth && dayInfo.coeffs && dayInfo.coeffs.length > 0
            ? html`<div class="day-coeffs">${dayInfo.coeffs.map(coeff => {
                const num = parseInt(coeff, 10);
                const cClass = num >= 100 ? 'warning-coef' : num < 40 ? 'low-coef' : '';
                return html`<span class="coeff-value ${cClass}">${coeff}</span>`;
            })}</div>`
            : nothing}
        </div>`;
  }

  // --- Styles ---
  static styles = css`
      :host {
        /* Card specific vars using HA vars */
        --current_tide_color: #fdd835;
        --tide-icon-color: var(--current_tide_color);
        --tide-time-color: var(--primary-text-color);
        --tide-detail-color: var(--secondary-text-color);
        /* Tab colors */
        --tab-inactive-background: var(
          --ha-card-background
        ); /* Use card background for inactive tabs */
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
        padding: 0 16px 8px 16px; /* Reduced bottom padding */
      }

      /* Next Tide Status Display Styles */
      .next-tide-status {
        display: flex;
        justify-content: space-between; /* Push icon to the right */
        align-items: center; /* Vertically align main info and icon */
        gap: 16px; /* Gap between main info and icon */
        padding-bottom: 16px; /* Space before tabs */
        padding-left: 16px; /* Add left padding to match card content */
        padding-right: 16px; /* Add right padding */
        padding-top: 16px; /* Add top padding */
      }
      .next-tide-main {
        display: flex;
        flex-direction: column; /* Stack icon/time and details */
        align-items: flex-start; /* Align items to the left */
        gap: 4px; /* Smaller gap between lines */
        flex-grow: 1; /* Allow main section to take available space */
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
        font-size: 1em; /* Smaller text for prefix */
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
        padding-left: calc(
          2.2em + 11px
        ); /* Indent details to align below time (icon width + gap) */
        font-size: 1em; /* Slightly smaller details */
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

      .calendar-icon {
        color: var(--secondary-text-color); /* Use a less prominent color */
        --mdc-icon-button-size: 30px; /* Slightly smaller icon button - Removed for testing */
        transition: color 0.2s ease-in-out;
        cursor: pointer; /* Pointer cursor for interactivity */
      }
      .calendar-icon:hover {
        color: var(--primary-color); /* Highlight on hover */
      }

      .tabs {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 16px;
        gap: 4px;
        /* padding-left: 16px; */ /* REMOVED - Let card content padding handle alignment */
        /* padding-right: 16px; */ /* REMOVED - Let card content padding handle alignment */
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
        transition:
          background-color 0.2s ease-in-out,
          color 0.2s ease-in-out;
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
        color: var(
          --text-primary-color
        ); /* Make date color match active text color */
        opacity: 0.8; /* Slightly less prominent */
      }

      /* Styles for SVG graph container and loader */
      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
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
      /* Tooltip styles (within SVG) - Not used for HTML tooltip */
      #marker-tooltip {
        pointer-events: none; /* Tooltip should not capture mouse events */
      }

      /* HTML Tooltip Styles */
      .chart-tooltip {
        position: absolute; /* Position relative to the card content area */
        display: none; /* Hidden by default */
        background-color: var(
          --secondary-background-color,
          #f0f0f0
        ); /* Match coef box background */
        color: var(--primary-text-color, black); /* Keep text color primary */
        border: 1px solid
          var(--ha-card-border-color, var(--divider-color, grey)); /* Match coef box border */
        border-radius: 4px;
        padding: 4px 6px; /* Reduced padding */
        font-size: 12px;
        white-space: nowrap; /* Prevent wrapping */
        z-index: 100; /* Ensure it's above the SVG */
        pointer-events: none; /* Tooltip should not interfere with mouse */
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      }
      .chart-tooltip strong {
        font-weight: bold;
        font-weight: bold;
      }
      .chart-tooltip.snapped-tooltip {
        border-color: var(--tide-icon-color); /* Yellow border */
        color: var(--primary-text-color); /* Use primary text color */
      }
      .chart-tooltip.snapped-tooltip strong {
        color: var(--primary-text-color); /* Ensure bold text is also primary */
      }

      /* Dialog Styles [MODIFIED FOR GRID] */
      ha-dialog {
        /* Allow content to scroll */
        --dialog-content-padding: 0;
        --dialog-z-index: 5; /* Ensure dialog is above other elements */
        /* Default width for desktop - Set both min and max */
        --mdc-dialog-min-width: 600px;
        --mdc-dialog-max-width: 600px;
      }
      .calendar-dialog-content {
        padding: 10px 20px; /* Default padding for desktop */
        max-height: 70vh; /* Limit height and allow scrolling */
        overflow-y: hidden; /* Allow vertical scroll if needed */
        box-sizing: border-box; /* Include padding in width calculation */
      }
      .dialog-loader,
      .dialog-warning,
      .no-data-month {
        text-align: center;
        padding: 20px;
        color: var(--secondary-text-color);
      }
      .dialog-warning {
        color: var(--error-color);
      }
      .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px; /* Reduced margin */
        padding: 0 4px; /* Reduced padding */
      }
      .calendar-month-year {
        font-size: 1.1em; /* Slightly smaller */
        font-weight: 500;
        text-align: center;
        flex-grow: 1;
        color: var(--primary-text-color);
      }
      .calendar-header ha-icon-button {
        color: var(--primary-text-color);
      }
      .calendar-header ha-icon-button[disabled] {
        color: var(--disabled-text-color);
      }
      .calendar-header ha-icon-button ha-icon {
        /* hack to fix icon misalignment */
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .calendar-header ha-icon-button ha-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      /* NEW Calendar Grid Styles */
      .calendar-grid {
        /* padding removed, handled by .calendar-dialog-content */
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px; /* Small gap between cells */
        margin-top: 8px;
        border: 1px solid var(--card-background-color, #e0e0e0); /* Optional border around grid */
        border-radius: 4px;
        overflow: hidden; /* Clip corners */
        background-color: var(
          --card-background-color,
          #e0e0e0
        ); /* Background for gaps */
      }

      .calendar-weekday {
        text-align: center;
        padding: 6px 2px; /* Adjust padding */
        font-weight: bold;
        font-size: 0.8em; /* Smaller weekday font */
        color: var(--secondary-text-color);
        background-color: var(
          --secondary-background-color,
          #f5f5f5
        ); /* Header background */
        text-transform: uppercase; /* Match screenshot */
      }

      .calendar-day {
        background-color: var(
          --card-background-color,
          white
        ); /* Cell background */
        padding: 1px;
        min-height: 60px; /* Minimum height for cells */
        display: flex;
        flex-direction: column;
        justify-content: flex-start; /* Align content to top */
        align-items: center; /* Center horizontally */
        position: relative; /* For positioning day number */
        border: none; /* Remove individual borders if grid gap is used */
      }

      .calendar-day.padding {
        opacity: 0.6;
      }

      .day-number {
        font-size: 0.9em;
        font-weight: 500;
        color: var(--secondary-text-color);
        margin-bottom: 4px; /* Space between number and coeffs */
        text-align: center;
        width: 100%; /* Take full width for centering */
        background-color: var(--divider-color);
      }

      .day-coeffs {
        display: flex;
        flex-wrap: wrap; /* Allow coeffs to wrap */
        flex-direction: column; /* Align coeffs in a row */
        justify-content: center; /* Center coeffs horizontally */
        align-items: center; /* Center coeffs vertically */
        gap: 3px; /* Gap between coeffs */
        /* width: 3ch; */ /* REMOVED to allow expansion */
      }

      .coeff-value {
        display: inline-block;
        font-size: 0.85em; /* Smaller coefficient font */
        font-weight: 500;
        padding: 1px 4px; /* Small padding */
        border-radius: 3px;
        line-height: 1.2;
        /* background-color: var(--divider-color); Default background */
        color: var(--primary-text-color); /* Default text color */
      }

      .coeff-value.warning-coef {
        color: var(--warning-color); /* Text color on warning background */
        font-weight: bold;
      }
      .coeff-value.low-coef {
        color: var(--info-color); /* Text color on info background */
        opacity: 0.8;
      }

      /* Remove old table styles if they exist */
      .calendar-table {
        display: none;
      }
      /* Media Query for Mobile Dialog Width */
      @media (max-width: 600px) {
        ha-dialog {
          /* Override default max-width for mobile */
          --mdc-dialog-min-width: calc(
            100vw - 20px
          ); /* 10px margin each side */
          --mdc-dialog-max-width: calc(100vw - 20px);
        }
        .calendar-dialog-content {
          /* Reduce padding inside dialog on mobile */
          padding: 10px 5px;
        }
        /* .calendar-grid padding already removed */
      }
    `;
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

// Remove the original JS file after successful conversion
// (This step should be done manually or via a separate command after verification)