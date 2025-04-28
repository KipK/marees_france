// --- Basic Home Assistant Frontend Types (Placeholders) ---
// Minimal definitions to allow compilation. Replace with official types if a stable source becomes available.
export interface LovelaceCardConfig {
  type: string;
  view_layout?: any;
  [key: string]: any; // Allow other properties
}

export interface HomeAssistant {
  language: string;
  localize: (key: string, ...args: any[]) => string;
  config: any;
  themes: any;
  states: { [entityId: string]: any };
  services: { [domain: string]: { [service: string]: any } };
  user?: { is_admin?: boolean; name?: string };
  devices?: { [deviceId: string]: { name: string; /* other properties */ } };
  entities?: { [entityId: string]: any };
  callService: (domain: string, service: string, serviceData?: object, target?: object, blocking?: boolean, return_response?: boolean) => Promise<any>;
  callApi: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: object) => Promise<T>;
  formatEntityState: (stateObj: any, state?: string) => string;
  formatEntityAttributeValue: (stateObj: any, attribute: string, value?: any) => string;
  formatEntityAttributeName: (stateObj: any, attribute: string) => string;
  // Add other commonly used hass properties/methods if needed
  editMode?: boolean; // For card editor context
  [key: string]: any; // Allow other properties
}

// --- Configuration ---
// Use our own definition extending the minimal base
export interface MareesFranceCardConfig extends LovelaceCardConfig {
  device_id: string;
  show_header?: boolean;
  title?: string | null;
}

// --- Home Assistant Object Subset ---
// Use the base HomeAssistant type defined above
export interface HassObject extends HomeAssistant {
  // No additional properties needed here for now as they are covered in the base HomeAssistant interface
}

// --- Service Call Response Wrapper ---
// Generic wrapper for the structure returned by hass.callService with return_response: true
export interface ServiceResponseWrapper<T> {
  response: T | { error?: string }; // Data is nested under 'response'
  // Potentially add context if needed
}

// --- Raw Data Structures from Services ---
// ["tide.high" | "tide.low", "HH:MM", "H.HH", "CC" | "---"]
export type TideEventTuple = [string, string, string, string];
// ["HH:MM", "H.HH"]
export type WaterLevelTuple = [string, string];

// Structure within the 'response' object for get_tides_data
// { "YYYY-MM-DD": [ TideEventTuple, ... ], ... }
export interface GetTidesDataResponseData {
  [date: string]: TideEventTuple[];
}

// Structure within the 'response' object for get_water_levels
// { "YYYY-MM-DD": [ WaterLevelTuple, ... ], ... }
export interface GetWaterLevelsResponseData {
  [date: string]: WaterLevelTuple[];
}

// Structure within the 'response' object for get_coefficients_data
// { "YYYY-MM-DD": [ "CC", "CC" ], ... }
export interface GetCoefficientsDataResponseData {
  [date: string]: string[];
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
}

// --- SVG.js Basic Types (Placeholder if @types not available) ---
// Rely on implicit 'any' or type assertions where needed for SVG.js for now