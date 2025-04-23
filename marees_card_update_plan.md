# Plan for Updating marees-france-card.js

This plan outlines the steps to modify the `marees-france-card.js` Home Assistant card to match the user's specifications and the provided reference image.

**I. Data Handling and Logic Refinement:**

1.  **Refine `getNextTideStatus` Function:**
    *   Modify the function to reliably find the *next* upcoming tide event (either high or low) after the current time.
    *   Determine the current trend: Is the tide rising towards the next high tide, or falling towards the next low tide?
    *   Return an object containing:
        *   `nextPeakTime`: Time of the next tide peak (e.g., "12:24").
        *   `nextPeakHeight`: Height of the next tide peak (e.g., 4.1).
        *   `nextPeakCoefficient`: Coefficient *only if* the next peak is a high tide.
        *   `currentTrendIcon`: 'mdi:arrow-up' if rising, 'mdi:arrow-down' if falling.
        *   `nextPeakType`: 'high' or 'low'.
2.  **Ensure `_fetchWaterLevels` Robustness:**
    *   Verify the service call `marees_france.get_water_levels` is correctly formatted.
    *   Improve error handling for failed service calls or unexpected data formats in the response (`this._waterLevels`).
    *   Ensure the `_waterLevels` state is correctly updated and triggers a re-render.

**II. Rendering Updates (HTML & CSS):**

1.  **Update Header Section Rendering:**
    *   In the `render()` method, use the data returned by the refined `getNextTideStatus`.
    *   Display the `currentTrendIcon`, `nextPeakTime`, `nextPeakHeight` (formatted as "X.X m"), and `nextPeakCoefficient` (formatted as "- Coef. YYY") below the main "MARÉES" title, matching the layout in the image.
2.  **Adjust Day Tabs:**
    *   Ensure the 7-day tabs display correctly using 3-letter uppercase abbreviations based on the locale.
    *   Verify the `active` class is applied correctly to the selected day's tab.
3.  **Refine CSS (`static get styles`):**
    *   Adjust styles for the header section (icon size, text sizes, colors, spacing) to match the image.
    *   Ensure tab styles (`.tab`, `.tab.active`) match the image (background, text color, font weight).
    *   Review overall card padding and margins.
    *   Ensure the SVG container (`.svg-graph-container`) is set up for responsiveness (e.g., `width: 100%`, potentially `aspect-ratio` or a dynamic height calculation if needed, although `height: 200px` might be sufficient if the `viewBox` handles scaling).

**III. SVG Graph Drawing (`_drawGraphWithSvgJs`):**

1.  **Initialization:**
    *   Ensure the `svg.js` instance (`this._svgDraw`) is correctly initialized within the target `div` (`#marees-graph-target`), preferably in `firstUpdated` or `updated`. Use a `viewBox` that matches the internal coordinate system (e.g., `0 0 500 150` based on current code) to allow proper scaling. Clear the SVG (`this._svgDraw.clear()`) at the beginning of each redraw.
2.  **Data Processing & Scaling:**
    *   Confirm extraction of `levelsData` for the `_selectedDay`.
    *   Verify calculation of `minHeight`, `maxHeight`, `yDomainMin`, `yDomainMax`.
    *   Double-check the `timeToX` and `heightToY` mapping functions against the chosen `viewBox` and margins.
3.  **Draw Base Elements:**
    *   Draw the filled area path (`fillPathData`) with the specified blue color and opacity.
    *   Draw the main tide curve path (`pathData`) with the specified blue color and line width.
    *   Draw the X-axis labels ("00:00", "08:00", "16:00", "00:00") at the correct positions below the graph.
