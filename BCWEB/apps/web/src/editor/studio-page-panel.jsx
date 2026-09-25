// The studio's Page panel: the page's background, its stylesheet and file imports.
// Moved out of editor/canvas-studio.jsx (studio phase 8).
import { useEffect, useState } from 'react';
import { Trash2, Plus, Upload } from 'lucide-react';
import { Button, Field, Input, Textarea, Select, useToast } from '../ui/ui.jsx';
import { uploadMedia } from '../lib/api.js';
import { PATTERNS } from '../lib/patterns.js';
import { BackgroundThumb } from '../ui/canvas-background.jsx';
import { sanitizeSvg } from '../lib/svg-safe.js';
import { scopeCss } from '../lib/css-scope.js';
import {
  BACKGROUND_TYPES, BG_TOKENS, BG_IMAGE_FITS, BG_POSITIONS, SCENE3D_POSITIONS, BOARD_GRIDS, GRADIENT_STOPS, bgColor, patternColor, bgImagePath,
  SCENE_SHAPES, SCENE_SURFACES, SCENE_BOUNDS, detailMaxFor,
} from '../lib/canvas.js';

/**
 * What each background kind starts as when it is picked. `image` has no picture yet, which
 * normalises to `site`: the panel holds the chosen kind itself until a picture is set.
 */
const BG_START = {
  site: { type: 'site' },
  color: { type: 'color', color: 'var(--surface-2)' },
  gradient: { type: 'gradient', angle: 135, stops: [{ color: 'var(--primary)', at: 0 }, { color: 'var(--primary-2)', at: 100 }] },
  image: { type: 'image', src: '', fit: 'cover', position: 'center' },
  pattern: { type: 'pattern', id: 'dots', color: '#000000', size: 24, opacity: 0.18 },
  scene3d: { type: 'scene3d', shape: 'orb' },
  board: { type: 'board', color: 'var(--surface-2)', grid: 24 },
};
/** A few ready-made values per kind, shown as thumbnails under the kind picker. */
const BG_PRESETS = {
  color: ['var(--bg)', 'var(--surface)', 'var(--surface-2)', 'var(--surface-3)', 'var(--primary)', '#0f172a', '#fafaf9', '#fef3c7']
    .map((color) => ({ type: 'color', color })),
  gradient: [
    [135, 'var(--primary)', 'var(--primary-2)'], [180, 'var(--surface-2)', 'var(--bg)'], [160, '#0f172a', '#334155'],
    [120, '#fdf2f8', '#ede9fe'], [90, '#ecfeff', '#f0fdf4'], [200, '#1e1b4b', '#4c1d95'],
  ].map(([angle, a, b]) => ({ type: 'gradient', angle, stops: [{ color: a, at: 0 }, { color: b, at: 100 }] })),
  pattern: PATTERNS.map((p) => ({ type: 'pattern', id: p.id, color: '#000000', size: 24, opacity: 0.18 })),
  scene3d: SCENE_SHAPES.map((shape) => ({ type: 'scene3d', shape })),
  board: [0, 16, 24, 32].map((grid) => ({ type: 'board', color: 'var(--surface-2)', grid })),
};

