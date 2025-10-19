import { translations } from './constants';
import { HomeAssistant } from './types'; // Import the HomeAssistant type

/**
 * Custom localization function for the card.
 * Retrieves translations from the `translations` constant based on the current language
 * (or falls back to English) and replaces placeholders.
 *
 * @param key The localization key (e.g., 'ui.card.marees_france.error_device_required').
 * @param hass The HomeAssistant object, used to determine the current language.
 * @param args A list of placeholder-value pairs. For example, `localize('Hello {name}', hass, 'name', 'World')`.
 * @returns The localized string, or the original key if no translation is found.
 */
export function localizeCard(
  key: string,
  hass: HomeAssistant | undefined | null,
  ...args: (string | number)[]
): string {
  const lang = hass?.language || 'en';
  const langTranslations = translations[lang] || translations.en; // Fallback to English
  let translated: string = key; // Default to key, explicitly typed

  try {
    // Use type assertion for the accumulator 'o' to handle nested structure
    // Use a loop for safer type handling when traversing nested objects
    let currentLevel: unknown = langTranslations; // Start with the whole object
    const keys = key.split('.');

    for (const k of keys) {
      // Check if currentLevel is an indexable object and has the key
      if (currentLevel && typeof currentLevel === 'object' && !Array.isArray(currentLevel) && Object.prototype.hasOwnProperty.call(currentLevel, k)) {
        // Safely access the next level
        currentLevel = (currentLevel as Record<string, unknown>)[k];
      } else {
        // If not an object or key doesn't exist, stop the lookup
        currentLevel = undefined;
        break;
      }
    }

    // Check if the final result is a string
    if (typeof currentLevel === 'string') {
      translated = currentLevel;
    } else if (hass?.localize) {
      // Fallback to hass.localize if our custom lookup fails
      translated = hass.localize(key, ...args);
    } else {
      // If not a string and no fallback, use the key
      translated = key;
    }
  } catch {
    // Key not found, use the key itself or fallback
    if (hass?.localize) {
      translated = hass.localize(key, ...args);
    } else {
      translated = key;
    }
  }

  // Replace placeholders like {entity}
  if (translated && args.length > 0) {
    for (let i = 0; i < args.length; i += 2) {
      const placeholder = `{${args[i]}}`;
      const value = args[i + 1];
      // Use a regex for global replacement to handle multiple occurrences
      // Escape special regex characters in the placeholder
      const escapedPlaceholder = placeholder.replace(
        /[-/\\^$*+?.()|[\]{}]/g,
        '\\$&'
      );
      translated = translated.replace(
        new RegExp(escapedPlaceholder, 'g'),
        value !== undefined ? String(value) : '' // Ensure value is string
      );
    }
  }
  return translated;
}