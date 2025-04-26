# Plan: Replace Draggable Dot with Hover/Touch Interaction

**Goal:** Replace the draggable yellow dot interaction with a hover/touch interaction that shows a blue dot and tooltip on the tide curve in the `marees-france-card`.

**Phase 1: Analysis (Complete)**

*   Reviewed `frontend/src/graph-renderer.js`: Identified the code responsible for drawing the current time marker (yellow dot), its hit area, event listeners (`mouseover`, `mouseout`, `mousedown`, `touchstart`), and calls to the card's drag/tooltip handlers (lines ~555-609). Also noted helper functions for coordinate conversion and interpolation (`_timeToX`, `_heightToY`, `_xToTotalMinutes`, `_interpolateHeight`, `getSVGCoordinates`).
*   Reviewed `frontend/src/marees-france-card.js`: Identified state properties (`_isDraggingDot`, `_originalDotPosition`, `_draggedPosition`), drag handling methods (`_handleDragStart`, `_handleDragMove`, `_handleDragEnd`, `_removeDragListeners`), and tooltip methods (`_handleTooltipShow`, `_handleTooltipHide`, `_showHtmlTooltip`, `_hideHtmlTooltip`). Confirmed interaction points where the renderer calls card methods.

**Phase 2: Detailed Plan**

1.  **Modify `frontend/src/graph-renderer.js`:**
    *   **Remove:**
        *   The entire block creating the `dotGroup`, `hitAreaCircle`, `dotCircle`, and associated event listeners for the current time marker (approx. lines 555-609).
        *   The storage of `_originalDotPosition` on the card instance (lines 586-591).
    *   **Add:**
        *   Inside the `drawGraph` method, after drawing the main curve (line 428) but before drawing tide markers (line 447):
            *   Create an SVG group for interaction elements, initially hidden: `const interactionGroup = draw.group().attr('id', 'interaction-indicator').hide();`
            *   Add a blue circle (the indicator dot) to this group: `const interactionDot = interactionGroup.circle(8).fill('var(--info-color, blue)').attr('pointer-events', 'none');` (Adjust size/color as needed).
        *   Add a transparent overlay rectangle covering the graph area to capture mouse/touch events reliably:
            ```javascript
            const interactionOverlay = draw.rect(this.graphWidth, this.graphHeight)
                .move(this.graphMargin.left, this.graphMargin.top)
                .fill('transparent')
                .attr('cursor', 'crosshair'); // Indicate interactivity
            ```
        *   Attach event listeners to `interactionOverlay.node`:
            *   `mousemove`: Call a new `_handleInteractionMove` method.
            *   `touchmove`: Call `_handleInteractionMove` (with `{ passive: false }`).
            *   `mouseleave`: Call a new `_handleInteractionEnd` method.
            *   `touchend`: Call `_handleInteractionEnd`.
            *   `touchcancel`: Call `_handleInteractionEnd`.
        *   Implement `_handleInteractionMove(event)`:
            *   Prevent default touch behavior (`event.preventDefault()` if touch).
            *   Get SVG coordinates using `this.getSVGCoordinates(event)`.
            *   If coordinates are valid:
                *   Convert X coordinate to `totalMinutes` using `this._xToTotalMinutes(svgPoint.x)`.
                *   Clamp `totalMinutes` between `this.curveMinMinutes` and `this.curveMaxMinutes`.
                *   Interpolate `height` using `this._interpolateHeight(clampedTotalMinutes)`.
                *   If `height` is valid:
                    *   Convert clamped time and height back to SVG coordinates `(finalX, finalY)` using `this._timeToX` and `this._heightToY`.
                    *   Show the `interactionGroup`.
                    *   Update the `interactionDot` position: `interactionDot.center(finalX, finalY);`
                    *   Call the card's update method: `this.card._updateInteractionTooltip(finalX, finalY, clampedTotalMinutes, height);`
                *   Else (height interpolation failed): Call `_handleInteractionEnd()`.
            *   Else (invalid coordinates): Call `_handleInteractionEnd()`.
        *   Implement `_handleInteractionEnd()`:
            *   Hide the `interactionGroup`: `interactionGroup.hide();`
            *   Call the card's hide method: `this.card._hideInteractionTooltip();`

