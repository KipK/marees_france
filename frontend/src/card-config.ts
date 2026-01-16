// This file will handle card configuration logic,
// including setConfig, getStubConfig, and getConfigElement.
// It will be responsible for validating and applying the card configuration.

import { HomeAssistant, MareesFranceCardConfig, GetWaterLevelsResponseData, GetTidesDataResponseData, GetCoefficientsDataResponseData, GetHarborMinDepthResponseData } from './types';
import { localizeCard } from './localize';

// Define an interface for the card instance properties and methods
// that setCardConfig needs to access. This helps avoid circular dependencies
// with the main card class file if we were to import the full class.
export interface CardInstanceForSetConfig {
  hass: HomeAssistant;
  config: MareesFranceCardConfig; // This will be assigned by setCardConfig
  _selectedDay: string;
  _waterLevels: GetWaterLevelsResponseData | { error: string } | null;
  _tideData: GetTidesDataResponseData | { error: string } | null;
  _coefficientsData: GetCoefficientsDataResponseData | { error: string } | null;
  _harborMinDepth: GetHarborMinDepthResponseData | { error: string } | null;
  _isLoadingWater: boolean;
  _isLoadingTides: boolean;
  _isLoadingCoefficients: boolean;
  _isLoadingHarborMinDepth: boolean;
  _isInitialLoading: boolean;
  // _isCalendarDialogOpen and _calendarSelectedMonth are now managed by CalendarDialogManager
  _deviceName: string | null;
  // Methods that setConfig calls on the card instance
  _fetchData: () => Promise<void>;
  _updateDeviceName: () => void;
}

/**
 * Sets the configuration for the card instance and initializes its state.
 * @param card The card instance (must conform to CardInstanceForSetConfig).
 * @param newConfig The new configuration object.
 */
export function setCardConfig(
  card: CardInstanceForSetConfig,
  newConfig: MareesFranceCardConfig
): void {
  if (!newConfig.device_id) {
    throw new Error(
      localizeCard(
        'ui.card.marees_france.error_device_required',
        card.hass // Assuming hass might be available early, otherwise handle potential null
      ) || 'Device required'
    );
  }
  card.config = newConfig; // Assign the validated config to the card instance

  // Initialize state properties on the card instance
  const today = new Date();
  card._selectedDay = today.toISOString().slice(0, 10);
  card._waterLevels = null;
  card._tideData = null;
  card._coefficientsData = null;
  card._harborMinDepth = null;
  card._isLoadingWater = true;
  card._isLoadingTides = true;
  card._isLoadingHarborMinDepth = true;
  card._isLoadingCoefficients = true;
  card._isInitialLoading = true;
  // card._isCalendarDialogOpen = false; // Managed by CalendarDialogManager
  // card._calendarSelectedMonth = new Date(); // Managed by CalendarDialogManager
  card._deviceName = null;

  // Fetch data immediately if hass is available on the card instance
  if (card.hass) {
    card._fetchData();
    card._updateDeviceName();
  }
}

/**
 * Provides the default/stub configuration for the card editor.
 * @returns The stub configuration object.
 */
export function getCardStubConfig(): MareesFranceCardConfig {
  return {
    type: 'custom:marees-france-card',
    device_id: '',
    show_header: true,
    title: null,
    card_type: 'full',
  };
}

/**
 * Returns the HTML element for the card editor.
 * The editor element 'marees-france-card-editor' is expected to be globally registered by Home Assistant.
 * @returns A Promise that resolves to the editor HTMLElement.
 */
export async function getCardConfigElement(): Promise<HTMLElement> {
  // The 'marees-france-card-editor' custom element is expected to be registered globally
  // by Home Assistant when the card is loaded. Therefore, a direct import of the
  // editor's source file is not necessary here for document.createElement to work.
  return document.createElement('marees-france-card-editor');
}