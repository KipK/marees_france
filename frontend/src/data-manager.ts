// This file will manage all data fetching logic for the card.
// Responsibilities include:
// - Fetching tide data, water levels, and coefficients.
// - Handling the _callServiceWithResponse helper.
// - Managing loading states (e.g., _isLoadingWater, _isInitialLoading).
// - Managing data state properties (e.g., _waterLevels, _tideData).
// - Updating device name.

import {
  HomeAssistant,
  MareesFranceCardConfig,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
  GetCoefficientsDataResponseData,
  GetWaterTempResponseData,
  GetHarborMinDepthResponseData,
} from "./types";
import { localizeCard } from './localize';

// Interface for the card instance properties and methods DataManager needs.
export interface CardInstanceForDataManager {
  hass: HomeAssistant;
  config: MareesFranceCardConfig;
  _selectedDay: string;
  _waterLevels: GetWaterLevelsResponseData | { error: string } | null;
  _tideData: GetTidesDataResponseData | { error: string } | null;
  _coefficientsData: GetCoefficientsDataResponseData | { error: string } | null;
  _waterTempData: GetWaterTempResponseData | { error: string } | null;
  _harborMinDepth: GetHarborMinDepthResponseData | { error: string } | null;
  _isLoadingWater: boolean;
  _isLoadingTides: boolean;
  _isLoadingCoefficients: boolean;
  _isLoadingWaterTemp: boolean;
  _isLoadingHarborMinDepth: boolean;
  _isInitialLoading: boolean;
  _deviceName: string | null;
  // Potentially requestUpdate if direct state manipulation isn't enough,
  // but @state decorators on the card should handle it.
  requestUpdate: () => void;
}

export class DataManager {
  private card: CardInstanceForDataManager;

  constructor(cardInstance: CardInstanceForDataManager) {
    this.card = cardInstance;
  }

  /**
   * Fetches all necessary data for the card (water levels, tides, coefficients).
   * Manages loading states on the card instance.
   */
  public async fetchData(): Promise<void> {
    if (!this.card.hass || !this.card.config?.device_id) {
      console.warn('Marees Card (DataManager): Fetch prerequisites not met.');
      this.card._isLoadingWater = false;
      this.card._isLoadingTides = false;
      this.card._isLoadingCoefficients = false;
      this.card._waterLevels = { error: 'Configuration incomplete' };
      this.card._tideData = { error: 'Configuration incomplete' };
      this.card._coefficientsData = { error: 'Configuration incomplete' };
      this.card._harborMinDepth = { error: 'Configuration incomplete' };
      this.card._isInitialLoading = false;
      this.card._isLoadingHarborMinDepth = false;
      this.card.requestUpdate();
      return;
    }

    this.card._isLoadingWater = true;
    this.card._isLoadingTides = true;
    this.card._isLoadingCoefficients = true;
    this.card._isLoadingWaterTemp = true;
    this.card._isLoadingHarborMinDepth = false;
    this.card._waterLevels = null;
    this.card._tideData = null;
    this.card._coefficientsData = null;
    this.card._harborMinDepth = null;
    this.card.requestUpdate(); // Ensure loading states are reflected

    try {
      await Promise.all([
        this.fetchWaterLevels(),
        this.fetchTideData(),
        this.fetchCoefficientsData(),
        this.fetchWaterTemp(),
        this.fetchHarborMinDepth(),
      ]);
    } catch (error) {
      console.error("Marees Card (DataManager): Error during concurrent data fetch", error);
    }
  }

  /**
   * Calls the specified Marées France websocket command and returns response data.
   */
  private async callWebsocketCommand<T>(
    type: string,
    data: Record<string, unknown>
  ): Promise<T> {
    if (!this.card.hass) {
      throw new Error("Home Assistant object (hass) is not available in DataManager.");
    }

    try {
      // Accessing hass.connection.conn directly as it's part of HomeAssistant type
      const conn = 'conn' in this.card.hass.connection ? this.card.hass.connection.conn : this.card.hass.connection;

      const response = await conn.sendMessagePromise<T>({
        type,
        ...data
      });

      return response;

    } catch (error: unknown) {
      console.error(`Marees Card (DataManager): Error calling websocket command ${type}:`, error);
      if (error instanceof Error) {
        const haError = error as Error & { code?: string | number };
        if (haError.code) {
          throw new Error(`${haError.message} (Code: ${haError.code})`);
        }
        throw haError;
      }
      throw new Error(`Unknown error calling websocket command ${type}`);
    }
  }

  /**
   * Fetches water level data for the selected day on the card instance.
   * Updates loading state and water level data on the card.
   */
  public async fetchWaterLevels(): Promise<void> {
    this.card._isLoadingWater = true;
    this.card.requestUpdate();

    if (!this.card.hass || !this.card.config?.device_id || !this.card._selectedDay) {
      this.card._waterLevels = { error: localizeCard('ui.card.marees_france.missing_configuration', this.card.hass) };
      this.card._isLoadingWater = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
      return;
    }

    try {
      const response = await this.callWebsocketCommand<GetWaterLevelsResponseData>(
        'marees_france/get_water_levels',
        {
          device_id: this.card.config.device_id,
          date: this.card._selectedDay
        }
      );

      if (response && typeof response === 'object' && !('error' in response)) {
        this.card._waterLevels = response;
      } else {
        const errorMsg = ('error' in response) ? response.error : 'Invalid data structure from websocket command';
        console.error('Marees Card (DataManager): Invalid data from get_water_levels:', response);
        this.card._waterLevels = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card (DataManager): Error calling get_water_levels:', error);
      this.card._waterLevels = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this.card._isLoadingWater = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
    }
  }

  /**
   * Fetches general tide data (for next tide status, etc.).
   * Updates loading state and tide data on the card instance.
   */
  public async fetchTideData(): Promise<void> {
    this.card._isLoadingTides = true;
    this.card.requestUpdate();

    if (!this.card.hass || !this.card.config?.device_id) {
      this.card._tideData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.card.hass) };
      this.card._isLoadingTides = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
      return;
    }

