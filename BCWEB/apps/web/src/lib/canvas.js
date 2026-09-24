// The free-form page canvas lives in the studio package now (PLAN-STUDIO-2026, phase 3):
// BCWEB/packages/studio, `@bettercommunity/studio`, where the API reads the same code to
// validate what it stores. This file stays so no import breaks.
//
// A RELATIVE path, not the package name: the web's tests import this file under plain node
// (`node --test`), where no alias exists, and node resolves a relative path exactly as Vite
// does. B.MD's own tests and kit-pack.js reach packages/bmd the same way.
export * from '../../../../packages/studio/src/canvas.js';
export * from '../../../../packages/studio/src/validate.js';
// The closed page background (phase 4), for the renderer and the studio's Page panel.
export * from '../../../../packages/studio/src/background.js';
// The scene vocabulary (shapes, bounds) a 3D page background is edited with; no three.js in it.
export * from '../../../../packages/studio/src/scene.js';
