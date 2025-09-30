import { SVG, Svg, Element as SvgElement, Circle, G, Rect, Text, Path, Line } from '@svgdotjs/svg.js'; // Use types from the library itself if available
import { localizeCard } from './localize';
import {
  HomeAssistant,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
  WaterLevelTuple,
  TideEventTuple,
  GraphMargins,
  PointData,
  TideMarkerData,
  CurrentTimeMarkerData,
} from './types.js';

// Interface for the object responsible for handling tooltip updates
export interface TooltipDelegate {
  updateInteractionTooltip(
    svgX: number,
    svgY: number,
    timeMinutes: number,
    height: number,
    waterTemp: number | undefined,
    isSnapped?: boolean
  ): void;
  hideInteractionTooltip(): void;
}

/**
 * Handles the rendering of the SVG graph, including tide curves, markers, and interaction elements.
 * It uses svg.js for drawing and manages scaling of elements on resize.
 */
export class GraphRenderer {
  private tooltipDelegate: TooltipDelegate | null; // Reference to the tooltip handling delegate
  private svgContainer: HTMLDivElement | null;
  private hass: HomeAssistant | null;
  private svgDraw: Svg | null = null;
  private resizeObserver: ResizeObserver | null = null;
  // Array of SVG elements (like text, groups) that need to maintain their apparent size when the SVG viewbox scales.
  private elementsToKeepSize: Array<SvgElement | G | Text | Path | Line> = [];

  // Graph properties
  private graphMargin: GraphMargins | null = null;
  private graphWidth: number | null = null;
  private graphHeight: number | null = null;
  private pointsData: PointData[] | null = null;
  private curveMinMinutes: number | null = null;
  private curveMaxMinutes: number | null = null;
  private yDomainMin: number | null = null;
  private yDomainMax: number | null = null;  // Add yDomainMax property
  private yRange: number | null = null;
  private currentTimeMarkerData: CurrentTimeMarkerData | null = null; // Store current time marker info
  private currentTimeDotElement: Circle | null = null; // Store reference to the yellow dot SVG element
  private interactionLine: Line | null = null; // Store reference to the interaction vertical line
  private tooltipBottomSvgY: number | null = null; // Store tooltip bottom Y in SVG coords

  // Bound event handlers
  private _boundHandleInteractionMove: ((event: MouseEvent | TouchEvent) => void) | null = null;
  private _boundHandleInteractionEnd: ((event: MouseEvent | TouchEvent) => void) | null = null;


  /**
   * Constructs a new GraphRenderer instance.
   * @param tooltipDelegate An object conforming to TooltipDelegate, responsible for showing/hiding HTML tooltips.
   * @param svgContainer The HTMLDivElement where the SVG graph will be rendered.
   * @param hass The HomeAssistant object, used for localization and accessing theme variables.
   */
  constructor(
    tooltipDelegate: TooltipDelegate,
    svgContainer: HTMLDivElement,
    hass: HomeAssistant | null
  ) {
    this.tooltipDelegate = tooltipDelegate;
    this.svgContainer = svgContainer;
    this.hass = hass;

    this._initializeSvg();
    this._setupResizeObserver();
  }

  private _initializeSvg(): void {
    if (this.svgContainer) {
      // Clear previous SVG content if any
      while (this.svgContainer.firstChild) {
        this.svgContainer.removeChild(this.svgContainer.firstChild);
      }
      // Initialize svg.js instance with viewBox for scaling
      // Use type assertion if SVG() return type is not specific enough
      this.svgDraw = SVG().addTo(this.svgContainer).viewbox(0, 0, 500, 190) as Svg;
    } else {
      console.error(
        'GraphRenderer: SVG container not provided during initialization.'
      );
    }
  }

  // --- Coordinate/Interpolation Helper Methods ---
  private _timeToX(totalMinutes: number): number {
    if (!this.graphMargin || this.graphWidth === null) return 0;
    return this.graphMargin.left + (totalMinutes / (24 * 60)) * this.graphWidth;
  }

