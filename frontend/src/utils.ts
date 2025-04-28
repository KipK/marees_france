import {
  HassObject,
  ServiceResponseWrapper,
  GetTidesDataResponseData,
  ParsedTideEvent,
  NextTideStatus,
  TideEventTuple,
} from './types.js';

// Helper function to get localized weekday abbreviation (3 letters)
export function getWeekdayShort3Letters(
  dayIndex: number,
  locale: string
): string {
  // Create a date object for a known week starting on Sunday (e.g., Jan 1, 2023 was a Sunday)
  // Adjust index to match JavaScript's Date (0=Sun, 1=Mon, ...)
  // We want 0=Mon, 1=Tue, ... 6=Sun for display order matching the screenshot (L, M, M, J, V, S, D)
  // Let's adjust the date calculation to get the desired starting day.
  // Sunday = 0, Monday = 1, ..., Saturday = 6
  // If locale starts week on Sunday (e.g., en-US), dayIndex 0 should map to Sunday.
  // If locale starts week on Monday (e.g., fr-FR), dayIndex 0 should map to Monday.

  // Let's create dates starting from a known Monday (Jan 2, 2023)
  const date = new Date(2023, 0, 2 + dayIndex); // 2=Mon, 3=Tue, ... 8=Sun
  let abbr = date.toLocaleDateString(locale, { weekday: 'short' });
  // Ensure it's 3 letters, some locales might give 2 (e.g., Japanese)
  if (abbr.length > 3) {
    abbr = abbr.substring(0, 3);
  }
  // Optional: Uppercase the first letter if needed by design
  // abbr = abbr.charAt(0).toUpperCase() + abbr.slice(1);
  return abbr;
}

// Returns data needed for the next tide peak display
// Adapts to the new service call format: { "YYYY-MM-DD": [ ["tide.type", "HH:MM", "H.HH", "CC"], ... ] }
export function getNextTideStatus(
  tideServiceData: ServiceResponseWrapper<GetTidesDataResponseData> | null,
  hass: HassObject | null
): NextTideStatus | null { // Return type can be null if prerequisites fail
  // Check if the main data object and the 'response' property exist
  if (
    !tideServiceData ||
    !tideServiceData.response ||
    typeof tideServiceData.response !== 'object' || // Ensure response is an object
    tideServiceData.response.error || // Check for explicit error in response
    !hass
  ) {
    return null; // Return null if data is invalid or hass is missing
  }

  // Type assertion after checks
  const tideData = tideServiceData.response as GetTidesDataResponseData;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  // Look ahead 2 days to ensure we capture the next tide even if it's early tomorrow
  const tomorrowStr = new Date(new Date(now).setDate(now.getDate() + 1))
    .toISOString()
    .slice(0, 10);
  const dayAfterTomorrowStr = new Date(new Date(now).setDate(now.getDate() + 2))
    .toISOString()
    .slice(0, 10);

  // Helper function to parse the new array format for a given date
  const parseTidesForDate = (dateStr: string): ParsedTideEvent[] => {
    const dailyTides = tideData[dateStr];
    if (!dailyTides || !Array.isArray(dailyTides)) return [];

    return dailyTides
      .map((tideArr: TideEventTuple): ParsedTideEvent | null => {
        if (!Array.isArray(tideArr) || tideArr.length < 3) return null; // Need at least type, time, height
        const typeStr = tideArr[0]; // "tide.high" or "tide.low"
        const time = tideArr[1]; // "HH:MM"
        const height = parseFloat(tideArr[2]); // "H.HH" -> number
        const coefficient =
          tideArr.length > 3 && tideArr[3] !== '---'
            ? parseInt(tideArr[3], 10)
            : null; // "CC" or "---" -> number or null
        const type: 'high' | 'low' | null =
          typeStr === 'tide.high'
            ? 'high'
            : typeStr === 'tide.low'
              ? 'low'
              : null;

        if (!type || !time || isNaN(height)) return null; // Basic validation

        try {
          return {
            type: type,
            time: time,
            height: height,
            coefficient: coefficient,
            date: dateStr, // Add date for constructing dateTime
            dateTime: new Date(`${dateStr}T${time}:00`), // Construct Date object
          };
        } catch (e) {
          console.error(`Error parsing date/time: ${dateStr}T${time}:00`, e);
          return null; // Handle potential Date constructor errors
        }
      })
      .filter((t): t is ParsedTideEvent => t !== null); // Type predicate to filter out nulls
  };

  // Parse tides for the relevant days
  const todayTides: ParsedTideEvent[] = parseTidesForDate(todayStr);
  const tomorrowTides: ParsedTideEvent[] = parseTidesForDate(tomorrowStr);
  const dayAfterTomorrowTides: ParsedTideEvent[] = parseTidesForDate(
    dayAfterTomorrowStr
  );

  // Combine and sort all valid tides
  const allRelevantTides: ParsedTideEvent[] = [
    ...todayTides,
    ...tomorrowTides,
    ...dayAfterTomorrowTides,
  ].sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime()); // Use getTime() for comparison

  let nextTide: ParsedTideEvent | null = null;
  let previousTide: ParsedTideEvent | null = null;

  // Find the first tide strictly after 'now'
  for (let i = 0; i < allRelevantTides.length; i++) {
    if (allRelevantTides[i].dateTime > now) {
      nextTide = allRelevantTides[i];
      // The tide immediately before this 'nextTide' is the 'previousTide' relative to now
      if (i > 0) {
        previousTide = allRelevantTides[i - 1];
      }
      break;
    }
    // If the loop finishes, the last tide before now is the previous one
    previousTide = allRelevantTides[i];
  }

  // If no next tide was found within the 2-day window
  if (!nextTide) {
    // Return default/error state matching the new structure
    return {
      currentTrendIcon: 'mdi:help-circle-outline',
      nextPeakTime: '--:--',
      nextPeakHeight: null,
      displayCoefficient: null, // Changed from nextPeakCoefficient
      nextPeakType: null, // Indicate unknown type
    };
  }

  // Determine trend: If the previous tide was low, we are rising. If previous was high, we are falling.
  // If there's no previous tide (e.g., right at the start), infer trend from the type of the *next* tide.
  // If next is low, we must be falling towards it. If next is high, we must be rising towards it.
  const isRising: boolean = previousTide
    ? previousTide.type === 'low'
    : nextTide.type === 'high';

  // Determine the coefficient to display
  let displayCoefficient: number | null = null;
  if (isRising) {
    // Find the next high tide after now
    const nextHighTide = allRelevantTides.find(
      (tide) => tide.dateTime > now && tide.type === 'high'
    );
    if (nextHighTide) {
      displayCoefficient = nextHighTide.coefficient;
    }
  } else {
    // Find the last high tide at or before now (should be previousTide if it was high)
    const previousHighTide = allRelevantTides
      .slice()
      .reverse()
      .find((tide) => tide.dateTime <= now && tide.type === 'high');
    if (previousHighTide) {
      displayCoefficient = previousHighTide.coefficient;
    } else if (previousTide && previousTide.type === 'high') {
      // Fallback just in case the reverse find fails but previousTide was high
      displayCoefficient = previousTide.coefficient;
    }
  }

  // Return data matching the plan's requirements
  return {
    currentTrendIcon: isRising ? 'mdi:wave-arrow-up' : 'mdi:wave-arrow-down',
    nextPeakTime: nextTide.time,
    nextPeakHeight: nextTide.height, // Keep as number for potential calculations
    displayCoefficient: displayCoefficient, // Use the determined coefficient
    nextPeakType: nextTide.type, // 'high' or 'low'
  };
}