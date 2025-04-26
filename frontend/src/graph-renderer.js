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

    this.resizeObserver = new ResizeObserver((entries) => {
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
    // Reset drag state via card reference (if needed, or handle drag separately)
    // this.card._isDraggingDot = false;
    // this.card._originalDotPosition = null;
    // this.card._draggedPosition = null;

    const viewBoxWidth = 500;
    const viewBoxHeight = 170;

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

    // --- Current Time Marker Data ---
    const now = new Date();
    let currentTimeMarker = null;
    if (selectedDay === now.toISOString().slice(0, 10)) {
      const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
      const currentHeight = this._interpolateHeight(currentTotalMinutes);
      if (currentHeight !== null) {
        const currentX = this._timeToX(currentTotalMinutes);
        const currentY = this._heightToY(currentHeight);
        currentTimeMarker = {
          x: currentX,
          y: currentY,
          height: currentHeight,
          totalMinutes: currentTotalMinutes,
        };
      }
    }

    // --- Drawing the Actual Graph ---
    const draw = this.svgDraw;
    const locale = this.hass.language || 'en';
    const axisColor = 'var(--secondary-text-color, grey)';
    const primaryTextColor = 'var(--primary-text-color, black)';
    const curveColor = 'var(--primary-color, blue)';
    const arrowAndTextColor = 'var(--primary-text-color, white)'; // Changed to primary text color
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

    // Draw Base Elements
    draw
      .path(fillPathData)
      .fill({ color: curveColor, opacity: 0.4 })
      .stroke('none');
    draw.path(pathData).fill('none').stroke({ color: curveColor, width: 2 });

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

    // --- Draw Current Time Marker ---
    if (currentTimeMarker) {
      const dotRadius = 5;
      const dotGroup = draw.group();
      dotGroup.attr('id', 'current-time-marker');
      dotGroup.addClass('has-tooltip');
      dotGroup.addClass('draggable-dot');

      const hitAreaRadius = dotRadius * 2.5;
      const hitAreaCircle = dotGroup
        .circle(hitAreaRadius * 2)
        .center(currentTimeMarker.x, currentTimeMarker.y)
        .fill('transparent')
        .attr('cursor', 'grab');

      const dotCircle = dotGroup
        .circle(dotRadius * 2)
        .center(currentTimeMarker.x, currentTimeMarker.y)
        .fill('var(--current_tide_color)')
        .attr('pointer-events', 'none');

      const currentTimeStr = now.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
      });
      const currentHeightStr =
        currentTimeMarker.height !== null
          ? currentTimeMarker.height.toFixed(2)
          : 'N/A';

      // Store original position data on the card instance for drag/tooltip
      this.card._originalDotPosition = {
        x: currentTimeMarker.x,
        y: currentTimeMarker.y,
        timeStr: currentTimeStr,
        heightStr: currentHeightStr,
      };

      // Add event listeners (these will call methods on the card instance)
      hitAreaCircle.node.addEventListener('mouseover', (e) =>
        this.card._handleTooltipShow(e)
      );
      hitAreaCircle.node.addEventListener('mouseout', () =>
        this.card._handleTooltipHide()
      );
      hitAreaCircle.node.addEventListener('mousedown', (e) =>
        this.card._handleDragStart(e, dotGroup, dotCircle, hitAreaCircle)
      );
      hitAreaCircle.node.addEventListener(
        'touchstart',
        (e) =>
          this.card._handleDragStart(e, dotGroup, dotCircle, hitAreaCircle),
        { passive: false }
      );
    }

    // Trigger scale update after drawing
    window.requestAnimationFrame(() => {
      this._updateElementScale();
    });
  }

  // Method to clean up resources
  destroy() {
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
    // console.log("GraphRenderer destroyed.");
  }
}
