// D4: the 3D scene's transitions, edited inside Admin → Home page → 3D scene (SceneEditor in
// admin.jsx renders this). What is stored and why the defaults are "off" is in
// apps/api/src/lib/scene-transitions.mjs; what the renderer does with it, including the
// reduced-motion rule and the frame budget, is in hero/Hero3D.jsx.
//
// The playlist is the scene's own shape first, then the shapes picked here, in the order they
// were picked (the order is the order the site moves through them).
import { Repeat2, MousePointer2, Timer, RotateCw, Route, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Explain, Button } from '../ui/ui.jsx';
import { SCENE_DEFAULTS, TRANSITION_MAX_SHAPES } from '../hero/scene-config.js';

export default function SceneTransitionsEditor({ cfg, set, shapes, names }) {
  const { t } = useI18n();
  const tr = { ...SCENE_DEFAULTS.transitions, ...(cfg.transitions || {}) };
  const trg = { ...SCENE_DEFAULTS.transitions.triggers, ...(tr.triggers || {}) };
  const patch = (p) => set({ transitions: { ...tr, ...p } });
  const extra = (tr.shapes || []).filter((s) => s !== cfg.shape);
  const toggleShape = (s) => {
    if (s === cfg.shape) return;
    const has = extra.includes(s);
    if (!has && extra.length >= TRANSITION_MAX_SHAPES - 1) return;
    patch({ shapes: has ? extra.filter((x) => x !== s) : [...extra, s] });
  };
  const playlist = [cfg.shape, ...extra];
  const anyTrigger = Object.values(trg).some(Boolean);

  const TRIGGERS = [
    ['hover', MousePointer2, t('scn.tr.hover', 'When the pointer lands on it')],
    ['interval', Timer, t('scn.tr.interval', 'Every few seconds')],
    ['reload', RotateCw, t('scn.tr.reload', 'On each page load')],
    ['route', Route, t('scn.tr.route', 'On each change of page')],
  ];
  const STYLES = [
    ['fade', t('scn.tr.fade', 'Fade'), t('scn.tr.fade.d', 'The surface dims out and comes back as the next shape.')],
    ['burst', t('scn.tr.burst', 'Shatter'), t('scn.tr.burst.d', 'It breaks into its faces, and the faces that come back together are the next shape.')],
  ];

  return (
    <div className="mt-6 pt-5 border-t border-[var(--line)]" data-scene-transitions="">
      <div className="text-[13px] font-medium mb-1 flex items-center gap-1.5"><Repeat2 size={14} className="text-[var(--accent-ink)]" /> {t('scn.tr.title', 'Transitions between scenes')}</div>
      <Explain className="mb-3 max-w-2xl" summary={t('scn.tr.d2', 'Give the scene more than one shape and say when it moves to the next.')}>
        <p className="text-[11px] text-[var(--muted)] leading-snug">
          {t('scn.tr.d3', 'Visitors who ask their system for reduced motion never see a transition play; the page-load rotation still applies to them, since a first frame is not a movement. A transition runs at full frame rate while it plays, then the scene goes back to its frame budget.')}
        </p>
      </Explain>

      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('scn.tr.list', 'Shapes, in order')}</div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {shapes.map((s) => {
          const pos = playlist.indexOf(s);
          const on = pos >= 0;
          const base = s === cfg.shape;
          return (
            <button key={s} type="button" onClick={() => toggleShape(s)} aria-pressed={on} disabled={base}
              title={base ? t('scn.tr.base', 'The scene’s own shape, always first') : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${on ? 'border-[var(--primary)] tint-primary-soft' : 'border-[var(--line)] hover:border-[var(--line-strong)]'} ${base ? 'cursor-default' : ''}`}>
              {on && <span className="text-[10px] tabular-nums text-[var(--faint)]">{pos + 1}</span>}
              {names[s]?.[0] || s}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--muted)] mb-4">
        {playlist.length > 1
          ? t('scn.tr.order', 'The scene moves through these {n} shapes in this order, then starts again.').replace('{n}', String(playlist.length))
          : t('scn.tr.one', 'One shape: nothing to move between. Pick at least one more.')}
      </p>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <div className="text-[13px] font-medium mb-1.5">{t('scn.tr.when', 'When it moves')}</div>
          <div className="space-y-1.5">
            {TRIGGERS.map(([k, I, label]) => (
              <label key={k} className="flex items-start gap-2 text-[13px] cursor-pointer select-none">
                <input type="checkbox" className="accent-[var(--primary)] mt-0.5" checked={!!trg[k]} disabled={playlist.length < 2}
                  onChange={(e) => patch({ triggers: { ...trg, [k]: e.target.checked } })} />
                <I size={14} className="text-[var(--muted)] shrink-0 mt-0.5" />
                <span className="min-w-0">{label}</span>
              </label>
            ))}
          </div>
          {trg.interval && (
            <label className="block mt-3">
              <span className="text-[12px] text-[var(--muted)]">{t('scn.tr.every', 'Every {n} s').replace('{n}', String(tr.intervalSec))}</span>
              <input type="range" min={5} max={600} step={5} value={tr.intervalSec} onChange={(e) => patch({ intervalSec: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
              <span className="flex justify-between text-[10px] tabular-nums text-[var(--faint)]"><span>5 s</span><span>{t('scn.default', 'default {v}').replace('{v}', `${SCENE_DEFAULTS.transitions.intervalSec} s`)}</span><span>600 s</span></span>
            </label>
          )}
        </div>
        <div>
          <div className="text-[13px] font-medium mb-1.5">{t('scn.tr.how', 'How it moves')}</div>
          <div className="flex flex-wrap gap-2">
            {STYLES.map(([k, label]) => (
              <button key={k} type="button" onClick={() => patch({ style: k })} aria-pressed={tr.style === k}
                className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${tr.style === k ? 'border-[var(--primary)] tint-primary-soft' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>{label}</button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--muted)] leading-snug mt-1.5">{STYLES.find(([k]) => k === tr.style)?.[2]}</p>
          <label className="block mt-3">
            <span className="text-[12px] text-[var(--muted)]">{t('scn.tr.dur', 'Length {n} s').replace('{n}', (tr.durationMs / 1000).toFixed(1))}</span>
            <input type="range" min={300} max={3000} step={100} value={tr.durationMs} onChange={(e) => patch({ durationMs: Number(e.target.value) })} className="w-full accent-[var(--primary)]" />
            <span className="flex justify-between text-[10px] tabular-nums text-[var(--faint)]"><span>0.3 s</span><span>{t('scn.default', 'default {v}').replace('{v}', `${(SCENE_DEFAULTS.transitions.durationMs / 1000).toFixed(1)} s`)}</span><span>3.0 s</span></span>
          </label>
        </div>
      </div>
      {playlist.length > 1 && !anyTrigger && (
        <p className="text-[11px] text-warning mt-3">{t('scn.tr.notrigger', 'No moment is ticked, so the scene stays on its first shape.')}</p>
      )}
      {/* M18 (agent-perf-M18): a way back to the shipped state (one shape, nothing ticked). */}
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={() => set({ transitions: SCENE_DEFAULTS.transitions })}>
          <RotateCcw size={13} /> {t('scn.tr.reset', 'No transitions (default)')}
        </Button>
      </div>
    </div>
  );
}
