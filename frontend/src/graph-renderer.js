import { SVG } from '@svgdotjs/svg.js';
import { localizeCard } from './localize.js'; // Assuming localize is needed here

export class GraphRenderer {
  constructor(cardInstance, svgContainer, hass) {
    this.card = cardInstance; // Reference to the main card component instance
    this.svgContainer = svgContainer;
    this.hass = hass;
    this.svgDraw = null;
    this.resizeObserver = null;
    this.elementsToKeepSize = [];

    // Graph properties (initialized in _drawGraph)
    this.graphMargin = null;
    this.graphWidth = null;
    this.graphHeight = null;
    this.pointsData = null;
    this.curveMinMinutes = null;
    this.curveMaxMinutes = null;
    this.yDomainMin = null;
    this.yRange = null;
    this.currentTimeMarkerData = null; // Store current time marker info
    this.currentTimeDotElement = null; // Store reference to the yellow dot SVG element

    this._initializeSvg();
    this._setupResizeObserver();
  }

  _initializeSvg() {
    if (this.svgContainer) {
      // Clear previous SVG content if any
      while (this.svgContainer.firstChild) {
        this.svgContainer.removeChild(this.svgContainer.firstChild);
      }
      // Initialize svg.js instance with viewBox for scaling
      this.svgDraw = SVG().addTo(this.svgContainer).viewbox(0, 0, 500, 170);
    } else {
      console.error(
        'GraphRenderer: SVG container not provided during initialization.'
      );
    }
  }

  // --- Coordinate/Interpolation Helper Methods ---
  _timeToX(totalMinutes) {
    if (!this.graphMargin || this.graphWidth === null) return 0; // Guard
    return this.graphMargin.left + (totalMinutes / (24 * 60)) * this.graphWidth;
  }

  _heightToY(h) {
    if (
      !this.graphMargin ||
      this.graphHeight === null ||
      this.yDomainMin === null ||
      !this.yRange
    )
      return 0; // Guard
    return (
      this.graphMargin.top +
      this.graphHeight -
      ((h - this.yDomainMin) / this.yRange) * this.graphHeight
    );
  }

  _xToTotalMinutes(x) {
    if (!this.graphMargin || this.graphWidth === null || this.graphWidth <= 0)
      return 0; // Guard
    const clampedX = Math.max(
      this.graphMargin.left,
      Math.min(this.graphMargin.left + this.graphWidth, x)
    );
    return ((clampedX - this.graphMargin.left) / this.graphWidth) * (24 * 60);
  }

  _interpolateHeight(targetTotalMinutes) {
    if (!this.pointsData || this.pointsData.length < 2) return null; // Guard, check pointsData exists
    let prevPoint = null;
    let nextPoint = null;
    // Find the two points surrounding the target time
    for (let i = 0; i < this.pointsData.length; i++) {
      if (this.pointsData[i].totalMinutes <= targetTotalMinutes)
        prevPoint = this.pointsData[i];
      if (this.pointsData[i].totalMinutes > targetTotalMinutes) {
        nextPoint = this.pointsData[i];
        break;
      }
    }
    // Handle edge cases (before first point or after last point)
    if (!prevPoint && nextPoint) return nextPoint.heightNum;
    if (prevPoint && !nextPoint) return prevPoint.heightNum;
    if (!prevPoint && !nextPoint) return null;

    // Interpolate
    const timeDiff = nextPoint.totalMinutes - prevPoint.totalMinutes;
    if (timeDiff <= 0) return prevPoint.heightNum;

    const timeProgress =
      (targetTotalMinutes - prevPoint.totalMinutes) / timeDiff;
    return (
      prevPoint.heightNum +
      (nextPoint.heightNum - prevPoint.heightNum) * timeProgress
    );
  }

