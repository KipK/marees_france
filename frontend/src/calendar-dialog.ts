// This file will manage all calendar dialog logic for the card.
import {
  HomeAssistant,
  GetCoefficientsDataResponseData
} from './types';
import { localizeCard } from './localize';
import { getWeekdayShort3Letters } from './utils';
import { TemplateResult, html, nothing } from 'lit';
import { DataManager } from './data-manager'; // May be needed to fetch data

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

// Interface for the card instance properties and methods CalendarDialogManager needs.
export interface CardInstanceForCalendarDialog {
  hass: HomeAssistant;
  _coefficientsData: GetCoefficientsDataResponseData | { error: string } | null;
  _isLoadingCoefficients: boolean;
  _dataManager: DataManager | null; // To call fetchCoefficientsData if needed
  requestUpdate: () => void;
  // Add any other properties/methods from the main card that the dialog will need.
}

export class CalendarDialogManager {
  private card: CardInstanceForCalendarDialog;
  private _isCalendarDialogOpen: boolean = false;
  private _calendarSelectedMonth: Date = new Date();
  private _touchStartX: number | null = null;
  private _touchStartY: number | null = null;
  private _calendarHasPrevData: boolean = false;
  private _calendarHasNextData: boolean = false;
  private _calendarContentElement: HTMLElement | null = null;
  private _boundHandlePopState: (event: PopStateEvent) => void;
  private _boundHandleTouchStart?: (ev: TouchEvent) => void;
  private _boundHandleTouchMove?: (ev: TouchEvent) => void;
  private _boundHandleTouchEnd?: (ev: TouchEvent) => void;

  constructor(cardInstance: CardInstanceForCalendarDialog) {
    this.card = cardInstance;
    this._boundHandlePopState = this._handlePopState.bind(this);
  }

  /**
   * Gets the current open state of the calendar dialog.
   * @returns True if the dialog is open, false otherwise.
   */
  public get isCalendarDialogOpen(): boolean {
    return this._isCalendarDialogOpen;
  }

  // --- Dialog Handlers ---
  /**
   * Opens the calendar dialog.
   * Fetches coefficient data if not already available or if an error occurred previously.
   * Manages browser history for back button navigation.
   */
  public async openCalendarDialog(): Promise<void> {
    if (this._isCalendarDialogOpen) return;

    const hasCoeffError = this.card._coefficientsData && 'error' in this.card._coefficientsData && this.card._coefficientsData.error;
    if (!this.card._coefficientsData || hasCoeffError) {
      // Check if dataManager exists and can fetch data
      if (this.card._dataManager) {
        await this.card._dataManager.fetchCoefficientsData();
      } else {
        console.warn("CalendarDialogManager: DataManager not available to fetch coefficient data.");
        // Optionally, handle this case by showing an error in the dialog or preventing opening
      }
    }
    this._isCalendarDialogOpen = true;
    this._calendarSelectedMonth = new Date(); // Reset to current month on open

    history.pushState({ mareesCalendarOpen: true } as PopStateEventState, '', '#marees-calendar');
    window.addEventListener('popstate', this._boundHandlePopState);

    this.card.requestUpdate(); // Request update on the main card to re-render with dialog open.
    // The main card's `updated` lifecycle method is responsible for calling
    // `setCalendarContentElement` on this manager after the DOM update.
  }

  private _handlePopState(event: PopStateEvent): void {
    const state = event.state as PopStateEventState | null;
    if (this._isCalendarDialogOpen && !state?.mareesCalendarOpen) {
      this.closeCalendarDialog(true);
    }
  }

  /**
   * Closes the calendar dialog.
   * Manages browser history and cleans up event listeners.
   * @param isFromPopstate True if the closure was triggered by a popstate event (browser back button).
   */
  public closeCalendarDialog(isFromPopstate: boolean = false): void {
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
    this.card.requestUpdate(); // Request update on the main card
  }

  private _changeCalendarMonth(monthOffset: number): void {
    const newMonth = new Date(this._calendarSelectedMonth);
    newMonth.setMonth(newMonth.getMonth() + monthOffset);
    newMonth.setDate(1); // Ensure it's the first of the month to avoid day overflow issues
    this._calendarSelectedMonth = newMonth;
    this.card.requestUpdate(); // Request update to re-render calendar
  }

