// The tiling patterns live in the studio package now (PLAN-STUDIO-2026, phase 4): a page
// background can be a pattern, and the API validates a stored background with the same list of
// ids. This file stays so no import breaks. A RELATIVE path, for the same reason as
// lib/canvas.js: the web's tests import it under plain node, where no alias exists.
export * from '../../../../packages/studio/src/patterns.js';