  // --- Coordinate Conversion Helper ---
  getSVGCoordinates(evt) {
    if (!this.svgDraw || !this.svgContainer) return null;

    const svg = this.svgContainer.querySelector('svg');
    if (!svg) return null;

    // Create an SVGPoint for transformations
    const pt = svg.createSVGPoint();

    // Get the screen coordinates from the event
    if (evt.touches && evt.touches.length > 0) {
      pt.x = evt.touches[0].clientX;
      pt.y = evt.touches[0].clientY;
    } else if (evt.clientX !== undefined && evt.clientY !== undefined) {
      pt.x = evt.clientX;
      pt.y = evt.clientY;
    } else {
      return null; // No coordinates found
    }

    // Transform the screen coordinates to SVG coordinates
    try {
      const svgPoint = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: svgPoint.x, y: svgPoint.y };
    } catch (e) {
      console.error('Error transforming screen coordinates to SVG:', e);
      return null;
    }
  }

  // --- Resize Observer Logic ---
  _setupResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (!this.svgContainer) {
      console.warn(
        'GraphRenderer: Cannot setup ResizeObserver, SVG container not found.'
      );
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      // Removed unused 'entries'
      window.requestAnimationFrame(() => {
        this._updateElementScale();
      });
    });
    this.resizeObserver.observe(this.svgContainer);
  }

  _updateElementScale() {
    if (
      !this.svgContainer ||
      !this.svgDraw ||
      this.elementsToKeepSize.length === 0
    ) {
      return;
    }

    const svgRect = this.svgContainer.getBoundingClientRect();
    const viewBox = this.svgDraw.viewbox();
    const viewBoxWidth = viewBox ? viewBox.width : 500;

    if (svgRect.width <= 0 || viewBoxWidth <= 0) {
      return;
    }

    const scaleFactor = svgRect.width / viewBoxWidth;

    if (scaleFactor <= 0 || !isFinite(scaleFactor)) {
      return;
    }

    const inverseScale = 1 / scaleFactor;

    this.elementsToKeepSize = this.elementsToKeepSize.filter(
      (element) =>
        element &&
        element.node?.isConnected &&
        typeof element.bbox === 'function'
    );

    this.elementsToKeepSize.forEach((element) => {
      try {
        const bbox = element.bbox();
        const cx = bbox.cx;
        const cy = bbox.cy;

        if (isNaN(cx) || isNaN(cy)) {
          console.warn(
            'GraphRenderer: Invalid bbox center for scaling element:',
            element,
            bbox
          );
          return;
        }

        element
          .transform({})
          .translate(cx, cy)
          .scale(inverseScale)
          .translate(-cx, -cy);
      } catch (e) {
        console.error('GraphRenderer: Error scaling element:', e, element);
      }
    });
  }

  // --- Main Drawing Method ---
  drawGraph(tideData, waterLevels, selectedDay) {
    if (!this.svgDraw || !this.svgContainer) {
      return;
    }

    this.svgDraw.clear();
    this.elementsToKeepSize = [];

    const viewBoxWidth = 500;
    const viewBoxHeight = 170;
    const locale = this.hass.language || 'en';

    // --- 1. Check for Errors or Missing Data ---
    if (!tideData || tideData.error || !tideData.response) {
      const errorMessage = tideData?.error
        ? `Tide Error: ${tideData.error}`
        : localizeCard('ui.card.marees_france.no_tide_data', this.hass);
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }
    const tideResponse = tideData.response;

    if (!waterLevels || waterLevels.error || !waterLevels.response) {
      const errorMessage = waterLevels?.error
        ? `Water Level Error: ${waterLevels.error}`
        : localizeCard('ui.card.marees_france.no_water_level_data', this.hass);
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }
    const waterLevelResponse = waterLevels.response;
    const levelsData = waterLevelResponse[selectedDay];

    // --- 2. Check for Water Level Data for the Selected Day ---
    if (!Array.isArray(levelsData) || levelsData.length === 0) {
      const noDataText = this.svgDraw
        .text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass))
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({
          fill: 'var(--secondary-text-color, grey)',
          size: 14,
          anchor: 'middle',
        });
      this.elementsToKeepSize.push(noDataText);
      return;
    }

    // --- SVG Dimensions and Margins ---
    this.graphMargin = { top: 55, right: 15, bottom: 35, left: 15 };
    this.graphWidth =
      viewBoxWidth - this.graphMargin.left - this.graphMargin.right;
    this.graphHeight =
      viewBoxHeight - this.graphMargin.top - this.graphMargin.bottom;

    // --- Process Data ---
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    this.pointsData = levelsData
      .map((item) => {
        const timeStr = item[0];
        const heightNum = parseFloat(item[1]);
        if (isNaN(heightNum)) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        minHeight = Math.min(minHeight, heightNum);
        maxHeight = Math.max(maxHeight, heightNum);
        return { totalMinutes, heightNum };
      })
      .filter((p) => p !== null);

    // --- 3. Check if enough points to draw & Store Boundaries ---
    if (this.pointsData.length < 2) {
      const notEnoughDataText = this.svgDraw
        .text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass))
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({
          fill: 'var(--secondary-text-color, grey)',
          size: 14,
          anchor: 'middle',
        });
      this.elementsToKeepSize.push(notEnoughDataText);
      this.curveMinMinutes = null;
      this.curveMaxMinutes = null;
      return;
    } else {
      this.curveMinMinutes = this.pointsData[0].totalMinutes;
      this.curveMaxMinutes =
        this.pointsData[this.pointsData.length - 1].totalMinutes;
    }

    // Adjust Y domain slightly for padding
    const yPadding = (maxHeight - minHeight) * 0.1 || 0.5;
    this.yDomainMin = Math.max(0, minHeight - yPadding);
    const yDomainMax = maxHeight + yPadding;
    this.yRange = Math.max(1, yDomainMax - this.yDomainMin);

    // --- Generate SVG Path Data Strings ---
    const pathData = this.pointsData
      .map((p, index) => {
        const x = this._timeToX(p.totalMinutes);
        const y = this._heightToY(p.heightNum);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

    const xAxisY = this.graphMargin.top + this.graphHeight;
    const firstPointX = this._timeToX(this.pointsData[0].totalMinutes);
    const lastPointX = this._timeToX(
      this.pointsData[this.pointsData.length - 1].totalMinutes
    );
    const fillPathData = `M ${firstPointX.toFixed(2)} ${xAxisY} ${pathData.replace(/^M/, 'L')} L ${lastPointX.toFixed(2)} ${xAxisY} Z`;

    // --- Calculate Ticks and Markers Data ---
    const xTicks = [];
    const xLabelStep = 480;
    for (
      let totalMinutes = 0;
      totalMinutes <= 24 * 60;
      totalMinutes += xLabelStep
    ) {
      const x = this._timeToX(totalMinutes === 1440 ? 1439.9 : totalMinutes);
      const hour = Math.floor(totalMinutes / 60);
      const label =
        hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`;
      xTicks.push({ x: x, label: label });
    }

    const tideEventsForDay = tideResponse[selectedDay];
    const tideMarkers = [];
    if (Array.isArray(tideEventsForDay)) {
      tideEventsForDay.forEach((tideArr) => {
        if (!Array.isArray(tideArr) || tideArr.length < 3) return;
        const typeStr = tideArr[0];
        const time = tideArr[1];
        const height = parseFloat(tideArr[2]);
        const coefficient =
          tideArr.length > 3 && tideArr[3] !== '---'
            ? parseInt(tideArr[3], 10)
            : null;
        const isHigh = typeStr === 'tide.high';
        const isLow = typeStr === 'tide.low';

        if ((!isHigh && !isLow) || !time || isNaN(height)) return;

        const [hours, minutes] = time.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        const x = this._timeToX(totalMinutes);
        const y = this._heightToY(height);

        tideMarkers.push({
          x,
          y,
          time,
          height,
          coefficient: isHigh ? coefficient : null,
          isHigh,
        });
      });
    }

    // --- Current Time Marker Data (with formatted strings for tooltip) ---
    const now = new Date();
    let currentTimeMarkerData = null;
    let currentTimeStr = '';
    let currentHeightStr = '';
    if (selectedDay === now.toISOString().slice(0, 10)) {
      const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
      if (
        this.curveMinMinutes !== null &&
        this.curveMaxMinutes !== null &&
        currentTotalMinutes >= this.curveMinMinutes &&
        currentTotalMinutes <= this.curveMaxMinutes
      ) {
        const currentHeight = this._interpolateHeight(currentTotalMinutes);
        if (currentHeight !== null) {
          const currentX = this._timeToX(currentTotalMinutes);
          const currentY = this._heightToY(currentHeight);
          currentTimeStr = now.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          });
          currentHeightStr = currentHeight.toFixed(2);
          // Store data for snapping logic
          this.currentTimeMarkerData = {
            x: currentX,
            y: currentY,
            timeStr: currentTimeStr, // Store formatted string
            heightStr: currentHeightStr, // Store formatted string
            totalMinutes: currentTotalMinutes,
            height: currentHeight,
          };
          currentTimeMarkerData = this.currentTimeMarkerData; // Also assign to local var for drawing
        } else {
          this.currentTimeMarkerData = null; // Reset if no valid height
        }
      } else {
        this.currentTimeMarkerData = null; // Reset if not today
      }
    } else {
      this.currentTimeMarkerData = null; // Reset if not today
    }

    // --- Drawing the Actual Graph ---
    const draw = this.svgDraw;
    const axisColor = 'var(--secondary-text-color, grey)';
    const primaryTextColor = 'var(--primary-text-color, black)';
    const curveColor = 'var(--primary-color, blue)';
    const arrowAndTextColor = 'var(--primary-text-color, white)';
    const coefBoxBgColor = 'var(--secondary-background-color, #f0f0f0)';
    const coefBoxBorderColor =
      'var(--ha-card-border-color, var(--divider-color, grey))';
    const coefLineColor = 'var(--primary-text-color, #212121)';

    const axisFontSize = 14;
    const tideTimeFontSize = 14;
    const tideHeightFontSize = 12;
    const coefFontSize = 16;
    const arrowSize = 8;
    const coefBoxPadding = { x: 6, y: 4 };
    const coefBoxRadius = 4;
    const coefBoxTopMargin = 10;
    const coefLineToPeakGap = 3;
    const dotRadius = 6; // 12px diameter

    // Draw Base Elements
    draw
      .path(fillPathData)
      .fill({ color: curveColor, opacity: 0.4 })
      .stroke('none');
    draw.path(pathData).fill('none').stroke({ color: curveColor, width: 2 });

    // --- Interaction Elements (Hover/Touch for Blue Dot) ---
    const interactionGroup = draw
      .group()
      .attr('id', 'interaction-indicator')
      .hide();
    const interactionDot = interactionGroup
      .circle(dotRadius * 2) // Use same radius as yellow dot
      .fill('var(--info-color, blue)')
      .attr('pointer-events', 'none');

    // Transparent overlay for capturing events (drawn first)
    const interactionOverlay = draw
      .rect(this.graphWidth, this.graphHeight)
      .move(this.graphMargin.left, this.graphMargin.top)
      .fill('transparent')
      .attr('cursor', 'crosshair'); // Indicate interactivity

    // Bind interaction handlers once
    this._boundHandleInteractionMove = this._handleInteractionMove.bind(
      this,
      interactionGroup,
      interactionDot
    );
    this._boundHandleInteractionEnd = this._handleInteractionEnd.bind(
      this,
      interactionGroup
    );

    // Add event listeners to the overlay
    interactionOverlay.node.addEventListener(
      'mousemove',
      this._boundHandleInteractionMove
    );
    interactionOverlay.node.addEventListener(
      'touchstart',
      this._boundHandleInteractionMove,
      { passive: false }
    );
    interactionOverlay.node.addEventListener(
      'touchmove',
      this._boundHandleInteractionMove,
      { passive: false }
    );
    interactionOverlay.node.addEventListener(
      'mouseleave',
      this._boundHandleInteractionEnd
    );
    interactionOverlay.node.addEventListener(
      'touchend',
      this._boundHandleInteractionEnd
    );
    interactionOverlay.node.addEventListener(
      'touchcancel',
      this._boundHandleInteractionEnd
    );

    // Draw X Axis Labels
    xTicks.forEach((tick) => {
      if (tick.label) {
        const textEl = draw
          .text(tick.label)
          .font({
            fill: axisColor,
            size: axisFontSize,
            anchor: 'middle',
            weight: 'normal',
          })
          .move(tick.x, xAxisY + 10);
        this.elementsToKeepSize.push(textEl);
      }
    });

    // --- Draw Tide Markers ---
    const markerElements = [];
    tideMarkers.forEach((marker) => {
      // Coefficient Group
      if (marker.isHigh && marker.coefficient) {
        const coefGroup = draw.group();
        const coefText = String(marker.coefficient);
        const tempText = draw
          .text(coefText)
          .font({ size: coefFontSize, weight: 'bold', anchor: 'middle' })
          .attr('dominant-baseline', 'central')
          .opacity(0);
        const textBBox = tempText.bbox();
        tempText.remove();

        const boxWidth = textBBox.width + 2 * coefBoxPadding.x;
        const boxHeight = textBBox.height + 2 * coefBoxPadding.y;
        const boxX = marker.x - boxWidth / 2;
        const boxY = coefBoxTopMargin;

        coefGroup
          .rect(boxWidth, boxHeight)
          .attr({ x: boxX, y: boxY, rx: coefBoxRadius, ry: coefBoxRadius })
          .fill(coefBoxBgColor)
          .stroke({ color: coefBoxBorderColor, width: 1 })
          .attr('vector-effect', 'non-scaling-stroke');

        const coefValue = marker.coefficient;
        const coefColor =
          coefValue >= 100 ? 'var(--warning-color)' : primaryTextColor;
        coefGroup
          .text(coefText)
          .font({
            fill: coefColor,
            size: coefFontSize,
            weight: 'bold',
            anchor: 'middle',
          })
          .attr('dominant-baseline', 'central')
          .attr({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });

        const lineStartY = boxY + boxHeight;
        const lineEndY = marker.y - coefLineToPeakGap;
        if (lineEndY > lineStartY) {
          coefGroup
            .line(marker.x, lineStartY, marker.x, lineEndY)
            .stroke({ color: coefLineColor, width: 1, dasharray: '2,2' })
            .attr('vector-effect', 'non-scaling-stroke');
        }
        this.elementsToKeepSize.push(coefGroup);
      }

      // Arrow & Text Group
      const arrowYOffset = marker.isHigh ? arrowSize * 2.0 : -arrowSize * 2.2;
      const textLineHeight = tideTimeFontSize * 1.1;
      const visualPadding = 8;
      const arrowGroup = draw.group();

      let arrowPathData;
      const arrowY = marker.y + arrowYOffset;
      if (marker.isHigh) {
        arrowPathData = `M ${marker.x - arrowSize / 2},${arrowY + arrowSize * 0.4} L ${marker.x + arrowSize / 2},${arrowY + arrowSize * 0.4} L ${marker.x},${arrowY - arrowSize * 0.4} Z`;
      } else {
        arrowPathData = `M ${marker.x - arrowSize / 2},${arrowY - arrowSize * 0.4} L ${marker.x + arrowSize / 2},${arrowY - arrowSize * 0.4} L ${marker.x},${arrowY + arrowSize * 0.4} Z`;
      }
      arrowGroup.path(arrowPathData).fill(arrowAndTextColor).stroke('none');

      let timeTextY, heightTextY;
      const arrowTipOffset = arrowSize * 0.4;
      const timeAscent = tideTimeFontSize * 0.8;
      const heightDescent = tideHeightFontSize * 0.2;

      if (marker.isHigh) {
        const arrowTipY = arrowY - arrowTipOffset;
        timeTextY = arrowTipY + visualPadding + timeAscent - 10;
        heightTextY = timeTextY + textLineHeight;
      } else {
        const arrowTipY = arrowY + arrowTipOffset;
        heightTextY = arrowTipY - visualPadding - heightDescent - 22;
        timeTextY = heightTextY - textLineHeight;
      }

      arrowGroup
        .text(marker.time)
        .font({
          fill: arrowAndTextColor,
          size: tideTimeFontSize,
          weight: 'bold',
        })
        .attr('text-anchor', 'middle')
        .cx(marker.x)
        .y(timeTextY);

      arrowGroup
        .text(`${marker.height.toFixed(1)}m`)
        .font({ fill: arrowAndTextColor, size: tideHeightFontSize })
        .attr('text-anchor', 'middle')
        .cx(marker.x)
        .y(heightTextY);

      this.elementsToKeepSize.push(arrowGroup);
      markerElements.push({
        element: arrowGroup,
        bbox: arrowGroup.bbox(),
        isHigh: marker.isHigh,
        markerY: marker.y,
      });
    });

    // --- Draw Static Current Time Marker (Yellow Dot) ---
    this.currentTimeDotElement = null; // Reset reference
    if (currentTimeMarkerData) {
      this.currentTimeDotElement = draw
        .circle(dotRadius * 2) // 12px diameter
        .center(currentTimeMarkerData.x, currentTimeMarkerData.y)
        .fill('var(--tide-icon-color)') // Use the specific yellow color
        .attr('pointer-events', 'none'); // Keep it non-interactive for mouse events

      // Scaling will be handled by interaction handlers based on proximity
    }
    // Trigger scale update after drawing
    window.requestAnimationFrame(() => {
      this._updateElementScale();
    });
  }

  // --- Public method to explicitly refresh scaling ---
  refreshDimensionsAndScale() {
    // Use rAF to ensure it runs after potential layout changes
    window.requestAnimationFrame(() => {
      // Add extra check for container existence before scaling
      if (this.svgContainer && this.svgDraw) {
        this._updateElementScale();
      }
    });
  }
  // --- Interaction Handlers (Blue Dot) ---
  _handleInteractionMove(interactionGroup, interactionDot, event) {
    // Prevent default scrolling on touch devices when interacting
    if (event.type === 'touchmove' || event.type === 'touchstart') {
      event.preventDefault();
    }

    const svgPoint = this.getSVGCoordinates(event);
    if (
      !svgPoint ||
      this.curveMinMinutes === null ||
      this.curveMaxMinutes === null
    ) {
      this._handleInteractionEnd(interactionGroup); // Hide if outside bounds or error
      return;
    }

    // Convert X coordinate to total minutes
    const totalMinutes = this._xToTotalMinutes(svgPoint.x);

    // Clamp time to the actual curve data range
    const clampedTotalMinutes = Math.max(
      this.curveMinMinutes,
      Math.min(this.curveMaxMinutes, totalMinutes)
    );

    // Interpolate height at the clamped time
    const height = this._interpolateHeight(clampedTotalMinutes);

    if (height !== null) {
      // Convert clamped time and interpolated height back to SVG coordinates
      const finalX = this._timeToX(clampedTotalMinutes);
      const finalY = this._heightToY(height);

      // Always move the blue dot to the interpolated position
      interactionGroup.show();
      interactionDot.center(finalX, finalY);

      // Determine if the interpolated position is close to the current time marker
      // for styling purposes only (isSnapped flag).
      let isSnapped = false;
      const snapThreshold = 10; // Pixels in SVG coordinates for proximity check
      // Check proximity for BOTH mouse and touch events
      if (this.currentTimeMarkerData) {
        const dx = finalX - this.currentTimeMarkerData.x;
        const dy = finalY - this.currentTimeMarkerData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < snapThreshold) {
          isSnapped = true; // Close enough to yellow dot for styling/scaling
        }
      }

      // Apply scaling based on snap status
      if (this.currentTimeDotElement) {
        const scaleValue = isSnapped ? 1.3 : 1.0;
        this.currentTimeDotElement.transform({
          scale: scaleValue,
          origin: 'center center',
        });
      }

      // Determine which data to show in the tooltip based on snap status
      let tooltipX, tooltipY, tooltipTimeValue, tooltipHeightValue;

      if (isSnapped && this.currentTimeMarkerData) {
        // Use yellow dot's data when snapped
        tooltipX = this.currentTimeMarkerData.x;
        tooltipY = this.currentTimeMarkerData.y;
        tooltipTimeValue = this.currentTimeMarkerData.totalMinutes; // Use raw minutes for consistency if needed, or formatted string
        tooltipHeightValue = this.currentTimeMarkerData.height;
      } else {
        // Use interpolated data when not snapped
        tooltipX = finalX;
        tooltipY = finalY;
        tooltipTimeValue = clampedTotalMinutes;
        tooltipHeightValue = height;
      }

      // Call the card's method to update the HTML tooltip, passing snap status and correct data
      if (
        this.card &&
        typeof this.card._updateInteractionTooltip === 'function'
      ) {
        this.card._updateInteractionTooltip(
          tooltipX, // Use determined X for positioning tooltip
          tooltipY, // Use determined Y for positioning tooltip
          tooltipTimeValue, // Use determined time for content
          tooltipHeightValue, // Use determined height for content
          isSnapped // Pass the proximity flag for styling
        );
      }
    } else {
      // Hide if interpolation fails (e.g., pointer is before/after the curve time range)
      this._handleInteractionEnd(interactionGroup);
    }
  }

  _handleInteractionEnd(interactionGroup) {
    interactionGroup.hide();
    // Call the card's method to hide the HTML tooltip
    if (this.card && typeof this.card._hideInteractionTooltip === 'function') {
      this.card._hideInteractionTooltip();
    }
    // Ensure yellow dot is reset to normal scale when interaction ends
    if (this.currentTimeDotElement) {
      this.currentTimeDotElement.transform({
        scale: 1.0,
        origin: 'center center',
      });
    }
  }

  // Method to clean up resources
  destroy() {
    // Remove interaction listeners if they were bound
    if (this._boundHandleInteractionMove && this.svgContainer) {
      const overlay = this.svgContainer.querySelector(
        'rect[fill="transparent"]'
      );
      if (overlay) {
        overlay.removeEventListener(
          'mousemove',
          this._boundHandleInteractionMove
        );
        overlay.removeEventListener(
          'touchstart',
          this._boundHandleInteractionMove
        );
        overlay.removeEventListener(
          'touchmove',
          this._boundHandleInteractionMove
        );
        overlay.removeEventListener(
          'mouseleave',
          this._boundHandleInteractionEnd
        );
        overlay.removeEventListener(
          'touchend',
          this._boundHandleInteractionEnd
        );
        overlay.removeEventListener(
          'touchcancel',
          this._boundHandleInteractionEnd
        );
      }
    }
    this._boundHandleInteractionMove = null;
    this._boundHandleInteractionEnd = null;

    // Note: Listeners added directly to currentTimeDot are removed when the SVG is cleared/removed.

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.svgDraw) {
      this.svgDraw.remove(); // Remove the SVG element
      this.svgDraw = null;
    }
    this.elementsToKeepSize = [];
    this.svgContainer = null;
    this.card = null; // Remove reference to card
    this.currentTimeDotElement = null; // Clear reference
    // console.log("GraphRenderer destroyed.");
  }
}
