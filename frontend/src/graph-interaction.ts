// This file will manage interactions with the graph renderer and its container.
// Responsibilities include:
// - Setting up and handling the MutationObserver for the SVG container.
// - Managing the GraphRenderer instance.
// - Logic for triggering graph drawing (_drawGraphIfReady).
// - Handling tooltip updates initiated by the GraphRenderer.
// - Managing internal HTML tooltip visibility and positioning.

import {
  HomeAssistant,
  ServiceResponseWrapper,
  GetTidesDataResponseData,
  GetWaterLevelsResponseData,
} from './types';
import { GraphRenderer, TooltipDelegate } from './graph-renderer';

// Define type for synthetic event used in tooltip positioning
export interface SyntheticPositionEvent {
    clientX?: number;
    clientY?: number;
    type: string;
}

// Interface for the card instance properties and methods GraphInteractionManager needs.
// This helps to decouple and define clear dependencies.
export interface CardInstanceForGraphManager {
  hass: HomeAssistant;
  shadowRoot: ShadowRoot | null;
  // Data properties needed for drawing the graph
  _selectedDay: string;
  _waterLevels: ServiceResponseWrapper<GetWaterLevelsResponseData> | { error: string } | null;
  _tideData: ServiceResponseWrapper<GetTidesDataResponseData> | { error: string } | null;
  _isLoadingWater: boolean;
  _isLoadingTides: boolean;
  // Method to get bounding client rect for tooltip positioning
  getBoundingClientRect: () => DOMRect;
  // Method to request an update if needed (though @state should handle most)
  requestUpdate: (name?: PropertyKey, oldValue?: unknown) => void;
}

export class GraphInteractionManager implements TooltipDelegate {
  private card: CardInstanceForGraphManager;
  private graphRenderer: GraphRenderer | null = null;
  private svgContainer: HTMLDivElement | null = null;
  private mutationObserver: MutationObserver | null = null;

  constructor(cardInstance: CardInstanceForGraphManager) {
    this.card = cardInstance;
  }

  /**
   * Sets up the MutationObserver to watch for the graph container element.
   * Initializes the graph renderer when the container is available.
   */
  public setupMutationObserver(): void {
    if (!this.card.shadowRoot || this.mutationObserver) return;
    this.mutationObserver = new MutationObserver(this.handleMutation.bind(this));
    this.mutationObserver.observe(this.card.shadowRoot, { childList: true, subtree: true });
    this.handleContainerStateChange(this.card.shadowRoot.querySelector<HTMLDivElement>('#marees-graph-target'));
  }

