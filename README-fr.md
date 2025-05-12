# 🌊 Intégration Home Assistant — Marées France

👉 [EN Read this documentation in English](./README.md)

**Affichez les marées françaises du SHOM directement dans Home Assistant, grâce à une intégration simple et une carte Lovelace personnalisée.**

![Carte Lovelace Marées France](./img/card.png)

**Auteur** : [@KipK](https://github.com/KipK)

---

## 🚀 Installation

### Automatique via HACS

[![Ajouter à Home Assistant via HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=KipK&category=integration&repository=marees_france)

### Manuelle

1. Ajouter le dépôt `KipK/marees_france` dans HACS.
2. Rechercher **Marées France** dans HACS et installer l’intégration.

---

## ⚙️ Configuration

1. Dans **Appareils et Services → Ajouter une intégration**, rechercher **Marées France**.
2. Sélectionner le **port le plus proche** dans la liste proposée.

![Configuration de l'intégration](./img/integration-config.png)

Une fois configurée, l’entité sera disponible sous le nom :  
`sensor.marees_france_[NOM_DU_PORT]`

---

## 🖼️ Utilisation

Une **carte Lovelace personnalisée** est fournie avec l'intégration !  
Ajoutez simplement la **carte Marées France** dans votre dashboard.

![Éditeur de carte](./img/card-editor.png)

---

## 📈 Entités créées

### Marée actuelle

| Attribut             | Description                    |
|----------------------|---------------------------------|
| `coefficient`         | Coefficient de marée            |
| `tide_trend`          | Montante / Descendante          |
| `current_height`      | Hauteur actuelle                |
| `starting_height`     | Hauteur au début du cycle       |
| `finished_height`     | Hauteur à la fin du cycle       |
| `starting_time`       | Heure de début du cycle         |
| `finished_time`       | Heure de fin du cycle           |

État : `Montante` ou `Descendante` jusqu’à l’heure indiquée.

### Prochaine marée

Même attributs que ci-dessus, pour l’événement de marée suivant.

### Marée précédente

Même attributs que ci-dessus, pour l’événement de marée précédent.

### Prochaine grande marée

- **État** : Date/heure de la prochaine grande marée (coefficient ≥ 100)
- **Attribut** : `coefficient`

### Prochaine morte-eau

- **État** : Date/heure de la prochaine morte-eau (coefficient ≤ 40)
- **Attribut** : `coefficient`

---

## 🛠️ Services disponibles


Trois services sont disponibles :

### 1. Récupérer les données de marées

```yaml
action: marees_france.get_tides_data
data:
  device_id: xxxxxxxxxx
```

### 2. Obtenir les hauteurs d’eau pour une date spécifique

```yaml
action: marees_france.get_water_levels
data:
  device_id: xxxxxxxxxx
  date: "2025-04-26"
```

### 3. Obtenir les coefficients pour plusieurs jours

```yaml
action: marees_france.get_coefficients_data
data:
  device_id: xxxxxxxxxx
  date: "2025-04-26"
  days: 10
```

---

## 🛠️ Développement

### Setup

Utilisez ***setup.sh*** (linux) ou ***setup.ps1*** (win) pour installer les dépendances nécessaires

### Compilation du Frontend

Pour compiler la carte Lovelace :

```bash
cd frontend
npm run build
```

Le build sera généré dans :  
`custom_components/marees_info/frontend`


### Documentation build

Pour générer la documentation:

```bash
npm run docs
```

### Tests Unitaires ###

```bash
pip install -r requirements-test.txt
npm run test
```

---

## 🎯 Notes

- Source des données : **SHOM** (Service Hydrographique et Océanographique de la Marine).
- Entièrement compatible avec **Home Assistant** via **HACS**.

---

👉 [🇬🇧 Read this documentation in English](./README.md)