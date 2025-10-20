# Marées France - Home Assistant Integration Documentation

## Overview

This document provides comprehensive documentation for the Marées France Home Assistant integration. This integration retrieves tide data from the French SHOM (Service Hydrographique et Océanographique de la Marine) API and provides it through Home Assistant sensors and a custom Lovelace card.

## Project Structure

```
marees_france/
├── custom_components/marees_france/     # Backend integration code
├── frontend/                            # Frontend card development
├── tests/                              # Unit tests
├── docs/                               # Generated documentation
├── img/                                # Screenshots and assets
├── tools/                              # Development tools
├── requirements*.txt                   # Python dependencies
├── package*.json                       # Node.js dependencies
├── setup.*                             # Setup scripts
└── README*.md                          # Documentation
```

## Backend Integration (custom_components/marees_france/)

### Core Components

#### __init__.py - Main Integration Module

- __Purpose__: Entry point for the Home Assistant integration
- __Key Functions__:
  - `async_setup()`: Registers frontend modules
  - `async_setup_entry()`: Sets up integration for a config entry
  - `async_unload_entry()`: Cleans up when integration is removed
  - `async_migrate_entry()`: Handles config entry migrations
- __Services Provided__:
  - `get_water_levels`: Fetch water level data for specific dates
  - `get_tides_data`: Retrieve cached tide data
  - `get_coefficients_data`: Get tide coefficient data
  - `reinitialize_harbor_data`: Clear and refresh all cached data
  - `get_water_temp`: Fetch water temperature data
- __WebSocket Commands__: Mirror services for frontend access

#### coordinator.py - Data Update Coordinator

- __Purpose__: Manages data fetching, caching, and processing
- __Key Features__:
  - Fetches tide, coefficient, and water level data from SHOM API
  - Implements caching with automatic repair and validation
  - Processes raw API data into structured format for sensors
  - Handles DST transitions in water level data
  - Calculates derived information (next spring/neap tides, current tide status)
- __Update Interval__: 5 minutes for water level data
- __Cache Management__: Persistent storage with automatic pruning

#### sensor.py - Sensor Entities

- __Purpose__: Provides Home Assistant sensor entities
- __Sensors Created__:
  - `MareesFranceNowSensor`: Current tide status (rising/falling)
  - `MareesFranceNextSensor`: Next tide event timestamp
  - `MareesFrancePreviousSensor`: Previous tide event timestamp
  - `MareesFranceNextSpringTideSensor`: Next spring tide date
  - `MareesFranceNextNeapTideSensor`: Next neap tide date
  - `MareesFranceWaterTempSensor`: Current water temperature

#### api_helpers.py - API Fetching and Caching

- __Purpose__: Handles all external API communications
- __Key Functions__:
  - `_async_fetch_with_retry()`: Robust API fetching with exponential backoff
  - `_async_fetch_and_store_water_level()`: Water level data retrieval
  - `_async_fetch_and_store_tides()`: Tide event data retrieval
  - `_async_fetch_and_store_coefficients()`: Tide coefficient data retrieval
  - `_async_fetch_and_store_water_temp()`: Water temperature data retrieval

#### config_flow.py - Configuration Flow

- __Purpose__: Handles user configuration through Home Assistant UI
- __Flow Steps__:
  - User selection: Choose harbor from SHOM API list
  - Automatic harbor data fetching and validation

#### const.py - Constants and Configuration

- __API Endpoints__:
  - `HARBORSURL`: SHOM harbor list API
  - `TIDESURL_TEMPLATE`: Tide data API template
  - `WATERLEVELS_URL_TEMPLATE`: Water level data API template
  - `COEFF_URL_TEMPLATE`: Tide coefficient API template
  - `WATERTEMP_URL_TEMPLATE`: Water temperature API (MeteoConsult)
- __Data Thresholds__:
  - `SPRING_TIDE_THRESHOLD`: 100 (coefficient ≥ 100)
  - `NEAP_TIDE_THRESHOLD`: 40 (coefficient ≤ 40)
- __Storage Keys__: Persistent cache storage identifiers

### Data Sources

#### SHOM API

- __Primary Data Source__: Service Hydrographique et Océanographique de la Marine
- __Data Types__:
  - Tide events (high/low tides with times and heights)
  - Tide coefficients (daily values)
  - Water levels (hourly measurements)
  - Harbor information (locations and metadata)

