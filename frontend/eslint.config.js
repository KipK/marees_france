import globals from "globals";
import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
import litPlugin from "eslint-plugin-lit";
import * as wcPlugin from "eslint-plugin-wc"; // Use namespace import
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended, // Start with eslint recommended rules
  {
    // Global settings for all JS files
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Process browser globals to remove whitespace from keys
        ...Object.fromEntries(
          Object.entries(globals.browser).map(([key, value]) => [key.trim(), value])
        ),
      },
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false, // Necessary for @babel/eslint-parser standalone
        babelOptions: {
          presets: ["@babel/preset-env"],
          plugins: [
            ["@babel/plugin-proposal-decorators", { "version": "legacy" }]
          ]
        },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    ignores: ["**/node_modules/", "**/dist/", "../custom_components/marees_france/frontend/"], // Ignore node_modules, build output
  },
  {
    // Settings specific to Lit elements (using recommended config)
    files: ["src/**/*.js"], // Apply Lit rules only to source files
    plugins: {
      lit: litPlugin,
    }
  },
  {
    // Settings specific to Web Components (using recommended config)
    files: ["src/**/*.js"], // Apply WC rules only to source files
    plugins: {
      wc: wcPlugin,
    },
    rules: {
      ...wcPlugin.configs.recommended.rules, // Apply WC recommended rules
    },
  },
  // Apply Prettier config last to override other formatting rules
  prettierConfig,
];