  // Method to be called by the card after its update cycle to set the content element
  /**
   * Sets the calendar content HTMLElement.
   * This method should be called by the main card component after its `updated` lifecycle
   * to provide the manager with the DOM element it needs to attach touch listeners to.
   * @param element The calendar content div element, or null if not available/dialog closed.
   */
  public setCalendarContentElement(element: HTMLElement | null): void {
    if (this._calendarContentElement && this._calendarContentElement !== element) {
        this._removeCalendarTouchListeners(); // Clean up listeners on old element
    }
    this._calendarContentElement = element;
    if (this._isCalendarDialogOpen && this._calendarContentElement) {
        this._addCalendarTouchListeners();
    } else if (!this._isCalendarDialogOpen || !this._calendarContentElement) {
        this._removeCalendarTouchListeners();
    }
  }


  // --- Calendar Touch Handlers ---
  private _addCalendarTouchListeners(): void {
      if (!this._calendarContentElement) return;
      this._boundHandleTouchStart = this._handleTouchStart.bind(this);
      this._boundHandleTouchMove = this._handleTouchMove.bind(this);
      this._boundHandleTouchEnd = this._handleTouchEnd.bind(this);
      this._calendarContentElement.addEventListener('touchstart', this._boundHandleTouchStart, { passive: true });
      this._calendarContentElement.addEventListener('touchmove', this._boundHandleTouchMove, { passive: false }); // passive: false to allow preventDefault
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
      // Don't nullify _calendarContentElement here, it's managed by setCalendarContentElement
  }

  private _handleTouchStart(ev: TouchEvent): void {
    if (ev.touches.length === 1) {
      this._touchStartX = ev.touches[0].clientX;
      this._touchStartY = ev.touches[0].clientY;
    } else {
      // Reset if more than one touch (e.g., pinch zoom attempt)
      this._touchStartX = null;
      this._touchStartY = null;
    }
  }

