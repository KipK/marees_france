import { translations } from './constants';
import { HomeAssistant } from './types'; // Import the HomeAssistant type

// --- Custom Localization Function ---
export function localizeCard(
  key: string,
  hass: HomeAssistant | undefined | null, // Type the hass object
  ...args: (string | number)[] // Type the rest arguments
): string { // Add return type
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
    } else {
      // If not a string (undefined, object, etc.), fall back to the key
      translated = key;
    }
  } catch {
    // Key not found, use the key itself
    translated = key;
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