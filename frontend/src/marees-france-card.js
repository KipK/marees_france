import {
  LitElement,
  html,
  css,
} from "lit"; // Use bare specifier for lit
// SVG is imported by GraphRenderer now
// import { SVG } from "@svgdotjs/svg.js";

// Import localization function
import { localizeCard } from './localize.js';

// Import utility functions
import { getWeekdayShort3Letters, getNextTideStatus } from './utils.js';

// Import the GraphRenderer class
import { GraphRenderer } from './graph-renderer.js';


class MareesFranceCard extends LitElement {
  // --- Properties for GraphRenderer ---
  _graphRenderer = null; // Instance of GraphRenderer
  _svgContainer = null; // Reference to the SVG container div in the shadow DOM

  // --- Properties for Card State & Interaction ---
  _isDraggingDot = false; // NEW: Track drag state
  _originalDotPosition = null; // NEW: Store original {x, y, timeStr, heightStr}
  _draggedPosition = null; // NEW: Store dragged {timeStr, heightStr} during drag
  _touchStartX = null; // [NEW] For swipe detection
  _touchStartY = null; // [NEW] For swipe detection
  _calendarHasPrevData = false; // [NEW] Store calendar nav state
  _calendarHasNextData = false; // [NEW] Store calendar nav state
  _calendarContentElement = null; // [NEW] Reference to the dialog content
  _boundHandlePopState = null; // [NEW] Store bound popstate handler

  constructor() {
    super();
    this._boundHandlePopState = this._handlePopState.bind(this);
    // Bind tooltip handlers once (drag handlers bound dynamically)
    this._boundHandleTooltipShow = this._handleTooltipShow.bind(this);
    this._boundHandleTooltipHide = this._handleTooltipHide.bind(this);
    this._boundHandleDragMove = null; // Will be bound in _handleDragStart
    this._boundHandleDragEnd = null; // Will be bound in _handleDragStart
  }

  static get properties() {
    return {
      hass: {},
      config: {},
      _selectedDay: { state: true },
      _waterLevels: { state: true }, // State property for water level data (from get_water_levels)
      _tideData: { state: true }, // State property for tide data (from get_tides_data)
      _coefficientsData: { state: true }, // State property for coefficient data (from get_coefficients_data) [NEW]
      _isLoadingWater: { state: true }, // Loading status for water levels
      _isLoadingTides: { state: true }, // Loading status for tide data
      _isLoadingCoefficients: { state: true }, // Loading status for coefficient data [NEW]
      _isInitialLoading: { state: true }, // Track initial load vs subsequent loads (maybe combine loaders?)
      _isDraggingDot: { state: true }, // Needed for conditional tooltip display
      _draggedPosition: { state: true, attribute: false }, // Needed for tooltip display during drag
      _isCalendarDialogOpen: { state: true },
      _calendarSelectedMonth: { state: true }, // Date object for the calendar month [NEW]
      _calendarHasPrevData: { state: true },
      _calendarHasNextData: { state: true },
    };
  }

  // Define card editor
  static async getConfigElement() {
    // Dynamically import the editor component when needed
    await import('./marees-france-card-editor.js');
    return document.createElement("marees-france-card-editor");
  }

  // Updated Stub Config for Device Picker
  static getStubConfig() {
      return {
          device_id: "", // Use device_id now
          show_header: true,
          title: localizeCard('ui.card.marees_france.default_title', null) // Provide default title
      };
  }

  setConfig(config) {
    // Check for device_id now
    if (!config.device_id) {
      throw new Error(localizeCard('ui.card.marees_france.error_device_required', this.hass) || "Device required");
    }
    this.config = config;
    const today = new Date();
    this._selectedDay = today.toISOString().slice(0, 10); // Default to today
    this._waterLevels = null; // Reset water levels on config change
    this._tideData = null; // Reset tide data on config change
    this._coefficientsData = null; // Reset coefficient data on config change [NEW]
    this._isLoadingWater = true; // Initialize loading state
    this._isLoadingTides = true; // Initialize loading state
    this._isLoadingCoefficients = true; // Initialize loading state [NEW]
    this._isInitialLoading = true;
    this._isCalendarDialogOpen = false;
    this._calendarSelectedMonth = new Date();
    // Reset graph-related interaction state
    this._isDraggingDot = false;
    this._originalDotPosition = null;
    this._draggedPosition = null;
    // Graph renderer will be initialized in `updated`
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Destroy the graph renderer if it exists
    if (this._graphRenderer) {
      this._graphRenderer.destroy();
      this._graphRenderer = null;
    }
    this._svgContainer = null; // Clear container reference
    // Ensure popstate listener is removed
    window.removeEventListener('popstate', this._boundHandlePopState);
    // Clean up any lingering drag listeners (safety measure)
    this._removeDragListeners();
  }

  // --- Combined Fetch Function (Optional but cleaner) ---
  async _fetchData() {
      if (!this.hass || !this.config || !this.config.device_id) {
          console.warn("Marees Card: Fetch prerequisites not met (device_id).");
          this._isLoadingWater = false;
          this._isLoadingTides = false;
          this._isLoadingCoefficients = false; // [NEW]
          this._waterLevels = { error: "Configuration incomplete" };
          this._tideData = { error: "Configuration incomplete" };
          this._coefficientsData = { error: "Configuration incomplete" }; // [NEW]
          this.requestUpdate();
          return;
      }
      // Reset states before fetching
      this._isLoadingWater = true;
      this._isLoadingTides = true;
      this._isLoadingCoefficients = true; // [NEW]
      this._waterLevels = null;
      this._tideData = null;
      this._coefficientsData = null; // [NEW]
      this.requestUpdate(); // Show loaders

      // Fetch all concurrently
      await Promise.all([
          this._fetchWaterLevels(),
          this._fetchTideData(),
          this._fetchCoefficientsData() // [NEW]
      ]);

      // No need to set loading false here, individual fetches handle it in finally blocks
      // No need for final requestUpdate here, individual fetches handle it
  }

