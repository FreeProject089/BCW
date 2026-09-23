// @bettercommunity/studio: the studio document, in one place for the web and the API.
//
// Pure ESM, no React, no DOM: the web renders with it (apps/web/src/ui/canvas-view.jsx, through
// the re-exports in apps/web/src/lib/canvas.js, css-scope.js and svg-safe.js) and the API
// validates every studio write with it (apps/api/src/lib/studio-doc.mjs). One definition of the
// document, so the rule a page is drawn by and the rule it is saved under cannot drift.
export * from './canvas.js';
export * from './validate.js';
export * from './css-scope.js';
export * from './svg-safe.js';