  private _handleTouchMove(ev: TouchEvent): void {
    if (this._touchStartX === null || this._touchStartY === null || ev.touches.length !== 1) return;

    const deltaX = ev.touches[0].clientX - this._touchStartX;
    const deltaY = ev.touches[0].clientY - this._touchStartY;

    // If horizontal movement is more significant than vertical, prevent default page scroll
    // This threshold can be adjusted.
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) { // Adjusted factor for more leniency on vertical scroll
      ev.preventDefault();
    }
  }

  private _handleTouchEnd(ev: TouchEvent): void {
    if (this._touchStartX === null || this._touchStartY === null || ev.changedTouches.length !== 1) {
      this._touchStartX = null; this._touchStartY = null; return;
    }

    const deltaX = ev.changedTouches[0].clientX - this._touchStartX;
    const deltaY = ev.changedTouches[0].clientY - this._touchStartY;
    const swipeThreshold = 50; // Minimum pixels to be considered a swipe

    // Check for a horizontal swipe that is not predominantly vertical
    if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaY) < swipeThreshold * 1.5) { // Allow more vertical movement
      if (deltaX > 0 && this._calendarHasPrevData) { // Swipe right
        this._changeCalendarMonth(-1);
      } else if (deltaX < 0 && this._calendarHasNextData) { // Swipe left
        this._changeCalendarMonth(1);
      }
    }
    // Reset touch coordinates
    this._touchStartX = null;
    this._touchStartY = null;
  }


  // --- Render Methods ---
  /**
   * Renders the full <ha-dialog> element for the calendar.
   * This includes the dialog structure, header, content (via _renderCalendarDialogContent), and actions.
   * @returns A TemplateResult for the calendar dialog.
   */
  public renderCalendarDialog(): TemplateResult {
      return html`
        <ha-dialog
          ?open=${this._isCalendarDialogOpen}
          @closed=${() => this.closeCalendarDialog()}
          heading="${localizeCard('ui.card.marees_france.coefficient_calendar_title', this.card.hass)}"
        >
          <div class="dialog-content">${this._renderCalendarDialogContent()}</div>
          <mwc-button slot="primaryAction" @click=${() => this.closeCalendarDialog()}>
            ${this.card.hass.localize('ui.common.close')}
          </mwc-button>
        </ha-dialog>
      `;
  }

  private _renderCalendarDialogContent(): TemplateResult {
    if (this.card._isLoadingCoefficients) return html`<div class="dialog-loader">Loading...</div>`;

    const coeffData = this.card._coefficientsData;
    if (coeffData && 'error' in coeffData && coeffData.error) {
        this._calendarHasPrevData = false; this._calendarHasNextData = false;
        return html`<div class="dialog-warning">${String(coeffData.error)}</div>`;
    }

    if (!coeffData || typeof coeffData !== 'object') {
        this._calendarHasPrevData = false; this._calendarHasNextData = false;
        return html`<div class="dialog-warning">${localizeCard('ui.card.marees_france.no_coefficient_data', this.card.hass)}</div>`;
    }

    const actualCoeffData = coeffData as GetCoefficientsDataResponseData;
    const locale = this.card.hass.language || 'en';
    const currentMonthDate = this._calendarSelectedMonth;
    const currentYear = currentMonthDate.getFullYear();
    const currentMonth = currentMonthDate.getMonth(); // 0-11

    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Adjust startingDay: 0 (Sun) to 6 (Sat) -> 0 (Mon) to 6 (Sun) for typical European calendars
    const startingDayRaw = firstDayOfMonth.getDay(); // 0 (Sunday) - 6 (Saturday)
    const startingDay = startingDayRaw === 0 ? 6 : startingDayRaw - 1; // 0 (Monday) - 6 (Sunday)

    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const weekdays = Array.from({ length: 7 }, (_, i) => getWeekdayShort3Letters(i, locale)); // Assuming 0=Monday

    const calendarDays: CalendarDayInfo[] = [];

    // Previous month's padding days
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = 0; i < startingDay; i++) {
      calendarDays.push({
        day: daysInPrevMonth - startingDay + 1 + i,
        isPadding: true,
        isCurrentMonth: false,
      });
    }

    // Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
      calendarDays.push({
        day,
        isPadding: false,
        isCurrentMonth: true,
        coeffs: actualCoeffData[dateStr] || [],
        dateStr,
      });
    }

    // Next month's padding days (ensure 6 rows, 42 cells total)
    const totalCells = Math.ceil((startingDay + daysInMonth) / 7) * 7; // Ensure full weeks displayed
    const cellsToFill = totalCells < 42 ? 42 : totalCells; // Minimum 6 weeks
    const remainingCells = cellsToFill - calendarDays.length;

    for (let i = 1; i <= remainingCells; i++) {
      calendarDays.push({ day: i, isPadding: true, isCurrentMonth: false });
    }

    // Check prev/next month data availability
    const availableDates = Object.keys(actualCoeffData).sort();
    let hasPrev = false, hasNext = false;
    if (availableDates.length > 0) {
        const prevMonthDateObj = new Date(currentYear, currentMonth -1, 1);
        const nextMonthDateObj = new Date(currentYear, currentMonth + 1, 1);
        const prevMonthYear = prevMonthDateObj.getFullYear(), prevMonthMonth = prevMonthDateObj.getMonth();
        const nextMonthYear = nextMonthDateObj.getFullYear(), nextMonthMonth = nextMonthDateObj.getMonth();
        try {
            hasPrev = availableDates.some(dStr => { const d = new Date(dStr); return d.getFullYear() === prevMonthYear && d.getMonth() === prevMonthMonth; });
            hasNext = availableDates.some(dStr => { const d = new Date(dStr); return d.getFullYear() === nextMonthYear && d.getMonth() === nextMonthMonth; });
        } catch (e) { console.error("Error checking month data:", e); }
    }
    this._calendarHasPrevData = hasPrev;
    this._calendarHasNextData = hasNext;


    return html`
      <div class="calendar-dialog-content">
        <div class="calendar-header">
          <ha-icon-button
            @click=${() => this._changeCalendarMonth(-1)}
            .disabled=${!this._calendarHasPrevData}
            title="${localizeCard('ui.card.marees_france.previous_month', this.card.hass)}"
          >
            <ha-icon icon="mdi:chevron-left"></ha-icon>
          </ha-icon-button>
          <span class="calendar-month-year">
            ${currentMonthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
          </span>
          <ha-icon-button
            @click=${() => this._changeCalendarMonth(1)}
            .disabled=${!this._calendarHasNextData}
            title="${localizeCard('ui.card.marees_france.next_month', this.card.hass)}"
          >
            <ha-icon icon="mdi:chevron-right"></ha-icon>
          </ha-icon-button>
        </div>
        <div class="calendar-grid">
          ${weekdays.map(day => html`<div class="calendar-weekday">${day}</div>`)}
          ${calendarDays.map(dayInfo => this._renderCalendarDay(dayInfo))}
        </div>
        ${calendarDays.filter(d => d.isCurrentMonth && d.coeffs && d.coeffs.length > 0).length === 0 && !this.card._isLoadingCoefficients
          ? html`<div class="no-data-month">${localizeCard('ui.card.marees_france.no_data_for_month', this.card.hass)}</div>`
          : nothing}
      </div>
    `;
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
      </div>
    `;
  }
}