    try {
      const response = await this.callWebsocketCommand<GetTidesDataResponseData>(
        'marees_france/get_tides_data',
        {
          device_id: this.card.config.device_id
        }
      );

      if (response && typeof response === 'object' && !('error' in response)) {
        this.card._tideData = response;
      } else {
        const errorMsg = ('error' in response) ? response.error : 'Invalid data structure from websocket command';
        console.error('Marees Card (DataManager): Invalid data from get_tides_data:', response);
        this.card._tideData = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card (DataManager): Error calling get_tides_data:', error);
      this.card._tideData = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this.card._isLoadingTides = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
    }
  }

  /**
   * Fetches tide coefficient data for a year starting from the current month.
   * Updates loading state and coefficients data on the card instance.
   */
  public async fetchCoefficientsData(): Promise<void> {
    this.card._isLoadingCoefficients = true;
    this.card.requestUpdate();

    if (!this.card.hass || !this.card.config?.device_id) {
      this.card._coefficientsData = { error: localizeCard('ui.card.marees_france.missing_configuration', this.card.hass) };
      this.card._isLoadingCoefficients = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
      return;
    }

    try {
      const today = new Date();
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startDateStr = firstDayOfMonth.toISOString().slice(0, 10);

      const response = await this.callWebsocketCommand<GetCoefficientsDataResponseData>(
        'marees_france/get_coefficients_data',
        {
          device_id: this.card.config.device_id,
          date: startDateStr,
          days: 365
        }
      );

      if (response && typeof response === 'object' && !('error' in response)) {
        if (Object.keys(response).length === 0) {
          console.warn('Marees Card (DataManager): Received empty coefficient data.');
          this.card._coefficientsData = response; // Still store it, might be valid empty
        } else {
          this.card._coefficientsData = response;
        }
      } else {
        const errorMsg = ('error' in response) ? response.error : 'Invalid data structure from websocket command';
        console.error('Marees Card (DataManager): Invalid data from get_coefficients_data:', response);
        this.card._coefficientsData = { error: typeof errorMsg === 'string' ? errorMsg : 'Invalid data structure' };
      }
    } catch (error: unknown) {
      console.error('Marees Card (DataManager): Error calling get_coefficients_data:', error);
      this.card._coefficientsData = { error: error instanceof Error ? error.message : 'Service call failed' };
    } finally {
      this.card._isLoadingCoefficients = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
    }
  }

  public async fetchWaterTemp(): Promise<void> {
    if (!this.card.config.device_id) return;

    this.card._isLoadingWaterTemp = true;
    this.card.requestUpdate();

    try {
      const waterTemp = await this.callWebsocketCommand(
        "marees_france/get_water_temp",
        {
          device_id: this.card.config.device_id,
        }
      );
      this.card._waterTempData = waterTemp as GetWaterTempResponseData;
    } catch (error) {
      console.error("Error fetching water temperature:", error);
      this.card._waterTempData = { error: (error as Error).message };
    } finally {
      this.card._isLoadingWaterTemp = false;
      this.updateInitialLoadingFlag();
      this.card.requestUpdate();
    }
  }

  public async fetchHarborMinDepth(): Promise<void> {
    if (!this.card.config.device_id) return;
    if (this.card._isLoadingHarborMinDepth) return;

    this.card._isLoadingHarborMinDepth = true;

    try {
      const harborMinDepth = await this.callWebsocketCommand(
        "marees_france/get_harbor_min_depth",
        {
          device_id: this.card.config.device_id,
        }
      );
      this.card._harborMinDepth = harborMinDepth as GetHarborMinDepthResponseData;
    } catch (error) {
      console.error("Error fetching harbor Min Depth:", error);
      this.card._harborMinDepth = { error: (error as Error).message };
    } finally {
      this.card._isLoadingHarborMinDepth = false;
      this.updateInitialLoadingFlag();
    }
  }


  private updateInitialLoadingFlag(): void {
    if (this.card._isInitialLoading && !this.card._isLoadingWater && !this.card._isLoadingTides && !this.card._isLoadingCoefficients && !this.card._isLoadingHarborMinDepth && !this.card._isLoadingWaterTemp) {
      this.card._isInitialLoading = false;
      // No need to call this.card.requestUpdate() here as it's called by the fetch methods' finally blocks.
    }
  }

  /**
   * Updates the device name on the card instance based on the device_id in the config.
   */
  public updateDeviceName(): void {
    if (this.card.hass && this.card.config?.device_id) {
      const device = this.card.hass.devices?.[this.card.config.device_id];
      const newName = device?.name ?? null;
      if (newName !== this.card._deviceName) {
        this.card._deviceName = newName;
        this.card.requestUpdate();
      }
    } else if (this.card._deviceName !== null) {
      this.card._deviceName = null;
      this.card.requestUpdate();
    }
  }
}