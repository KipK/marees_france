/*
This file holds the static CSS styles for the marees-france-card.
It exports a 'css' template literal which is imported and used by the
MareesFranceCard LitElement component.
Styles are organized by card sections (header, next tide status, tabs, graph, dialog).
*/
import { css } from 'lit';

export const cardStyles = css`
      :host {
        /* Card specific vars using HA vars */
        --current_tide_color: #fdd835;
        --tide-icon-color: var(--current_tide_color);
        --tide-time-color: var(--primary-text-color);
        --tide-detail-color: var(--secondary-text-color);
        /* Tab colors */
        --tab-inactive-background: var(
          --ha-card-background
        ); /* Use card background for inactive tabs */
        --tab-active-background: var(--primary-color);
        --tab-inactive-text-color: var(--secondary-text-color);
        --tab-active-text-color: var(--text-primary-color);
        display: block;
      }
      ha-card {
        overflow: hidden; /* Prevent SVG overflow issues */
      }
      .warning {
        background-color: var(--error-color);
        color: var(--text-primary-color);
        padding: 8px;
        text-align: center;
        border-radius: 4px;
        margin: 10px 16px; /* Add horizontal margin */
      }
      .card-header {
        /* Standard HA card header style */
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 16px 8px 16px; /* Less bottom padding */
        color: var(--primary-text-color);
      }
      .card-content {
        padding: 0 16px 8px 16px; /* Reduced bottom padding */
      }
      .header-icons {
        display: flex;
        gap: 8px;
      }
      .sinewave-icon {
        color: var(--secondary-text-color);
        --mdc-icon-size: 24px;
        transition: color 0.2s ease-in-out;
        cursor: pointer;
      }
      .sinewave-icon:hover,
      .sinewave-icon.active {
        color: var(--primary-color);
      }
      .calendar-icon {
        --mdc-icon-size: 24px;
      }
      .tabs-and-graph-container {
        position: relative;
      }
      .tabs-and-graph-container[style*="display: none;"] {
        display: none !important;
      }
      .graph-overlay-content {
        background-color: var(--ha-card-background, white);
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      }

      /* Next Tide Status Display Styles */
      .next-tide-status {
        display: flex;
        justify-content: space-between; /* Push icon to the right */
        align-items: center; /* Vertically align main info and icon */
        gap: 16px; /* Gap between main info and icon */
        padding-bottom: 8px; /* Reduced space before tabs */
        padding-left: 16px; /* Add left padding to match card content */
        padding-right: 8px; /* Reduced right padding */
        padding-top: 16px; /* Add top padding */
      }
      .next-tide-main {
        display: flex;
        flex-direction: column; /* Stack icon/time and details */
        align-items: flex-start; /* Align items to the left */
        gap: 4px; /* Smaller gap between lines */
        flex-grow: 1; /* Allow main section to take available space */
      }
      .next-tide-icon-time {
        display: flex;
        align-items: center; /* Vertically center icon and text block */
        align-content: center;
        gap: 8px;
      }
      .next-tide-icon-time ha-icon {
        color: var(--tide-icon-color);
        --mdc-icon-size: 2.4em; /* Adjusted size */
        /* margin-top removed for vertical centering */
        padding: 0;
      }
      .next-tide-text-container {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        line-height: 1; /* Tighten line height for the container */
      }
      .next-tide-trend-text {
        font-size: 1em; /* Smaller text for prefix */
        font-weight: 400;
        color: var(--tide-time-color); /* Same color as time */
        padding-bottom: 2px; /* Small space between text and time */
      }
      .next-tide-time {
        font-size: 1.5em; /* Adjusted time font size */
        font-weight: 400;
        color: var(--tide-time-color);
        line-height: 1; /* Keep tight line height */
      }
      .next-tide-details {
        display: flex; /* Keep details on one line if possible */
        flex-wrap: wrap; /* Allow wrapping */
        gap: 8px; /* Space between height and coef */
        padding-left: calc(
          2.2em + 11px
        ); /* Indent details to align below time (icon width + gap) */
        font-size: 1em; /* Slightly smaller details */
        color: var(--tide-detail-color);
        line-height: 1.3; /* Adjust line height */
      }
      .next-tide-details span {
        display: inline-block; /* Keep height and coef box inline */
        vertical-align: middle; /* Align items vertically */
      }
      .next-tide-details .warning-coef {
        color: var(--warning-color);
        font-weight: bold; /* Make it stand out more */
      }
      /* Separator is now handled directly in the HTML template */

      .calendar-icon {
        color: var(--secondary-text-color); /* Use a less prominent color */
        /* --mdc-icon-button-size: 30px; */ /* Note: Customizing mdc-icon-button-size can be tricky due to HA themes */
        transition: color 0.2s ease-in-out;
        cursor: pointer; /* Pointer cursor for interactivity */
      }
      .calendar-icon:hover {
        color: var(--primary-color); /* Highlight on hover */
      }

      .tabs {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 16px;
        gap: 4px;
        /* padding-left: 16px; */ /* REMOVED - Let card content padding handle alignment */
        /* padding-right: 16px; */ /* REMOVED - Let card content padding handle alignment */
      }
      .tab {
        display: flex; /* Use flexbox for vertical alignment */
        flex-direction: column; /* Stack day and date */
        justify-content: center; /* Center content vertically */
        align-items: center; /* Center content horizontally */
        text-align: center;
        padding: 6px 4px;
        border-radius: 6px;
        background: var(--tab-inactive-background);
        color: var(--tab-inactive-text-color);
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        transition:
          background-color 0.2s ease-in-out,
          color 0.2s ease-in-out;
        line-height: 1.2; /* Adjust line height for stacked text */
      }
      .tab-day {
        font-size: 14px; /* Keep original size */
        font-weight: inherit; /* Inherit weight from .tab or .tab.active */
      }
      .tab-date {
        font-size: 10px; /* Smaller font size for date */
        color: var(--secondary-text-color); /* Use secondary color */
        margin-top: 2px; /* Small space between day and date */
      }
      .tab:hover {
        filter: brightness(95%);
      }
      .tab.active {
        background: var(--tab-active-background);
        color: var(--tab-active-text-color);
        font-weight: bold;
      }
      .tab.active .tab-date {
        color: var(
          --text-primary-color
        ); /* Make date color match active text color */
        opacity: 0.8; /* Slightly less prominent */
      }

      /* Styles for SVG graph container and loader */
      @keyframes rotate {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      .svg-graph-container {
        position: relative; /* Needed for absolute positioning of loader */
        display: flex; /* Use flex to center loader */
        justify-content: center;
        align-items: center;
        /* Use aspect-ratio for responsive height based on width */
        aspect-ratio: 500 / 200; /* Updated aspect ratio */
        width: 100%;
        height: auto; /* Let aspect-ratio control height */
        max-height: 220px; /* Optional max height increased */
        margin-top: 10px; /* Space above graph */
        /* padding-left: 16px; */ /* REMOVED - Let card content padding handle alignment */
        /* padding-right: 16px; */ /* REMOVED - Let card content padding handle alignment */
      }
      .svg-graph-container .loading-icon {
        position: absolute; /* Position over the graph area */
        font-size: 3em; /* Adjust size as needed */
        color: var(--primary-color); /* Use primary color */
        animation: rotate 1.5s linear infinite; /* Apply rotation */
        z-index: 10; /* Ensure loader is above SVG content */
        opacity: 1; /* Final state */
        transition: opacity 1s ease-in; /* Fade-in effect */
      }
      /* When the icon is added via the template, it should fade from implicit 0 to 1 */

      .svg-graph-target {
        /* Ensure the SVG target takes up the container space */
        width: 100%;
        height: 100%;
        position: relative; /* Establish stacking context if needed */
        z-index: 1; /* Ensure graph is below loader */
      }
      /* Removed .hidden class rule */
      .svg-graph-target svg {
        display: block; /* Remove extra space below SVG */
        width: 100%;
        height: 100%;
      }
      /* Add cursor pointer to elements with tooltips */
      .svg-graph-target svg .has-tooltip {
        cursor: pointer;
      }
      /* Tooltip styles (within SVG) - Not used for HTML tooltip */
      #marker-tooltip {
        pointer-events: none; /* Tooltip should not capture mouse events */
      }

      /* HTML Tooltip Styles */
      .chart-tooltip {
        position: absolute; /* Position relative to the card content area */
        display: none; /* Hidden by default */
        background-color: var(
          --secondary-background-color,
          #f0f0f0
        ); /* Match coef box background */
        color: var(--primary-text-color, black); /* Keep text color primary */
        border: 1px solid
          var(--ha-card-border-color, var(--divider-color, grey)); /* Match coef box border */
        border-radius: 4px;
        padding: 4px 6px; /* Reduced padding */
        font-size: 12px;
        white-space: nowrap; /* Prevent wrapping */
        z-index: 100; /* Ensure it's above the SVG */
        pointer-events: none; /* Tooltip should not interfere with mouse */
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
      }
      .chart-tooltip strong {
        font-weight: bold;
        font-weight: bold;
      }
      .chart-tooltip.snapped-tooltip {
        border-color: var(--tide-icon-color); /* Yellow border */
        color: var(--primary-text-color); /* Use primary text color */
      }
      .chart-tooltip.snapped-tooltip strong {
        color: var(--primary-text-color); /* Ensure bold text is also primary */
      }

      /* Dialog Styles [MODIFIED FOR GRID] */
      ha-dialog {
        /* Allow content to scroll */
        --dialog-content-padding: 0;
        --dialog-z-index: 5; /* Ensure dialog is above other elements */
        /* Default width for desktop - Set both min and max */
        --mdc-dialog-min-width: 600px;
        --mdc-dialog-max-width: 600px;
      }
      .calendar-dialog-content {
        padding: 10px 20px; /* Default padding for desktop */
        max-height: 70vh; /* Limit height and allow scrolling */
        overflow-y: hidden; /* Allow vertical scroll if needed */
        box-sizing: border-box; /* Include padding in width calculation */
      }
      .dialog-loader,
      .dialog-warning,
      .no-data-month {
        text-align: center;
        padding: 20px;
        color: var(--secondary-text-color);
      }
      .dialog-warning {
        color: var(--error-color);
      }
      .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px; /* Reduced margin */
        padding: 0 4px; /* Reduced padding */
      }
      .calendar-month-year {
        font-size: 1.1em; /* Slightly smaller */
        font-weight: 500;
        text-align: center;
        flex-grow: 1;
        color: var(--primary-text-color);
      }
      .calendar-header ha-icon-button {
        color: var(--primary-text-color);
      }
      .calendar-header ha-icon-button[disabled] {
        color: var(--disabled-text-color);
      }
      .calendar-header ha-icon-button ha-icon {
        /* hack to fix icon misalignment */
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      }
      .calendar-header ha-icon-button ha-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      /* NEW Calendar Grid Styles */
      .calendar-grid {
        /* padding removed, handled by .calendar-dialog-content */
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 2px; /* Small gap between cells */
        margin-top: 8px;
        border: 1px solid var(--card-background-color, #e0e0e0); /* Optional border around grid */
        border-radius: 4px;
        overflow: hidden; /* Clip corners */
        background-color: var(
          --card-background-color,
          #e0e0e0
        ); /* Background for gaps */
      }

      .calendar-weekday {
        text-align: center;
        padding: 6px 2px; /* Adjust padding */
        font-weight: bold;
        font-size: 0.8em; /* Smaller weekday font */
        color: var(--secondary-text-color);
        background-color: var(
          --secondary-background-color,
          #f5f5f5
        ); /* Header background */
        text-transform: uppercase; /* Match screenshot */
      }

      .calendar-day {
        background-color: var(
          --card-background-color,
          white
        ); /* Cell background */
        padding: 1px;
        min-height: 60px; /* Minimum height for cells */
        display: flex;
        flex-direction: column;
        justify-content: flex-start; /* Align content to top */
        align-items: center; /* Center horizontally */
        position: relative; /* For positioning day number */
        border: none; /* Remove individual borders if grid gap is used */
      }

      .calendar-day.padding {
        opacity: 0.6;
      }

      .day-number {
        font-size: 0.9em;
        font-weight: 500;
        color: var(--secondary-text-color);
        margin-bottom: 4px; /* Space between number and coeffs */
        text-align: center;
        width: 100%; /* Take full width for centering */
        background-color: var(--divider-color);
      }

      .day-coeffs {
        display: flex;
        flex-wrap: wrap; /* Allow coeffs to wrap */
        flex-direction: column; /* Align coeffs in a row */
        justify-content: center; /* Center coeffs horizontally */
        align-items: center; /* Center coeffs vertically */
        gap: 3px; /* Gap between coeffs */
        /* width: 3ch; */ /* REMOVED to allow expansion */
      }

      .coeff-value {
        display: inline-block;
        font-size: 0.85em; /* Smaller coefficient font */
        font-weight: 500;
        padding: 1px 4px; /* Small padding */
        border-radius: 3px;
        line-height: 1.2;
        /* background-color: var(--divider-color); Default background */
        color: var(--primary-text-color); /* Default text color */
      }

      .coeff-value.warning-coef {
        color: var(--warning-color); /* Text color on warning background */
        font-weight: bold;
      }
      .coeff-value.low-coef {
        color: var(--info-color); /* Text color on info background */
        opacity: 0.8;
      }

      /* Remove old table styles if they exist */
      .calendar-table {
        display: none;
      }
      /* Media Query for Mobile Dialog Width */
      @media (max-width: 600px) {
        ha-dialog {
          /* Override default max-width for mobile */
          --mdc-dialog-min-width: calc(
            100vw - 20px
          ); /* 10px margin each side */
          --mdc-dialog-max-width: calc(100vw - 20px);
        }
        .calendar-dialog-content {
          /* Reduce padding inside dialog on mobile */
          padding: 10px 5px;
        }
        /* .calendar-grid padding already removed */
      }
    `;