  // --- Fetch Water Level Data ---
  async _fetchWaterLevels() {
    // Set loading true ONLY if not already loading (prevent loops if called rapidly)
    // if (this._isLoadingWater) return; // Maybe not needed if called carefully
    this._isLoadingWater = true;
    this.requestUpdate(); // Show loader if needed

    // Check for device_id and selectedDay
    if (!this.hass || !this.config || !this.config.device_id || !this._selectedDay) {
      console.warn("Marees Card: Water Level Fetch prerequisites not met.", { hass: !!this.hass, device_id: this.config?.device_id, day: this._selectedDay });
      this._waterLevels = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) }; // Use localized message
      this._isLoadingWater = false; // Set loading false
      this.requestUpdate(); // Update UI
      return;
    }

    try {
      // console.log(`Marees Card: Fetching water levels for device ${this.config.device_id} on ${this._selectedDay}`); // Removed log
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_water_levels', // service
        { // data
          device_id: this.config.device_id, // Use device_id
          date: this._selectedDay
        },
        undefined, // target (not needed)
        false, // blocking (usually false for frontend calls)
        true // return_response
      );

      // Check response structure
      if (response && response.response && typeof response.response === 'object') {
          this._waterLevels = response;
          // console.log("Marees Card: Water levels received:", this._waterLevels); // Removed log
      } else {
          console.error('Marees Card: Invalid data structure received from get_water_levels:', response);
          this._waterLevels = { error: "Invalid data structure from service" };
      }
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_water_levels service:', error);
      this._waterLevels = { error: error.message || "Service call failed" };
    } finally {
        this._isLoadingWater = false; // Set loading false after fetch completes or fails
        if (this._isInitialLoading && !this._isLoadingTides && !this._isLoadingCoefficients) { // Turn off initial flag only when all are done
             this._isInitialLoading = false;
        }
        this.requestUpdate(); // Ensure UI updates after loading finishes
    }
  }

  // --- Fetch Tide Data ---
  async _fetchTideData() {
    // if (this._isLoadingTides) return; // Maybe not needed
    this._isLoadingTides = true;
    this.requestUpdate(); // Show loader if needed

    // Check for device_id
    if (!this.hass || !this.config || !this.config.device_id) {
      console.warn("Marees Card: Tide Data Fetch prerequisites not met.", { hass: !!this.hass, device_id: this.config?.device_id });
      this._tideData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingTides = false; // Set loading false
      this.requestUpdate(); // Update UI
      return;
    }

    try {
      // console.log(`Marees Card: Fetching tide data for device ${this.config.device_id}`); // Removed log
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_tides_data', // service
        { // data
          device_id: this.config.device_id // Use device_id
        },
        undefined, // target (not needed)
        false, // blocking (usually false for frontend calls)
        true // return_response
      );

      // Check response structure
      if (response && response.response && typeof response.response === 'object') {
          this._tideData = response;
           // console.log("Marees Card: Tide data received:", this._tideData); // Removed log
      } else {
          console.error('Marees Card: Invalid data structure received from get_tides_data:', response);
          this._tideData = { error: "Invalid data structure from service" };
      }
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_tides_data service:', error);
      this._tideData = { error: error.message || "Service call failed" };
    } finally {
        this._isLoadingTides = false; // Set loading false after fetch completes or fails
         if (this._isInitialLoading && !this._isLoadingWater && !this._isLoadingCoefficients) { // Turn off initial flag only when all are done
             this._isInitialLoading = false;
        }
        this.requestUpdate(); // Ensure UI updates after loading finishes
    }
  }

  // --- Fetch Coefficient Data --- [NEW]
  async _fetchCoefficientsData() {
    this._isLoadingCoefficients = true;
    this.requestUpdate();

    if (!this.hass || !this.config || !this.config.device_id) {
      console.warn("Marees Card: Coefficient Data Fetch prerequisites not met.", { hass: !!this.hass, device_id: this.config?.device_id });
      this._coefficientsData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.hass) };
      this._isLoadingCoefficients = false;
      this.requestUpdate();
      return;
    }

    try {
      // Calculate the first day of the current month
      const today = new Date();
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDateStr = firstDayOfMonth.toISOString().slice(0, 10); // Format YYYY-MM-DD

      // console.log(`Marees Card: Fetching coefficient data for device ${this.config.device_id} starting from ${startDateStr}`); // Removed log
      const response = await this.hass.callService(
        'marees_france', // domain
        'get_coefficients_data', // service
        { // data
          device_id: this.config.device_id, // Use device_id
          date: startDateStr, // Explicitly request data starting from the 1st of the month
          days: 365 // Fetch 365 days from the start date
        },
        undefined, // target
        false, // blocking
        true // return_response
      );

      // Check response structure (should be nested under 'response')
      if (response && response.response && typeof response.response === 'object' && Object.keys(response.response).length > 0) {
          // Store the whole response object like other fetches
          this._coefficientsData = response;
          // console.log("Marees Card: Coefficient data received:", this._coefficientsData); // Removed log
      } else if (response && response.response && typeof response.response === 'object' && Object.keys(response.response).length === 0) {
          console.warn('Marees Card: Received empty coefficient data object from get_coefficients_data:', response);
          // Store the whole response but add an error marker if needed, or just the error
          this._coefficientsData = { ...response, error: localizeCard('ui.card.marees_france.no_coefficient_data', this.hass) };
      } else {
          console.error('Marees Card: Invalid data structure received from get_coefficients_data:', response);
          this._coefficientsData = { error: "Invalid data structure from service" };
      }
    } catch (error) {
      console.error('Marees Card: Error calling marees_france.get_coefficients_data service:', error);
      this._coefficientsData = { error: error.message || "Service call failed" };
    } finally {
        this._isLoadingCoefficients = false;
        // Update initial loading flag check
        if (this._isInitialLoading && !this._isLoadingWater && !this._isLoadingTides) {
             this._isInitialLoading = false;
        }
        this.requestUpdate();
    }
  }


  _handleTabClick(ev) {
    const newDay = ev.currentTarget.dataset.date;
    if (newDay !== this._selectedDay) {
        this._selectedDay = newDay;
        // Only need to fetch water levels, as tide data is for all days
        this._fetchWaterLevels();
    }
  }

  render() {
    // Check for device_id in config
    if (!this.hass || !this.config || !this.config.device_id) {
      return html`<ha-card><div class="warning">${localizeCard('ui.card.marees_france.error_device_required', this.hass)}</div></ha-card>`;
    }

    // Check if tide data fetch resulted in an error
    if (this._tideData?.error) {
        // Optionally show a more specific error if device wasn't found vs other service errors
        const message = this._tideData.error.includes("not found")
            ? localizeCard('ui.card.marees_france.device_not_found', this.hass, 'device_id', this.config.device_id)
            : `${localizeCard('ui.card.marees_france.no_tide_data', this.hass)} Error: ${this._tideData.error}`;
        return html`<ha-card><div class="warning">${message}</div></ha-card>`;
    }

    // Check if tide data is loaded and valid before proceeding
    if (!this._tideData || !this._tideData.response) {
        // Show loading or initial message if still loading tides
        return html`
            <ha-card>
                <div class="card-header">${this.config.title || localizeCard('ui.card.marees_france.default_title', this.hass)}</div>
                <div class="card-content">
                    ${this._isLoadingTides ? html`<div class="loader">Loading tide data...</div>` : html`<div class="warning">${localizeCard('ui.card.marees_france.no_tide_data', this.hass)}</div>`}
                </div>
            </ha-card>
        `;
    }

    // --- Tide data is available, proceed ---
    const tideDataForStatus = this._tideData; // Pass the whole object including 'response'
    const nextTideInfo = getNextTideStatus(tideDataForStatus, this.hass);
    const locale = this.hass.language || 'en';

    const today = new Date();
    const dayLabels = [...Array(7).keys()].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().slice(0, 10);
    });


    return html`
      <ha-card>
        ${this.config.show_header !== false ? html`
          <div class="card-header">${this.config.title || localizeCard('ui.card.marees_france.default_title', this.hass)}</div>
        ` : ''}
        <div class="card-content">
          <!-- Next Tide Status Display -->
          ${nextTideInfo ? html`
            <div class="next-tide-status">
              <div class="next-tide-main">
                <div class="next-tide-icon-time">
                    <ha-icon .icon=${nextTideInfo.currentTrendIcon}></ha-icon>
                    <div class="next-tide-text-container">
                        <span class="next-tide-trend-text">
                            ${localizeCard(nextTideInfo.currentTrendIcon === 'mdi:wave-arrow-up' ? 'ui.card.marees_france.rising_prefix' : 'ui.card.marees_france.falling_prefix', this.hass)}
                        </span>
                        <span class="next-tide-time">${nextTideInfo.nextPeakTime}</span>
                    </div>
                </div>
                <div class="next-tide-details">
                  ${(() => {
                    let parts = [];
                  // Ensure height is a number before adding
                  if (nextTideInfo.nextPeakHeight !== null && !isNaN(parseFloat(nextTideInfo.nextPeakHeight))) {
                    parts.push(`${parseFloat(nextTideInfo.nextPeakHeight).toFixed(1)} m`);
                  }
                  // Always show coefficient if available (determined in getNextTideStatus)
                  if (nextTideInfo.displayCoefficient !== null) {
                    const coef = nextTideInfo.displayCoefficient;
                    const coefClass = coef >= 100 ? 'warning-coef' : '';
                    // Use secondary text color for coefficient like height, apply warning class if needed
                    parts.push(html`<span class="${coefClass}" >Coef. ${coef}</span>`);
                  }
                  // Join with separator only if both parts exist
                  // Need to render the parts directly if one contains HTML
                  if (parts.length === 2) {
                    return html`${parts[0]} - ${parts[1]}`;
                  } else if (parts.length === 1) {
                    return parts[0];
                  }
                  return ''; // Return empty if no parts
                  })()}
                </div>
              </div>
              <ha-icon
                class="calendar-icon"
                icon="mdi:calendar-month"
                @click="${this._openCalendarDialog}"
                title="${localizeCard('ui.card.marees_france.open_calendar', this.hass)}"
              ></ha-icon>
            </div>
          ` : html`<div class="warning">${localizeCard('ui.card.marees_france.waiting_next_tide', this.hass)}</div>`}

          <!-- Day Tabs (Simplified) -->
          <div class="tabs">
            ${dayLabels.map(date => {
              const d = new Date(date);
              // Get 3-letter abbreviation, uppercase
              const dayLabel = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase();
              // Get dd/mm date format
              const dateLabel = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
              return html`
                <div
                  class="tab ${this._selectedDay === date ? 'active' : ''}"
                  data-date="${date}"
                  @click="${this._handleTabClick}"
                >
                  <div class="tab-day">${dayLabel}</div>
                  <div class="tab-date">${dateLabel}</div>
                </div>
              `;
            })}
          </div>

          <!-- SVG Graph Container -->
          <div class="svg-graph-container">
            ${(this._isLoadingWater || this._isLoadingTides) ? html`
              <ha-icon icon="mdi:loading" class="loading-icon"></ha-icon>
            ` : ''}
            <!-- Target for svg.js -->
            <div id="marees-graph-target" class="svg-graph-target">
               <!-- SVG will be drawn here by _drawGraphWithSvgJs -->
            </div>
          </div>
          <!-- HTML Tooltip Element -->
          <div id="marees-html-tooltip" class="chart-tooltip"></div>
        </div>
      </ha-card>

      <!-- Coefficient Calendar Dialog [NEW] -->
      <!-- Coefficient Calendar Dialog [NEW] - Always rendered, visibility controlled by 'open' -->
      <ha-dialog
        ?open=${this._isCalendarDialogOpen}
        @closed="${this._closeCalendarDialog}"
        heading="${localizeCard('ui.card.marees_france.coefficient_calendar_title', this.hass)}"
      >
        <div class="dialog-content">
          ${this._renderCalendarDialogContent()}
        </div>
        <mwc-button
          slot="primaryAction"
          @click="${this._closeCalendarDialog}"
        >
          ${this.hass.localize('ui.common.close')}
        </mwc-button>
      </ha-dialog>
    `;
  }

  // --- Dialog Handlers [MODIFIED FOR HISTORY] ---
  async _openCalendarDialog() { // Make async to await updateComplete
    // Prevent opening if already open
    if (this._isCalendarDialogOpen) return;

    // Fetch coefficient data if it hasn't been fetched yet or resulted in an error
    if (!this._coefficientsData || this._coefficientsData.error) {
        this._fetchCoefficientsData(); // Fetch on demand if needed
    }
    this._isCalendarDialogOpen = true;
    this._calendarSelectedMonth = new Date(); // Reset to current month on open

    // [NEW] Push state and add popstate listener
    history.pushState({ mareesCalendarOpen: true }, '', '#marees-calendar');
    window.addEventListener('popstate', this._boundHandlePopState);
    // console.log("Marees Card: Pushed history state and added popstate listener."); // Removed log

    // Wait for the dialog and its content to render before adding listeners
    await this.updateComplete; // Wait for LitElement update cycle

    this._calendarContentElement = this.shadowRoot?.querySelector('ha-dialog .calendar-dialog-content');
    if (this._calendarContentElement) {
        // console.log("Marees Card: Adding calendar touch listeners."); // Removed log
        // Bind listeners to ensure 'this' context is correct
        this._boundHandleTouchStart = this._handleTouchStart.bind(this);
        this._boundHandleTouchMove = this._handleTouchMove.bind(this);
        this._boundHandleTouchEnd = this._handleTouchEnd.bind(this);

        this._calendarContentElement.addEventListener('touchstart', this._boundHandleTouchStart, { passive: true }); // passive:true initially
        this._calendarContentElement.addEventListener('touchmove', this._boundHandleTouchMove, { passive: false }); // passive:false to allow preventDefault
        this._calendarContentElement.addEventListener('touchend', this._boundHandleTouchEnd, { passive: true });
    } else {
        console.warn("Marees Card: Could not find calendar content element to attach listeners.");
    }
  }

  // [NEW] Handle popstate event
  _handlePopState(event) {
    // console.log("Marees Card: Popstate event fired.", event.state, "Dialog open:", this._isCalendarDialogOpen); // Removed log
    // If the dialog is open and the new state doesn't indicate it should be (i.e., user navigated back)
    if (this._isCalendarDialogOpen && !event.state?.mareesCalendarOpen) {
        // console.log("Marees Card: Closing dialog due to popstate."); // Removed log
        this._closeCalendarDialog(true); // Pass flag indicating closure is from popstate
    }
  }

  _closeCalendarDialog(isFromPopstate = false) {
    // Prevent closing if already closed
    if (!this._isCalendarDialogOpen) return;

    // console.log(`Marees Card: Closing calendar dialog. From popstate: ${isFromPopstate}`); // Removed log
    this._isCalendarDialogOpen = false; // Set state immediately

    // [NEW] Remove popstate listener
    window.removeEventListener('popstate', this._boundHandlePopState);
    // console.log("Marees Card: Removed popstate listener."); // Removed log

    // [NEW] If closed normally (not via back button) and history state indicates dialog was open, go back.
    if (!isFromPopstate && history.state?.mareesCalendarOpen) {
        // console.log("Marees Card: Dialog closed normally, calling history.back()."); // Removed log
        history.back();
    }

    // Remove touch listeners when dialog closes
    if (this._calendarContentElement) {
        // console.log("Marees Card: Removing calendar touch listeners."); // Removed log
        this._calendarContentElement.removeEventListener('touchstart', this._boundHandleTouchStart);
        this._calendarContentElement.removeEventListener('touchmove', this._boundHandleTouchMove);
        this._calendarContentElement.removeEventListener('touchend', this._boundHandleTouchEnd);
        this._calendarContentElement = null; // Clear reference
    }
    // Reset touch state
    this._touchStartX = null;
    this._touchStartY = null;
  }

  // --- Dialog Content Renderer [MODIFIED FOR GRID CALENDAR & NAV STATE] ---
  _renderCalendarDialogContent() {
    const locale = this.hass.language || 'en';

    // Handle loading state
    if (this._isLoadingCoefficients) {
      return html`<div class="dialog-loader">Loading coefficient data...</div>`;
    }

    // Handle error state
    if (!this._coefficientsData || this._coefficientsData.error || !this._coefficientsData.response) {
      const errorMsg = this._coefficientsData?.error || localizeCard('ui.card.marees_france.no_coefficient_data', this.hass);
      // Reset nav state on error
      this._calendarHasPrevData = false;
      this._calendarHasNextData = false;
      return html`<div class="dialog-warning">${errorMsg}</div>`;
    }

    // Data is available
    const actualCoeffData = this._coefficientsData.response;
    const currentMonthDate = this._calendarSelectedMonth; // Use the state variable
    const currentYear = currentMonthDate.getFullYear();
    const currentMonth = currentMonthDate.getMonth(); // 0-indexed

    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Determine starting day of the week (0=Sun, 1=Mon, ... 6=Sat)
    const startingDayRaw = firstDayOfMonth.getDay();
    // Adjust based on locale? Let's assume Monday is the start (like screenshot L, M, M...)
    // Convert Sunday (0) to 7, then subtract 1 to make Monday=0, ..., Sunday=6
    const startingDay = startingDayRaw === 0 ? 6 : startingDayRaw - 1;

    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`; // YYYY-MM

    // --- Generate Weekday Headers ---
    // Assuming week starts on Monday for display
    const weekdays = Array.from({ length: 7 }, (_, i) => getWeekdayShort3Letters(i, locale));

    // --- Generate Calendar Days ---
    const calendarDays = [];

    // 1. Previous month's padding days
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = 0; i < startingDay; i++) {
        const day = daysInPrevMonth - startingDay + 1 + i;
        calendarDays.push({ day: day, isPadding: true, isCurrentMonth: false });
    }

    // 2. Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
        const coeffs = actualCoeffData[dateStr] || []; // Get coeffs for this day
        calendarDays.push({ day: day, isPadding: false, isCurrentMonth: true, coeffs: coeffs, dateStr: dateStr });
    }

    // 3. Next month's padding days
    const totalCells = startingDay + daysInMonth;
    // Ensure we always have 42 cells(6 rows)
    const targetCells =  42;
    const remainingCells = targetCells - totalCells;
    for (let i = 1; i <= remainingCells; i++) {
        calendarDays.push({ day: i, isPadding: true, isCurrentMonth: false });
    }

    // --- Check if Prev/Next Months have data and store in state --- [MODIFIED]
    const availableDates = Object.keys(actualCoeffData).sort();
    let hasPrev = false; // Use local vars for calculation
    let hasNext = false;
    if (availableDates.length > 0) {
        const prevMonthDateObj = new Date(currentYear, currentMonth - 1, 1);
        const nextMonthDateObj = new Date(currentYear, currentMonth + 1, 1);
        const prevMonthYear = prevMonthDateObj.getFullYear();
        const prevMonthMonth = prevMonthDateObj.getMonth();
        const nextMonthYear = nextMonthDateObj.getFullYear();
        const nextMonthMonth = nextMonthDateObj.getMonth();

        try {
            hasPrev = availableDates.some(dateStr => {
                const d = new Date(dateStr);
                return d.getFullYear() === prevMonthYear && d.getMonth() === prevMonthMonth;
            });
            hasNext = availableDates.some(dateStr => {
                const d = new Date(dateStr);
                return d.getFullYear() === nextMonthYear && d.getMonth() === nextMonthMonth;
            });
        } catch (error) {
            console.error("Marees Card Dialog: Error checking prev/next month data:", error);
        }
    }
    // Update state properties (will trigger re-render if changed, but that's ok here)
    this._calendarHasPrevData = hasPrev;
    this._calendarHasNextData = hasNext;
    // --- End Modification ---

    return html`
      <div class="calendar-dialog-content">
        <div class="calendar-header">
          <ha-icon-button
            @click="${() => this._changeCalendarMonth(-1)}"
            .disabled=${!this._calendarHasPrevData}
            title="${localizeCard('ui.card.marees_france.previous_month', this.hass)}"
          >
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </ha-icon-button>
          <span class="calendar-month-year">
            ${currentMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
          </span>
          <ha-icon-button
            icon="mdi:chevron-right"
            @click="${() => this._changeCalendarMonth(1)}"
            .disabled=${!this._calendarHasNextData}
            title="${localizeCard('ui.card.marees_france.next_month', this.hass)}"
          >
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </ha-icon-button>
        </div>

        <div class="calendar-grid">
          <!-- Weekday Headers -->
          ${weekdays.map(day => html`<div class="calendar-weekday">${day}</div>`)}

          <!-- Calendar Day Cells -->
          ${calendarDays.map(dayInfo => html`
            <div class="calendar-day ${dayInfo.isPadding ? 'padding' : ''} ${dayInfo.isCurrentMonth ? 'current-month' : ''}">
              <div class="day-number">${dayInfo.isCurrentMonth?dayInfo.day:''}</div>
              ${dayInfo.isCurrentMonth && dayInfo.coeffs && dayInfo.coeffs.length > 0 ? html`
                <div class="day-coeffs">
                  ${dayInfo.coeffs.map(coeff => {
                    const coefNum = parseInt(coeff, 10);
                    const coefClass = coefNum >= 100 ? 'warning-coef' : (coefNum < 40 ? 'low-coef' : '');
                    return html`<span class="coeff-value ${coefClass}">${coeff}</span>`;
                  })}
                </div>
              ` : ''}
            </div>
          `)}
        </div>
        ${calendarDays.filter(d => d.isCurrentMonth && d.coeffs?.length > 0).length === 0 && !this._isLoadingCoefficients ? html`
            <div class="no-data-month">${localizeCard('ui.card.marees_france.no_data_for_month', this.hass)}</div>
            ` : ''}
      </div>
    `;
  }

  // --- Change Calendar Month Handler [MODIFIED] ---
  _changeCalendarMonth(monthOffset) {
    const newMonth = new Date(this._calendarSelectedMonth);
    newMonth.setMonth(newMonth.getMonth() + monthOffset);
    newMonth.setDate(1); // Go to the first day of the new month
    this._calendarSelectedMonth = newMonth;
    // Data availability (_calendarHasPrevData/_calendarHasNextData) will be recalculated on the next render
  }

  // --- [NEW] Touch Handlers for Calendar Swipe ---
  _handleTouchStart(ev) {
    // Only track single touch
    if (ev.touches.length === 1) {
        this._touchStartX = ev.touches[0].clientX;
        this._touchStartY = ev.touches[0].clientY;
        // console.log(`Touch Start: X=${this._touchStartX}, Y=${this._touchStartY}`);
    } else {
        this._touchStartX = null; // Reset if multiple touches
        this._touchStartY = null;
    }
  }

  _handleTouchMove(ev) {
    if (!this._touchStartX || !this._touchStartY) {
        return; // No valid start touch
    }

    const currentX = ev.touches[0].clientX;
    const currentY = ev.touches[0].clientY;
    const deltaX = currentX - this._touchStartX;
    const deltaY = currentY - this._touchStartY;

    // If horizontal movement is significantly larger than vertical, prevent default scroll
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) { // Adjust multiplier as needed
        // console.log("Preventing scroll due to horizontal swipe");
        ev.preventDefault();
    }
  }

  _handleTouchEnd(ev) {
    if (!this._touchStartX || !this._touchStartY || ev.changedTouches.length !== 1) {
        // console.log("Touch End: Invalid start or multiple touches.");
        this._touchStartX = null; // Reset state
        this._touchStartY = null;
        return; // No valid start touch or multiple end touches
    }

    const touchEndX = ev.changedTouches[0].clientX;
    const touchEndY = ev.changedTouches[0].clientY;
    const deltaX = touchEndX - this._touchStartX;
    const deltaY = touchEndY - this._touchStartY;
    const swipeThreshold = 50; // Minimum pixels for a swipe

    // console.log(`Touch End: EndX=${touchEndX}, EndY=${touchEndY}, DeltaX=${deltaX}, DeltaY=${deltaY}`);
    // console.log(`Nav State: Prev=${this._calendarHasPrevData}, Next=${this._calendarHasNextData}`);

    // Check for horizontal swipe (significant X movement, minimal Y movement)
    if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaY) < swipeThreshold) {
        // console.log(`Swipe detected: ${deltaX > 0 ? 'Right' : 'Left'}`);
        if (deltaX > 0 && this._calendarHasPrevData) { // Swipe Right -> Previous Month
            // console.log("Triggering Previous Month");
            this._changeCalendarMonth(-1);
        } else if (deltaX < 0 && this._calendarHasNextData) { // Swipe Left -> Next Month
            // console.log("Triggering Next Month");
            this._changeCalendarMonth(1);
        } else {
            // console.log("Swipe detected but navigation disabled for this direction.");
        }
    } else {
        // console.log("No significant horizontal swipe detected.");
    }

    // Reset touch start coordinates for the next touch
    this._touchStartX = null;
    this._touchStartY = null;
  }

  // --- Lifecycle method to handle updates and GraphRenderer ---
  updated(changedProperties) {
    super.updated(changedProperties);

    let needsGraphRedraw = false;

    // Initialize GraphRenderer on first update or if container ref is lost/recreated
    if (!this._graphRenderer || !this.shadowRoot.contains(this._svgContainer)) {
        this._svgContainer = this.shadowRoot.querySelector('#marees-graph-target');
        if (this._svgContainer) {
            // If renderer exists, destroy the old one first
            if (this._graphRenderer) {
                this._graphRenderer.destroy();
            }
            // Create new renderer instance
            this._graphRenderer = new GraphRenderer(this, this._svgContainer, this.hass);
            needsGraphRedraw = true; // Need initial draw after setup
        }
    }

    let configChanged = changedProperties.has('config');

    // Trigger full data refetch on config change
    if (configChanged) {
        this._fetchData();
        needsGraphRedraw = true; // Graph will redraw after fetch completes
    }
    // Trigger initial data fetch if hass/config ready and data not yet fetched
    else if (changedProperties.has('hass') && this.hass && this.config?.device_id && this._waterLevels === null && this._tideData === null) {
        this._fetchData();
        needsGraphRedraw = true;
    }

    // Check if data relevant to the graph changed
    if (changedProperties.has('_selectedDay') || changedProperties.has('_waterLevels') || changedProperties.has('_tideData') || changedProperties.has('_isLoadingWater') || changedProperties.has('_isLoadingTides')) {
        needsGraphRedraw = true;
    }

    // Call GraphRenderer to draw if needed and data is ready
    if (needsGraphRedraw && this._graphRenderer && !this._isLoadingWater && !this._isLoadingTides) {
        // Pass necessary data to the renderer
        this._graphRenderer.drawGraph(this._tideData, this._waterLevels, this._selectedDay);
    }
  }

  // --- Tooltip Helpers (Remain on Card) ---
  _handleTooltipShow(evt) {
      // Only show hover tooltip if NOT dragging
      if (!this._isDraggingDot && this._originalDotPosition) {
          this._showHtmlTooltip(evt, this._originalDotPosition.timeStr, this._originalDotPosition.heightStr);
      }
  }

  _handleTooltipHide() {
      // Hide tooltip if NOT dragging (drag move will handle tooltip otherwise)
       if (!this._isDraggingDot) {
          this._hideHtmlTooltip();
       }
  }

  _showHtmlTooltip(evt, time, height, isDragging = false) {
      const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
      if (!tooltip) return;

      tooltip.style.visibility = 'visible';
      tooltip.style.display = 'block';
      void tooltip.offsetWidth; // Force reflow
      tooltip.innerHTML = `<strong>${time}</strong><br>${height} m`;

      const targetElement = evt.currentTarget || evt.target;
      if (!targetElement && !(isDragging && evt.type === 'syntheticDrag')) {
          console.warn("Tooltip: Cannot determine target element or synthetic event.");
          this._hideHtmlTooltip();
          return;
      }

       const cardRect = this.getBoundingClientRect();
       let targetCenterX, targetTopY, targetHeight;

       if (isDragging && evt.type === 'syntheticDrag' && evt.clientX !== undefined && evt.clientY !== undefined) {
           targetCenterX = evt.clientX - cardRect.left;
           targetTopY = evt.clientY - cardRect.top;
           targetHeight = 1;
       } else if (targetElement?.getBoundingClientRect) {
           const targetRect = targetElement.getBoundingClientRect();
           targetCenterX = targetRect.left + targetRect.width / 2 - cardRect.left;
           targetTopY = targetRect.top - cardRect.top;
           targetHeight = targetRect.height;
       } else {
           console.warn("Tooltip: Cannot determine target coordinates from event:", evt);
           this._hideHtmlTooltip();
           return;
       }

       const tooltipWidth = tooltip.offsetWidth;
       const tooltipHeight = tooltip.offsetHeight;

       if (tooltipWidth <= 0 || tooltipHeight <= 0) {
           this._hideHtmlTooltip();
           return;
       }

       const isTouchEvent = evt.type.startsWith('touch');
       const offsetAbove = isTouchEvent ? 45 : 10;
       let left = targetCenterX - tooltipWidth / 2;
       let top = targetTopY - tooltipHeight - offsetAbove;
       const safetyMargin = 2;

       if (left < safetyMargin) left = safetyMargin;
       if (left + tooltipWidth > cardRect.width - safetyMargin) left = cardRect.width - tooltipWidth - safetyMargin;
       if (top < safetyMargin) {
           top = targetTopY + targetHeight + offsetAbove;
           if (top + tooltipHeight > cardRect.height - safetyMargin) {
               top = cardRect.height - tooltipHeight - safetyMargin;
           }
       }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
  }

 _hideHtmlTooltip() {
     const tooltip = this.shadowRoot?.getElementById('marees-html-tooltip');
     if (tooltip) {
         tooltip.style.display = 'none';
         tooltip.style.visibility = 'hidden';
     }
 }

 // --- Drag Handlers (Remain on Card, interact with GraphRenderer) ---
 _handleDragStart(e, dotGroup, dotCircle, hitAreaCircle) {
     if (e.button === 2) return;
     e.preventDefault();

     this._isDraggingDot = true;
     this.requestUpdate('_isDraggingDot');

     dotCircle.fill('var(--info-color, var(--primary-color))');
     hitAreaCircle.attr('cursor', 'grabbing');
     this._hideHtmlTooltip(); // Hide hover tooltip

     // Bind move/end listeners to window
     this._boundHandleDragMove = (ev) => this._handleDragMove(ev, dotGroup, dotCircle, hitAreaCircle);
     this._boundHandleDragEnd = (ev) => this._handleDragEnd(ev, dotGroup, dotCircle, hitAreaCircle);

     if (e.type === 'touchstart') {
         window.addEventListener('touchmove', this._boundHandleDragMove, { passive: false });
         window.addEventListener('touchend', this._boundHandleDragEnd, { once: true });
         window.addEventListener('touchcancel', this._boundHandleDragEnd, { once: true });
     } else {
         window.addEventListener('mousemove', this._boundHandleDragMove);
         window.addEventListener('mouseup', this._boundHandleDragEnd, { once: true });
     }
 }

  _handleDragMove(e, dotGroup, dotCircle, hitAreaCircle) {
     if (!this._isDraggingDot || !this._graphRenderer) return;
     e.preventDefault();

     const svgPoint = this._graphRenderer.getSVGCoordinates(e);
     // Check if graphRenderer has the necessary data (boundaries) before proceeding
     if (!svgPoint || this._graphRenderer.curveMinMinutes === null || this._graphRenderer.curveMaxMinutes === null) return;

     // Calculate the min/max X coordinates based on the actual curve data times from the renderer
     const minX = this._graphRenderer._timeToX(this._graphRenderer.curveMinMinutes);
     const maxX = this._graphRenderer._timeToX(this._graphRenderer.curveMaxMinutes);

     // Clamp the pointer's X coordinate to the curve's boundaries
     const clampedX = Math.max(minX, Math.min(maxX, svgPoint.x));

     // Convert clamped X back to total minutes using renderer's method
     const draggedTotalMinutes = this._graphRenderer._xToTotalMinutes(clampedX);

     // Interpolate height based on the clamped dragged time using renderer's method
     const draggedHeight = this._graphRenderer._interpolateHeight(draggedTotalMinutes);

     if (draggedHeight !== null) {
         // Calculate the precise Y on the curve using renderer's method
         const draggedY = this._graphRenderer._heightToY(draggedHeight);

         // Move the visual dot elements
         dotCircle.center(clampedX, draggedY);
         hitAreaCircle.center(clampedX, draggedY);

         // Format time and height for tooltip using the clamped time
         const hours = Math.floor(draggedTotalMinutes / 60);
         const minutes = Math.floor(draggedTotalMinutes % 60);
         const draggedTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
         const draggedHeightStr = draggedHeight.toFixed(2);

         // Store dragged position data on the card for tooltip
         this._draggedPosition = { timeStr: draggedTimeStr, heightStr: draggedHeightStr };
         this.requestUpdate('_draggedPosition');

         // Update and show tooltip with dragged data
         const svg = this._svgContainer?.querySelector('svg');
         if (svg) {
             try {
                 const ctm = svg.getScreenCTM();
                 if (ctm) {
                     const svgPt = svg.createSVGPoint();
                     svgPt.x = clampedX;
                     svgPt.y = draggedY;
                     const screenPt = svgPt.matrixTransform(ctm);
                     const syntheticEvent = {
                         clientX: screenPt.x, clientY: screenPt.y, type: 'syntheticDrag'
                     };
                     this._showHtmlTooltip(syntheticEvent, draggedTimeStr, draggedHeightStr, true); // Pass true for isDragging
                 } else { console.warn("Marees Card: Could not get CTM for tooltip positioning."); }
             } catch (transformError) { console.error("Marees Card: Error transforming SVG point for tooltip:", transformError); }
         } else { console.warn("Marees Card: Could not find SVG element for tooltip positioning."); }
     }
  }

 _handleDragEnd(e, dotGroup, dotCircle, hitAreaCircle) {
     if (!this._isDraggingDot) return;

     this._isDraggingDot = false;
     this.requestUpdate('_isDraggingDot');

     // Revert color and cursor
     dotCircle.fill('var(--current_tide_color)');
     hitAreaCircle.attr('cursor', 'grab');

     // Move dot back to original position visually
     if (this._originalDotPosition) {
         dotCircle.center(this._originalDotPosition.x, this._originalDotPosition.y);
         hitAreaCircle.center(this._originalDotPosition.x, this._originalDotPosition.y);
     }

     this._hideHtmlTooltip();

     // Clean up card state
     this._draggedPosition = null;
     this.requestUpdate('_draggedPosition');

     // Remove window listeners
     this._removeDragListeners();
 }

 // Helper to remove drag listeners
 _removeDragListeners() {
     if (this._boundHandleDragMove) {
         window.removeEventListener('mousemove', this._boundHandleDragMove);
         window.removeEventListener('touchmove', this._boundHandleDragMove);
         this._boundHandleDragMove = null;
     }
     if (this._boundHandleDragEnd) {
         window.removeEventListener('mouseup', this._boundHandleDragEnd);
         window.removeEventListener('touchend', this._boundHandleDragEnd);
         window.removeEventListener('touchcancel', this._boundHandleDragEnd);
         this._boundHandleDragEnd = null;
     }
 }

   getCardSize() {
     return 7; // Keep original size calculation
   }

  static get styles() {
    return css`
      :host {
        /* Card specific vars using HA vars */
        --current_tide_color: #FDD835;
        --tide-icon-color: var(--current_tide_color);
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
          color: var(--primary-text-color);
      }
      .card-content {
          padding: 0 16px 16px 16px; /* No top padding, standard sides/bottom */
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
        font-size: 1.0em; /* Smaller text for prefix */
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
        padding-left: calc(2.2em + 11px); /* Indent details to align below time (icon width + gap) */
        font-size: 1.0em; /* Slightly smaller details */
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
        transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
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
         color: var(--text-primary-color); /* Make date color match active text color */
         opacity: 0.8; /* Slightly less prominent */
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
        background-color: var(--secondary-background-color, #f0f0f0); /* Match coef box background */
        color: var(--primary-text-color, black); /* Keep text color primary */
        border: 1px solid var(--ha-card-border-color, var(--divider-color, grey)); /* Match coef box border */
        border-radius: 4px;
        padding: 4px 6px; /* Reduced padding */
        font-size: 12px;
        white-space: nowrap; /* Prevent wrapping */
        z-index: 100; /* Ensure it's above the SVG */
        pointer-events: none; /* Tooltip should not interfere with mouse */
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      }
      .chart-tooltip strong {
        font-weight: bold;
        font-weight: bold;
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
      .dialog-loader, .dialog-warning, .no-data-month {
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
      .calendar-header ha-icon-button ha-icon { /* hack to fix icon misalignment */
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
          background-color: var(--card-background-color, #e0e0e0); /* Background for gaps */
      }

      .calendar-weekday {
          text-align: center;
          padding: 6px 2px; /* Adjust padding */
          font-weight: bold;
          font-size: 0.8em; /* Smaller weekday font */
          color: var(--secondary-text-color);
          background-color: var(--secondary-background-color, #f5f5f5); /* Header background */
          text-transform: uppercase; /* Match screenshot */
      }

      .calendar-day {
          background-color: var(--card-background-color, white); /* Cell background */
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
      .calendar-table { display: none; }
      /* Media Query for Mobile Dialog Width */
      @media (max-width: 600px) {
        ha-dialog {
          /* Override default max-width for mobile */
          --mdc-dialog-min-width: calc(100vw - 20px); /* 10px margin each side */
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
} // End of class

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