/** Every label the Page panel prints, as literal keys (i18n-check reads literals only). */
export function bgNames(t) {
  return {
    type: {
      site: t('cst.bg.type.site', 'Site'), color: t('cst.bg.type.color', 'Colour'), gradient: t('cst.bg.type.gradient', 'Gradient'),
      image: t('cst.bg.type.image', 'Picture'), pattern: t('cst.bg.type.pattern', 'Pattern'), scene3d: t('cst.bg.type.scene3d', '3D scene'),
      board: t('cst.bg.type.board', 'Board'),
    },
    hint: {
      site: t('cst.bg.type.site.h', 'Nothing of its own: the site background, and the site\u2019s 3D backdrop, show through.'),
      color: t('cst.bg.type.color.h', 'One colour behind the page. A site colour follows the reader\u2019s light or dark theme; your own does not.'),
      gradient: t('cst.bg.type.gradient.h', 'A straight gradient, two to four colours at an angle.'),
      image: t('cst.bg.type.image.h', 'A picture uploaded to this site, stretched, fitted or tiled.'),
      pattern: t('cst.bg.type.pattern.h', 'A tiling pattern in one colour.'),
      scene3d: t('cst.bg.type.scene3d.h', 'The site\u2019s 3D scene, set for this page alone.'),
      board: t('cst.bg.type.board.h', 'A colour and a dot grid that go on past the edges of the page, like a drawing board. The page grows with its content.'),
    },
    token: {
      bg: t('cst.bg.token.bg', 'Page'), 'bg-solid': t('cst.bg.token.bg-solid', 'Page, opaque'), surface: t('cst.bg.token.surface', 'Surface'),
      'surface-2': t('cst.bg.token.surface-2', 'Surface 2'), 'surface-3': t('cst.bg.token.surface-3', 'Surface 3'),
      primary: t('cst.bg.token.primary', 'Accent'), 'primary-2': t('cst.bg.token.primary-2', 'Second accent'), text: t('cst.bg.token.text', 'Text'),
      muted: t('cst.bg.token.muted', 'Muted text'), line: t('cst.bg.token.line', 'Line'), success: t('cst.bg.token.success', 'Success'),
      warning: t('cst.bg.token.warning', 'Warning'), error: t('cst.bg.token.error', 'Error'), info: t('cst.bg.token.info', 'Information'),
    },
    fit: { cover: t('cst.bg.fit.cover', 'Cover the page'), contain: t('cst.bg.fit.contain', 'Whole picture'), tile: t('cst.bg.fit.tile', 'Tile') },
    pos: {
      center: t('cst.bg.pos.center', 'Centre'), top: t('cst.bg.pos.top', 'Top'), bottom: t('cst.bg.pos.bottom', 'Bottom'),
      left: t('cst.bg.pos.left', 'Left'), right: t('cst.bg.pos.right', 'Right'),
    },
    scene: {
      detail: t('scn.detail', 'Detail'), noise: t('scn.noise', 'Distortion'), speed: t('scn.speed', 'Speed'), opacity: t('scn.opacity', 'Presence'),
      scale: t('scn.scale', 'Size'), glow: t('scn.glow', 'Halo'), twinkles: t('scn.tw', 'Dust'), fps: t('scn.fps', 'Frame budget'),
    },
    shape: {
      orb: t('scn.orb', 'Orb'), prism: t('scn.prism', 'Prism'), crystal: t('scn.crystal', 'Crystal'), gem: t('scn.gem', 'Gem'),
      ring: t('scn.ring', 'Knot'), halo: t('scn.halo', 'Halo'), cube: t('scn.cube', 'Cube'), spire: t('scn.spire', 'Spire'),
      capsule: t('scn.capsule', 'Capsule'), spiral: t('scn.spiral', 'Spiral'), vase: t('scn.vase', 'Vase'),
    },
    surface: { solid: t('scn.sf.solid', 'Solid'), wire: t('scn.sf.wire', 'Wireframe'), both: t('scn.sf.both', 'Both') },
  };
}

/** One colour: a site token (follows the reader's theme) or a hex of the author's own. */
export function BgColorField({ t, names, label, value, onChange, hexOnly = false }) {
  const token = /^var\(--([a-z0-9-]+)\)$/.exec(value || '')?.[1] || '';
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000';
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        {!hexOnly && (
          <Select value={token || 'hex'} onChange={(e) => onChange(e.target.value === 'hex' ? hex : `var(--${e.target.value})`)} className="!w-auto min-w-0 flex-1"
            aria-label={t('cst.bg.color.kind', 'Site colour or your own')}>
            {BG_TOKENS.map((k) => <option key={k} value={k}>{names.token[k] || k}</option>)}
            <option value="hex">{t('cst.bg.token.hex', 'Your own colour')}</option>
          </Select>
        )}
        {(hexOnly || !token) && (<>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label={label}
            className="h-8 w-9 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0.5" />
          <Input value={value || ''} onChange={(e) => onChange(e.target.value.trim())} placeholder="#1e293b" className="min-w-0 flex-1 font-mono text-[12px]" spellCheck={false} />
        </>)}
      </div>
      {value && !(hexOnly ? patternColor(value) : bgColor(value)) && (
        <p className="text-[11.5px] text-warning mt-1">{t('cst.bg.color.bad', 'Not a colour this page can use: a hex like #1e293b, or one of the site colours.')}</p>
      )}
    </Field>
  );
}

