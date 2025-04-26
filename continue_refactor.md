# Marees France Card Refactoring - Continuation Steps

This file outlines the remaining steps to complete the refactoring of the Marees France custom card frontend.

**Current State:**
*   Frontend project structure created (`frontend/src`).
*   Existing card and editor JS files moved to `frontend/src`.
*   npm project initialized in `frontend`.
*   Webpack and Babel dependencies installed.
*   Webpack (`webpack.config.js`) and Babel (`babel.config.js`) configurations created.
*   `build` script added to `frontend/package.json`.
*   Translations and localization function extracted to `frontend/src/constants.js` and `frontend/src/localize.js`.
*   Utility functions (`getWeekdayShort3Letters`, `getNextTideStatus`) extracted to `frontend/src/utils.js`.
*   Graph rendering logic extracted to `frontend/src/graph-renderer.js`.
*   `marees-france-card.js` refactored to use `localize.js`, `utils.js`, and `graph-renderer.js`.
*   `marees-france-card-editor.js` refactored to use bare Lit import and shared `localize.js`.

**Remaining Steps:**

1.  **Add Editor Localization Keys:**
    *   Read `frontend/src/constants.js`.
    *   Add the following keys under `ui.card.marees_france` for both `en` and `fr` languages, providing appropriate translations:
        *   `editor.show_header`: "Display header" / "Afficher l'en-tête"
        *   `editor.device_label`: "Harbor Device" / "Appareil Port"
        *   `editor.title`: "Title (Optional)" / "Titre (Optionnel)"
    *   Use `apply_diff` or `write_to_file` to update `frontend/src/constants.js`.

2.  **Install Core Dependencies:**
    *   The card and editor now use bare imports for `lit` and `@svgdotjs/svg.js`. Install these as production dependencies.
    *   Run the following command in the `frontend` directory:
        ```bash
        npm install lit @svgdotjs/svg.js
        ```
    *   Use the `execute_command` tool with `cwd: frontend`.

3.  **Run Initial Build:**
    *   Test the build process to ensure everything compiles correctly.
    *   Run the following command in the `frontend` directory:
        ```bash
        npm run build
        ```
    *   Use the `execute_command` tool with `cwd: frontend`.
    *   Verify that `marees-france-card.js` and `marees-france-card-editor.js` are generated in `custom_components/marees_france/frontend/`.

4.  **Update `.gitignore`:**
    *   Ensure `node_modules` within the `frontend` directory is ignored.
    *   Consider ignoring the generated files within `custom_components/marees_france/frontend/` if they shouldn't be committed directly (depends on workflow).
    *   Read the root `.gitignore` file.
    *   Add `/frontend/node_modules/` to the `.gitignore`.
    *   (Optional) Add `/custom_components/marees_france/frontend/*.js` (if build output shouldn't be committed).
    *   Use `apply_diff` or `write_to_file` to update `.gitignore`.

5.  **(Optional) Add Linting/Formatting:**
    *   Install ESLint and Prettier dev dependencies:
        ```bash
        npm install --save-dev eslint prettier eslint-config-prettier eslint-plugin-lit eslint-plugin-wc @babel/eslint-parser
        ```
    *   Configure ESLint (e.g., `.eslintrc.json`) and Prettier (e.g., `.prettierrc.json`).
    *   Add lint/format scripts to `frontend/package.json`.

**Next Action:**
Start with step 1: Add Editor Localization Keys.