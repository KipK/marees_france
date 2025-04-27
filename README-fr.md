```yaml

```

# Intégration Home-Assistant Marées France

Intégration Home-Assistant et sa carte Lovelace pour afficher les marées Françaises du Shom.

![image info](./img/card.png)

Auteur: @KipK

## Installation

### Automatique

[![Ouvrez votre instance Home Assistant et ajouter automatiquement le dépôt dans le Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=KipK&category=integration&repository=marees_france)

### Manuelle

Ajouter le repository à HACS:  <KipK/marees_france>

Rechercher "Marées France" dans HACS et installer.

## Configuration

Dans Appareils et Services / Intégrations, ajouter une Intégration, sélectionner Marées France.
Sélectionner le port le plus proche dans la liste.

![image info](./img/integration-config.png)

Une fois le port sélectionné, l'entité apparaitra dans sensor.marees_france_[NOM_DU_PORT]

## Utilisation

Une carte Lovelace est pré-installée avec l'intégration pour afficher les données sur votre dashboard.
Ajouter sur le dashboard la carte marees_france.

### Entités

Friendly_name: "[PORT] Marée Actuelle"
Etat: "Montante/Descendante jusqu'à [HEURE]"
Attributs:
. coefficient: 96              - Coéfficient de marée
. tide_trend:  raising|falling - Tendance
. starting_height: 1.27        - Hauteur de début de cycle
. current_height: 2.30         - Hauteur courante
. finished_height: 4.73        - Hauteur de fin de cycle
. starting time: 2025-04-2(..) - Date/Heure du départ de cycle
. finished_time: 2025-04-2(..) - Date/Heure de la fin de cycle


nom: [PORT] Prochaine Marée
Etat: Date/Heure de la prochaine marée
Attributs:
. coefficient: 96              - Coéfficient de marée
. tide_trend:  Low|High tide   - Tendance
. starting_height: 1.27        - Hauteur de début de cycle
. finished_height: 4.73        - Hauteur de fin de cycle
. starting time: 2025-04-2(..) - Date/Heure du départ de cycle
. finished_time: 2025-04-2(..) - Date/Heure de la fin de cycle

nom: [PORT] Marée Précédente
Etat: Date/Heure de la précédente marée
Attributs:
. coefficient: 96              - Coéfficient de marée
. tide_trend:  Low|High tide   - Tendance
. starting_height: 1.27        - Hauteur de début de cycle
. finished_height: 4.73        - Hauteur de fin de cycle
. starting time: 2025-04-2(..) - Date/Heure du départ de cycle
. finished_time: 2025-04-2(..) - Date/Heure de la fin de cycle

Nom: Prochaine Grande Marée
 state: Date/Heure de la prochaine grande marée ( >= 100
 attributes:
. coefficient

Nom: Prochaine Morte-Eau: 
 state: Date/Heure de la prochaine morte-eau ( <= 40 )
 attributes:
. coefficient

### Services

![image info](./img/card-editor.png)

L'intégration met à disposition 3 services actions:

- Marées France (SHOM): Récupérer les données de marées: marees_france.get_tides_data

```lang=yaml
action: marees_france.get_tides_data
data:
device_id: xxxxxxxxxx
```

- Marées France (SHOM): Obtenir les hauteurs d'eau:

```lang=yaml
action: marees_france.get_water_levels
data:
device_id: xxxxxxxxxx
date: "2025-04-26"
```

- Marées France (SHOM): Obtenir les Données de Coefficients:

```lang=yaml
action: marees_france.get_coefficients_data
data:
device_id: xxxxxxxxxx
date: "2025-04-26"
days: 10
```

## Build

Compiler le frontend


```lang=sh
cd frontend
npm install
npm run build
```

Frontend will be exported in custom_components/marees_info/frontend
