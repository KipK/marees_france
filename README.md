# Marées France Home-Assistant Integration

Home-Assistant integration and its lovelace card to display french tides from Shom.

![image info](./img/card.png)

## Installation

#### Automatically

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=KipK&category=integration&repository=marees_france)

#### Manually

Add the custom repo link to HACS <https://github.com/KipK/marees_france>

Search for "marees_france" in HACS and install.

## Setup

In Devices & Services / Integrations, add and integration, select Marées France.

Select the nearest harbor.

![image info](./img/integration-config.png)


Once you've selected the harbor, the entity will pop in sensor.marees_france_[HARBOR_NAME]


## Usage

A Lovelace custom card is pre-installed with the integration

![image info](./img/card-editor.png)


```yaml
type: custom:marees-france-card
entity: sensor.marees_france_pornichet
```

To get a "data" attribute value using template, here is an example:

Display the coeff for first tomorrow tide:

```yaml
{{ state_attr('sensor.marees_france_pornichet', 'data')[1]['high_tides'][0]['coefficient'] }}
```
