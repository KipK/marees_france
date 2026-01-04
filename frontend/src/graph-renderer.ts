import { SVG, Svg, Element as SvgElement, Circle, G, Rect, Text, Path, Line } from '@svgdotjs/svg.js';
import { localizeCard } from './localize';
import {
  HomeAssistant,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
  GetWaterTempResponseData,
  GetHarborMinDepthResponseData,
  WaterLevelTuple,
  TideEventTuple,
  GraphMargins,
  PointData,
  CurrentTimeMarkerData,
} from './types.js';

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

export class GraphRenderer {
  private tooltipDelegate: TooltipDelegate | null;
  private svgContainer: HTMLDivElement | null;
  private hass: HomeAssistant | null;
  private svgDraw: Svg | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private elementsToKeepSize: Array<SvgElement | G | Text | Path | Line> = [];
  private graphMargin: GraphMargins | null = null;
  private graphWidth: number | null = null;
  private graphHeight: number | null = null;
  private pointsData: PointData[] | null = null;
  private curveMinMinutes: number | null = null;
  private curveMaxMinutes: number | null = null;
  private yDomainMin: number | null = null;
  private yDomainMax: number | null = null;
  private yRange: number | null = null;
  private waterTempData: GetWaterTempResponseData | null = null;
  private harborMinDepth: GetHarborMinDepthResponseData | null = null;
  private currentTimeMarkerData: CurrentTimeMarkerData | null = null;
  private currentTimeDotElement: Circle | null = null;
  private interactionLine: Line | null = null;
  private tooltipBottomSvgY: number | null = null;
  private _boundHandleInteractionMove: ((event: MouseEvent | TouchEvent) => void) | null = null;
  private _boundHandleInteractionEnd: ((event: MouseEvent | TouchEvent) => void) | null = null;

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
      while (this.svgContainer.firstChild) {
        this.svgContainer.removeChild(this.svgContainer.firstChild);
      }
      this.svgDraw = SVG().addTo(this.svgContainer).viewbox(0, 0, 500, 190) as Svg;
    } else {
      console.error('GraphRenderer: SVG container not provided during initialization.');
    }
  }

  private _timeToX(totalMinutes: number): number {
    if (!this.graphMargin || this.graphWidth === null) return 0;
    return this.graphMargin.left + (totalMinutes / (24 * 60)) * this.graphWidth;
  }

  private _heightToY(h: number): number {
    if (!this.graphMargin || this.graphHeight === null || this.yDomainMin === null || this.yDomainMax === null || !this.yRange) return 0;
    return this.graphMargin.top + this.graphHeight - ((h - this.yDomainMin) / this.yRange) * this.graphHeight;
  }

  private _xToTotalMinutes(x: number): number {
    if (!this.graphMargin || this.graphWidth === null || this.graphWidth <= 0) return 0;
    const clampedX = Math.max(this.graphMargin.left, Math.min(this.graphMargin.left + this.graphWidth, x));
    return ((clampedX - this.graphMargin.left) / this.graphWidth) * (24 * 60);
  }

  private _interpolateHeight(targetTotalMinutes: number): number | null {
    if (!this.pointsData || this.pointsData.length < 2) return null;
    let prevPoint: PointData | null = null;
    let nextPoint: PointData | null = null;
    for (let i = 0; i < this.pointsData.length; i++) {
      if (this.pointsData[i].totalMinutes <= targetTotalMinutes) prevPoint = this.pointsData[i];
      if (this.pointsData[i].totalMinutes > targetTotalMinutes) {
        nextPoint = this.pointsData[i];
        break;
      }
    }
    if (!prevPoint && nextPoint) return nextPoint.heightNum;
    if (prevPoint && !nextPoint) return prevPoint.heightNum;
    if (!prevPoint || !nextPoint) return null;
    const timeDiff = nextPoint.totalMinutes - prevPoint.totalMinutes;
    if (timeDiff <= 0) return prevPoint.heightNum;
    const timeProgress = (targetTotalMinutes - prevPoint.totalMinutes) / timeDiff;
    return prevPoint.heightNum + (nextPoint.heightNum - prevPoint.heightNum) * timeProgress;
  }

  private _interpolateWaterTemp(targetTotalMinutes: number): number | null {
    if (!this.waterTempData || !this.svgDraw) return null;
    const selectedDay = this.svgDraw.node.dataset.day;
    if (!selectedDay || !this.waterTempData[selectedDay]) return null;
    const dailyTemps = this.waterTempData[selectedDay].map(item => {
      const [hours, minutes] = item.datetime.split('T')[1].split(':').map(Number);
      return { totalMinutes: hours * 60 + minutes, temp: item.temp };
    }).sort((a, b) => a.totalMinutes - b.totalMinutes);
    if (dailyTemps.length < 2) return dailyTemps[0]?.temp ?? null;
    let prevTemp: { totalMinutes: number, temp: number } | null = null;
    let nextTemp: { totalMinutes: number, temp: number } | null = null;
    for (let i = 0; i < dailyTemps.length; i++) {
      if (dailyTemps[i].totalMinutes <= targetTotalMinutes) prevTemp = dailyTemps[i];
      if (dailyTemps[i].totalMinutes > targetTotalMinutes) {
        nextTemp = dailyTemps[i];
        break;
      }
    }
    if (!prevTemp && nextTemp) return nextTemp.temp;
    if (prevTemp && !nextTemp) return prevTemp.temp;
    if (!prevTemp || !nextTemp) return null;
    const timeDiff = nextTemp.totalMinutes - prevTemp.totalMinutes;
    if (timeDiff <= 0) return prevTemp.temp;
    const timeProgress = (targetTotalMinutes - prevTemp.totalMinutes) / timeDiff;
    return prevTemp.temp + (nextTemp.temp - prevTemp.temp) * timeProgress;
  }

  private getSVGCoordinates(evt: MouseEvent | TouchEvent): { x: number; y: number } | null {
    if (!this.svgDraw || !this.svgContainer) return null;
    const svg = this.svgContainer.querySelector('svg');
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    if (typeof TouchEvent !== 'undefined' && evt instanceof TouchEvent && evt.touches && evt.touches.length > 0) {
      pt.x = evt.touches[0].clientX;
      pt.y = evt.touches[0].clientY;
    } else if (evt instanceof MouseEvent && evt.clientX !== undefined && evt.clientY !== undefined) {
      pt.x = evt.clientX;
      pt.y = evt.clientY;
    } else {
      return null;
    }
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

  private _setupResizeObserver(): void {
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (!this.svgContainer) {
      console.warn('GraphRenderer: Cannot setup ResizeObserver, SVG container not found.');
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => this._updateElementScale());
    });
    this.resizeObserver.observe(this.svgContainer);
  }

  private _updateElementScale(): void {
    if (!this.svgContainer || !this.svgDraw || this.elementsToKeepSize.length === 0) return;
    const svgRect = this.svgContainer.getBoundingClientRect();
    const viewBox = this.svgDraw.viewbox();
    const viewBoxWidth = viewBox?.width ?? 500;
    if (svgRect.width <= 0 || viewBoxWidth <= 0) return;
    const scaleFactor = svgRect.width / viewBoxWidth;
    if (scaleFactor <= 0 || !isFinite(scaleFactor)) return;
    const inverseScale = 1 / scaleFactor;
    this.elementsToKeepSize = this.elementsToKeepSize.filter(el => el && el.node?.isConnected && el instanceof SvgElement && typeof el.bbox === 'function');
    this.elementsToKeepSize.forEach(element => {
      try {
        const bbox = (element as SvgElement).bbox();
        if (!bbox) return;
        const { cx, cy } = bbox;
        if (isNaN(cx) || isNaN(cy)) {
          console.warn('GraphRenderer: Invalid bbox center for scaling element:', element, bbox);
          return;
        }
        (element as SvgElement).transform({}).translate(cx, cy).scale(inverseScale).translate(-cx, -cy);
      } catch (e) {
        console.error('GraphRenderer: Error scaling element:', e, element);
      }
    });
  }

  public drawGraph(
    tideData: GetTidesDataResponseData | null,
    waterLevels: GetWaterLevelsResponseData | null,
    waterTemp: GetWaterTempResponseData | null,
    selectedDay: string,
    harborMinDepth: GetHarborMinDepthResponseData | null,
  ): void {
    if (!this.svgDraw || !this.svgContainer || !this.hass) return;
    this.svgDraw.clear();
    this.svgDraw.node.dataset.day = selectedDay;
    this.waterTempData = waterTemp;
    this.harborMinDepth = harborMinDepth;
    this.elementsToKeepSize = [];
    this.currentTimeDotElement = null;
    this.currentTimeMarkerData = null;
    this.tooltipBottomSvgY = null;
    const viewBoxWidth = 500;
    const viewBoxHeight = 190;
    const locale = this.hass.language || 'en';

    if (!tideData || typeof tideData !== 'object' || ('error' in tideData && tideData.error)) {
      const msg = !tideData || !('error' in tideData) ? 'no_tide_data' : `Tide Error: ${tideData.error}`;
      const errorText = this.svgDraw.text(localizeCard(`ui.card.marees_france.${msg}`, this.hass)).move(viewBoxWidth / 2, viewBoxHeight / 2).font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }
    if (!waterLevels || typeof waterLevels !== 'object' || ('error' in waterLevels && waterLevels.error)) {
      const msg = !waterLevels || !('error' in waterLevels) ? 'no_water_level_data' : `Water Level Error: ${waterLevels.error}`;
      const errorText = this.svgDraw.text(localizeCard(`ui.card.marees_france.${msg}`, this.hass)).move(viewBoxWidth / 2, viewBoxHeight / 2).font({ fill: 'var(--error-color, red)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(errorText);
      return;
    }

    let levelsData: WaterLevelTuple[] | undefined = waterLevels[selectedDay];
    if (!Array.isArray(levelsData) || levelsData.length === 0) {
      const noDataText = this.svgDraw.text(localizeCard('ui.card.marees_france.no_data_for_day', this.hass)).move(viewBoxWidth / 2, viewBoxHeight / 2).font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle' });
      this.elementsToKeepSize.push(noDataText);
      return;
    }

    // Handle DST transition days where data is an array of arrays
    // Check if the first element is itself an array (indicating nested structure for DST)
    if (levelsData.length > 0 && Array.isArray(levelsData[0]) && Array.isArray(levelsData[0][0])) {
      const arrays = levelsData as unknown as WaterLevelTuple[][];

      // Process first array (before DST transition) - filter out nulls
      const firstArray = arrays[0].filter(
        (item): item is WaterLevelTuple => Array.isArray(item) && item[1] !== null
      );

      // Find the last valid time in first array to determine where DST transition occurred
      let lastValidTime = '00:00:00';
      if (firstArray.length > 0) {
        lastValidTime = firstArray[firstArray.length - 1][0];
      }

      // Process second array (after DST transition) - filter nulls and skip duplicate times
      const secondArray = arrays.length > 1 ? arrays[1].filter(
        (item): item is WaterLevelTuple => {
          if (!Array.isArray(item) || item[1] === null) return false;
          // Skip times that are less than or equal to the last valid time from first array
          // This avoids plotting the duplicate hour when clocks fall back
          return item[0] > lastValidTime;
        }
      ) : [];

      // Combine the arrays
      levelsData = [...firstArray, ...secondArray];
    }

    this.graphMargin = { top: 55, right: 15, bottom: 27.2, left: 15 };
    this.graphWidth = viewBoxWidth - this.graphMargin.left - this.graphMargin.right;
    this.graphHeight = viewBoxHeight - this.graphMargin.top - this.graphMargin.bottom;

    let minHeight = Infinity, maxHeight = -Infinity;
    this.pointsData = levelsData.map((item: WaterLevelTuple): PointData | null => {
      const timeStr = item[0];
      const heightNum = parseFloat(item[1]);
      if (isNaN(heightNum) || !timeStr || !timeStr.includes(':')) return null;
      const [hours, minutes] = timeStr.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return null;
      const totalMinutes = hours * 60 + minutes;
      minHeight = Math.min(minHeight, heightNum);
      maxHeight = Math.max(maxHeight, heightNum);
      return { totalMinutes, heightNum };
    }).filter((p): p is PointData => p !== null);

    if (this.pointsData.length < 2) {
      this.curveMinMinutes = this.curveMaxMinutes = null;
      return;
    }
    this.curveMinMinutes = this.pointsData[0].totalMinutes;
    this.curveMaxMinutes = this.pointsData[this.pointsData.length - 1].totalMinutes;

    const medianHeight = (minHeight + maxHeight) / 2;
    const spanToCoverMax = (maxHeight + 0.2) - medianHeight;
    const spanToCoverMin = medianHeight - Math.max(0, minHeight - 0.2);
    const dataRequiredHalfSpan = Math.max(spanToCoverMax, spanToCoverMin, 0.005);
    const minTotalSpanFromRatio = (maxHeight > 0) ? maxHeight / 1.2 : 0.01;
    const minRatioHalfSpan = minTotalSpanFromRatio / 2;
    const finalHalfSpan = Math.max(dataRequiredHalfSpan, minRatioHalfSpan);
    this.yDomainMin = medianHeight - finalHalfSpan;
    this.yDomainMax = medianHeight + finalHalfSpan;
    if (this.yDomainMin < 0) {
      this.yDomainMax += -this.yDomainMin;
      this.yDomainMin = 0;
    }
    const textSpacingInMeters = (this.graphHeight > 0 && (this.yDomainMax - this.yDomainMin) > 0) ? (16 / this.graphHeight) * (this.yDomainMax - this.yDomainMin) : 0;
    const targetMinDomainForText = Math.max(0, minHeight - textSpacingInMeters);
    if (this.yDomainMin > targetMinDomainForText) {
      const adj = this.yDomainMin - targetMinDomainForText;
      this.yDomainMin -= adj;
      this.yDomainMax += adj;
    }
    this.yRange = Math.max(0.01, this.yDomainMax - this.yDomainMin);

    //Prepare informations needed to draw graph
    const draw = this.svgDraw;
    const firstX = this._timeToX(this.pointsData[0].totalMinutes), lastX = this._timeToX(this.pointsData[this.pointsData.length - 1].totalMinutes);
    const fillBottomY = this.graphMargin.top + this.graphHeight;
    const minDepthAvailable = this.harborMinDepth?.harborMinDepth !== null && this.harborMinDepth?.harborMinDepth !== 0;
    var currentDepth: number | null = null;

    //Compute current depth & temperature (interpolate)
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (this.curveMinMinutes <= currentMinutes && currentMinutes <= this.curveMaxMinutes) {
      currentDepth = this._interpolateHeight(currentMinutes); //Compute current depth

      if (selectedDay === now.toISOString().slice(0, 10) && currentDepth !== null) {
        //If selected day == current : compute current temp & TimeMarkerData position.
        const t = this._interpolateWaterTemp(currentMinutes);
        this.currentTimeMarkerData = { x: this._timeToX(currentMinutes), y: this._heightToY(currentDepth), timeStr: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }), heightStr: currentDepth.toFixed(2), totalMinutes: currentMinutes, height: currentDepth, water_temp: t ?? undefined };
      }
    }

    //There are 3 differents ways to display the graph.
    if (!(minDepthAvailable && this.harborMinDepth?.harborMinDepth !== undefined)) {
      //Case Harbor min depth setting not available or set to default value (zero)
      // -1st way : graph shows the depth curve, filled under using primary-color
      const curveColor = 'var(--primary-color, blue)';
      const pathData = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(p.heightNum).toFixed(2)}`).join(' ').replace('L', 'M');
      const firstX = this._timeToX(this.pointsData[0].totalMinutes), lastX = this._timeToX(this.pointsData[this.pointsData.length - 1].totalMinutes);
      const fillPath = `M ${firstX.toFixed(2)} ${fillBottomY.toFixed(2)} ${pathData.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${fillBottomY.toFixed(2)} Z`;

      //Draw depth curve and its bottom filled
      draw.path(fillPath).fill({ color: curveColor, opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
      draw.path(pathData).fill('none').stroke({ color: curveColor, width: 2 }).attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
    }
    else {
      //Else, we're in the case harbor min depth is available and > 0
      if (selectedDay === now.toISOString().slice(0, 10)) {
        //Case selected day is current day
        // -2nd way : We display the graph with a different layout to show 3 zones :
        //      - Current depth : represents water level (blue)
        //      - Go zone : area over min Depth (green)
        //      - NoGo zone : area under min depth (red)
        if (currentDepth !== null) {
          const tsIssue_currentDepth = currentDepth ///TS issue in some max function bellow, still considering currentDepth can be null ...
          const harborMinDepthValue = this.harborMinDepth?.harborMinDepth;

          //PathCurve is depth curve
          const pathCurve = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(p.heightNum).toFixed(2)}`).join(' ').replace('L', 'M');

          //pathCurrentHeight is the current depth curve (not display, used to compute the area fillCurrentHeight)
          const pathCurrentHeight = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.min(p.heightNum, tsIssue_currentDepth)).toFixed(2)}`).join(' ').replace('L', 'M');
          //fillCurrentHeight is the area representing the current level of water
          const fillCurrentHeight = `M ${firstX.toFixed(2)} ${fillBottomY.toFixed(2)} ${pathCurrentHeight.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${fillBottomY.toFixed(2)} Z`;

          //pathDataMinDepth is the curve representing the minimum depth, used to compute the nogo area, displayed as dashed when there is not nogo zone to display )
          const pathDataMinDepth = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.min(p.heightNum, harborMinDepthValue)).toFixed(2)}`).join(' ').replace('L', 'M');
          //pathDataMinDepthMin is a working curve used to compute fillPathMinDepth (the nogo zone)
          const pathDataMinDepthMin = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.max(Math.min(p.heightNum, harborMinDepthValue), tsIssue_currentDepth)).toFixed(2)}`).join(' ').replace('L', 'M');
          //fillPathMinDepth is the area of the nogo zone, diplayed in red to illustrate the depth bellow you can't navigate
          const fillPathMinDepth = `M ${firstX.toFixed(2)} ${this._heightToY(tsIssue_currentDepth).toFixed(2)} ${pathDataMinDepthMin.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${this._heightToY(tsIssue_currentDepth).toFixed(2)} Z`;
          //pathCurveMax is a working curve used to compute fillPath (the go zone)
          const pathCurveMax = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.max(tsIssue_currentDepth, harborMinDepthValue, p.heightNum)).toFixed(2)}`).join(' ').replace('L', 'M');
          //fillPath is the area of the go zone, diplayed in green to illustrate the depth in which you can navigate
          const fillPath = `M ${firstX.toFixed(2)} ${this._heightToY(Math.max(tsIssue_currentDepth, harborMinDepthValue)).toFixed(2)} ${pathCurveMax.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${this._heightToY(Math.max(tsIssue_currentDepth, harborMinDepthValue)).toFixed(2)} Z`;

          //In some condition, nogo zone area is empty and if in the graph scale
          if (tsIssue_currentDepth > harborMinDepthValue && this._heightToY(harborMinDepthValue) < fillBottomY) {
            //we display a red dashed line to represent the minimum depth under which you should not enter/leave the harbor
            draw.path(pathDataMinDepth).fill('none').stroke({ color: 'red', width: 1 }).attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '2' });
          }

          //Drawing the depth curve and the 3 areas
          draw.path(fillCurrentHeight).fill({ color: 'blue', opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
          draw.path(pathCurve).fill('none').stroke({ color: 'blue', width: 2 }).attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
          draw.path(fillPath).fill({ color: 'green', opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
          draw.path(fillPathMinDepth).fill({ color: 'red', opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
        }
        else
          return
      }
      else {
        //Else, not current day
        // -3rd way : We draw the graph with two areas :
        //      - Go zone : area over min Depth (green)
        //      - NoGo zone : area under min depth (blue)

        const harborMinDepthValue = this.harborMinDepth?.harborMinDepth;

        //PathCurve is depth curve
        const pathCurve = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(p.heightNum).toFixed(2)}`).join(' ').replace('L', 'M');
        //pathCurveMax is a working curve used to compute fillPath (the go zone)
        const pathCurveMax = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.max(harborMinDepthValue, p.heightNum)).toFixed(2)}`).join(' ').replace('L', 'M');
        //fillPath is the area of the go zone, diplayed in green to illustrate the depth in which you can navigate
        const fillPath = `M ${firstX.toFixed(2)} ${this._heightToY(harborMinDepthValue).toFixed(2)} ${pathCurveMax.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${this._heightToY(harborMinDepthValue).toFixed(2)} Z`;
        //pathDataMinDepth is the curve representing the minimum depth, used to compute the nogo area fillPathMinDepth
        const pathDataMinDepth = this.pointsData.map(p => `L ${this._timeToX(p.totalMinutes).toFixed(2)} ${this._heightToY(Math.min(p.heightNum, harborMinDepthValue)).toFixed(2)}`).join(' ').replace('L', 'M');
        //fillPathMinDepth is the area of the nogo zone, diplayed in red to illustrate the depth bellow you can't navigate
        const fillPathMinDepth = `M ${firstX.toFixed(2)} ${fillBottomY.toFixed(2)} ${pathDataMinDepth.replace(/^M/, 'L')} L ${lastX.toFixed(2)} ${fillBottomY.toFixed(2)} Z`;

        //Drawing the depth curve and the green area
        draw.path(pathCurve).fill('none').stroke({ color: 'blue', width: 2 }).attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
        draw.path(fillPath).fill({ color: 'green', opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });

        //Drawing the nogo zone if in the graph scale
        if (this._heightToY(harborMinDepthValue) < fillBottomY) {
          draw.path(fillPathMinDepth).fill({ color: 'red', opacity: 0.4 }).stroke('none').attr({ 'shape-rendering': 'geometricPrecision', 'vector-effect': 'non-scaling-stroke' });
        }
      }
    }

    const interactionGroup = draw.group().attr('id', 'interaction-indicator').hide() as G;
    this.interactionLine = interactionGroup.line(0, 0, 0, 0).stroke({ color: 'var(--primary-text-color, black)', width: 1, dasharray: '2,2' }).attr({ 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke' }) as Line;
    const interactionDot = interactionGroup.circle(12).fill('var(--info-color, blue)').attr('pointer-events', 'none') as Circle;

    for (let mins = 0; mins <= 1440; mins += 480) {
      const x = this._timeToX(mins === 1440 ? 1439.99 : mins);
      const label = (mins / 60 === 24) ? '00:00' : `${String(mins / 60).padStart(2, '0')}:00`;
      const textEl = draw.text(label).font({ fill: 'var(--secondary-text-color, grey)', size: 14, anchor: 'middle', weight: 'normal' }).move(x, viewBoxHeight - 11.2);
      this.elementsToKeepSize.push(textEl);
    }

    const tideEventsForDay: TideEventTuple[] | undefined = tideData[selectedDay];
    if (Array.isArray(tideEventsForDay)) {
      tideEventsForDay.forEach((tideArr: TideEventTuple) => {
        if (!Array.isArray(tideArr) || tideArr.length < 3) return;
        const typeStr = tideArr[0], time = tideArr[1], height = parseFloat(tideArr[2]), coeff = tideArr.length > 3 && tideArr[3] !== '---' ? parseInt(tideArr[3], 10) : null;
        const isHigh = typeStr === 'tide.high' || typeStr === 'tide_high';
        if ((!isHigh && (typeStr !== 'tide.low' && typeStr !== 'tide_low')) || !time || isNaN(height) || !time.includes(':')) return;
        const [hours, minutes] = time.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return;
        const totalMinutes = hours * 60 + minutes, x = this._timeToX(totalMinutes), y = this._heightToY(height);
        const arrowGroup = draw.group() as G;
        const arrowSize = 8, textSpacing = 10, textLineHeight = 14.4;
        const arrowYOffset = isHigh ? arrowSize * 2.1 : -arrowSize * 2.1;
        const arrowY = y + arrowYOffset;
        let arrowPathData;
        if (isHigh) {
          arrowPathData = `M ${x - arrowSize / 2},${arrowY + arrowSize * 0.4} L ${x + arrowSize / 2},${arrowY + arrowSize * 0.4} L ${x},${arrowY - arrowSize * 0.4} Z`;
        } else {
          arrowPathData = `M ${x - arrowSize / 2},${arrowY - arrowSize * 0.4} L ${x + arrowSize / 2},${arrowY - arrowSize * 0.4} L ${x},${arrowY + arrowSize * 0.4} Z`;
        }
        arrowGroup.path(arrowPathData).fill('var(--primary-text-color, black)').stroke('none');
        let timeTextY, heightTextY;
        const arrowTipY = arrowY + (isHigh ? -arrowSize * 0.4 : arrowSize * 0.4);
        if (isHigh) {
          timeTextY = arrowTipY + textSpacing;
          heightTextY = timeTextY + textLineHeight;
        } else {
          heightTextY = arrowTipY - textSpacing - textLineHeight;
          timeTextY = heightTextY - textLineHeight;
        }
        arrowGroup.text(time).font({ fill: 'var(--primary-text-color, black)', size: 14, weight: 'bold' }).attr('text-anchor', 'middle').cx(x).y(timeTextY);
        arrowGroup.text(`${height.toFixed(1)}m`).font({ fill: 'var(--primary-text-color, black)', size: 12 }).attr('text-anchor', 'middle').cx(x).y(heightTextY);
        this.elementsToKeepSize.push(arrowGroup);
        if (isHigh && coeff !== null) {
          const coefGroup = draw.group() as G;
          const coefText = String(coeff);
          const tempText = draw.text(coefText).font({ size: 16, weight: 'bold', anchor: 'middle' }).attr('dominant-baseline', 'central').opacity(0);
          const textBBox = tempText.bbox();
          tempText.remove();
          if (textBBox && !isNaN(textBBox.width) && !isNaN(textBBox.height) && !isNaN(x)) {
            const boxWidth = textBBox.width + 12, boxHeight = textBBox.height + 8, boxX = x - boxWidth / 2, boxY = 10;
            coefGroup.rect(boxWidth, boxHeight).attr({ x: boxX, y: boxY, rx: 4, ry: 4 }).fill('var(--secondary-background-color, #f0f0f0)').stroke({ color: 'var(--ha-card-border-color, var(--divider-color, grey))', width: 1 }).attr('vector-effect', 'non-scaling-stroke');
            const coefColor = coeff >= 100 ? 'var(--warning-color)' : 'var(--primary-text-color, black)';
            coefGroup.text(coefText).font({ fill: coefColor, size: 16, weight: 'bold', anchor: 'middle' }).attr('dominant-baseline', 'central').attr({ x: boxX + boxWidth / 2, y: boxY + boxHeight / 2 });
            const lineStartY = boxY + boxHeight, lineEndY = y - 10;
            if (!isNaN(lineStartY) && !isNaN(lineEndY) && lineEndY > lineStartY) {
              coefGroup.line(x, lineStartY, x, lineEndY).stroke({ color: 'var(--primary-text-color, #212121)', width: 1, dasharray: '2,2' }).attr('vector-effect', 'non-scaling-stroke');
            }
            this.elementsToKeepSize.push(coefGroup);
          }
        }
      });
    }

    if (this.currentTimeMarkerData) {
      this.currentTimeDotElement = draw.circle(12).center(this.currentTimeMarkerData.x, this.currentTimeMarkerData.y).fill('var(--tide-icon-color)').attr('pointer-events', 'none') as Circle;
    }

    const overlay = draw.rect(this.graphWidth, this.graphHeight).move(this.graphMargin.left, this.graphMargin.top).fill('transparent').attr('cursor', 'crosshair') as Rect;
    this._boundHandleInteractionMove = this._handleInteractionMove.bind(this, interactionGroup, interactionDot);
    this._boundHandleInteractionEnd = this._handleInteractionEnd.bind(this, interactionGroup);
    overlay.node.addEventListener('mousemove', this._boundHandleInteractionMove);
    overlay.node.addEventListener('touchstart', this._boundHandleInteractionMove, { passive: false });
    overlay.node.addEventListener('touchmove', this._boundHandleInteractionMove, { passive: false });
    overlay.node.addEventListener('mouseleave', this._boundHandleInteractionEnd);
    overlay.node.addEventListener('touchend', this._boundHandleInteractionEnd);
    overlay.node.addEventListener('touchcancel', this._boundHandleInteractionEnd);

    window.requestAnimationFrame(() => this._updateElementScale());
  }

  public refreshDimensionsAndScale(): void {
    window.requestAnimationFrame(() => {
      if (this.svgContainer && this.svgDraw) this._updateElementScale();
    });
  }

  private _handleInteractionMove(interactionGroup: G, interactionDot: Circle, event: MouseEvent | TouchEvent): void {
    if (event.type.startsWith('touch')) event.preventDefault();
    const svgPoint = this.getSVGCoordinates(event);
    if (!svgPoint || this.curveMinMinutes === null || this.curveMaxMinutes === null) {
      this._handleInteractionEnd(interactionGroup);
      return;
    }
    const totalMinutes = Math.max(this.curveMinMinutes, Math.min(this.curveMaxMinutes, this._xToTotalMinutes(svgPoint.x)));
    const height = this._interpolateHeight(totalMinutes);
    if (height !== null) {
      const finalX = this._timeToX(totalMinutes), finalY = this._heightToY(height);
      interactionGroup.show();
      interactionDot.center(finalX, finalY);
      let isSnapped = false;
      if (this.currentTimeMarkerData) {
        const dx = finalX - this.currentTimeMarkerData.x, dy = finalY - this.currentTimeMarkerData.y;
        isSnapped = Math.sqrt(dx * dx + dy * dy) < 10;
      }
      if (this.currentTimeDotElement) this.currentTimeDotElement.transform({ scale: isSnapped ? 1.3 : 1.0, origin: 'center center' });
      if (this.interactionLine) {
        const lineStart = isSnapped ? this.currentTimeMarkerData! : { x: finalX, y: finalY };
        const lineEnd_y = this.tooltipBottomSvgY !== null && this.tooltipBottomSvgY > 0 ? this.tooltipBottomSvgY : (this.graphMargin?.top || 0);
        this.interactionLine.plot(lineStart.x, lineStart.y, lineStart.x, Math.min(lineStart.y, lineEnd_y));
      }
      const data = isSnapped ? this.currentTimeMarkerData! : { x: finalX, y: finalY, totalMinutes, height, water_temp: this._interpolateWaterTemp(totalMinutes) ?? undefined };
      if (this.tooltipDelegate) this.tooltipDelegate.updateInteractionTooltip(data.x, data.y, data.totalMinutes, data.height, data.water_temp, isSnapped);
    } else {
      this._handleInteractionEnd(interactionGroup);
    }
  }

  private _handleInteractionEnd(interactionGroup: G): void {
    interactionGroup.hide();
    if (this.tooltipDelegate) this.tooltipDelegate.hideInteractionTooltip();
    if (this.currentTimeDotElement) this.currentTimeDotElement.transform({ scale: 1.0, origin: 'center center' });
  }

  public destroy(): void {
    if (this._boundHandleInteractionMove && this.svgContainer) {
      const overlay = this.svgContainer.querySelector('rect[fill="transparent"]');
      if (overlay) {
        overlay.removeEventListener('mousemove', this._boundHandleInteractionMove as EventListener);
        overlay.removeEventListener('touchstart', this._boundHandleInteractionMove as EventListener);
        overlay.removeEventListener('touchmove', this._boundHandleInteractionMove as EventListener);
        overlay.removeEventListener('mouseleave', this._boundHandleInteractionEnd as EventListener);
        overlay.removeEventListener('touchend', this._boundHandleInteractionEnd as EventListener);
        overlay.removeEventListener('touchcancel', this._boundHandleInteractionEnd as EventListener);
      }
    }
    this._boundHandleInteractionMove = null;
    this._boundHandleInteractionEnd = null;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.svgDraw) this.svgDraw.remove();
    this.elementsToKeepSize = [];
    this.svgContainer = this.tooltipDelegate = this.svgDraw = this.resizeObserver = null;
  }

  public setTooltipBottomY(svgY: number): void {
    this.tooltipBottomSvgY = svgY;
  }
}