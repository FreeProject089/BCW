// D3: the landing-page presets, as cards (Admin → Home page). v4, the snake, added by M2.
//
// Moved out of HomePageEditor (admin.jsx) and reworked:
//   - each wireframe is drawn in its page's real LAYOUT, not as one stack of bars: v1 is a long
//     single column, v2 is one screen with the choice on the left and the media on the right,
//     v3 is a line of header, a strip of numbers, a feed and a side column. The three differ by
//     shape before they differ by section, and a stack of bars hid exactly that;
//   - the card says which page is LIVE (saved) and which one is only selected, because "I
//     clicked it" and "visitors see it" were the same highlight;
//   - every card can be previewed without committing to it (the preview is the real page, with
//     the draft, in HomePageEditor's modal);
//   - labels wrap instead of being cut, in every language.
// The section lists still come from the API (HOME_VARIANTS via /admin/site/home): this screen
// draws them, it does not declare them.
import { Eye, Radio } from 'lucide-react';
import { useI18n } from '../i18n.jsx';

function Bar({ label, strong = false, className = '' }) {
  return (
    <div className={`rounded px-1 py-0.5 min-h-[12px] flex items-center ${strong ? 'tint-primary-strong' : 'bg-[var(--surface-3,var(--line))]'} ${className}`}>
      <span className="text-[7.5px] leading-tight uppercase tracking-wide text-[var(--muted)] break-words">{label}</span>
    </div>
  );
}

function Wire({ v, list, label, t }) {
  const has = (id) => list.includes(id);
  const hero = t('hp.wire.hero', 'HERO');
  if (v === 'v2') {
    return (
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1">
          <div className="space-y-1">
            <Bar label={hero} strong className="h-8" />
            {has('status') && <Bar label={label('status')} />}
            {has('products') && <Bar label={label('products')} className="h-6" />}
          </div>
          <Bar label={t('hp.wire.media', 'MEDIA')} className="h-full min-h-[40px]" />
        </div>
        {has('news') && <Bar label={label('news')} />}
      </div>
    );
  }
  if (v === 'v3') {
    const side = ['poll', 'reviews', 'myo'].filter(has);
    return (
      <div className="space-y-1">
        <Bar label={t('hp.wire.header', 'ONE-LINE HEADER')} strong />
        <Bar label={t('hp.wire.pulse', 'NUMBERS')} />
        <div className="grid grid-cols-3 gap-1">
          <div className="col-span-2 space-y-1">
            {has('status') && <Bar label={label('status')} />}
            {has('news') && <Bar label={label('news')} className="h-10" />}
          </div>
          <div className="space-y-1">
            <Bar label={t('hp.wire.jump', 'WAYS IN')} />
            <Bar label={t('hp.wire.media', 'MEDIA')} />
            {side.map((id) => <Bar key={id} label={label(id)} />)}
          </div>
        </div>
      </div>
    );
  }
  if (v === 'v4') {
    // The snake: stops that alternate sides, joined by one line, then the rest as bars.
    const rest = list.filter((id) => id !== 'steps' && id !== 'myo');
    return (
      <div className="space-y-1">
        <Bar label={hero} strong className="h-5" />
        {has('steps') && (
          <div className="relative rounded bg-[var(--surface-3,var(--line))] px-1 py-1">
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
              <path d="M12 6 C12 13 88 13 88 20 C88 27 12 27 12 34" fill="none" stroke="var(--primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
            </svg>
            <div className="relative space-y-[3px]">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`flex items-center gap-1 ${i % 2 ? 'flex-row-reverse' : ''}`}>
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-[var(--primary)] bg-[var(--bg-solid)] shrink-0" />
                  <span className="h-2 w-1/2 rounded-sm bg-[var(--surface-2)]" />
                </div>
              ))}
            </div>
          </div>
        )}
        {rest.map((id) => <Bar key={id} label={label(id)} />)}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Bar label={hero} strong className="h-6" />
      {list.map((id) => <Bar key={id} label={label(id)} />)}
    </div>
  );
}

/**
 * @param variants     homeVariantList(t)
 * @param variantMap   HOME_VARIANTS from the API ({ v1: { sections } … }) or null while loading
 * @param variant      the draft's choice
 * @param saved        what visitors see now
 * @param onPick       (v) => void
 * @param onPreview    (v) => void: pick it and open the preview
 * @param sectionLabel { id: label }
 */
export default function HomePresetCards({ variants, variantMap, variant, saved, onPick, onPreview, sectionLabel }) {
  const { t } = useI18n();
  const label = (id) => sectionLabel[id] || id;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3" data-home-presets="">
      {variants.map((v) => {
        const list = variantMap?.[v.v]?.sections || [];
        const hasHero = v.v !== 'v3';
        const picked = variant === v.v;
        const live = saved === v.v;
        return (
          <div key={v.v} className={`rounded-xl border p-3 flex flex-col transition-colors ${picked ? 'border-[var(--primary)] tint-primary-soft' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
            <button type="button" onClick={() => onPick(v.v)} aria-pressed={picked} className="text-start flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{v.name}</span>
                {live && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-1.5 py-0.5 border border-[var(--success)] text-[var(--success)]">
                    <Radio size={10} /> {t('hp.preset.live', 'live')}
                  </span>
                )}
                {picked && !live && (
                  <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 border border-[var(--primary)] text-[var(--accent-ink)]">
                    {t('hp.preset.picked', 'selected, not saved')}
                  </span>
                )}
                <span className="ms-auto text-[10px] font-mono text-[var(--faint)]">{v.v}</span>
              </div>
              {/* aria-hidden: the sentence below says the same thing in words. */}
              <div aria-hidden="true" className="mt-2.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-1.5">
                <Wire v={v.v} list={list} label={label} t={t} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">{v.sub}</p>
              <p className="mt-1 text-[10px] text-[var(--faint)]">
                {t('hp.wire.count', '{n} section(s)').replace('{n}', String(list.length + (hasHero ? 1 : 0)))}
              </p>
            </button>
            <button type="button" onClick={() => onPreview(v.v)}
              className="mt-2 self-start inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] underline decoration-dotted">
              <Eye size={12} /> {t('hp.preset.preview', 'Preview this page')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
