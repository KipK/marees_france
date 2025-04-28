// Define the structure for editor translations
interface EditorTranslationKeys {
  show_header: string;
  device_label: string;
  title: string;
}

// Define the structure for card translations
interface CardTranslationKeys {
  default_title: string;
  missing_configuration: string;
  error_entity_required: string;
  error_device_required: string;
  entity_not_found: string;
  device_not_found: string;
  no_tide_data: string;
  no_water_level_data: string;
  no_coefficient_data: string;
  waiting_next_tide: string;
  rising_until: string;
  falling_until: string;
  rising_prefix: string;
  falling_prefix: string;
  high_tide_short: string;
  low_tide_short: string;
  next_tide_at: string;
  no_data_available: string;
  height: string;
  coefficient: string;
  no_data_for_day: string;
  no_data_for_month: string;
  high_tide: string;
  low_tide: string;
  tide_at_time: string;
  chart_js_missing: string;
  open_calendar: string;
  coefficient_calendar_title: string;
  previous_month: string;
  next_month: string;
  calendar_date: string;
  calendar_coeffs: string;
  editor: EditorTranslationKeys;
}

// Define the overall translation structure type
interface TranslationStructure {
  [lang: string]: {
    ui: {
      card: {
        marees_france: CardTranslationKeys;
      };
    };
  };
}

// --- Embedded Translations ---
export const translations: TranslationStructure = {
  en: {
    ui: {
      card: {
        marees_france: {
          default_title: 'France Tides',
          missing_configuration: 'Missing configuration',
          error_entity_required:
            'Missing entity, please configure the card first',
          error_device_required:
            'Missing device, please configure the card first',
          entity_not_found: 'Entity not found: {entity}',
          device_not_found: 'Device not found: {device_id}',
          no_tide_data: 'No tide data found for device.',
          no_water_level_data: 'No water level data found for device and date.',
          no_coefficient_data: 'No coefficient data found for device.', // [NEW]
          waiting_next_tide: 'Waiting for next tide',
          rising_until: 'Rising until {time} ({duration})',
          falling_until: 'Falling until {time} ({duration})',
          rising_prefix: 'Rising until',
          falling_prefix: 'Falling until',
          high_tide_short: 'High',
          low_tide_short: 'Low',
          next_tide_at: 'Next tide ({type}) at {time}',
          no_data_available: 'Tide data unavailable',
          height: 'Height',
          coefficient: 'Coefficient',
          no_data_for_day: 'No tide data for this day.',
          no_data_for_month: 'No coefficient data for this month.', // [NEW]
          high_tide: 'High',
          low_tide: 'Low',
          tide_at_time: '{status} at {time}',
          chart_js_missing:
            'Error: Chart.js library not loaded. Please add it as a frontend resource in Home Assistant.',
          open_calendar: 'Open coefficient calendar', // [NEW]
          coefficient_calendar_title: 'Tide Coefficients', // [NEW]
          previous_month: 'Previous month', // [NEW]
          next_month: 'Next month', // [NEW]
          calendar_date: 'Date', // [NEW]
          calendar_coeffs: 'Coefficients', // [NEW]
          editor: {
            show_header: 'Display header',
            device_label: 'Harbor Device',
            title: 'Title (Optional)',
          },
        },
      },
    },
  },
  fr: {
    ui: {
      card: {
        marees_france: {
          default_title: 'Marées France',
          missing_configuration: 'Configuration manquante',
          error_entity_required:
            "Entité manquante, veuillez d'abord configurer la carte",
          error_device_required:
            "Appareil manquant, veuillez d'abord configurer la carte",
          entity_not_found: 'Entité non trouvée : {entity}',
          device_not_found: 'Appareil non trouvé : {device_id}',
          no_tide_data: "Aucune donnée de marée trouvée pour l'appareil.",
          no_water_level_data:
            "Aucune donnée de niveau d'eau trouvée pour l'appareil et la date.",
          no_coefficient_data:
            "Aucune donnée de coefficient trouvée pour l'appareil.", // [NEW]
          waiting_next_tide: 'En attente de la prochaine marée',
          rising_until: "Monte jusqu'à {time} ({duration})",
          falling_until: "Descend jusqu'à {time} ({duration})",
          rising_prefix: "Monte jusqu'à",
          falling_prefix: "Descend jusqu'à",
          high_tide_short: 'Haute',
          low_tide_short: 'Basse',
          next_tide_at: 'Prochaine marée ({type}) à {time}',
          no_data_available: 'Données de marée non disponibles',
          height: 'Hauteur',
          coefficient: 'Coefficient',
          no_data_for_day: 'Aucune donnée de marée pour ce jour.',
          no_data_for_month: 'Aucune donnée de coefficient pour ce mois.', // [NEW]
          high_tide: 'Haute',
          low_tide: 'Basse',
          tide_at_time: '{status} à {time}',
          chart_js_missing:
            "Erreur : Librairie Chart.js non chargée. Veuillez l'ajouter comme ressource frontend dans Home Assistant.",
          open_calendar: 'Ouvrir le calendrier des coefficients', // [NEW]
          coefficient_calendar_title: 'Coefficients de Marée', // [NEW]
          previous_month: 'Mois précédent', // [NEW]
          next_month: 'Mois suivant', // [NEW]
          calendar_date: 'Date', // [NEW]
          calendar_coeffs: 'Coefficients', // [NEW]
          editor: {
            show_header: "Afficher l'en-tête",
            device_label: 'Appareil Port',
            title: 'Titre (Optionnel)',
          },
        },
      },
    },
  },
};