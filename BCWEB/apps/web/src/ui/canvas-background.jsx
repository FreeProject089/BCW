// A studio page's background, painted (PLAN-STUDIO-2026, 2.4 and phase 4).
//
// The value is closed and normalised in the studio package (packages/studio/src/background.js);
// this only paints it. Every kind but one is a CSS layer whose properties the package builds
// from named fields (`backgroundStyle`), so nothing an author typed reaches a CSS property as
// text and the only url() it can produce is this site's media or a pattern's data: tile.
//
// `scene3d` is the exception, and the reason this file exists apart from canvas-view.jsx:
//
//   · three.js is ~120 KB gzip. It is loaded LAZILY, only by a page that has a 3D background,
//     through hero/ScenePreview.jsx (the same renderer the admin previews the site scene with).
//     Nothing here imports three, so canvas-view.jsx and the studio stay free of it
//     (scripts/bundle-budget.mjs asserts that on the build).
//   · A page has ONE scene and ONE WebGL context. The layer claims the stage
//     (hero/scene-stage.js): App.jsx stops rendering the site's 3D backdrop while it does, and
//     only the first claimant on a page draws live; any other gets the still drawing.
//   · The still drawing (hero/scene-still.js, CSS, no three) is what is painted first, on the
//     server-side render, in thumbnails and on the studio's board (`still`), for a reader who
//     switched the 3D backdrop off, without WebGL2, and when the context is lost.
//   · Reduced motion: the live scene draws one frame and holds it.
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { normalizeBackground, backgroundStyle } from '../lib/canvas.js';
import { sceneStillLayers } from '../hero/scene-still.js';
import { claimStage, ownsStage, subscribeStage } from '../hero/scene-stage.js';
import { getHero3dDisabled } from '../lib/prefs.js';

const PageScene = lazy(() => import('../hero/ScenePreview.jsx'));

/** A crash in the scene (a driver that throws in a shader compile, a chunk that will not load)
 *  stops HERE and becomes the still drawing, not the site's error screen. */
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The layer every kind is drawn in: the frame's box, under the blocks, never under a pointer. */
const LAYER = { position: 'absolute', inset: 0, pointerEvents: 'none', margin: 0 };

function StillScene({ bg }) {
  return sceneStillLayers(bg).map((l) => <div key={l.key} style={l.style} />);
}

/** The scene settings ScenePreview reads, from a normalised `scene3d` background. */
const sceneCfg = (bg) => ({
  shape: bg.shape, surface: bg.surface, detail: bg.detail, noise: bg.noise, speed: bg.speed,
  opacity: bg.opacity, scale: bg.scale, glow: bg.glow, twinkles: bg.twinkles,
  // Behind the page's blocks the pointer is never on the scene: no hover reaction to set up.
  hover: 'none',
});

function SceneLayer({ bg, still, style }) {
  // Decided after mount, never during render: the server render and the first paint are the
  // still drawing, and a page with no WebGL never downloads three.js at all.
  const [owner, setOwner] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (still) return undefined;
    // The stage is claimed even when this layer will draw in CSS: the page has ITS scene, and
    // the site backdrop's own drawing behind it would be a second one.
    const token = {};
    const release = claimStage(token);
    const read = () => setOwner(ownsStage(token));
    read();
    const off = subscribeStage(read);
    return () => { off(); release(); };
  }, [still]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduce(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  // A reader who switched the 3D backdrop off did it for motion, for a weak GPU or because they
  // did not want it; no page overrides that (the same rule App.jsx applies to the backdrop).
  const live = !still && owner && !failed && !getHero3dDisabled()
    && typeof window !== 'undefined' && typeof window.WebGL2RenderingContext !== 'undefined';
  const fail = () => setFailed(true);
  return (
    <div aria-hidden data-cv-bg="scene3d" data-scene-mode={live ? 'live' : 'still'} style={{ ...LAYER, overflow: 'hidden', ...style }}>
      {/* The scene's own box: the top of the frame, at most a screen tall. A 3000px page does not
          get a 3000px canvas to fill every frame, nor a shape in the middle of nowhere. */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 'min(100%, 100vh)' }}>
        {live ? (
          <SceneBoundary onFail={fail}>
            <Suspense fallback={<StillScene bg={bg} />}>
              <PageScene cfg={sceneCfg(bg)} className="absolute inset-0" position={bg.position}
                fps={bg.fps} still={reduce} pauseOffscreen onFail={fail} />
            </Suspense>
          </SceneBoundary>
        ) : <StillScene bg={bg} />}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.bg       the page background (normalised here too; any stored value is safe)
 * @param {boolean} [props.still] never a live scene: thumbnails and the studio's board
 * @param {object} [props.style]  position/size overrides for the layer
 */
export default function CanvasBackground({ bg: raw, still = false, style = null }) {
  const bg = normalizeBackground(raw);
  if (bg.type === 'site') return null;
  if (bg.type === 'scene3d') return <SceneLayer bg={bg} still={still} style={style} />;
  return <div aria-hidden data-cv-bg={bg.type} style={{ ...LAYER, ...backgroundStyle(bg), ...style }} />;
}

/** A small swatch of a background, for the studio's pickers. Never a live scene. */
export function BackgroundThumb({ bg, className = '', label = '' }) {
  const b = normalizeBackground(bg);
  return (
    <span className={`cst-bg-thumb ${className}`} data-bg-thumb={b.type} title={label || undefined}
      style={{ position: 'relative', display: 'block', overflow: 'hidden', isolation: 'isolate' }}>
      <CanvasBackground bg={b} still />
    </span>
  );
}
