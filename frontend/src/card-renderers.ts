// This file will contain specific rendering functions for UI elements of the card,
// excluding the calendar dialog (handled in calendar-dialog.ts).
// Responsibilities include rendering:
// - Card header.
// - Next tide status section.
// - Day tabs.
// - Graph container.

import { html, TemplateResult, nothing } from 'lit';
import {
  HomeAssistant,
  MareesFranceCardConfig,
  NextTideStatus,
  GetTidesDataResponseData,
} from './types';
import { localizeCard } from './localize';
import { CalendarDialogManager } from './calendar-dialog'; // For opening dialog

// Interface for the card instance properties and methods that renderers need.
export interface CardInstanceForRenderers {
  hass: HomeAssistant;
  config: MareesFranceCardConfig;
  _deviceName: string | null;
  _selectedDay: string;
  _isLoadingWater: boolean;
  _isLoadingTides: boolean;
  _tideData: GetTidesDataResponseData | { error: string } | null; // For nextTideInfo
  // Methods
  _handleTabClick: (ev: MouseEvent) => void;
  _calendarDialogManager: CalendarDialogManager | null; // To open the dialog
}

/**
 * Renders the card header.
 * @param card The card instance, providing config and device name.
 * @returns A TemplateResult for the header, or nothing if header is disabled.
 */
export function renderHeader(card: CardInstanceForRenderers): TemplateResult | typeof nothing {
  if (card.config.show_header === false) return nothing;
  const title = card.config.title ?? card._deviceName ?? localizeCard('ui.card.marees_france.default_title', card.hass);
  return html`<div class="card-header">${title}</div>`;
}

/**
 * Renders the section displaying the next tide status.
 * @param card The card instance, providing hass for localization and CalendarDialogManager.
 * @param nextTideInfo Information about the next tide.
 * @returns A TemplateResult for the next tide status section.
 */
export function renderNextTideStatus(card: CardInstanceForRenderers, nextTideInfo: NextTideStatus | null): TemplateResult {
  if (!nextTideInfo) {
    return html`<div class="warning">${localizeCard('ui.card.marees_france.waiting_next_tide', card.hass)}</div>`;
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
            <span class="next-tide-trend-text">${localizeCard(nextTideInfo.currentTrendIcon === 'mdi:wave-arrow-up' ? 'ui.card.marees_france.rising_prefix' : 'ui.card.marees_france.falling_prefix', card.hass)}</span>
            <span class="next-tide-time">${nextTideInfo.nextPeakTime}</span>
          </div>
        </div>
        <div class="next-tide-details">${detailParts.length === 2 ? html`${detailParts[0]} - ${detailParts[1]}` : detailParts[0] ?? ''}</div>
      </div>
      <ha-icon class="calendar-icon" icon="mdi:calendar-month" @click="${() => card._calendarDialogManager?.openCalendarDialog()}" title="${localizeCard('ui.card.marees_france.open_calendar', card.hass)}"></ha-icon>
    </div>`;
}

/**
 * Renders a single day tab.
 * @param card The card instance, providing selectedDay and tab click handler.
 * @param date The date string (YYYY-MM-DD) for this tab.
 * @param locale The locale for date formatting.
 * @returns A TemplateResult for the day tab.
 */
export function renderDayTab(card: CardInstanceForRenderers, date: string, locale: string): TemplateResult {
  const d = new Date(date);
  const dayLabel = d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase();
  const dateLabel = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return html`
    <div class="tab ${card._selectedDay === date ? 'active' : ''}" data-date="${date}" @click="${card._handleTabClick}">
      <div class="tab-day">${dayLabel}</div>
      <div class="tab-date">${dateLabel}</div>
    </div>`;
}

/**
 * Renders the container for the SVG graph, including a loading indicator.
 * @param card The card instance, providing loading states.
 * @returns A TemplateResult for the graph container.
 */
export function renderGraphContainer(card: CardInstanceForRenderers): TemplateResult {
  return html`
    <div class="svg-graph-container">
      ${card._isLoadingWater || card._isLoadingTides ? html`<ha-icon icon="mdi:loading" class="loading-icon"></ha-icon>` : nothing}
      <div id="marees-graph-target" class="svg-graph-target"></div>
    </div>`;
}