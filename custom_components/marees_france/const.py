"""Constants for the Marées France integration."""

import json
import logging
from pathlib import Path
from typing import Final

from homeassistant.const import Platform

_LOGGER = logging.getLogger(__name__)

# --- Integration Metadata ---
MANIFEST_PATH = Path(__file__).parent / "manifest.json"
try:
    with open(MANIFEST_PATH, encoding="utf-8") as manifest_file:
        manifest_data = json.load(manifest_file)
    INTEGRATION_VERSION: Final[str] = manifest_data.get("version", "0.0.0")
except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
    INTEGRATION_VERSION = "0.0.0"  # Fallback version
    _LOGGER.debug(
        "Failed to read version from manifest.json: %s. Using fallback version: %s",
        e,
        INTEGRATION_VERSION,
    )

DOMAIN: Final[str] = "marees_france"
PLATFORMS: Final[list[Platform]] = [Platform.SENSOR]
INTEGRATION_NAME: Final[str] = "Marées France"
MANUFACTURER: Final[str] = "SHOM"
ATTRIBUTION: Final[str] = "Data provided by SHOM"

# --- Configuration Constants ---
CONF_HARBOR_ID: Final[str] = "harbor_id"
CONF_HARBOR_NAME: Final[str] = (
    "harbor_name"  # Used in config entry, not directly by user
)
CONF_HARBOR_LAT: Final[str] = "harbor_lat"
CONF_HARBOR_LON: Final[str] = "harbor_lon"

# --- Default Values ---
DEFAULT_HARBOR: Final[str] = "PORNICHET"  # Default harbor for config flow

# --- API Configuration ---
HARBORSURL: Final[str] = (
    "https://services.data.shom.fr/x13f1b4faeszdyinv9zqxmx1/wfs?"
    "service=WFS&version=1.0.0&srsName=EPSG:3857&request=GetFeature"
    "&typeName=SPM_PORTS_WFS:liste_ports_spm_h2m&outputFormat=application/json"
)
TIDESURL_TEMPLATE: Final[str] = (
    "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/hlt?"
    "harborName={harbor_id}&date={date}&utc=standard&correlation=1"
)
WATERLEVELS_URL_TEMPLATE: Final[str] = (
    "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/wl?"
    "harborName={harbor_name}&duration=1&date={date}&utc=standard&nbWaterLevels=288"
)
COEFF_URL_TEMPLATE: Final[str] = (
    "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/coeff?"
    "harborName={harbor_name}&duration={days}&date={date}&utc=1&correlation=1"
)
WATERTEMP_URL_TEMPLATE: Final[str] = (
    "https://ws.meteoconsult.fr/meteoconsultmarine/androidtab/115/fr/v30/previsionsSpot.php?"
    "lat={lat}&lon={lon}"
)
HEADERS: Final[dict[str, str]] = {
    "Referer": "https://maree.shom.fr/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/109.0.0.0 Safari/537.36"  # Common User-Agent
    ),
}
API_REQUEST_DELAY: Final[float] = 0.2  # Delay in seconds between API requests

# --- Data Attributes & Keys ---
ATTR_DATA: Final[str] = "data"  # General data attribute
ATTR_NEXT_TIDE: Final[str] = "next"  # Key for next tide information
ATTR_PREVIOUS_TIDE: Final[str] = "previous"  # Key for previous tide information
ATTR_HARBOR_NAME: Final[str] = (
    "harbor_name"  # Attribute for harbor name in sensor state
)
ATTR_DATE: Final[str] = "date"  # Attribute/key for date
ATTR_COEFFICIENT: Final[str] = "coefficient"  # Attribute for tide coefficient
ATTR_TIDE_TREND: Final[str] = (
    "tide_trend"  # Attribute for tide trend (e.g., rising, falling)
)
ATTR_STARTING_HEIGHT: Final[str] = (
    "starting_height"  # Attribute for tide starting height
)
ATTR_FINISHED_HEIGHT: Final[str] = (
    "finished_height"  # Attribute for tide finished height
)
ATTR_STARTING_TIME: Final[str] = "starting_time"  # Attribute for tide starting time
ATTR_FINISHED_TIME: Final[str] = "finished_time"  # Attribute for tide finished time
ATTR_CURRENT_HEIGHT: Final[str] = "current_height"  # Attribute for current water height
ATTR_WATER_TEMP: Final[str] = "water_temp"

# --- Storage Keys and Versions ---
WATERLEVELS_STORAGE_KEY: Final[str] = f"{DOMAIN}_water_levels_cache"
WATERLEVELS_STORAGE_VERSION: Final[int] = 1
WATERTEMP_STORAGE_KEY: Final[str] = f"{DOMAIN}_water_temp_cache"
WATERTEMP_STORAGE_VERSION: Final[int] = 1
TIDES_STORAGE_KEY: Final[str] = f"{DOMAIN}_tides_cache"
TIDES_STORAGE_VERSION: Final[int] = 1
COEFF_STORAGE_KEY: Final[str] = f"{DOMAIN}_coefficients_cache"
COEFF_STORAGE_VERSION: Final[int] = 1

# --- Tide Types & Thresholds ---
TIDE_HIGH: Final[str] = "tide.high"  # Internal representation for high tide
TIDE_LOW: Final[str] = "tide.low"  # Internal representation for low tide
TIDE_NONE: Final[str] = "tide.none"  # Internal representation for no current tide event
SPRING_TIDE_THRESHOLD: Final[int] = 100  # Coefficient threshold for spring tide
NEAP_TIDE_THRESHOLD: Final[int] = 40  # Coefficient threshold for neap tide

# --- Translation Keys for Sensor State (matches strings.json) ---
STATE_HIGH_TIDE: Final[str] = "high_tide"
STATE_LOW_TIDE: Final[str] = "low_tide"

# --- Date/Time Formatting ---
DATE_FORMAT: Final[str] = "%Y-%m-%d"
TIME_FORMAT: Final[str] = "%H:%M"
DATETIME_FORMAT: Final[str] = f"{DATE_FORMAT} {TIME_FORMAT}"

# --- Service Names ---
SERVICE_GET_WATER_LEVELS: Final[str] = "get_water_levels"
SERVICE_GET_TIDES_DATA: Final[str] = "get_tides_data"
SERVICE_GET_COEFFICIENTS_DATA: Final[str] = "get_coefficients_data"
SERVICE_REINITIALIZE_HARBOR_DATA: Final[str] = "reinitialize_harbor_data"
SERVICE_GET_WATER_TEMP: Final[str] = "get_water_temp"

# --- Frontend Modules ---
JSMODULES: Final[list[dict[str, str]]] = [
    {
        "name": "Carte Marées France",
        "filename": "marees-france-card.js",
        "version": INTEGRATION_VERSION,
    },
    {
        "name": "Editeur Carte Marées France",
        "filename": "marees-france-card-editor.js",
        "version": INTEGRATION_VERSION,
    },
]
URL_BASE: Final[str] = "/marees-france"  # Base URL for frontend resources