4.  **Draw Tide Peak Markers (Arrows & Text):**
    *   Iterate through the `tideMarkers` data (calculated from `entityState.attributes.data`).
    *   For each marker:
        *   Calculate the peak's (x, y) coordinate on the curve.
        *   Define vertical offsets for placing arrows and text relative to the curve point (e.g., `arrowOffset`, `textOffset`).
        *   **If High Tide:**
            *   Draw a white UP arrow (↑) at `(x, y + arrowOffset)`.
            *   Draw the time text at `(x, y + arrowOffset + textOffset)`.
            *   Draw the height text below the time text.
        *   **If Low Tide:**
            *   Draw a white DOWN arrow (↓) at `(x, y - arrowOffset)`.
            *   Draw the time text at `(x, y - arrowOffset - textOffset)`.
            *   Draw the height text above the time text.
        *   Use appropriate font sizes, colors (white/secondary), and text anchors ('middle').
5.  **Draw Current Time Marker (Yellow Dot):**
    *   Calculate the `currentTimeMarker`'s (x, y) position by interpolating the height based on the current time.
    *   Draw a solid yellow circle at `(x, y)`. **Crucially, do not draw any text associated with this dot.**
6.  **Implement Collision Avoidance (Yellow Dot vs. Peak Info):**
    *   After calculating the initial position for the yellow dot and the tide peak arrows/text, check for overlaps.
    *   If the yellow dot's bounding box significantly overlaps with a tide peak arrow or its text:
        *   Slightly adjust the *vertical position* (`y`) of the yellow dot away from the tide peak info (e.g., move it slightly higher if it overlaps with low tide info, slightly lower if it overlaps high tide info). The goal is to ensure the tide peak information remains unobstructed. The horizontal position (`x`) should remain unchanged.
7.  **Final Styling:** Ensure all SVG elements (lines, fills, text, arrows, dot) use colors and styles derived from Home Assistant themes (CSS variables) where possible, falling back to defaults that match the image.

**IV. Responsiveness & Bug Fixing:**

1.  **Test Responsiveness:** Check how the card renders at different widths in the Lovelace UI. Ensure the day tabs wrap or shrink appropriately and the SVG graph scales correctly without distortion.
2.  **Code Cleanup:** Remove commented-out code, unused variables, and excessive `console.log` statements (except for essential debugging ones if needed temporarily).
3.  **Lifecycle Management:** Ensure `_drawGraphWithSvgJs` is called reliably in the `updated` lifecycle method, specifically when `_waterLevels` or `_selectedDay` changes, and after the component has rendered its DOM.

**Mermaid Plan Diagram:**

```mermaid
graph TD
    subgraph Initialization & Data
        A[Card Load/Config Change] --> B(Fetch Entity State);
        B --> C{Refine getNextTideStatus};
        B --> D(Set _selectedDay);
        D --> E(Call _fetchWaterLevels);
        E --> F{Store _waterLevels};
    end

    subgraph Rendering
        G[Render Triggered] --> H(Render Static HTML: Title, Header Area, Tabs, SVG Container);
        C --> I(Render Header Info);
        H --> J(Render Day Tabs);
    end

    subgraph SVG Drawing (in updated method)
        K{Check if _svgDraw exists & _waterLevels ready?} -- Yes --> L(Clear SVG);
        F --> M(Process _waterLevels for _selectedDay);
        M --> N(Calculate Coordinates & Paths);
        N --> O(Draw SVG Base: Curve, Fill, X-Axis);
        M --> P(Extract Tide Peaks);
        P --> Q(Draw Tide Peak Arrows);
        P --> R(Draw Tide Peak Text);
        M --> S(Calculate Current Time Position);
        S --> T(Draw Yellow Dot);
        Q & R & T --> U{Check/Resolve Collisions (Dot vs Peaks)};
        U --> V(Final SVG Output);
    end

    subgraph User Interaction
        W[User Clicks Day Tab] --> X(Update _selectedDay);
        X --> E;
    end

    A --> G;
    F --> G;
    X --> G;
    I --> H;
    J --> H;
    V --> H;

    style K fill:#f9f,stroke:#333,stroke-width:2px
    style U fill:#f9f,stroke:#333,stroke-width:2px