/** A slider for one number of the 3D scene, with its bounds from the shared vocabulary. */
export function SceneSlider({ label, k, value, shape, onChange }) {
  const b = SCENE_BOUNDS[k];
  const max = k === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max;
  const shown = b.unit === 'pct' ? `${Math.round(value * 100)} %` : b.unit === 'x' ? `${Number(value).toFixed(2)}x` : b.unit === 'fps' ? `${value} fps` : String(value);
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[11.5px] text-[var(--muted)]">
        <span>{label}</span><span className="tabular-nums">{shown}</span>
      </span>
      <input type="range" min={b.min} max={max} step={b.step} value={value} className="w-full"
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/**
 * The page itself: its background, the author's stylesheet (scoped), and file imports.
 *
 * A dock panel since phase 4 (PLAN-STUDIO-2026): it used to be a modal with its own Save, so
 * trying a background meant open, type, save, look, reopen. Every change now goes straight to
 * the document through `emit`, with undo, like every other panel, and the board shows it.
 */
export function PagePanel({ t, canvas, emit, add, onClose = null }) {
  const bg = canvas.background || { type: 'site' };
  const names = bgNames(t);
  // The kind being edited. Usually the document's own; different only while a kind that needs
  // something first (an image with no picture yet) has been picked and not filled in.
  const [kind, setKind] = useState(bg.type);
  useEffect(() => { setKind(bg.type); }, [bg.type]);
  const [upBusy, setUpBusy] = useState(false);
  const toast = useToast();
  const setBg = (next, extra = {}) => emit(canvas.blocks, { background: next, ...extra }, 'page-bg');
  const pick = (type) => {
    setKind(type);
    if (type === bg.type) return;
    // The board is the "infinite canvas" reading of a page: its frame follows its content.
    const extra = type === 'board' ? { frames: { desktop: { fit: 'content' }, phone: { fit: 'content' } } } : {};
    setBg(BG_START[type], extra);
  };
  const set = (k, v) => setBg({ ...bg, [k]: v });
  const { refused } = scopeCss(canvas.css || '', '[data-cv="x"]');
  const importFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    if (/\.svg$/i.test(file.name)) { add('svg', { props: { svg: sanitizeSvg(text) }, w: 320, h: 320 }); onClose?.(); }
    else emit(canvas.blocks, { css: (canvas.css ? `${canvas.css}\n\n` : '') + `/* ${file.name} */\n${text}` }, 'page-css-import');
  };
  const upload = async (file) => {
    if (!file) return;
    setUpBusy(true);
    try {
      const url = await uploadMedia(file);
      if (bgImagePath(url)) setBg({ type: 'image', src: url, fit: bg.type === 'image' ? bg.fit : 'cover', position: bg.type === 'image' ? bg.position : 'center' });
      else toast.error(t('cst.bg.image.bad', 'That picture is not stored on this site, so it cannot be a background.'));
    } catch { toast.error(t('cst.bg.image.fail', 'The picture could not be uploaded.')); }
    finally { setUpBusy(false); }
  };
  const img = bg.type === 'image' ? bg : BG_START.image;
  const stops = bg.type === 'gradient' ? bg.stops : [];
  const setStop = (i, patchStop) => set('stops', stops.map((s, j) => (j === i ? { ...s, ...patchStop } : s)));
  const presets = BG_PRESETS[kind] || [];
  const presetName = (p) => (p.type === 'pattern' ? t(`cst.pattern.${p.id}`, PATTERNS.find((x) => x.id === p.id)?.name || p.id)
    : p.type === 'scene3d' ? names.shape[p.shape] : p.type === 'color' ? (names.token[/^var\(--([a-z0-9-]+)\)$/.exec(p.color)?.[1]] || p.color) : '');
  return (
    <div className="space-y-3 text-sm" data-page-panel>
      <section className="space-y-2" aria-label={t('cst.bg.page', 'Page background')}>
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('cst.bg.page', 'Page background')}</div>
        {canvas.bgNote === 'replaced' && (
          <p className="text-[11.5px] text-warning" data-bg-note>
            {t('cst.bg.replaced', 'This page had a background the studio no longer accepts (free CSS). It is shown with the site background instead; pick one here and save to keep the change.')}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t('cst.bg.kind', 'Kind of background')}>
          {BACKGROUND_TYPES.map((type) => (
            <button key={type} type="button" role="radio" aria-checked={kind === type} onClick={() => pick(type)} data-bg-kind={type}
              className={`rounded-lg border p-1 text-[11px] text-left transition-colors ${kind === type ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              <BackgroundThumb bg={type === bg.type ? bg : BG_START[type]} className="h-9 w-full rounded-md border border-[var(--line)] bg-[var(--bg)]" />
              <span className="mt-1 block truncate" title={names.type[type]}>{names.type[type]}</span>
            </button>
          ))}
        </div>
        <p className="text-[11.5px] text-[var(--muted)]">{names.hint[kind]}</p>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={t('cst.bg.presets', 'Ready-made')}>
            {presets.map((p, i) => (
              <button key={i} type="button" onClick={() => setBg(p, kind === 'board' ? { frames: { desktop: { fit: 'content' }, phone: { fit: 'content' } } } : {})}
                title={presetName(p) || undefined} aria-label={presetName(p) || t('cst.bg.preset', 'Ready-made background')}
                className="rounded-md border border-[var(--line)] p-0.5 hover:border-[var(--primary)]">
                <BackgroundThumb bg={p} className="h-8 w-12 rounded bg-[var(--bg)]" />
              </button>
            ))}
          </div>
        )}

        {bg.type === 'color' && <BgColorField t={t} names={names} label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />}

        {bg.type === 'gradient' && (<>
          <label className="block">
            <span className="flex items-center justify-between text-[11.5px] text-[var(--muted)]"><span>{t('cst.bg.angle', 'Angle')}</span><span className="tabular-nums">{bg.angle}°</span></span>
            <input type="range" min={0} max={360} step={5} value={bg.angle} onChange={(e) => set('angle', Number(e.target.value))} className="w-full" />
          </label>
          {stops.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_auto] items-end gap-1.5">
              <BgColorField t={t} names={names} label={`${t('cst.bg.stop', 'Stop')} ${i + 1}`} value={s.color} onChange={(v) => setStop(i, { color: v })} />
              <Field label={t('cst.bg.at', 'At (%)')}><Input type="number" min={0} max={100} value={s.at} onChange={(e) => setStop(i, { at: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
              <Button size="sm" variant="ghost" className="!px-2 mb-0.5" disabled={stops.length <= GRADIENT_STOPS.min}
                onClick={() => set('stops', stops.filter((_, j) => j !== i))} title={t('cst.bg.stop.rm', 'Remove this stop')} aria-label={t('cst.bg.stop.rm', 'Remove this stop')}><Trash2 size={13} /></Button>
            </div>
          ))}
          {stops.length < GRADIENT_STOPS.max && (
            <Button size="sm" variant="ghost" onClick={() => set('stops', [...stops, { color: stops[stops.length - 1]?.color || '#ffffff', at: 100 }])}><Plus size={13} /> {t('cst.bg.stop.add', 'Add a stop')}</Button>
          )}
        </>)}

        {kind === 'image' && (<>
          <div className="flex items-center gap-2">
            {bg.type === 'image' && <BackgroundThumb bg={bg} className="h-12 w-20 shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)]" />}
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
              <Upload size={13} /> {upBusy ? t('common.loading', 'Loading…') : t('cst.bg.image.up', 'Upload a picture')}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" disabled={upBusy}
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <Field label={t('cst.bg.image.src', 'Picture on this site')} hint={t('cst.bg.image.src.h', 'An upload from this site (/api/media/...). A picture from another site cannot be a background: every visitor would fetch it from there.')}>
            <Input value={bg.type === 'image' ? bg.src : ''} placeholder="/api/media/..." className="font-mono text-[12px]" spellCheck={false}
              onChange={(e) => { const src = e.target.value.trim(); if (bgImagePath(src)) setBg({ ...img, type: 'image', src }); }} />
          </Field>
          {bg.type === 'image' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('cst.bg.fit', 'Fit')}><Select value={bg.fit} onChange={(e) => set('fit', e.target.value)}>{BG_IMAGE_FITS.map((f) => <option key={f} value={f}>{names.fit[f]}</option>)}</Select></Field>
              <Field label={t('cst.bg.pos', 'Position')}><Select value={bg.position} onChange={(e) => set('position', e.target.value)}>{BG_POSITIONS.map((f) => <option key={f} value={f}>{names.pos[f]}</option>)}</Select></Field>
            </div>
          )}
        </>)}

        {bg.type === 'pattern' && (<>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('cst.pattern', 'Pattern')}><Select value={bg.id} onChange={(e) => set('id', e.target.value)}>{PATTERNS.map((x) => <option key={x.id} value={x.id}>{t(`cst.pattern.${x.id}`, x.name)}</option>)}</Select></Field>
            <BgColorField t={t} names={names} hexOnly label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />
            <Field label={t('cst.pattern.size', 'Tile (px)')}><Input type="number" min={6} max={160} value={bg.size} onChange={(e) => set('size', Math.max(6, Math.min(160, Number(e.target.value) || 24)))} /></Field>
            <Field label={t('cst.pattern.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={bg.opacity} onChange={(e) => set('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>
          </div>
        </>)}

        {bg.type === 'scene3d' && (<>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('cst.bg.scene.shape', 'Shape')}><Select value={bg.shape} onChange={(e) => set('shape', e.target.value)}>{SCENE_SHAPES.map((s) => <option key={s} value={s}>{names.shape[s] || s}</option>)}</Select></Field>
            <Field label={t('cst.bg.scene.surface', 'Surface')}><Select value={bg.surface} onChange={(e) => set('surface', e.target.value)}>{SCENE_SURFACES.map((s) => <option key={s} value={s}>{names.surface[s]}</option>)}</Select></Field>
            <Field label={t('cst.bg.pos', 'Position')}><Select value={bg.position} onChange={(e) => set('position', e.target.value)}>{SCENE3D_POSITIONS.map((s) => <option key={s} value={s}>{names.pos[s]}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {Object.keys(SCENE_BOUNDS).map((k) => <SceneSlider key={k} label={names.scene[k]} k={k} value={bg[k]} shape={bg.shape} onChange={(v) => set(k, v)} />)}
          </div>
          <p className="text-[11.5px] text-[var(--muted)]">{t('cst.bg.scene.h', 'One 3D scene per page: it takes the place of the site’s 3D backdrop on this page. A reader who asked for less motion gets a still frame, and one without WebGL (or who switched the 3D backdrop off) gets a drawing of the shape. The board shows that drawing; the preview shows the real scene.')}</p>
        </>)}

        {bg.type === 'board' && (
          <div className="grid grid-cols-2 gap-2">
            <BgColorField t={t} names={names} label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />
            <Field label={t('cst.bg.grid', 'Dot grid')}><Select value={String(bg.grid)} onChange={(e) => set('grid', Number(e.target.value))}>{BOARD_GRIDS.map((g) => <option key={g} value={g}>{g ? `${g}px` : t('cst.bg.grid.none', 'None')}</option>)}</Select></Field>
          </div>
        )}
      </section>

      <Field label={t('cst.css', 'Custom CSS (scoped to this page)')} hint={t('cst.css.h', 'Every selector is confined to this page. @import, external url(), expression() and behaviour are refused. Tailwind utilities work only if the site’s build already contains them — prefer plain CSS here.')}>
        <Textarea rows={8} value={canvas.css || ''} onChange={(e) => emit(canvas.blocks, { css: e.target.value }, 'page-css')} className="font-mono text-[12px]" spellCheck={false} placeholder={'.hero { letter-spacing: .02em }\n@media (max-width: 640px) { .cv-shell { border-radius: 8px } }'} />
      </Field>
      {refused.length > 0 && <p className="text-[11.5px] text-warning">{t('cst.css.refused', 'Left out:')} {refused.join(' · ')}</p>}
      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
        <Upload size={13} /> {t('cst.import', 'Import a .css or .svg file')}
        <input type="file" accept=".css,.svg,text/css,image/svg+xml" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}
