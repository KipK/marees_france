import globals from "globals";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import babelParser from "@babel/eslint-parser";
import litPlugin from "eslint-plugin-lit";
import * as wcPlugin from "eslint-plugin-wc"; // Use namespace import
import prettierConfig from "eslint-config-prettier";

export default [
  // Global ignores
  {
    ignores: ["**/node_modules/", "**/dist/", "../custom_components/marees_france/frontend/"],
  },

  // Base JS configuration (including Babel for potential .js files)
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"], // Apply Babel parser only to JS files
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...Object.fromEntries(
          Object.entries(globals.browser).map(([key, value]) => [key.trim(), value])
        ),
      },
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
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
  },

  // TypeScript configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser, // Use TypeScript parser
      parserOptions: {
        project: "./tsconfig.json", // Link to your tsconfig
      },
      globals: {
        ...Object.fromEntries(
          Object.entries(globals.browser).map(([key, value]) => [key.trim(), value])
        ),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin, // Enable TypeScript plugin
      lit: litPlugin, // Keep Lit plugin for TS files
      wc: wcPlugin,   // Keep WC plugin for TS files
    },
    rules: {
      ...tsPlugin.configs.recommended.rules, // Apply TS recommended rules
      ...litPlugin.configs.recommended.rules, // Apply Lit recommended rules
      ...wcPlugin.configs.recommended.rules, // Apply WC recommended rules
      // Add any specific overrides here if needed
      // e.g., '@typescript-eslint/no-explicit-any': 'warn',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },

  // Apply Prettier config last to override other formatting rules
  prettierConfig,

  // Specific config for Node.js scripts
  {
    files: ["frontend/scripts/sync-version.js"],
    languageOptions: {
      globals: {
        ...globals.node, // Add Node.js globals
      },
    },
  },
];