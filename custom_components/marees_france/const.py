import logging

"""Constants for the Marées France integration."""

import json
from pathlib import Path
from typing import Final

from homeassistant.const import Platform

_LOGGER = logging.getLogger(__name__)

# Read version from manifest.json
MANIFEST_PATH = Path(__file__).parent / "manifest.json"
try:
    with open(MANIFEST_PATH, encoding="utf-8") as manifest_file:
        manifest_data = json.load(manifest_file)
    INTEGRATION_VERSION = manifest_data.get("version", "0.0.0")
except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
    INTEGRATION_VERSION = "0.0.0" # Fallback version
    _LOGGER.debug(
        "Failed to read version from manifest.json: %s. Using fallback version: %s",
        e,
        INTEGRATION_VERSION,
    )

DOMAIN: Final = "marees_france"
PLATFORMS: Final = [Platform.SENSOR]

# Configuration constants
CONF_HARBOR_ID: Final = "harbor_id"
CONF_SCAN_INTERVAL: Final = "scan_interval"

# Default values
DEFAULT_HARBOR: Final = "PORNICHET"
DEFAULT_SCAN_INTERVAL_HOURS: Final = 24

# API URLs
HARBORSURL: Final = "https://services.data.shom.fr/x13f1b4faeszdyinv9zqxmx1/wfs?service=WFS&version=1.0.0&srsName=EPSG:3857&request=GetFeature&typeName=SPM_PORTS_WFS:liste_ports_spm_h2m&outputFormat=application/json"
TIDESURL_TEMPLATE: Final = "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/hlt?harborName={harbor_id}&date={date}&utc=standard&correlation=1"
WATERLEVELS_URL_TEMPLATE: Final = "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/wl?harborName={harbor_name}&duration=1&date={date}&utc=standard&nbWaterLevels=288"
COEFF_URL_TEMPLATE: Final = "https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/coeff?harborName={harbor_name}&duration={days}&date={date}&utc=1&correlation=1"

# API Headers
# Using a common Chrome User-Agent as requested
HEADERS: Final = {
    "Referer": "https://maree.shom.fr/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
}

# Attributes
ATTR_DATA: Final = "data"
ATTR_NEXT_TIDE: Final = "next"
ATTR_PREVIOUS_TIDE: Final = "previous"
ATTR_HARBOR_NAME: Final = "harbor_name"
ATTR_DATE: Final = "date"

# Other constants
ATTRIBUTION: Final = "Data provided by SHOM"
MANUFACTURER: Final = "SHOM"
INTEGRATION_NAME: Final = "Marées France"
TIDE_HIGH: Final = "tide.high"
TIDE_LOW: Final = "tide.low"

# Translation Keys for Sensor State
STATE_HIGH_TIDE: Final = "high_tide"
STATE_LOW_TIDE: Final = "low_tide"
TIDE_NONE: Final = "tide.none"
DATE_FORMAT: Final = "%Y-%m-%d"
TIME_FORMAT: Final = "%H:%M"
DATETIME_FORMAT: Final = f"{DATE_FORMAT} {TIME_FORMAT}"

# Service names
SERVICE_GET_WATER_LEVELS: Final = "get_water_levels"
SERVICE_GET_TIDES_DATA: Final = "get_tides_data"
SERVICE_GET_COEFFICIENTS_DATA: Final = "get_coefficients_data"

# frontend modules
JSMODULES = [
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
URL_BASE = "/marees-france"
