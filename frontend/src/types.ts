// --- Basic Home Assistant Frontend Types (Placeholders) ---
// Minimal definitions to allow compilation. Replace with official types if a stable source becomes available.
export interface LovelaceCardConfig {
  type: string;
  view_layout?: unknown; // Use unknown instead of any
  [key: string]: unknown; // Allow other properties, use unknown
}

// Basic type for a Home Assistant state object
export interface StateObject {
  entity_id: string;
  state: string;
  attributes: { [key: string]: unknown }; // Attributes can be anything
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: string | null; user_id: string | null };
  // Allow other potential properties
  [key: string]: unknown;
}

// Minimal interface for the HA Connection object
export interface Connection {
  sendMessagePromise: <T>(message: unknown) => Promise<T>;
  // Add other connection methods if needed
}
export interface HomeAssistant {
  connection: Connection | { conn: Connection }; // Added connection property
  language: string;
  localize: (key: string, ...args: unknown[]) => string; // Use unknown[] for args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any; // Keep any for complex config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  themes: any; // Keep any for themes
  states: { [entityId: string]: StateObject }; // Use StateObject
  services: { [domain: string]: { [service: string]: unknown } }; // Use unknown for service defs
  user?: { is_admin?: boolean; name?: string };
  devices?: { [deviceId: string]: { name: string; /* other properties */ } };
  entities?: { [entityId: string]: unknown }; // Use unknown for entities
  callService: (domain: string, service: string, serviceData?: object, target?: object, blocking?: boolean, return_response?: boolean) => Promise<unknown>; // Use Promise<unknown>
  callApi: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: object) => Promise<T>;
  formatEntityState: (stateObj: StateObject, state?: string) => string; // Use StateObject
  formatEntityAttributeValue: (stateObj: StateObject, attribute: string, value?: unknown) => string; // Use StateObject and unknown
  formatEntityAttributeName: (stateObj: StateObject, attribute: string) => string; // Use StateObject
  // Add other commonly used hass properties/methods if needed
  editMode?: boolean; // For card editor context
  [key: string]: unknown; // Allow other properties, use unknown
}

// --- Configuration ---
// Use our own definition extending the minimal base
/**
 * Specific configuration for the Marees France card.
 */
export interface MareesFranceCardConfig extends LovelaceCardConfig {
  device_id: string;
  show_header?: boolean;
  title?: string | null;
  card_type?: 'full' | 'condensed';
}

// --- Home Assistant Object Subset ---
// Removed HassObject interface as it was empty and redundant. Use HomeAssistant directly.

// --- Websocket API Response Data ---
// Direct data structures returned by websocket commands (no wrapper needed)

// --- Raw Data Structures from Services ---
/** Represents a raw tide event as an array: [type, time, height, coefficient] */
export type TideEventTuple = [string, string, string, string];
/** Represents a raw water level entry as an array: [time, height] */
export type WaterLevelTuple = [string, string];

/**
 * Expected data structure within the `response` object from the `get_tides_data` service.
 * Maps date strings (YYYY-MM-DD) to arrays of TideEventTuples.
 */
export interface GetTidesDataResponseData {
  [date: string]: TideEventTuple[];
}

/**
 * Expected data structure within the `response` object from the `get_water_levels` service.
 * Maps date strings (YYYY-MM-DD) to arrays of WaterLevelTuples.
 */
export interface GetWaterLevelsResponseData {
  [date: string]: WaterLevelTuple[];
}

/**
 * Expected data structure within the `response` object from the `get_coefficients_data` service.
 * Maps date strings (YYYY-MM-DD) to arrays of coefficient strings.
 */
export interface GetCoefficientsDataResponseData {
  [date: string]: string[];
}

export interface GetWaterTempResponseData {
  [date: string]: { datetime: string; temp: number }[];
}

export interface GetHarborMinDepthResponseData {
  harborMinDepth: number;
}
// --- Parsed/Processed Data Structures ---

// Structure for a parsed tide event used in utils.ts and graph-renderer.ts
export interface ParsedTideEvent {
  type: 'high' | 'low';
  time: string; // HH:MM
  height: number;
  coefficient: number | null;
  date: string; // YYYY-MM-DD
  dateTime: Date;
}

// Structure returned by getNextTideStatus in utils.ts
export interface NextTideStatus {
  currentTrendIcon: string; // e.g., 'mdi:wave-arrow-up'
  nextPeakTime: string; // HH:MM
  nextPeakHeight: number | null;
  displayCoefficient: number | null;
  nextPeakType: 'high' | 'low' | null;
}

// Structure for graph margins used in graph-renderer.ts
export interface GraphMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// Structure for processed water level points used in graph-renderer.ts
export interface PointData {
  totalMinutes: number;
  heightNum: number;
}

// Structure for tide markers used in graph-renderer.ts
export interface TideMarkerData {
  x: number;
  y: number;
  time: string;
  height: number;
  coefficient: number | null;
  isHigh: boolean;
}

// Structure for current time marker data used in graph-renderer.ts
export interface CurrentTimeMarkerData {
  x: number;
  y: number;
  timeStr: string;
  heightStr: string;
  totalMinutes: number;
  height: number;
  water_temp?: number;
}

// --- SVG.js Basic Types (Placeholder if @types not available) ---
// Rely on implicit 'any' or type assertions where needed for SVG.js for now