  private handleMutation(mutationsList: MutationRecord[]): void {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        let containerAdded: HTMLDivElement | null = null;
        let containerRemoved = false;
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const found = el.id === 'marees-graph-target' ? el : el.querySelector<HTMLDivElement>('#marees-graph-target');
            if (found && found instanceof HTMLDivElement) {
              containerAdded = found;
            } else if (found) {
              console.warn("Marees Card (GraphInteractionManager): Found potential graph target container but it's not an HTMLDivElement:", found);
            }
          }
        });
        mutation.removedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.id === 'marees-graph-target' || (this.svgContainer && el.contains(this.svgContainer))) {
              containerRemoved = true;
            }
          }
        });
        if (containerAdded) this.handleContainerStateChange(containerAdded);
        else if (containerRemoved) this.handleContainerStateChange(null);
      }
    }
  }

  private handleContainerStateChange(containerElement: HTMLDivElement | null): void {
    if (!containerElement && this.graphRenderer) {
      this.graphRenderer.destroy();
      this.graphRenderer = null;
      this.svgContainer = null;
    } else if (containerElement && !this.graphRenderer) {
      this.svgContainer = containerElement;
      // Pass `this` (GraphInteractionManager instance) as the first argument to GraphRenderer
      this.graphRenderer = new GraphRenderer(this, this.svgContainer, this.card.hass);
      this.drawGraphIfReady();
    } else if (containerElement && this.graphRenderer) {
      if (this.svgContainer !== containerElement) {
          this.svgContainer = containerElement;
          // Re-initialize or update renderer if container instance changes.
          // For now, destroy and recreate.
          this.graphRenderer.destroy();
          this.graphRenderer = new GraphRenderer(this, this.svgContainer, this.card.hass);
      }
      this.drawGraphIfReady();
    }
  }

  /**
   * Checks if all data is ready and the graph container exists, then draws the graph.
   * Called when data changes or the graph container becomes available.
   */
  public drawGraphIfReady(): void {
    const waterDataValid = this.card._waterLevels && 'response' in this.card._waterLevels && this.card._waterLevels.response;
    const tideDataValid = this.card._tideData && 'response' in this.card._tideData && this.card._tideData.response;
    const dataIsReady = !this.card._isLoadingWater && !this.card._isLoadingTides && waterDataValid && tideDataValid;
    const containerStillExists = this.svgContainer && this.card.shadowRoot?.contains(this.svgContainer);

    if (this.graphRenderer && containerStillExists && dataIsReady) {
      try {
        this.graphRenderer.drawGraph(
          this.card._tideData as ServiceResponseWrapper<GetTidesDataResponseData>,
          this.card._waterLevels as ServiceResponseWrapper<GetWaterLevelsResponseData>,
          this.card._selectedDay
        );
        this.graphRenderer.refreshDimensionsAndScale();
      } catch (e) {
        console.error('[MareesCard GIM] Error during graph draw/refresh:', e);
      }
    }
  }

  /**
   * Updates and shows the HTML tooltip based on interaction with the graph.
   * This method is called by the GraphRenderer instance.
   * @param svgX The X coordinate in SVG space for the tooltip anchor.
   * @param svgY The Y coordinate in SVG space for the tooltip anchor.
   * @param timeMinutes The time in total minutes from midnight.
   * @param height The water height at that time.
   * @param isSnapped True if the interaction point is snapped to the current time marker.
   */
  public updateInteractionTooltip(svgX: number, svgY: number, timeMinutes: number, height: number, isSnapped: boolean = false): void {
    if (this.card.hass?.editMode) return;
    const svg = this.svgContainer?.querySelector('svg');
    if (!svg) return;

    const hours = Math.floor(timeMinutes / 60);
    const minutes = Math.floor(timeMinutes % 60);
    const formattedTimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const formattedHeightStr = height.toFixed(2);

    try {
      const ctm = svg.getScreenCTM();
      if (!ctm) { this.hideHtmlTooltip(); return; }
      const svgPt = svg.createSVGPoint();
      svgPt.x = svgX; svgPt.y = svgY;
      const screenPt = svgPt.matrixTransform(ctm);

      const syntheticEvent: SyntheticPositionEvent = { clientX: screenPt.x, clientY: screenPt.y, type: 'interactionMove' };
      const tooltip = this.card.shadowRoot?.getElementById('marees-html-tooltip');
      if (tooltip) tooltip.classList.toggle('snapped-tooltip', isSnapped);
      this.showHtmlTooltip(syntheticEvent, formattedTimeStr, formattedHeightStr);

      if (tooltip && svg && this.graphRenderer) {
        const tooltipRect = tooltip.getBoundingClientRect();
        const ctmForTooltip = svg.getScreenCTM();
        if (ctmForTooltip) {
          const pt = svg.createSVGPoint();
          pt.x = tooltipRect.left;
          pt.y = tooltipRect.bottom;
          try {
            const svgPoint = pt.matrixTransform(ctmForTooltip.inverse());
            this.graphRenderer.setTooltipBottomY(svgPoint.y);
          } catch (inverseError) {
             console.error('Marees Card (GIM): Error inverting CTM for tooltip Y:', inverseError);
             this.graphRenderer.setTooltipBottomY(-1);
          }
        } else {
           this.graphRenderer.setTooltipBottomY(-1);
        }
      }
    } catch (transformError) {
      console.error('Marees Card (GIM): Error transforming SVG point for tooltip:', transformError);
      this.hideHtmlTooltip();
    }
  }

  /**
   * Hides the HTML interaction tooltip.
   * This method is called by the GraphRenderer instance.
   */
  public hideInteractionTooltip(): void {
    const tooltip = this.card.shadowRoot?.getElementById('marees-html-tooltip');
    if (tooltip) tooltip.classList.remove('snapped-tooltip');
    this.hideHtmlTooltip();
  }

  private showHtmlTooltip(evt: SyntheticPositionEvent, time: string, height: string): void {
    const tooltip = this.card.shadowRoot?.getElementById('marees-html-tooltip');
    if (!tooltip) return;

    tooltip.style.visibility = 'visible';
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<strong>${time}</strong><br>${height} m`;

    if (evt.clientX === undefined || evt.clientY === undefined) { this.hideHtmlTooltip(); return; }

    const cardRect = this.card.getBoundingClientRect();
    const targetCenterX = evt.clientX - cardRect.left;
    const targetTopY = evt.clientY - cardRect.top;
    const targetHeight = 1;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;

    if (tooltipWidth <= 0 || tooltipHeight <= 0) { this.hideHtmlTooltip(); return; }

    const isTouchEvent = evt.type.startsWith('touch') || evt.type === 'interactionMove';
    const offsetAbove = isTouchEvent ? 45 : 10;
    let left = targetCenterX - tooltipWidth / 2;
    let top = targetTopY - tooltipHeight - offsetAbove;
    const safetyMargin = 2;

    if (left < safetyMargin) left = safetyMargin;
    if (left + tooltipWidth > cardRect.width - safetyMargin) left = cardRect.width - tooltipWidth - safetyMargin;
    if (top < safetyMargin) {
      top = targetTopY + targetHeight + offsetAbove;
      if (top + tooltipHeight > cardRect.height - safetyMargin) top = cardRect.height - tooltipHeight - safetyMargin;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  private hideHtmlTooltip(): void {
    const tooltip = this.card.shadowRoot?.getElementById('marees-html-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
      tooltip.style.visibility = 'hidden';
    }
  }

  /**
   * Disconnects the MutationObserver and destroys the GraphRenderer instance.
   * Called when the main card is disconnected from the DOM.
   */
  public disconnectObserver(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.graphRenderer) {
      this.graphRenderer.destroy();
      this.graphRenderer = null;
    }
    this.svgContainer = null;
  }
}