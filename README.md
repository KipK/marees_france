# Intégration Home-Assistant Marées France

Intégration Home-Assistant pour récupérer les marées sur 7 jours pour un port donné depuis Shom.fr

## Configuration
Ajouter le repository 
Installer l'intégration depuis HACS

Dans Appareils et Services / Intégrations, ajouter une Intégration, sélectionner Marées France.

Une fois le port sélectionné, l'entité apparaitra dans sensor.marees_france_[NOM_DU_PORT]

## Utilisation

Une carte est pré-installée avec l'intégration pour afficher les données sur votre dashboard. Ajouter sur le dashboard la carte marees_france.
Dans la configuration y rajouter l'entité:

```yaml
type: custom:marees-france-card
entity: sensor.marees_france_pornichet
```


Pour récupérer une valeur de l'objet "data" en attribut de l'entité sensor.maree_france_[NOM_DU_PORT], voici un exemple:

Afficher le coefficient de la première marée haute de demain:

```yaml
{{ state_attr('sensor.maree_france_pornichet', 'data')[0]['high_tides'][0]['coefficient'] }}
```