#### MeteoConsult API

- __Secondary Data Source__: Water temperature data
- __Integration__: Fetched based on harbor coordinates
- __Format__: Hourly temperature readings

### Caching Strategy

#### Storage Structure

- __Tides Cache__: `tides_cache` - Daily tide events per harbor
- __Coefficients Cache__: `coefficients_cache` - Daily coefficients per harbor
- __Water Levels Cache__: `water_levels_cache` - Hourly water levels per date per harbor
- __Water Temperature Cache__: `water_temp_cache` - Hourly temperatures per date per harbor

#### Cache Management

- __Automatic Pruning__: Old data removed daily
- __Validation__: Cache integrity checked on each coordinator update
- __Repair__: Missing/corrupted data automatically refetched
- __Prefetching__: Scheduled jobs maintain cache freshness

## Frontend Card (frontend/src/)

### Main Components

#### marees-france-card.ts - Main Card Component

- __Framework__: LitElement with TypeScript
- __Features__:
  - Day navigation tabs (7-day view)
  - Interactive tide graph with SVG.js
  - Calendar dialog for date selection
  - Real-time tooltips and interaction
  - Responsive design with touch support

#### Data Management

- __DataManager__: Handles all data fetching from backend
- __GraphInteractionManager__: Manages graph interactions and tooltips
- __CalendarDialogManager__: Handles calendar modal functionality

#### Rendering Modules

- __card-renderers.ts__: UI rendering functions
- __graph-renderer.ts__: SVG graph generation and interaction
- __localize.ts__: Internationalization support

### Card Features

#### Graph Visualization

- __Water Level Curve__: Hourly water level data plotted as smooth curve
- __Tide Markers__: High/low tide arrows with coefficients
- __Current Time Indicator__: Shows current time on graph
- __Interactive Tooltips__: Hover/touch to see detailed information
- __DST Handling__: Properly handles daylight saving transitions

#### User Interface

- __Day Tabs__: Navigate between today and next 6 days
- __Calendar Dialog__: Full calendar view for date selection
- __Responsive Design__: Adapts to different screen sizes
- __Touch Support__: Swipe gestures for calendar navigation

## Configuration and Setup

### Integration Setup

1. __HACS Installation__: Add repository and install integration
2. __Configuration Flow__: Select harbor from dropdown list
3. __Automatic Setup__: Entities created automatically

### Card Configuration

- __device_id__: Required - Links card to integration instance
- __show_header__: Optional - Show/hide card header
- __card_type__: Optional - 'full' or 'condensed' view

## API Integration Details

### SHOM API Endpoints

#### Harbor List

```
GET https://services.data.shom.fr/x13f1b4faeszdyinv9zqxmx1/wfs?service=WFS&version=1.0.0&srsName=EPSG:3857&request=GetFeature&typeName=SPM_PORTS_WFS:liste_ports_spm_h2m&outputFormat=application/json
```

- Returns GeoJSON with harbor information

#### Tide Data

```
GET https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/hlt?harborName={harbor_id}&date={date}&utc=standard&correlation=1&duration={days}
```

- Returns tide events for specified harbor and date range

#### Water Levels

```
GET https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/wl?harborName={harbor_name}&duration=1&date={date}&utc=standard&nbWaterLevels=288
```

- Returns 288 hourly water level measurements (12 hours × 24 readings)

#### Coefficients

```
GET https://services.data.shom.fr/b2q8lrcdl4s04cbabsj4nhcb/hdm/spm/coeff?harborName={harbor_name}&duration={days}&date={date}&utc=1&correlation=1
```

- Returns daily tide coefficients

### Water Temperature API

```
GET https://ws.meteoconsult.fr/meteoconsultmarine/androidtab/115/fr/v30/previsionsSpot.php?lat={lat}&lon={lon}
```

- Returns weather data including water temperature

## Data Processing

### Tide Data Processing

1. __Raw Data__: Arrays of [type, time, height, coefficient]
2. __Parsing__: Convert to structured objects with UTC timestamps
3. __Timezone Handling__: Convert Paris timezone to UTC
4. __Interpolation__: Calculate current tide status between events

### Water Level Processing

1. __Raw Data__: Hourly measurements as [time, height] tuples
2. __DST Handling__: Detect and merge DST transition data
3. __Interpolation__: Calculate water height at any time
4. __Graph Scaling__: Dynamic Y-axis based on data range