  private _heightToY(h: number): number {
    if (
      !this.graphMargin ||
      this.graphHeight === null ||
      this.yDomainMin === null ||
      this.yDomainMax === null ||
      !this.yRange
    )
      return 0;
    return (
      this.graphMargin.top +
      this.graphHeight -
      ((h - this.yDomainMin) / this.yRange) * this.graphHeight
    );
  }

  private _xToTotalMinutes(x: number): number {
    if (!this.graphMargin || this.graphWidth === null || this.graphWidth <= 0) return 0;
    const clampedX = Math.max(
      this.graphMargin.left,
      Math.min(this.graphMargin.left + this.graphWidth, x)
    );
    return ((clampedX - this.graphMargin.left) / this.graphWidth) * (24 * 60);
  }

  private _interpolateHeight(targetTotalMinutes: number): number | null {
    if (!this.pointsData || this.pointsData.length < 2) return null;
    let prevPoint: PointData | null = null;
    let nextPoint: PointData | null = null;
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
    if (!prevPoint || !nextPoint) return null;

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
  private getSVGCoordinates(evt: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if (!this.svgDraw || !this.svgContainer) return null;

    const svg = this.svgContainer.querySelector('svg');
    if (!svg) return null;

    // Create an SVGPoint for transformations
    const pt = svg.createSVGPoint();

    // Get the screen coordinates from the event
    if (typeof TouchEvent !== 'undefined' && evt instanceof TouchEvent && evt.touches && evt.touches.length > 0) {
      pt.x = evt.touches[0].clientX;
      pt.y = evt.touches[0].clientY;
    } else if (evt instanceof MouseEvent && evt.clientX !== undefined && evt.clientY !== undefined) {
      pt.x = evt.clientX;
      pt.y = evt.clientY;
    } else {
      return null; // No coordinates found
    }

    // Transform the screen coordinates to SVG coordinates
    try {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const svgPoint = pt.matrixTransform(ctm.inverse());
      return { x: svgPoint.x, y: svgPoint.y };
    } catch (e) {
      console.error('Error transforming screen coordinates to SVG:', e);
      return null;
    }
  }

  // --- Resize Observer Logic ---
  private _setupResizeObserver(): void {
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
      window.requestAnimationFrame(() => {
        this._updateElementScale();
      });
    });
    this.resizeObserver.observe(this.svgContainer);
  }

  private _updateElementScale(): void {
    if (
      !this.svgContainer ||
      !this.svgDraw ||
      this.elementsToKeepSize.length === 0
    ) {
      return;
    }

    const svgRect = this.svgContainer.getBoundingClientRect();
    const viewBox = this.svgDraw.viewbox();
    // Use default if viewBox is somehow null/undefined
    const viewBoxWidth = viewBox?.width ?? 500;

    if (svgRect.width <= 0 || viewBoxWidth <= 0) {
      return;
    }

    const scaleFactor = svgRect.width / viewBoxWidth;

    if (scaleFactor <= 0 || !isFinite(scaleFactor)) {
      return;
    }

    const inverseScale = 1 / scaleFactor;

    // Filter out potentially disconnected elements
    this.elementsToKeepSize = this.elementsToKeepSize.filter(
      (element) =>
        element &&
        element.node?.isConnected && // Check if node is connected
        element instanceof SvgElement && typeof element.bbox === 'function' // Check if bbox method exists
    );

    this.elementsToKeepSize.forEach((element) => {
      try {
        // Use 'any' assertion if bbox() is not recognized on the specific type
        const bbox = (element as SvgElement).bbox();
        if (!bbox) return;

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

        // Use 'any' assertion for transform methods if needed
        (element as SvgElement)
          .transform({})
          .translate(cx, cy)
          .scale(inverseScale)
          .translate(-cx, -cy);
      } catch (e) {
        console.error('GraphRenderer: Error scaling element:', e, element);
      }
    });
  }

  /**
   * Clears and redraws the entire SVG graph based on the provided data.
   * This includes the tide curve, tide event markers, current time marker, and interaction layer.
   * @param tideData Data for tide events (high/low tides, coefficients).
   * @param waterLevels Data for water levels throughout the day.
   * @param selectedDay The currently selected day string (YYYY-MM-DD) for which to draw the graph.
   */
  public drawGraph(
    tideData: GetTidesDataResponseData | null,
    waterLevels: GetWaterLevelsResponseData | null,
    selectedDay: string
  ): void {
    if (!this.svgDraw || !this.svgContainer || !this.hass) {
      return;
    }

    this.svgDraw.clear();
    this.elementsToKeepSize = [];
    this.currentTimeDotElement = null; // Reset dot reference
    this.currentTimeMarkerData = null; // Reset marker data
    this.tooltipBottomSvgY = null; // Reset tooltip bottom Y coordinate

    const viewBoxWidth = 500;
    const viewBoxHeight = 190;
    const locale = this.hass.language || 'en';

    // --- 1. Check for Errors or Missing Data ---
    if (!tideData || typeof tideData !== 'object') {
      // Handle null, undefined, or non-object responses
      const errorMessage = localizeCard('ui.card.marees_france.no_tide_data', this.hass);
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    } else if ('error' in tideData && tideData.error) {
      // Handle responses that are objects but contain an error property
      const errorMessage = `Tide Error: ${tideData.error}`;
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }

    if (!waterLevels || typeof waterLevels !== 'object') {
       // Handle null, undefined, or non-object responses
      const errorMessage = localizeCard('ui.card.marees_france.no_water_level_data', this.hass);
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    } else if ('error' in waterLevels && waterLevels.error) {
      // Handle responses that are objects but contain an error property
      const errorMessage = `Water Level Error: ${waterLevels.error}`;
      const errorText = this.svgDraw
        .text(errorMessage)
        .move(viewBoxWidth / 2, viewBoxHeight / 2)
        .font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }

    const levelsData: WaterLevelTuple[] | undefined = waterLevels[selectedDay];

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
    this.graphMargin = { top: 55, right: 15, bottom: 27.2, left: 15 };
    this.graphWidth =
      viewBoxWidth - this.graphMargin.left - this.graphMargin.right;
    this.graphHeight =
      viewBoxHeight - this.graphMargin.top - this.graphMargin.bottom;

    // --- Process Data ---
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    this.pointsData = levelsData
      .map((item: WaterLevelTuple): PointData | null => {
        const timeStr = item[0];
        const heightNum = parseFloat(item[1]);
        if (isNaN(heightNum) || !timeStr || !timeStr.includes(':')) return null; // Add check for timeStr format
        const [hours, minutes] = timeStr.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return null; // Check parsing result
        const totalMinutes = hours * 60 + minutes;
        minHeight = Math.min(minHeight, heightNum);
        maxHeight = Math.max(maxHeight, heightNum);
        return { totalMinutes, heightNum };
      })
      .filter((p): p is PointData => p !== null); // Use type predicate

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

    // Constants for Y-axis scaling
    const DEFAULT_Y_PADDING_METERS = 0.2; // Standard padding
    const TEXT_SPACING = 16; // Pixels for text spacing from curve
    const MIN_RANGE_RATIO = 1.2; // Minimum ratio between max and min height

    // --- Y-Axis Scaling: Center Median Height ---

    // 1. Calculate Key Heights
    const medianHeight = (minHeight + maxHeight) / 2;

    // 2. Determine Necessary `halfSpan` for Y-Axis
    // Span for Data & Padding
    const spanToCoverMax = (maxHeight + DEFAULT_Y_PADDING_METERS) - medianHeight;
    const spanToCoverMin = medianHeight - Math.max(0, minHeight - DEFAULT_Y_PADDING_METERS);
    const dataRequiredHalfSpan = Math.max(spanToCoverMax, spanToCoverMin, 0.005); // Miniscule default if all heights are equal

    // Span for MIN_RANGE_RATIO
    const minTotalSpanFromRatio = (maxHeight > 0) ? maxHeight / MIN_RANGE_RATIO : 0.01; // Ensure maxHeight > 0
    const minRatioHalfSpan = minTotalSpanFromRatio / 2;

    // Final halfSpan
    const finalHalfSpan = Math.max(dataRequiredHalfSpan, minRatioHalfSpan);

    // 3. Set Initial `yDomainMin` and `yDomainMax` Centered on `medianHeight`
    this.yDomainMin = medianHeight - finalHalfSpan;
    this.yDomainMax = medianHeight + finalHalfSpan;

    // 4. Adjust if `this.yDomainMin` is Below Zero
    if (this.yDomainMin < 0) {
      const shiftAmount = -this.yDomainMin;
      this.yDomainMin = 0;
      this.yDomainMax += shiftAmount;
    }

    // 5. Adjust for Text Spacing Below Low Tides (Symmetrically)
    // This ensures enough space for text labels below the curve if minHeight is close to yDomainMin.
    let currentRangeForTextCalc = this.yDomainMax - this.yDomainMin;
    const textSpacingInMeters = (this.graphHeight !== null && this.graphHeight > 0 && currentRangeForTextCalc > 0)
                                  ? (TEXT_SPACING / this.graphHeight) * currentRangeForTextCalc
                                  : 0;
    const targetMinDomainForText = Math.max(0, minHeight - textSpacingInMeters);

    if (this.yDomainMin > targetMinDomainForText) { // yDomainMin is too high, not enough space
      const adjustmentNeeded = this.yDomainMin - targetMinDomainForText;
      this.yDomainMin -= adjustmentNeeded;
      this.yDomainMax += adjustmentNeeded; // Symmetrically adjust yDomainMax
    }

    // 6. Calculate Final `this.yRange`
    this.yRange = this.yDomainMax - this.yDomainMin;
    this.yRange = Math.max(0.01, this.yRange); // Ensure non-zero range

    // --- Generate SVG Path Data Strings ---
    // Calculate Y coordinate for height = 0 (sea level) - used for both fill path and axis labels

    const pathData = this.pointsData
      .map((p, index) => {
        const x = this._timeToX(p.totalMinutes);
        const y = this._heightToY(p.heightNum);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

    const firstPointX = this._timeToX(this.pointsData[0].totalMinutes);
    const lastPointX = this._timeToX(
      this.pointsData[this.pointsData.length - 1].totalMinutes
    );
    const fillAreaBottomY = this.graphMargin!.top + this.graphHeight!;
    const fillPathData = `M ${firstPointX.toFixed(2)} ${fillAreaBottomY.toFixed(2)} ${pathData.replace(/^M/, 'L')} L ${lastPointX.toFixed(2)} ${fillAreaBottomY.toFixed(2)} Z`;

    // --- Calculate Ticks and Markers Data ---
    const xTicks: { x: number; label: string }[] = [];
    const xLabelStep = 480; // minutes (8 hours)
    for (
      let totalMinutes = 0;
      totalMinutes <= 24 * 60;
      totalMinutes += xLabelStep
    ) {
      // Ensure the last tick (24:00) is handled correctly
      const effectiveMinutes = totalMinutes === 1440 ? 1439.99 : totalMinutes;
      const x = this._timeToX(effectiveMinutes);
      const hour = Math.floor(totalMinutes / 60);
      const label =
        hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`;
      xTicks.push({ x: x, label: label });
    }

    const tideEventsForDay: TideEventTuple[] | undefined = tideData[selectedDay];
    const tideMarkers: TideMarkerData[] = [];
    if (Array.isArray(tideEventsForDay)) {
      tideEventsForDay.forEach((tideArr: TideEventTuple) => {
        if (!Array.isArray(tideArr) || tideArr.length < 3) return;
        const typeStr = tideArr[0];
        const time = tideArr[1];
        const height = parseFloat(tideArr[2]);
        const coefficient =
          tideArr.length > 3 && tideArr[3] !== '---'
            ? parseInt(tideArr[3], 10)
            : null;
        const isHigh = typeStr === 'tide.high' || typeStr === 'tide_high';
        const isLow = typeStr === 'tide.low' || typeStr === 'tide_low';

        if ((!isHigh && !isLow) || !time || isNaN(height) || !time.includes(':')) return;

        const [hours, minutes] = time.split(':').map(Number);
         if (isNaN(hours) || isNaN(minutes)) return; // Check parsing result
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
    let localCurrentTimeMarkerData: CurrentTimeMarkerData | null = null; // Use local var for drawing
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
          const currentTimeStr = now.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
          });
          const currentHeightStr = currentHeight.toFixed(2);
          // Store data for snapping logic
          this.currentTimeMarkerData = {
            x: currentX,
            y: currentY,
            timeStr: currentTimeStr,
            heightStr: currentHeightStr,
            totalMinutes: currentTotalMinutes,
            height: currentHeight,
          };
          localCurrentTimeMarkerData = this.currentTimeMarkerData; // Assign to local var
        }
      }
    }

    // --- Drawing the Actual Graph ---
    const draw = this.svgDraw; // Already checked for null
    const axisColor = 'var(--secondary-text-color, grey)';
    const primaryTextColor = 'var(--primary-text-color, black)';
    const curveColor = 'var(--primary-color, blue)';
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
    const coefLineToPeakGap = 10; // Increased from 3 for better visual separation
    const dotRadius = 6; // 12px diameter

    // Draw Base Elements with anti-aliasing
    draw
      .path(fillPathData)
      .fill({ color: curveColor, opacity: 0.4 })
      .stroke('none')
      .attr('shape-rendering', 'geometricPrecision')
      .attr('vector-effect', 'non-scaling-stroke');
    draw
      .path(pathData)
      .fill('none')
      .stroke({ color: curveColor, width: 2 })
      .attr('shape-rendering', 'geometricPrecision')
      .attr('vector-effect', 'non-scaling-stroke');

    // --- Interaction Elements (Hover/Touch for Blue Dot) ---
    const interactionGroup = draw
      .group()
      .attr('id', 'interaction-indicator')
       .hide() as G; // Type assertion
    // Add the vertical dotted line FIRST
    this.interactionLine = interactionGroup
      .line(0, 0, 0, 0) // Initial dummy coordinates
      // Revert to primary text color
      .stroke({ color: 'var(--primary-text-color, black)', width: 1, dasharray: '2,2' })
      .attr('pointer-events', 'none')
      .attr('vector-effect', 'non-scaling-stroke') as Line; // Type assertion
    // Add the dot SECOND, so it's drawn on top
    const interactionDot = interactionGroup
      .circle(dotRadius * 2) // Use same radius as yellow dot
      .fill('var(--info-color, blue)')
      .attr('pointer-events', 'none') as Circle; // Type assertion

    // Draw X Axis Labels (at height = 0, using previously calculated yOfZero)
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
          .move(tick.x, viewBoxHeight - (axisFontSize * 0.8)); // Position labels relative to 0-meter line
        this.elementsToKeepSize.push(textEl);
      }
    });

    // --- Draw Tide Markers ---
    tideMarkers.forEach((marker) => {
      try { // Add try block for the entire marker
        // Coefficient Group
        if (marker.isHigh && marker.coefficient !== null) { // Check for null coefficient
          try { // Add specific try-catch for coefficient box
            const coefGroup = draw.group() as G;
            const coefText = String(marker.coefficient);
            // Use a temporary text element to measure size accurately
            const tempText = draw
              .text(coefText)
              .font({ size: coefFontSize, weight: 'bold', anchor: 'middle' })
              .attr('dominant-baseline', 'central')
              .opacity(0); // Make it invisible
            const textBBox = tempText.bbox(); // tempText is Text, which has bbox()
            tempText.remove(); // Remove temporary element

            if (!textBBox || isNaN(textBBox.width) || isNaN(textBBox.height) || isNaN(marker.x)) {
              console.error("GraphRenderer: Invalid bbox or marker.x for coefficient marker", marker, textBBox);
              return; // Skip this coefficient marker if bbox or x is invalid
            }

            const boxWidth = textBBox.width + 2 * coefBoxPadding.x;
            const boxHeight = textBBox.height + 2 * coefBoxPadding.y;
            const boxX = marker.x - boxWidth / 2;
            const boxY = coefBoxTopMargin;

            if (isNaN(boxX) || isNaN(boxY) || isNaN(boxWidth) || isNaN(boxHeight)) {
               console.error("GraphRenderer: NaN detected in coefficient box dimensions/position", marker, textBBox);
               return; // Skip drawing this box
            }

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

            if (isNaN(lineStartY) || isNaN(lineEndY) || isNaN(marker.x)) {
                console.error("GraphRenderer: NaN detected in coefficient line coordinates", marker);
                // Don't draw the line, but the box/text might be okay
            } else if (lineEndY !== lineStartY) { // Draw if endpoints are different, effectively always if valid
              // Connects the bottom of the coefficient box (lineStartY)
              // to the point just above the tide peak (lineEndY)
              coefGroup
                .line(marker.x, lineStartY, marker.x, lineEndY)
                .stroke({ color: coefLineColor, width: 1, dasharray: '2,2' })
                .attr('vector-effect', 'non-scaling-stroke');
            }
            this.elementsToKeepSize.push(coefGroup);
          } catch (coefError) {
             console.error("GraphRenderer: Error drawing coefficient marker:", coefError, marker);
             // Continue to draw arrow/text if possible
          }
        }

        // Arrow & Text Group
        try { // Add specific try-catch for arrow/text
          // Use consistent spacing for both high and low tides
          const TEXT_SPACING = 10; // Standard spacing from curve for both high and low
          const arrowYOffset = marker.isHigh ? arrowSize * 2.1 : -arrowSize * 2.1; // Same magnitude for both
          const textLineHeight = tideTimeFontSize * 1.2; // Slightly increased for better readability
          const arrowGroup = draw.group() as G;

          let arrowPathData: string;
          const arrowY = marker.y + arrowYOffset;
          // Arrow path with consistent proportions
          if (marker.isHigh) {
            arrowPathData = `M ${marker.x - arrowSize / 2},${arrowY + arrowSize * 0.4} L ${marker.x + arrowSize / 2},${arrowY + arrowSize * 0.4} L ${marker.x},${arrowY - arrowSize * 0.4} Z`;
          } else {
            arrowPathData = `M ${marker.x - arrowSize / 2},${arrowY - arrowSize * 0.4} L ${marker.x + arrowSize / 2},${arrowY - arrowSize * 0.4} L ${marker.x},${arrowY + arrowSize * 0.4} Z`;
          }

          if (isNaN(marker.x) || isNaN(arrowY)) {
             console.error("GraphRenderer: NaN detected in arrow path coordinates", marker);
             return; // Skip drawing arrow/text for this marker
          }

          arrowGroup.path(arrowPathData).fill(primaryTextColor).stroke('none');

          let timeTextY: number, heightTextY: number;
          const arrowTipOffset = arrowSize * 0.4;

          if (marker.isHigh) { // Arrow points up, text below
            const arrowTipY = arrowY - arrowTipOffset;
            timeTextY = arrowTipY + TEXT_SPACING;
            heightTextY = timeTextY + textLineHeight;
          } else { // Arrow points down, text above
            const arrowTipY = arrowY + arrowTipOffset;
            heightTextY = arrowTipY - TEXT_SPACING - textLineHeight;
            timeTextY = heightTextY - textLineHeight;
          }

          if (isNaN(timeTextY) || isNaN(heightTextY) || isNaN(marker.x)) {
             console.error("GraphRenderer: NaN detected in text position calculation", marker);
             return; // Skip drawing text for this marker
          }

          arrowGroup
            .text(marker.time)
            .font({ fill: primaryTextColor, size: tideTimeFontSize, weight: 'bold' })
            .attr('text-anchor', 'middle')
            .cx(marker.x)
            .y(timeTextY);

          arrowGroup // Changed from coefGroup to arrowGroup
            .text(`${marker.height.toFixed(1)}m`)
            .font({ fill: primaryTextColor, size: tideHeightFontSize })
            .attr('text-anchor', 'middle')
            .cx(marker.x)
            .y(heightTextY);

          this.elementsToKeepSize.push(arrowGroup);
        } catch (arrowTextError) {
           console.error("GraphRenderer: Error drawing arrow/text marker:", arrowTextError, marker);
           // Continue to next marker
        }
      } catch (markerError) {
        console.error("GraphRenderer: Error processing tide marker:", markerError, marker);
        // Continue to the next marker
      }
    });

    // --- Draw Static Current Time Marker (Yellow Dot) ---
    if (localCurrentTimeMarkerData) {
      this.currentTimeDotElement = draw
        .circle(dotRadius * 2) // 12px diameter
        .center(localCurrentTimeMarkerData.x, localCurrentTimeMarkerData.y)
        .fill('var(--tide-icon-color)') // Use the specific yellow color
        .attr('pointer-events', 'none') as Circle; // Type assertion
    }

    // --- Interaction Overlay (Draw LAST to be on top) ---
    const interactionOverlay = draw
      .rect(this.graphWidth, this.graphHeight)
      .move(this.graphMargin.left, this.graphMargin.top)
      .fill('transparent')
      .attr('cursor', 'crosshair') as Rect; // Type assertion

    // Always rebind interaction handlers when drawing a new graph
    // This ensures they reference the current interactionGroup
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
      this._boundHandleInteractionMove as EventListener // Cast needed
    );
    interactionOverlay.node.addEventListener(
      'touchstart',
      this._boundHandleInteractionMove as EventListener, // Cast needed
      { passive: false }
    );
    interactionOverlay.node.addEventListener(
      'touchmove',
      this._boundHandleInteractionMove as EventListener, // Cast needed
      { passive: false }
    );
    interactionOverlay.node.addEventListener(
      'mouseleave',
      this._boundHandleInteractionEnd as EventListener // Cast needed
    );
    interactionOverlay.node.addEventListener(
      'touchend',
      this._boundHandleInteractionEnd as EventListener // Cast needed
    );
    interactionOverlay.node.addEventListener(
      'touchcancel',
      this._boundHandleInteractionEnd as EventListener // Cast needed
    );

    // Trigger scale update after drawing
    window.requestAnimationFrame(() => {
      this._updateElementScale();
    });
  }

  /**
   * Explicitly triggers a refresh of element scaling.
   * Useful if the container size changes outside of a normal resize event.
   */
  public refreshDimensionsAndScale(): void {
    // Use rAF to ensure it runs after potential layout changes
    window.requestAnimationFrame(() => {
      // Add extra check for container existence before scaling
      if (this.svgContainer && this.svgDraw) {
        this._updateElementScale();
      }
    });
  }

  // --- Interaction Handlers (Blue Dot) ---
  private _handleInteractionMove(
      interactionGroup: G,
      interactionDot: Circle,
      event: MouseEvent | TouchEvent
  ): void {
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

      // Determine if the interpolated position is close to the current time marker (MUST be calculated first)
      let isSnapped = false;
      const snapThreshold = 10; // Pixels in SVG coordinates for proximity check
      if (this.currentTimeMarkerData) {
        const dx = finalX - this.currentTimeMarkerData.x;
        const dy = finalY - this.currentTimeMarkerData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < snapThreshold) {
          isSnapped = true;
        }
      }

      // Apply scaling based on snap status
      if (this.currentTimeDotElement) {
        const scaleValue = isSnapped ? 1.3 : 1.0;
        // Use assertion if transform is not typed
        this.currentTimeDotElement.transform({
          scale: scaleValue,
          origin: 'center center',
        });
      }

      // Update the vertical line position, considering snap status
      if (this.interactionLine) {
        let lineStartX: number, lineStartY: number;

        // Use yellow dot coords if snapped, otherwise use interpolated coords
        if (isSnapped && this.currentTimeMarkerData) {
          lineStartX = this.currentTimeMarkerData.x;
          lineStartY = this.currentTimeMarkerData.y;
        } else {
          lineStartX = finalX;
          lineStartY = finalY;
        }

        // If tooltipBottomSvgY is valid, use it; otherwise, use a default value
        const lineEndX = lineStartX; // Line is vertical
        const lineEndY = (this.tooltipBottomSvgY !== null && this.tooltipBottomSvgY > 0)
          ? this.tooltipBottomSvgY
          : this.graphMargin?.top || 0; // Default to top of graph area

        // Ensure line doesn't go below the starting point if tooltip is lower
        const plotY2 = Math.min(lineStartY, lineEndY);

        this.interactionLine.plot(lineStartX, lineStartY, lineEndX, plotY2); // x1, y1, x2, y2
      }

      // Determine which data to show in the tooltip based on snap status
      let tooltipX: number,
        tooltipY: number,
        tooltipTimeValue: number,
        tooltipHeightValue: number,
        tooltipWaterTempValue: number | undefined;

      if (isSnapped && this.currentTimeMarkerData) {
        // Use yellow dot's data when snapped
        tooltipX = this.currentTimeMarkerData.x;
        tooltipY = this.currentTimeMarkerData.y;
        tooltipTimeValue = this.currentTimeMarkerData.totalMinutes;
        tooltipHeightValue = this.currentTimeMarkerData.height;
        tooltipWaterTempValue = this.currentTimeMarkerData.water_temp;
      } else {
        // Use interpolated data when not snapped
        tooltipX = finalX;
        tooltipY = finalY;
        tooltipTimeValue = clampedTotalMinutes;
        tooltipHeightValue = height;
        tooltipWaterTempValue = undefined; // Not available for interpolated points
      }

      // Call the delegate's method to update the HTML tooltip
      if (this.tooltipDelegate) {
        this.tooltipDelegate.updateInteractionTooltip(
          tooltipX,
          tooltipY,
          tooltipTimeValue,
          tooltipHeightValue,
          tooltipWaterTempValue,
          isSnapped
        );
      }
    } else {
      // Hide if interpolation fails
      this._handleInteractionEnd(interactionGroup);
    }
  }

  private _handleInteractionEnd(interactionGroup: G): void {
    interactionGroup.hide();
    // Call the delegate's method to hide the HTML tooltip
    if (this.tooltipDelegate) {
      this.tooltipDelegate.hideInteractionTooltip();
    }
    // Ensure yellow dot is reset to normal scale when interaction ends
    if (this.currentTimeDotElement) {
       // Use assertion if transform is not typed
      this.currentTimeDotElement.transform({
        scale: 1.0,
        origin: 'center center',
      });
    }
  }

  /**
   * Cleans up all resources used by the GraphRenderer.
   * This includes removing event listeners, disconnecting observers, and removing the SVG element.
   * Should be called when the card is disconnected or the renderer is no longer needed.
   */
  public destroy(): void {
    // Remove interaction listeners if they were bound
    if (this._boundHandleInteractionMove && this.svgContainer) {
      const overlay = this.svgContainer.querySelector(
        'rect[fill="transparent"]'
      );
      if (overlay) {
        overlay.removeEventListener(
          'mousemove',
          this._boundHandleInteractionMove as EventListener
        );
        overlay.removeEventListener(
          'touchstart',
          this._boundHandleInteractionMove as EventListener
        );
        overlay.removeEventListener(
          'touchmove',
          this._boundHandleInteractionMove as EventListener
        );
        overlay.removeEventListener(
          'mouseleave',
          this._boundHandleInteractionEnd as EventListener
        );
        overlay.removeEventListener(
          'touchend',
          this._boundHandleInteractionEnd as EventListener
        );
        overlay.removeEventListener(
          'touchcancel',
          this._boundHandleInteractionEnd as EventListener
        );
      }
    
    } // End of if (_boundHandleInteractionMove && svgContainer)
    this._boundHandleInteractionMove = null;
    this._boundHandleInteractionEnd = null;

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
    this.tooltipDelegate = null; // Remove reference to delegate
    this.currentTimeDotElement = null; // Clear reference
    this.interactionLine = null; // Clear reference
    this.tooltipBottomSvgY = null; // Clear reference
    this.yDomainMax = null; // Clear yDomainMax reference
  } // End of destroy method

  /**
   * Allows the tooltip delegate (GraphInteractionManager) to inform the renderer
   * about the bottom Y-coordinate of the HTML tooltip in SVG space.
   * This is used to draw the vertical interaction line correctly up to the tooltip.
   * @param svgY The Y-coordinate of the tooltip's bottom edge in SVG coordinate space.
   */
  public setTooltipBottomY(svgY: number): void {
    this.tooltipBottomSvgY = svgY;
  }
} // End of GraphRenderer class