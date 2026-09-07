// The two site-theme cards that are not a colour picker: the per-scheme site mark, and the
// gradients.
//
// They live outside admin.jsx because they are the part of that 21k-line file worth
// RENDERING in CI. scripts/check-site-theme.mjs mounts both through react-dom/server, which
// is only affordable for a module that does not drag the whole back-office in with it — the
// same reason block-canvas.jsx is checked that way. Everything they need arrives as props.
import { useRef } from 'react';
import { Sun, Moon, Plus, Trash2, RotateCcw, Sparkles, Upload as UploadIcon, Image as ImageIcon } from 'lucide-react';
import { Badge, Button, Card, ColorInput, Input, Select, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { uploadImage } from '../lib/api.js';
import { GRADIENTS, GRADIENT_PRESETS, STOP_REFS, gradientCss, defaultSpec } from '../ui/theme-gradients.js';

// The site mark, per scheme.
//
// One logo cannot serve both. The BetterCommunity "C" is dark on a light ground, so on the
// near-black dark page it is a dark square on a dark page — which is why the hero already
// carried a hand-written `/logo-white.webp`. That need was real; it was just solved once, in
// one component, by hand. Two fields, and every place the site draws its own mark follows.
//
// Both previews sit on the ACTUAL light and dark page colours rather than on the admin's
// current one, because the whole point is to see the mark against the ground it will land
// on — a white logo previewed on a white panel tells you nothing.
export function BrandMarksCard({ f, setF }) {
  const { t } = useI18n(); const toast = useToast();
  const refs = { logoLight: useRef(null), logoDark: useRef(null) };
  const pick = async (key, file) => {
    if (!file) return;
    try { const url = await uploadImage(file); setF((c) => ({ ...c, [key]: url })); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const ROWS = [
    ['logoLight', t('st.logo.light', 'Light theme'), t('st.logo.lighth', 'Shown on the light page. Usually the standard mark.'), Sun, f.light?.bg || '#f4efe8'],
    ['logoDark', t('st.logo.dark', 'Dark theme'), t('st.logo.darkh', 'Shown on the dark page. Usually a light or knocked-out version.'), Moon, f.dark?.bg || '#0a0907'],
  ];
  return (
    <Card className="p-4 mb-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><ImageIcon size={12} /> {t('st.logos', 'Site mark')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('st.logos.h', 'The logo the site shows for itself — topbar, footer, sign-in, the default avatar. Leave a field empty to use the bundled mark; set only one and it serves both schemes. PNG or SVG with a transparent background, square.')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {ROWS.map(([key, label, hint, Icon, ground]) => (
          <div key={key} className="rounded-xl border border-[var(--line)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2"><Icon size={12} /> {label}</div>
            <div className="flex items-center gap-3">
              {/* The ground is the page colour of that scheme, so a mark that disappears on it
                  disappears here too — which is the one thing this preview exists to show. */}
              <label className="w-16 h-16 rounded-xl border border-[var(--line)] grid place-items-center overflow-hidden cursor-pointer shrink-0"
                style={{ background: ground }} title={t('ai.upload', 'Upload an image')}>
                <input type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={(e) => pick(key, e.target.files?.[0])} />
                {f[key] ? <img src={f[key]} alt="" className="max-w-full max-h-full p-1.5 object-contain" />
                  : <img src="/logo.png" alt="" className="max-w-full max-h-full p-1.5 object-contain opacity-45" />}
              </label>
              <div className="min-w-0 flex-1">
                <Input className="!py-1.5 !text-xs font-mono" value={f[key] || ''} onChange={(e) => setF((c) => ({ ...c, [key]: e.target.value }))} placeholder="/api/media/… or https://…" />
                <div className="flex items-center gap-2 mt-1.5">
                  <input ref={refs[key]} type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={(e) => pick(key, e.target.files?.[0])} />
                  <Button size="sm" variant="ghost" onClick={() => refs[key].current?.click()}><UploadIcon size={13} /> {t('st.logo.up', 'Upload')}</Button>
                  {f[key] && <Button size="sm" variant="ghost" className="!text-error" onClick={() => setF((c) => ({ ...c, [key]: '' }))}><Trash2 size={13} /> {t('st.logo.clear', 'Clear')}</Button>}
                </div>
                <div className="text-[11px] text-[var(--faint)] mt-1">{f[key] ? hint : t('st.logo.bundled', 'Using the bundled mark.')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// The gradients, as something you can actually edit.
//
// Every gradient on the site was written into index.css. Two of its ends were tokens, so the
// COLOURS moved with the accent — but the angle, the stop positions, the number of stops, and
// `.gradient-text`'s third stop (a literal `#fbbf24`) were not reachable from anywhere. That
// last one is the one people report: pick a blue theme and the landing page's headline still
// fades into amber, with no field on this page that explains why.
export function GradientsCard({ f, setF, lang }) {
  const { t } = useI18n();
  const tG = (o) => (lang === 'fr' ? o.fr : o.en);
  const bag = f.gradients || {};
  const setG = (name, spec) => {
    const next = { ...bag };
    if (spec) next[name] = spec; else delete next[name];
    setF({ ...f, gradients: Object.keys(next).length ? next : null });
  };
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Sparkles size={12} /> {t('st.grads', 'Gradients')}</div>
        {Object.keys(bag).length > 0 &&
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setF({ ...f, gradients: null })}><RotateCcw size={13} /> {t('st.grads.clear', 'Back to the shipped gradients')}</Button>}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('st.grads.h', 'The angle and the stops of every accent gradient. A stop can be a fixed colour or one of the accent tokens — an accent stop follows the accent, a fixed one does not. Untouched means the shipped gradient.')}</p>
      <div className="space-y-3">
        {GRADIENTS.map((g) => {
          const spec = bag[g.name] || defaultSpec(g.name);
          const custom = !!bag[g.name];
          const css = gradientCss(spec) || 'none';
          const put = (patch) => setG(g.name, { ...spec, ...patch });
          const setStop = (i, patch) => put({ stops: spec.stops.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
          return (
            <div key={g.name} className="rounded-xl border border-[var(--line)] p-3">
              <div className="flex items-start gap-3 flex-wrap">
                {/* The swatch IS the gradient — same string the stylesheet will get. */}
                <span className="w-20 h-12 rounded-lg border border-[var(--line)] shrink-0" style={{ background: css }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {tG(g.label)}
                    <code className="text-[10px] text-[var(--faint)]">{g.name}</code>
                    {custom && <Badge tone="amber">{t('st.grads.custom', 'custom')}</Badge>}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">{tG(g.affects)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-[10px] text-[var(--faint)] flex flex-col">
                    {t('st.grads.angle', 'Angle')}
                    <input type="range" min={0} max={360} step={5} className="bcw-range w-32" value={spec.angle ?? g.angle} onChange={(e) => put({ angle: Number(e.target.value) })} />
                  </label>
                  <span className="text-xs tabular-nums text-[var(--muted)] w-10">{spec.angle ?? g.angle}°</span>
                </div>
              </div>

              <div className="mt-2.5 space-y-1.5">
                {spec.stops.map((s, i) => {
                  const isRef = STOP_REFS.includes(s.color);
                  return (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap">
                      {/* An accent stop has no fixed colour to show, so the swatch paints the
                          token itself — what it resolves to right now, which is the honest
                          answer to "what colour is this stop". */}
                      {isRef
                        ? <span className="w-8 h-8 rounded border border-[var(--line)] shrink-0" style={{ background: s.color }} title={s.color} />
                        : <ColorInput swatchOnly value={/^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : '#888888'} onChange={(v) => setStop(i, { color: v })} className="w-8 h-8 rounded border border-[var(--line)] cursor-pointer shrink-0" />}
                      <Select className="!w-auto !py-1 !text-xs" value={isRef ? s.color : '__fixed'} onChange={(e) => setStop(i, { color: e.target.value === '__fixed' ? '#f97316' : e.target.value })}>
                        <option value="var(--primary)">{t('st.grads.ref1', 'Accent')}</option>
                        <option value="var(--primary-2)">{t('st.grads.ref2', 'Accent 2')}</option>
                        <option value="var(--text)">{t('st.grads.reft', 'Text colour')}</option>
                        <option value="var(--bg)">{t('st.grads.refb', 'Page colour')}</option>
                        <option value="__fixed">{t('st.grads.fixed', 'Fixed colour')}</option>
                      </Select>
                      {!isRef && <Input className="!w-28 !py-1 font-mono !text-xs" value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} />}
                      <label className="text-[10px] text-[var(--faint)] flex items-center gap-1">
                        {t('st.grads.at', 'at')}
                        <Input className="!w-16 !py-1 !text-xs" type="number" placeholder={t('st.grads.auto', 'auto')} value={s.at ?? ''}
                          onChange={(e) => setStop(i, { at: e.target.value === '' ? undefined : Number(e.target.value) })} />
                        %
                      </label>
                      {spec.stops.length > 2 &&
                        <button onClick={() => put({ stops: spec.stops.filter((_, n) => n !== i) })} className="p-1 rounded text-error hover:bg-error-bg"><Trash2 size={12} /></button>}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-[var(--line)]">
                {spec.stops.length < 8 &&
                  <Button size="sm" variant="ghost" onClick={() => put({ stops: [...spec.stops, { color: 'var(--primary-2)' }] })}><Plus size={13} /> {t('st.grads.addstop', 'Add a stop')}</Button>}
                <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] ms-1">{t('st.grads.presets', 'Presets')}</span>
                {GRADIENT_PRESETS.map((p) => (
                  <button key={p.id} type="button" onClick={() => setG(g.name, p.build(g))}
                    className="px-2 py-1 rounded-lg border border-[var(--line)] hover:border-[var(--line-strong)] text-[11px] flex items-center gap-1.5">
                    <span className="w-5 h-3 rounded-sm" style={{ background: gradientCss(p.build(g)) }} />
                    {tG(p.label)}
                  </button>
                ))}
                {custom && <button type="button" onClick={() => setG(g.name, null)} className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] ms-auto">{t('st.reset', 'reset')}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