### Coefficient Processing

1. __Raw Data__: Monthly arrays of daily coefficients
2. __Validation__: Filter valid integer coefficients
3. __Analysis__: Find next spring (≥100) and neap (≤40) tides

## Development and Build

### Backend Development

- __Language__: Python 3.11+
- __Framework__: Home Assistant custom component
- __Testing__: pytest with fixtures
- __Linting__: pylint, ruff

### Frontend Development

- __Language__: TypeScript
- __Framework__: LitElement
- __Build Tool__: Webpack
- __Styling__: CSS with HA theme variables
- __Graphics__: SVG.js for interactive charts

### Build Process

```bash
# Setup
./setup.sh  # or setup.ps1 on Windows

# Build frontend
cd frontend && npm run build

# Run tests
npm run test

# Generate docs
npm run docs
```

## Entities and Services

### Sensor Entities

| Entity | State | Attributes |
|--------|-------|------------|
| `marees_france_[port]_now` | rising/falling | coefficient, current_height, starting_time, etc. |
| `marees_france_[port]_next_tide` | timestamp | tide type, height, coefficient |
| `marees_france_[port]_previous_tide` | timestamp | tide type, height, coefficient |
| `marees_france_[port]_next_spring_tide` | date | coefficient |
| `marees_france_[port]_next_neap_tide` | date | coefficient |
| `marees_france_[port]_water_temp` | temperature °C | current_height, tide_trend |

### Services

| Service | Parameters | Description |
|---------|------------|-------------|
| `get_water_levels` | device_id, date | Get water levels for specific date |
| `get_tides_data` | device_id | Get all cached tide data |
| `get_coefficients_data` | device_id, date, days | Get coefficient data |
| `reinitialize_harbor_data` | device_id | Clear and refresh all data |
| `get_water_temp` | device_id, date | Get water temperature |

## Error Handling and Resilience

### API Error Handling

- __Retry Logic__: Exponential backoff (up to 5 attempts)
- __Timeout Management__: 30-60 second timeouts based on endpoint
- __Fallback Behavior__: Cache hit prevents API calls when possible

### Data Validation

- __Cache Integrity__: Automatic repair of corrupted cache entries
- __Data Structure Validation__: Type checking and format validation
- __DST Handling__: Special processing for daylight saving transitions

### User Experience

- __Loading States__: Visual feedback during data fetching
- __Error Messages__: Localized error messages for common issues
- __Graceful Degradation__: Card remains functional with partial data

## Performance Considerations

### Caching Strategy

- __Persistent Storage__: Data survives HA restarts
- __Prefetching__: Scheduled jobs maintain cache freshness
- __Pruning__: Automatic removal of old data

### API Rate Limiting

- __Request Spacing__: 200ms delay between API calls
- __Batch Operations__: Multiple data types fetched in parallel
- __Smart Updates__: Only fetch missing data

### Frontend Optimization

- __Lazy Loading__: Data fetched only when needed
- __Efficient Rendering__: SVG optimization and minimal DOM updates
- __Touch Optimization__: Hardware-accelerated interactions

## Internationalization

### Supported Languages

- __English__ (en)
- __French__ (fr)

### Translation Keys

- __Card Strings__: UI text for card components
- __Editor Strings__: Configuration editor labels
- __Entity States__: Sensor state translations

## Testing

### Backend Tests

- __Unit Tests__: Individual function testing
- __Integration Tests__: Full coordinator testing
- __Mock Dependencies__: Simulated API responses

### Frontend Tests

- __Component Tests__: LitElement testing
- __Interaction Tests__: User interaction simulation
- __Build Verification__: Webpack build testing

## Deployment and Distribution

### HACS Integration

- __Repository__: KipK/marees_france
- __Category__: Integration
- __Manifest__: Automatic version management

### Manual Installation

- __Files__: Copy custom_components/marees_france/
- __Dependencies__: Python requirements installation
- __Frontend__: Build and copy frontend assets

## Maintenance and Updates

### Version Management

- __Semantic Versioning__: Major.minor.patch
- __Changelog__: Documented changes per release
- __Migration__: Config entry migration support

### Monitoring

- __Logging__: Comprehensive debug and error logging
- __Health Checks__: Cache validation and repair
- __Performance Metrics__: API response times and cache hit rates

This documentation provides a complete technical overview of the Marées France integration, suitable for developers working on the codebase or integrating with similar systems.