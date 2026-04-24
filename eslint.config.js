import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";

export default [
  // Svelte recommended (includes base JS rules)
  ...sveltePlugin.configs["flat/recommended"],

  // Global language options
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Unused variables — warn, ignore _-prefixed
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Consistent equality
      "eqeqeq": ["warn", "always", { null: "ignore" }],
    },
  },

  // Svelte-specific overrides
  {
    files: ["**/*.svelte"],
    rules: {
      // Svelte 5: $props(), $state() etc. are compiler macros, not JS globals
      "no-undef": "off",
      // Good practice but pre-existing debt — warn, not block
      "svelte/require-each-key": "warn",
      // SvelteKit goto() / href without resolve() — warn until we audit navigation
      "svelte/no-navigation-without-resolve": "warn",
      // Svelte 5 reactivity primitives — warn to migrate over time
      "svelte/prefer-svelte-reactivity": "warn",
      // XSS risk — keep as warn so it's visible
      "svelte/no-at-html-tags": "warn",
      // Template literals in attributes are fine (multiline placeholders etc.)
      "svelte/no-useless-mustaches": "warn",
      // Unused svelte-ignore — warn instead of error
      "svelte/no-unused-svelte-ignore": "warn",
    },
  },

  // Ignore generated / build artefacts
  {
    ignores: [
      ".svelte-kit/",
      ".vercel/",
      "node_modules/",
      "build/",
      "dist/",
    ],
  },
];
