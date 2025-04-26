// Helper function to get localized weekday abbreviation (3 letters)
export function getWeekdayShort3Letters(dayIndex, locale) {
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
export function getNextTideStatus(tideServiceData, hass) {
  // Check if the main data object and the 'response' property exist
  if (!tideServiceData || !tideServiceData.response || !hass) return null;
  const tideData = tideServiceData.response; // Use the actual data within 'response'

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
  const parseTidesForDate = (dateStr) => {
    if (!tideData[dateStr] || !Array.isArray(tideData[dateStr])) return [];
    return tideData[dateStr]
      .map((tideArr) => {
        if (!Array.isArray(tideArr) || tideArr.length < 3) return null; // Need at least type, time, height
        const typeStr = tideArr[0]; // "tide.high" or "tide.low"
        const time = tideArr[1]; // "HH:MM"
        const height = parseFloat(tideArr[2]); // "H.HH" -> number
        const coefficient =
          tideArr.length > 3 && tideArr[3] !== '---'
            ? parseInt(tideArr[3], 10)
            : null; // "CC" or "---" -> number or null
        const type =
          typeStr === 'tide.high'
            ? 'high'
            : typeStr === 'tide.low'
              ? 'low'
              : null;

        if (!type || !time || isNaN(height)) return null; // Basic validation

        return {
          type: type,
          time: time,
          height: height,
          coefficient: coefficient,
          date: dateStr, // Add date for constructing dateTime
          dateTime: new Date(`${dateStr}T${time}:00`), // Construct Date object
        };
      })
      .filter((t) => t !== null); // Remove invalid entries
  };

  // Parse tides for the relevant days
  const todayTides = parseTidesForDate(todayStr);
  const tomorrowTides = parseTidesForDate(tomorrowStr);
  const dayAfterTomorrowTides = parseTidesForDate(dayAfterTomorrowStr);

  // Combine and sort all valid tides
  const allRelevantTides = [
    ...todayTides,
    ...tomorrowTides,
    ...dayAfterTomorrowTides,
  ].sort((a, b) => a.dateTime - b.dateTime);

  let nextTide = null;
  let previousTide = null;

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
  }

  // If no previous tide was found in the loop (meaning 'now' is before the first tide in our list),
  // and there are tides today before 'now', find the latest one that occurred before 'now'.
  if (
    !previousTide &&
    allRelevantTides.length > 0 &&
    allRelevantTides[0].dateTime > now
  ) {
    const tidesBeforeNow = allRelevantTides.filter((t) => t.dateTime <= now);
    if (tidesBeforeNow.length > 0) {
      previousTide = tidesBeforeNow[tidesBeforeNow.length - 1]; // Get the last one
    }
  }

  if (!nextTide) {
    // Return default/error state matching the new structure
    return {
      currentTrendIcon: 'mdi:help-circle-outline',
      nextPeakTime: '--:--',
      nextPeakHeight: null,
      nextPeakCoefficient: null,
      nextPeakType: null, // Indicate unknown type
    };
  }

  // Determine trend: If the previous tide was low, we are rising. If previous was high, we are falling.
  // If there's no previous tide (e.g., right at the start), infer trend from the type of the *next* tide.
  // If next is low, we must be falling towards it. If next is high, we must be rising towards it.
  const isRising = previousTide
    ? previousTide.type === 'low'
    : nextTide.type === 'high';

  // Determine the coefficient to display
  let displayCoefficient = null;
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