2.  **Modify `frontend/src/marees-france-card.js`:**
    *   **Remove:**
        *   State properties: `_isDraggingDot`, `_originalDotPosition`, `_draggedPosition` (lines 13-15, 45-46, 93-95).
        *   Drag handling methods: `_handleDragStart`, `_handleDragMove`, `_handleDragEnd`, `_removeDragListeners` (lines 1180-1353).
        *   Old tooltip trigger methods: `_handleTooltipShow`, `_handleTooltipHide` (lines 1081-1098).
        *   Binding of removed handlers in constructor/elsewhere.
    *   **Add:**
        *   New method `_updateInteractionTooltip(svgX, svgY, timeMinutes, height)`:
            *   Get the SVG element: `const svg = this._svgContainer?.querySelector('svg');`
            *   If `!svg`, return.
            *   Format `timeMinutes` to HH:MM string.
            *   Format `height` to "X.XX m" string.
            *   Calculate screen coordinates using `svg.createSVGPoint()`, `getScreenCTM()`, and `matrixTransform()`. Handle errors.
            *   Create a synthetic event object: `{ clientX: screenPoint.x, clientY: screenPoint.y, type: 'interactionMove' }`.
            *   Call `this._showHtmlTooltip(syntheticEvent, formattedTimeStr, formattedHeightStr);`
        *   New method `_hideInteractionTooltip()`:
            *   Call `this._hideHtmlTooltip();`
    *   **Modify:**
        *   `_showHtmlTooltip(evt, time, height)`: Remove the `isDragging` parameter and related logic.
        *   `_hideHtmlTooltip()`: No changes needed.
        *   In `updated()` (line 1073): Ensure `this._graphRenderer.drawGraph(...)` call remains correct.

**Phase 3: Implementation**

*   Switch to "Code" mode to apply the planned changes to `frontend/src/graph-renderer.js` and `frontend/src/marees-france-card.js`.

**Visual Plan (Mermaid Diagram):**

```mermaid
sequenceDiagram
    participant User
    participant Card (marees-france-card.js)
    participant Renderer (graph-renderer.js)
    participant SVG Overlay
    participant SVG Elements

    Note over User, SVG Overlay: User hovers/touches SVG graph area
    User->>+SVG Overlay: mousemove / touchmove (event)
    SVG Overlay->>+Renderer: _handleInteractionMove(event)
    Renderer->>Renderer: getSVGCoordinates(event) -> svgPoint
    Renderer->>Renderer: _xToTotalMinutes(svgPoint.x) -> totalMinutes
    Renderer->>Renderer: Clamp totalMinutes -> clampedTime
    Renderer->>Renderer: _interpolateHeight(clampedTime) -> height
    Renderer->>Renderer: _timeToX(clampedTime), _heightToY(height) -> (finalX, finalY)
    Renderer->>SVG Elements: Show interactionGroup
    Renderer->>SVG Elements: interactionDot.center(finalX, finalY)
    Renderer->>+Card: _updateInteractionTooltip(finalX, finalY, clampedTime, height)
    Card->>Card: Format time/height -> formattedTime, formattedHeight
    Card->>Card: Calculate screen coords from (finalX, finalY) -> screenPoint
    Card->>Card: Create syntheticEvent {clientX, clientY}
    Card->>Card: Call _showHtmlTooltip(syntheticEvent, formattedTime, formattedHeight)
    Card-->>-Renderer: Return
    Renderer-->>-SVG Overlay: Return
    SVG Overlay-->>-User: Show blue dot & tooltip

    Note over User, SVG Overlay: User moves mouse away / ends touch
    User->>+SVG Overlay: mouseleave / touchend / touchcancel
    SVG Overlay->>+Renderer: _handleInteractionEnd()
    Renderer->>SVG Elements: Hide interactionGroup
    Renderer->>+Card: _hideInteractionTooltip()
    Card->>Card: Call _hideHtmlTooltip()
    Card-->>-Renderer: Return
    Renderer-->>-SVG Overlay: Return
    SVG Overlay-->>-User: Hide blue dot & tooltip