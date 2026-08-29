// Draws a page an admin built, from the tree the API stores.
//
// The renderer is deliberately dumb: it knows how to lay blocks out and nothing about what a
// page should contain. Everything rich — bold, links, buttons, cards, tabs, callouts, code,
// maths — comes from ONE block, `text`, whose prop is BetterCommunity markdown. That is why
// the palette is short: the block system already shipped, and re-implementing a button here
// would be a second button that drifts from the one the blog uses.
//
// Three rules the tree obeys, all enforced on the API side and re-checked here because a
// stored tree outlives the code that wrote it:
//   · an unknown block type draws nothing, rather than crashing the page it is on
//   · a `mobile` layout of `null` means "the desktop tree" — inheritance, not an empty phone
//   · a node's `on` list decides which layouts it appears in; absent means both
import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../ui/ui.jsx';
import Markdown, { IconGlyph } from '../ui/md.jsx';
import { fmtNum } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { ProductRows, ShowcasePanel, NewsGrid, NewsFeed, PollCard, ReviewsCard, OffersCard } from './home-sections.jsx';
import StatusBanner from './status-banner.jsx';

/**
 * Which layout to draw, from the viewport.
 *
 * A media query and not a user-agent string: what matters is how wide the window is now, and
 * a phone-shaped browser window on a desktop is a phone-shaped browser window. 768px is the
 * same breakpoint Tailwind's `md:` uses everywhere else on this site, so a built page breaks
 * where the rest of the page breaks.
 *
 * Reactive, unlike the orb: swapping layouts on resize is cheap and is what somebody dragging
 * their window narrower is asking to see.
 */
export function useLayoutMode() {
  const [mode, setMode] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
  ));
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setMode(mq.matches ? 'mobile' : 'desktop');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mode;
}

/* ── Variables ───────────────────────────────────────────────────────────────
   `{{members}}` in a heading or in markdown, resolved against the numbers /stats
   publishes. A name that is not a real statistic renders as NOTHING rather than as
   `{{typo}}` — a visitor should never be shown the template that failed. */
const VAR = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/gi;

export function fillVars(str, vars) {
  if (typeof str !== 'string' || !str.includes('{{')) return str || '';
  return str.replace(VAR, (_, name) => {
    const v = vars?.[name];
    return typeof v === 'number' ? fmtNum(v) : (v == null ? '' : String(v));
  });
}

/* ── Scales ──────────────────────────────────────────────────────────────────
   Named sizes rather than free CSS. An admin picking "large" gets the site's spacing;
   an admin typing `padding: 93px` gets a page that does not match anything else on it. */
const PAD = { none: '', sm: 'py-4', md: 'py-10', lg: 'py-20' };
const GAP = { none: 'gap-0', sm: 'gap-2', md: 'gap-6', lg: 'gap-10' };
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' };
const ITEMS = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' };
const BG = {
  none: null,
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
};
// How wide a section's content is allowed to get. A landing page is a column of different
// widths — a hero is wide, a paragraph is not — and "full" here means the section's own
// container, not the viewport.
const MAXW = { wide: '', narrow: 'max-w-3xl mx-auto', prose: 'max-w-prose mx-auto', full: '' };
const SPACE = { none: 'my-0', sm: 'my-3', md: 'my-8', lg: 'my-16' };

/**
 * A number and what it counts.
 *
 * Three shapes, because the same figure is a different thing in a row of four and in the
 * middle of a sentence. `big` is the one a hero uses; `inline` is the one prose uses.
 */
function Stat({ value, label, icon, style = 'tile' }) {
  if (style === 'inline') {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        {icon && <IconGlyph name={icon} size={14} className="text-[var(--primary-2)] self-center" />}
        <b className="tabular-nums">{value}</b>
        {label && <span className="text-[var(--muted)]">{label}</span>}
      </span>
    );
  }
  const big = style === 'big';
  return (
    <div className="text-center">
      {icon && <IconGlyph name={icon} size={big ? 26 : 20} className="mx-auto mb-1.5 text-[var(--primary-2)]" />}
      <div className={`${big ? 'text-5xl md:text-6xl' : 'text-3xl'} font-extrabold tracking-tight tabular-nums`}>{value}</div>
      {label && <div className={`mt-1 ${big ? 'text-[13px]' : 'text-[12px]'} uppercase tracking-wider text-[var(--faint)]`}>{label}</div>}
    </div>
  );
}

/**
 * A rule, in the four tones a page needs.
 *
 * A `label` turns it into a section marker — a line, a word, a line — which is the one thing
 * a divider is asked to do that a bare rule cannot.
 */
