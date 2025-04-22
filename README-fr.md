# Intégration Home-Assistant Marées France

Intégration Home-Assistant et sa carte Lovelace pour afficher les marées Françaises du Shom.


## Configuration

Ajouter le repository à HACS et installer l'intégration

Dans Appareils et Services / Intégrations, ajouter une Intégration, sélectionner Marées France.
La liste des ports est mises à jours automatiquement.

![image info](./img/integration-config.png)


Une fois le port sélectionné, l'entité apparaitra dans sensor.marees_france_[NOM_DU_PORT]

## Utilisation

Une carte Lovelace est pré-installée avec l'intégration pour afficher les données sur votre dashboard. Ajouter sur le dashboard la carte marees_france.

![image info](./img/card-editor.png)



Pour récupérer une valeur de l'objet "data" en attribut de l'entité sensor.marees_france_[NOM_DU_PORT], voici un exemple:

Afficher le coefficient de la première marée haute de demain:

```yaml
{{ state_attr('sensor.marees_france_pornichet', 'data')[0]['high_tides'][0]['coefficient'] }}
```
