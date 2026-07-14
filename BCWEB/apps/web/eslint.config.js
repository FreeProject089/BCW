import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Minimal, targeted ESLint config (see guides/TECH_AUDIT §4, P2). The one rule that earns
// its keep here is `no-undef`: it catches a bare JSX identifier used but never imported —
// the exact class of bug that shipped a green build and then threw `X is not defined` /
// `Calendar is not defined` at render. Everything else is intentionally left off so this
// can gate CI without a big style cleanup first; tighten later as desired.
//
// The react-hooks plugin is registered (not enabled) only so the existing inline
// `// eslint-disable ... react-hooks/exhaustive-deps` comments reference a KNOWN rule
// instead of erroring as "rule not found". Unused-disable reporting is off for the same
// reason — turning it on is a future cleanup, not a blocker.
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
