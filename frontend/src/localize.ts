import { translations } from './constants';
import { HassObject } from './types'; // Import the HassObject type

// --- Custom Localization Function ---
export function localizeCard(
  key: string,
  hass: HassObject | undefined | null, // Type the hass object
  ...args: (string | number)[] // Type the rest arguments
): string { // Add return type
  const lang = hass?.language || 'en';
  const langTranslations = translations[lang] || translations.en; // Fallback to English
  let translated: string = key; // Default to key, explicitly typed

  try {
    // Use type assertion for the accumulator 'o' to handle nested structure
    // Use type assertion for the accumulator 'o' and check final type
    const potentialTranslation = key
      .split('.')
      .reduce((o, i) => (o && typeof o === 'object' ? (o as any)[i] : undefined), langTranslations);

    if (typeof potentialTranslation === 'string') {
      translated = potentialTranslation;
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