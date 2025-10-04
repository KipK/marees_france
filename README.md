# 🌊 Home Assistant Integration — Marées France

👉 [🇫🇷 Read this documentation in French](./README-fr.md)

**Display French tides from SHOM directly in Home Assistant, with a simple integration and a custom Lovelace card.**

![Tides France Lovelace Card](./img/card-en.png)

**Author**: [@KipK](https://github.com/KipK)

---

## 🚀 Installation

Search for and install the "Marees France" integration in HACS.

Once the integration is installed and configured, refresh your browser so that Home Assistant displays the card in the card selector.

### Manual

1. Add the repository `KipK/marees_france` to HACS.
2. Search for **Tides France** in HACS and install the integration.

---

## ⚙️ Configuration

1. Go to **Devices & Services → Add Integration**, search for **Tides France**.
2. Select the **nearest port** from the list.

![Integration Configuration](./img/integration-config-en.png)

Once configured, the entity will appear as:  
`sensor.marees_france_[PORT_NAME]`

---

## 🖼️ Usage

A **custom Lovelace card** is provided with the integration!  
Simply add the **Tides France card** to your dashboard.

![Card Editor](./img/card-editor-en.png)

---

## 📈 Entities created

### Current Tide

| Attribute            | Description                    |
|-----------------------|---------------------------------|
| `coefficient`          | Tide coefficient               |
| `tide_trend`           | raising / falling              |
| `current_height`       | Current height                 |
| `starting_height`      | Height at the beginning of the cycle |
| `finished_height`      | Height at the end of the cycle  |
| `starting_time`        | Cycle start time               |
| `finished_time`        | Cycle end time                 |

State: `Rising` or `Falling` until the specified time.

### Next Tide

Same attributes as above, for the next tide event.

### Previous Tide

Same attributes as above, for the last tide event.

### Next Spring Tide

- **State**: Date/Time of the next spring tide (coefficient ≥ 100)
- **Attribute**: `coefficient`

### Next Neap Tide

- **State**: Date/Time of the next neap tide (coefficient ≤ 40)
- **Attribute**: `coefficient`

### Water Temperature

- **State**: The current water temperature in degrees Celsius.
- **Attributes**: `current_height`, `tide_trend`

---

## 🛠️ Available Services

Five services are available:

### 1. Fetch tide data

```yaml
action: marees_france.get_tides_data
data:
  device_id: xxxxxxxxxx
```

### 2. Fetch water levels for a specific date

```yaml
action: marees_france.get_water_levels
data:
  device_id: xxxxxxxxxx
  date: "2025-04-26"
```

### 3. Fetch tide coefficients for multiple days

```yaml
action: marees_france.get_coefficients_data
data:
  device_id: xxxxxxxxxx
  date: "2025-04-26"
  days: 10
```

### 4. Reset harbor data

```yaml
action: marees_france.reinitialize_harbor_data
data:
  device_id: xxxxxxxxxx
```

### 5. Fetch water temperature for a specific date

```yaml
action: marees_france.get_water_temp
data:
  device_id: xxxxxxxxxx
  date: "2025-04-26"```

---

## Troubleshooting

After updating the integration, refresh your browser to load the new custom card.
If you've not installed it with HACS, you will perhaps have to clear your browser cache first.

## Fetch policy

Integration coordinator fetch data from Shom.fr and stores them in cache.
It then sabity check the cache everyday at a random time, if there's missing or corrupted data it will get missing ones autonomously.

---

## Uninstall

Delete all harbors from Settings/Devices/Marées France
Then remove the integration from HACS or delete the custom_components/marees_france folder

---

## 🛠️ Development

### Setup

Use ***setup.sh*** or ***setup.ps1*** to install required dependencies

### Frontend Build

To compile the Lovelace card:

```bash
cd frontend
npm run build
```

The build will be output to:  
`custom_components/marees_info/frontend`

---

### Documentation build

To generate documentation:

```bash
npm run docs
```

### Unit Tests

```bash
pip install -r requirements-test.txt
npm run test
```

---

## 🎯 Notes

- Data source: **SHOM** (Service Hydrographique et Océanographique de la Marine).
- Fully compatible with **Home Assistant** via **HACS**.

---

👉 [🇫🇷 Read this documentation in French](./README-fr.md)
