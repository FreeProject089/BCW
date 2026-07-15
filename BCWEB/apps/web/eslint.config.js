import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

// Minimal, targeted ESLint config (see guides/audits/TECH_AUDIT §4, P2). It exists for ONE
// class of bug: an identifier used but never imported, which builds green and then throws
// `X is not defined` at render.
//
// It takes TWO rules to cover that, and for a long time only the first was here:
//   • no-undef          — plain JS references.
//   • react/jsx-no-undef — JSX component names. no-undef does NOT see these: `<Foo />` is a
//                          JSXIdentifier, and core ESLint's scope analysis doesn't resolve it
//                          as a variable reference. So `<AppLogo />` with no import linted
//                          clean and crashed the page. That is exactly the bug this config
//                          claimed to prevent, and it shipped four of them (IconGlyph,
//                          AppLogo, OwnerCatalogs, MyReports) with CI green.
// Verify with a probe if you ever doubt it: a file containing both `const x = Nope;` and
// `<Nope2 />` must report TWO errors, not one.
//
// Everything else is intentionally left off so this can gate CI without a big style cleanup
// first; tighten later as desired.
//
// The react-hooks plugin is registered (not enabled) only so the existing inline
// `// eslint-disable ... react-hooks/exhaustive-deps` comments reference a KNOWN rule
// instead of erroring as "rule not found". Unused-disable reporting is off for the same
// reason — turning it on is a future cleanup, not a blocker.
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks, react },
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
    settings: { react: { version: 'detect' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
    },
  },
];