function Divider({ width, style = 'line', space = 'md', label = '' }) {
  const short = width === 'short';
  const cls = `${SPACE[space] ?? SPACE.md} ${short ? 'w-24 mx-auto' : ''}`;
  if (label) {
    return (
      <div className={`flex items-center gap-3 ${SPACE[space] ?? SPACE.md}`}>
        <span className="flex-1 h-px bg-[var(--line)]" />
        <span className="text-[11px] uppercase tracking-wider text-[var(--faint)] shrink-0">{label}</span>
        <span className="flex-1 h-px bg-[var(--line)]" />
      </div>
    );
  }
  if (style === 'dots') {
    return <div className={`${cls} text-center text-[var(--faint)] tracking-[0.6em] select-none`} aria-hidden>···</div>;
  }
  if (style === 'gradient') {
    return (
      <div className={cls} aria-hidden
        style={{ height: 1, background: 'linear-gradient(90deg, transparent, var(--line-strong), transparent)' }} />
    );
  }
  if (style === 'space') return <div className={cls} aria-hidden style={{ height: 1 }} />;
  return <hr className={`border-[var(--line)] ${cls}`} style={style === 'dashed' ? { borderTopStyle: 'dashed' } : undefined} />;
}

/**
 * A card.
 *
 * Holds children, so it holds anything the palette holds — including a markdown block. The
 * props are the frame: a media strip on top (an image, or a colour when there is no art yet),
 * an icon, a title, and optionally the whole thing being a link.
 *
 * `accent` colours the border and the icon rather than the background, because a card whose
 * background is the accent is a button, and a grid of them is unreadable.
 */
function PbCard({ p, vars, children }) {
  const accent = String(p.accent || '').trim();
  const media = p.media && p.media !== 'none';
  const inner = (
    <>
      {media && (
        <div
          className="rounded-t-[13px] overflow-hidden"
          style={{
            height: p.media === 'tall' ? 160 : 96,
            background: p.image ? undefined : (p.bg || 'linear-gradient(120deg, var(--surface-2), var(--surface))'),
          }}
        >
          {p.image && <img src={p.image} alt="" loading="lazy" className="w-full h-full object-cover" />}
        </div>
      )}
      <div className={`p-4 ${ALIGN[p.align] ?? ''}`}>
        {p.icon && (
          <span
            className="inline-grid place-items-center w-9 h-9 rounded-xl mb-2 border border-[var(--line)]"
            style={{ background: 'var(--surface-2)', color: accent || 'var(--primary-2)' }}
          >
            <IconGlyph name={p.icon} size={18} />
          </span>
        )}
        {p.title && <div className="font-semibold text-[15px] leading-snug">{fillVars(p.title, vars)}</div>}
        {children}
      </div>
    </>
  );
  const cls = 'pb-card block rounded-[14px] border overflow-hidden transition-colors h-full';
  const st = {
    background: 'var(--surface)',
    borderColor: accent ? `color-mix(in srgb, ${accent} 45%, var(--line))` : 'var(--line)',
  };
  return String(p.href || '').startsWith('/')
    ? <Link to={p.href} className={cls} style={st}>{inner}</Link>
    : p.href
      ? <a href={p.href} className={cls} style={st} target="_blank" rel="noreferrer noopener">{inner}</a>
      : <div className={cls} style={st}>{inner}</div>;
}

