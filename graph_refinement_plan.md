# Plan for Refining the Marees France Card SVG Graph

This plan outlines the steps to modify the `_drawGraphWithSvgJs` function in `custom_components/marees_france/frontend/marees-france-card.js` to achieve the desired visual refinements for the tide graph.

## Requirements Summary

1.  **Fill Area:** Adjust the blue fill to represent the water level from the bottom axis up to the tide curve.
2.  **Axes & Graduations:** Replace solid axis lines with tick marks:
    *   **Y-Axis (Height):** Horizontal dashes every 50cm with text labels (e.g., "1.5m").
    *   **X-Axis (Time):** Vertical bars every hour, with text labels every two hours.
3.  **Tide Markers:** Add dots at high/low tide peaks with time labels above, and coefficient labels for high tides.
4.  **Default View:** Ensure the graph displays the current day's data automatically on load.

## Implementation Steps

1.  **Fill Area:** Review and potentially adjust the `fill` style (color/opacity) applied to `fillPathData` (around line 552 in the current code) to match the desired "water" look.
2.  **Y-Axis (Height):**
    *   Calculate tick positions every 0.5 units within the graph's calculated height range (`yDomainMin` to `yDomainMax`).
    *   Use `svg.js` to draw a short horizontal `<line>` element for each tick at the calculated Y position, starting from `margin.left`.
    *   Add `<text>` elements next to each tick line to display the height label (e.g., "1.0m", "1.5m"). Position these labels appropriately (e.g., to the left of the axis line).
3.  **X-Axis (Time):**
    *   Modify the existing loop (around line 413) to calculate tick positions every hour (60 minutes).
    *   Use `svg.js` to draw a vertical `<line>` element for each hourly tick at the calculated X position, starting from the bottom axis (`xAxisY`) and extending upwards slightly.
    *   Modify the text label creation logic within the loop to only generate labels every two hours (120 minutes). Ensure labels like "08:00", "10:00" are positioned below the axis line (`xAxisY`).
4.  **Tide Markers:** Review the existing marker drawing code (lines 497-541). Verify that the positioning of the dot (`<circle>`), time (`<text>`), height (`<text>`), and coefficient/arrow (`<path>`/`<text>`) elements matches the visual requirements. Adjust font sizes, colors, and offsets as needed.
5.  **Default View:** Confirm that the `setConfig` method correctly initializes `_selectedDay` to the current date and calls `_fetchWaterLevels`, ensuring the current day's graph loads by default. This appears to be working correctly already.

## Visual Plan (Mermaid)

```mermaid
graph TD
    A[Start: Refine Graph Visuals] --> B{Analyze Current Code (`_drawGraphWithSvgJs`)};
    B --> C[Plan Modifications];
    C --> D[Implement Y-Axis Graduations (0.5m ticks, labels)];
    C --> E[Implement X-Axis Graduations (hourly ticks, bi-hourly labels)];
    C --> F[Review/Adjust Tide Marker Styling];
    C --> G[Review/Adjust Fill Area Style];
    C --> H[Confirm Default Day Loading];
    H --> I{User Review of Plan};
    I -- Approve --> J{Save Plan to File?};
    J -- Yes --> K[Write Plan to `graph_plan.md`];
    J -- No --> L[Proceed to Implementation];
    K --> L;
    L --> M[Switch to Code Mode];
    I -- Revise --> C;