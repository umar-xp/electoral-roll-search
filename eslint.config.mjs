import globals from "globals";

export default [
  {
    ignores: ["_archive/**", "dist/**", "node_modules/**"],
  },
  {
    files: ["apps/web/*.js", "scripts/*.js", "tests/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.worker,
        importScripts: "readonly",
        SearchUtils: "readonly",
        self: "readonly",
        Monitor: "readonly",
        // Shared from search-utils.js (loaded before app.js)
        escapeHtml: "readonly",
        phoneticKey: "readonly",
        levenshtein: "writable",
        scoreToken: "readonly",
        scoreNameMatch: "readonly",
        tokenizeQuery: "readonly",
        getVoterTokens: "readonly",
        getRelativeTokens: "readonly",
        isValidVoterRecord: "readonly",
        // Shared from search-engine.js
        VoterSearchEngine: "readonly",
        LRUCache: "readonly",
        // Shared from indexed-search.js
        IndexedSearchEngine: "writable",
        // Shared from state.js / data-fetcher.js / ui-renderer.js
        AppState: "writable",
        DataFetcher: "writable",
        UIRenderer: "writable",
        // CDN libraries
        pdfjsLib: "readonly",
        Fuse: "readonly",
        Tesseract: "readonly",
      },
    },
    rules: {
      // Security
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // Correctness
      "no-undef": "warn",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-redeclare": "error",
      "no-shadow": "warn",
      "eqeqeq": ["error", "smart"],

      // Style (minimal, non-controversial)
      "no-trailing-spaces": "warn",
      "no-multiple-empty-lines": ["warn", { max: 2 }],
      "semi": ["warn", "always"],
    },
  },
  {
    // Worker files import functions via importScripts — declare as globals
    files: ["apps/web/search-worker.js"],
    languageOptions: {
      globals: {
        phoneticKey: "readonly",
        levenshtein: "readonly",
        scoreToken: "readonly",
        scoreNameMatch: "readonly",
        tokenizeQuery: "readonly",
        getVoterTokens: "readonly",
        getRelativeTokens: "readonly",
        isValidVoterRecord: "readonly",
        escapeHtml: "readonly",
        PHONETIC_MAP: "readonly",
      },
    },
  },
  {
    files: ["scripts/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Module definition files define their own global — suppress redeclare
    files: [
      "apps/web/state.js",
      "apps/web/data-fetcher.js",
      "apps/web/ui-renderer.js",
      "apps/web/indexed-search.js",
      "apps/web/search-utils.js",
      "apps/web/search-engine.js",
    ],
    rules: {
      "no-redeclare": "off",
    },
  },
];