/** The four places a developer actually goes, for a `devtools` block on /dev. */
function DevTools() {
  const { t } = useI18n();
  const rows = [
    { to: '/dev/config', icon: 'sliders', label: t('dev.t.config', 'Keys & webhooks') },
    { to: '/dev/tools', icon: 'flask-conical', label: t('dev.t.tools', 'API console') },
    { to: '/docs/api-reference', icon: 'book-open', label: t('dev.t.ref', 'API reference') },
    { to: '/docs/bcweb-api', icon: 'code', label: t('dev.t.guide', 'Getting started') },
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {rows.map((r) => (
        <Link key={r.to} to={r.to}>
          <Card className="p-4 h-full flex items-center gap-2.5 hover:border-[var(--primary)] transition-colors">
            <IconGlyph name={r.icon} size={17} className="text-[var(--primary-2)] shrink-0" />
            <span className="text-sm font-semibold">{r.label}</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** One node. Returns null for anything this build does not know how to draw. */
function Node({ node, ctx, vars, which, edit }) {
  const p = node.props || {};
  // `on` absent means both layouts. A block placed once should appear on a phone too;
  // hiding it there is the deliberate act, and it has to be recorded as one.
  //
  // In the EDITOR it is dimmed rather than removed: a block that vanishes when you switch to
  // the phone view looks like the editor lost it, and the way back would be knowing that a
  // checkbox on a block you can no longer select is what did it.
  const hidden = Array.isArray(node.on) && node.on.length && !node.on.includes(which);
  if (hidden && !edit) return null;

  const kids = (node.children || []).map((c) => (
    <Node key={c.id} node={c} ctx={ctx} vars={vars} which={which} edit={edit} />
  ));

  const drawn = draw();
  if (!edit) return drawn;
  // The editing chrome, OUTSIDE the block rather than around its markup: the block renders
  // exactly what the live site renders, and everything the editor adds is a wrapper the site
  // never has. That is what stops "it looked right in the editor" from being a sentence
  // anybody says about this.
  return (
    <div
      className={`pb-node${edit.selected === node.id ? ' is-selected' : ''}${hidden ? ' is-off' : ''}`}
      data-label={node.type}
      draggable
      onClick={(e) => { e.stopPropagation(); edit.onSelect(node.id); }}
      onDragStart={(e) => { e.stopPropagation(); edit.onDragStart(node.id, e); }}
      onDragOver={(e) => { if (edit.canDrop(node.id)) { e.preventDefault(); e.stopPropagation(); } }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); edit.onDrop(node.id); }}
    >
      {drawn}
    </div>
  );

  function draw() {
  switch (node.type) {
    /* ── Layout ── */
    case 'section': {
      const bg = BG[p.bg] ?? null;
      return (
        <section
          className={`${PAD[p.pad] ?? PAD.md} ${p.full ? '-mx-4 px-4 sm:-mx-6 sm:px-6' : ''}`}
          style={{ ...(bg ? { background: bg } : {}), ...(Number(p.radius) ? { borderRadius: Number(p.radius) } : {}) }}
        >
          {/* The width lives on an inner wrapper, not the section: a full-bleed band with a
              narrow column inside it is the commonest landing-page shape, and putting the
              max-width on the section itself makes the two mutually exclusive. */}
          <div className={MAXW[p.maxw] ?? ''}>{kids}</div>
        </section>
      );
    }
    case 'row': {
      // `cols: auto` is a flex row that wraps; a number is a real grid, which is what
      // somebody means when they say "three across".
      const n = Number(p.cols);
      const grid = Number.isFinite(n) && n >= 1 && n <= 6;
      return (
        <div
          className={grid
            ? `grid ${GAP[p.gap] ?? GAP.md} ${ITEMS[p.align] ?? ITEMS.stretch}`
            : `flex ${p.wrap === false ? '' : 'flex-wrap'} ${GAP[p.gap] ?? GAP.md} ${ITEMS[p.align] ?? ITEMS.stretch}`}
          style={grid ? { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` } : undefined}
        >
          {kids}
        </div>
      );
    }
    case 'col':
      // `min-w-0` is not decoration: without it an unbreakable string in a child blows the
      // column past its track and takes the page's horizontal scroll with it.
      return <div className={`min-w-0 ${ITEMS[p.align] ?? ''}`} style={{ flex: Number(p.span) > 1 ? `${p.span} 1 0%` : undefined }}>{kids}</div>;
    case 'cards': {
      // `auto` fills the row with as many as fit at `min` px. A number is that many across,
      // which is what somebody means by "three cards".
      const n = Number(p.cols);
      const fixed = Number.isFinite(n) && n >= 1 && n <= 6;
      return (
        <div
          className={`grid ${GAP[p.gap] ?? GAP.md}`}
          style={{
            gridTemplateColumns: fixed
              ? `repeat(${n}, minmax(0, 1fr))`
              : `repeat(auto-fit, minmax(min(${Math.max(140, Math.min(480, Number(p.min) || 240))}px, 100%), 1fr))`,
          }}
        >
          {kids}
        </div>
      );
    }
    case 'card':
      return <PbCard p={p} vars={vars}>{kids}</PbCard>;

    /* ── Content ── */
    case 'heading': {
      const H = `h${Math.min(4, Math.max(1, Number(p.level) || 2))}`;
      const size = { h1: 'text-4xl md:text-5xl', h2: 'text-2xl md:text-3xl', h3: 'text-xl', h4: 'text-lg' }[H];
      return (
        <H className={`${size} font-extrabold tracking-tight ${ALIGN[p.align] ?? ''}`}>
          {p.gradient ? <span className="gradient-text">{fillVars(p.text, vars)}</span> : fillVars(p.text, vars)}
        </H>
      );
    }
    case 'text':
      return (
        <div className={`${ALIGN[p.align] ?? ''} ${p.width === 'prose' ? 'max-w-prose' : ''}`}>
          <Markdown>{fillVars(p.md, vars)}</Markdown>
        </div>
      );
    case 'button': {
      const cls = `doc-btn ${p.style === 'outline' ? 'doc-btn-outline' : ''} doc-btn-${p.size || 'md'}`;
      const inner = <>{p.icon ? <IconGlyph name={p.icon} size={15} /> : null}{fillVars(p.label, vars)}</>;
      // An internal path stays inside the router; anything else is a real navigation and
      // gets the noopener that every external link on this site gets.
      return String(p.href || '').startsWith('/')
        ? <Link to={p.href} className={cls}>{inner}</Link>
        : <a href={p.href} className={cls} target="_blank" rel="noreferrer noopener">{inner}</a>;
    }
    case 'image':
      return (
        <img
          src={p.src} alt={p.alt || ''} loading="lazy"
          className="max-w-full"
          style={{
            borderRadius: Number(p.radius) || 0,
            objectFit: p.fit === 'contain' ? 'contain' : 'cover',
            ...(Number(p.height) > 0 ? { height: Number(p.height), width: '100%' } : {}),
          }}
        />
      );
    case 'spacer':
      return <div style={{ height: Math.max(0, Math.min(400, Number(p.size) || 0)) }} />;
    case 'divider':
      return <Divider {...p} label={fillVars(p.label, vars)} />;
    case 'stat': {
      // A name the site does not publish reads as —, never as 0. The editor offers a fixed
      // list, so a stat gets an unknown name two ways: written through the API, or built
      // against a variable that was retired afterwards. Both used to put a confident zero on
      // a public page, which is indistinguishable from a measurement.
      //
      // A real zero still shows 0. It is the ABSENCE that must not read as a number.
      const raw = vars?.[p.variable];
      return (
        <Stat
          value={raw == null ? '—' : fmtNum(raw)} label={fillVars(p.label, vars)}
          icon={p.icon} style={p.style}
        />
      );
    }

    /* ── Dynamic: the sections the landing pages draw, wherever they were dropped ── */
    case 'showcase': return <ShowcasePanel showcase={ctx.showcase} />;
    case 'products': return <ProductRows products={ctx.products || []} style={p.style} />;
    case 'news':
      // The style is the choice now, not a threshold on the count. `limit > 3 ? feed : grid`
      // meant asking for four headlines silently changed the section's shape.
      return p.style === 'feed'
        ? <NewsFeed posts={ctx.posts || []} limit={Number(p.limit) || 6} />
        : <NewsGrid posts={ctx.posts || []} limit={Number(p.limit) || 3} heading={p.heading !== false} compact={p.style === 'list'} />;
    case 'status': return <StatusBanner />;
    case 'poll': return <PollCard pollData={ctx.pollData} />;
    case 'reviews': return <ReviewsCard reviewsData={ctx.reviewsData} limit={Number(p.limit) || 3} style={p.style} />;
    case 'myo': return <OffersCard myo={ctx.myo} limit={Number(p.limit) || 3} />;
    case 'devtools': return <DevTools />;

    default:
      // A block this build does not know. It draws nothing, on purpose: a tree saved by a
      // newer deploy must not be able to break the page it is on.
      return null;
  }
  }
}

/**
 * A built page.
 *
 * `which` is the layout to draw. It is decided by the caller — from a media query on the
 * site, and from a toolbar in the editor's preview — because the editor has to be able to
 * show the phone layout on a desktop screen.
 */
export default function PageRender({ page, ctx = {}, vars = {}, which = 'desktop', edit = null }) {
  // `mobile: null` inherits. `mobile: []` is a deliberately blank phone layout, and the two
  // have to stay distinguishable — which is why the check is `??` and not `||`.
  const tree = useMemo(
    () => (which === 'mobile' ? (page?.mobile ?? page?.desktop) : page?.desktop) || [],
    [page, which],
  );
  // Empty is nothing on the live site and a drop target in the editor: a builder whose blank
  // canvas has nowhere to drop the first block is a builder you cannot start.
  if (!tree.length && !edit) return null;
  return (
    <div
      className={`pb-page${edit ? ' pb-editing' : ''}`}
      onClick={edit ? () => edit.onSelect(null) : undefined}
      onDragOver={edit ? (e) => { if (edit.canDrop(null)) e.preventDefault(); } : undefined}
      onDrop={edit ? (e) => { e.preventDefault(); edit.onDrop(null); } : undefined}
    >
      {tree.map((n) => <Node key={n.id} node={n} ctx={ctx} vars={vars} which={which} edit={edit} />)}
      {edit && !tree.length && (
        <div className="pb-empty">{edit.emptyLabel}</div>
      )}
    </div>
  );
}
