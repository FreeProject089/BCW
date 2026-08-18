import { useMemo, useState, useEffect, useRef } from 'react';
import { stackLayers, STACK_KINDS } from '../lib/stack-layout.js';

// A project's stack, drawn the way `terraform graph` reads: what nothing depends on at the
// left, and everything that needs it to its right — and clicking a box opens what that box
// actually is.
//
// It draws a CONFIG an admin wrote, never the live infra map. That map is admin-only for a
// reason — it lists secret names and every published port — and a project page is public.
// What is published here is what somebody deliberately put in the project config, which is
// also why it can say things the machine does not know, like which box is somebody else's.
//
// The panel shows only authored fields. A node with nothing but a name shows its name and its
// relationships, and no empty rows: a detail view padded with "—" teaches the reader that the
// page has nothing to say, which is worse than a short panel.

const KIND = {
  // Four hues, validated against both surfaces: inside the lightness band on light, chroma
  // above the floor, worst adjacent CVD pair ΔE 8.8. Contrast against the light surface is
  // below 3:1, which obliges the relief this already has — every node carries its NAME, and
  // the legend below names every kind. Colour is never the only thing saying what a box is.
  edge: { ink: '#a855f7', label: 'Edge' },
  app: { ink: '#0ea5e9', label: 'App' },
  worker: { ink: '#f97316', label: 'Worker' },
  data: { ink: '#22c55e', label: 'Data' },
  // Not a fifth hue. "External" is the ABSENCE of a category — somebody else's box — and the
  // palette check said so: a grey slot fails the chroma floor because it reads as grey. So it
  // is drawn as a neutral with a dashed border instead of competing for a colour.
  external: { ink: null, label: 'External' },
};

// Wide enough for a real name. At 152 the two components of a Tauri app both rendered as
// "better-mods-mana…" — two boxes with the same truncated text, which is not a diagram, and
// the only thing telling them apart was the smallest, faintest line in the node.
const NODE_W = 196;
const NODE_H = 70;
const GAP_X = 78;
const GAP_Y = 22;

export default function StackMap({ stack, t = (k, d) => d }) {
  const nodes = Array.isArray(stack?.nodes) ? stack.nodes.filter((n) => n && n.id) : [];
  const edges = Array.isArray(stack?.edges) ? stack.edges : [];
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null);
  const svgRef = useRef(null);

  const laid = useMemo(() => stackLayers(nodes, edges), [nodes, edges]);
  const { columns, edges: clean, cycles } = laid;

  // A node removed from the config while its panel was open must not leave a stale panel.
  useEffect(() => { if (picked && !nodes.some((n) => n.id === picked)) setPicked(null); }, [nodes, picked]);

  if (!nodes.length) return null;

  const rows = Math.max(1, ...columns.map((c) => c.length));
  const W = columns.length * NODE_W + (columns.length - 1) * GAP_X;
  const H = rows * NODE_H + (rows - 1) * GAP_Y;

  // Where each node sits, so the edges can be drawn from the same numbers the boxes use —
  // two layout passes would drift the moment one of them changed.
  const at = new Map();
  columns.forEach((col, ci) => {
    const offset = (H - (col.length * NODE_H + (col.length - 1) * GAP_Y)) / 2;
    col.forEach((n, ri) => {
      at.set(n.id, { x: ci * (NODE_W + GAP_X), y: offset + ri * (NODE_H + GAP_Y) });
    });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Two components can genuinely carry the same name — a detector reading a monorepo names
  // both halves after the repository, which is correct and unreadable. Where a label is
  // shared, what is drawn is the name PLUS the thing that differs, so the boxes stop being
  // interchangeable and the panel stops saying "X is used by X".
  //
  // Only applied where there is a collision: appending "· Node.js" to a name nothing else
  // shares is noise, and this diagram is mostly names nothing else shares.
  const nameCount = new Map();
  for (const n of nodes) {
    const key = n.label || n.id;
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
  }
  const display = (n) => {
    if (!n) return '';
    const base = n.label || n.id;
    return nameCount.get(base) > 1 && n.tech ? `${base} · ${n.tech}` : base;
  };
  const kindsUsed = STACK_KINDS.filter((k) => nodes.some((n) => (n.kind || 'app') === k));
  // What the drawing highlights: the picked node wins, hover is only a preview of it.
  const focus = picked || hover;
  const related = (id) => clean.some(([a, b]) => (a === focus && b === id) || (b === focus && a === id));
  const dim = (id) => focus && focus !== id && !related(id);

  const order = columns.flatMap((col) => col);
  const move = (from, delta) => {
    const i = order.findIndex((n) => n.id === from);
    const next = order[(i + delta + order.length) % order.length];
    if (next) setPicked(next.id);
  };

  return (
    <div>
      {stack.note && <p className="text-sm text-[var(--muted)] mb-4">{stack.note}</p>}

      <Summary nodes={nodes} edges={clean} layers={columns.length} t={t} />

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Scrolls inside itself. A stack with six columns does not fit a phone, and a diagram
            that widens its parent breaks every layout beside it. */}
        <div className="overflow-x-auto -mx-1 px-1">
          <svg ref={svgRef} viewBox={`-8 -8 ${W + 16} ${H + 16}`} style={{ minWidth: Math.min(W + 16, 900), width: '100%' }}
            role="img" aria-label={t('stack.a11y', '{n} components across {c} layers')
              .replace('{n}', String(nodes.length)).replace('{c}', String(columns.length))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setPicked(null); return; }
              if (!picked) return;
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(picked, 1); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(picked, -1); }
            }}>
            {/* Edges under the boxes, so a line never crosses a name. */}
            {clean.map(([from, to, label], i) => {
              const a = at.get(from); const b = at.get(to);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2;
              const x2 = b.x; const y2 = b.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              const lit = focus === from || focus === to;
              return (
                <g key={i}>
                  <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                    fill="none" stroke="var(--line-strong, var(--line))" strokeWidth="2"
                    opacity={focus ? (lit ? 1 : 0.12) : 0.5} />
                  {/* An edge label is shown only while its end is in focus — every label at once
                      is a wall of text over the drawing. */}
                  {label && lit && (
                    <text x={mid} y={(y1 + y2) / 2 - 5} fontSize="10" textAnchor="middle"
                      fill="var(--muted)" style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }}>{label}</text>
                  )}
                </g>
              );
            })}

            {order.map((n) => {
              const k = KIND[n.kind] || KIND.app;
              const pos = at.get(n.id);
              const isPicked = picked === n.id;
              return (
                <g key={n.id} transform={`translate(${pos.x},${pos.y})`}
                  tabIndex={0} role="button" aria-pressed={isPicked}
                  aria-label={`${n.label || n.id}${n.tech ? ` — ${n.tech}` : ''}`}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                  onClick={() => setPicked(isPicked ? null : n.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(isPicked ? null : n.id); } }}
                  opacity={dim(n.id) ? 0.28 : 1} style={{ cursor: 'pointer' }}>
                  <rect width={NODE_W} height={NODE_H} rx="10"
                    fill="var(--surface-2)" stroke={isPicked ? 'var(--primary-2)' : (k.ink || 'var(--line)')}
                    strokeWidth={isPicked ? 3 : 2}
                    strokeDasharray={k.ink ? undefined : '5 4'} />
                  {/* The kind's colour as a bar, beside the name rather than instead of it. */}
                  {k.ink && <rect x="0" y="0" width="4" height={NODE_H} rx="2" fill={k.ink} />}
                  {/* The full name, always reachable. Truncation is fine as long as it is
                      recoverable, and an SVG <title> is the one tooltip that needs no JS. */}
                  <title>{`${n.label || n.id}${n.tech ? ` — ${n.tech}` : ''}`}</title>
                  <text x="14" y="24" fontSize="13" fill="var(--text)">{clip(n.label || n.id, 22)}</text>
                  {/* tech before kind, and no longer the faintest thing in the box. When two
                      components share a name this line is the ONLY thing that distinguishes
                      them, and it was set in the smallest, palest text in the node. */}
                  {n.tech && <text x="14" y="41" fontSize="11" fill="var(--muted)">{clip(n.tech, 26)}</text>}
                  <text x="14" y={n.tech ? 56 : 41} fontSize="10.5" fill="var(--faint)">{kindLabel(t, n.kind, k)}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <Panel node={picked ? byId.get(picked) : null} edges={clean} byId={byId} kind={KIND}
          onPick={setPicked} onClose={() => setPicked(null)} t={t} count={nodes.length}
          display={display} />
      </div>

      {/* Always present: with more than one kind on screen, identity must never be carried by
          colour alone. */}
      {kindsUsed.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-3">
          {kindsUsed.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <span className="w-3 h-3 rounded-sm border-2" style={{
                borderColor: KIND[k].ink || 'var(--line)',
                borderStyle: KIND[k].ink ? 'solid' : 'dashed',
              }} />
              {kindLabel(t, k, KIND[k])}
            </span>
          ))}
        </div>
      )}

      {cycles > 0 && (
        // Said rather than swallowed: the drawing is odd, and the reason is in the config.
        <p className="text-[11px] text-[var(--warning)] mt-2">
          {t('stack.cycle', 'Something in this diagram depends on itself, so the layout is approximate.')}
        </p>
      )}

      {/* The same thing as a list. A diagram is not readable by everybody, and a table view
          is the relief a below-3:1 palette owes its reader. */}
      <details className="mt-3">
        <summary className="text-[11px] text-[var(--muted)] cursor-pointer">{t('stack.table', 'As a list')}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[12px] w-full">
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id} className="border-t border-[var(--line)]">
                  <td className="py-1 pr-3 font-medium">{n.label || n.id}</td>
                  <td className="py-1 pr-3 text-[var(--muted)]">{kindLabel(t, n.kind, KIND[n.kind] || KIND.app)}</td>
                  <td className="py-1 pr-3 text-[var(--muted)]">{n.tech || ''}</td>
                  <td className="py-1 text-[var(--muted)]">
                    {clean.filter(([, to]) => to === n.id).map(([from]) => display(byId.get(from)) || from).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** A kind's name in the reader's language; the table's English is the fallback. */
const kindLabel = (t, kind, entry) => t(`stack.kind.${kind || 'app'}`, entry?.label || kind || '');

/** Counts that are worth a glance before reading any box. */
function Summary({ nodes, edges, layers, t }) {
  const external = nodes.filter((n) => n.kind === 'external').length;
  const cells = [
    [nodes.length, t('stack.sum.components', 'components')],
    [layers, t('stack.sum.layers', 'layers')],
    [edges.length, t('stack.sum.links', 'links')],
    ...(external ? [[external, t('stack.sum.external', 'external')]] : []),
  ];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 pb-3 border-b border-[var(--line)]">
      {cells.map(([n, label]) => (
        <span key={label} className="text-sm text-[var(--muted)]">
          <b className="text-[var(--text)] tabular-nums">{n}</b> {label}
        </span>
      ))}
    </div>
  );
}

/** What one component is: its role, what it is built from, and both sides of its wiring. */
function Panel({ node, edges, byId, kind, onPick, onClose, t, count, display = (n) => n?.label || n?.id }) {
  if (!node) {
    return (
      <aside className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
        {t('stack.pickHint', 'Select a component to see what it is and what it talks to.')}
        <span className="block mt-1 text-[11px] text-[var(--faint)]">
          {t('stack.pickCount', '{n} to choose from.').replace('{n}', String(count))}
        </span>
      </aside>
    );
  }
  const k = kind[node.kind] || kind.app;
  const needs = edges.filter(([, to]) => to === node.id).map(([from, , label]) => [from, label]);
  const feeds = edges.filter(([from]) => from === node.id).map(([, to, label]) => [to, label]);
  const name = (id) => display(byId.get(id)) || id;

  return (
    <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden">
      <div className="flex items-start gap-2 px-4 py-3 border-b border-[var(--line)]">
        <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: k.ink || 'var(--line)' }} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold break-words" title={node.label || node.id}>{node.label || node.id}</div>
          <div className="text-[11px] text-[var(--muted)]">{kindLabel(t, node.kind, k)}{node.version ? ` · v${node.version}` : ''}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close', 'Close')}
          className="text-[var(--faint)] hover:text-[var(--text)] text-lg leading-none px-1">×</button>
      </div>

      <div className="px-4 py-3 space-y-3 text-sm">
        {node.tech && <Row label={t('stack.f.tech', 'Built with')}>{node.tech}</Row>}
        {node.note && <p className="text-[var(--muted)] leading-relaxed">{node.note}</p>}

        <Side title={t('stack.f.needs', 'Depends on')} list={needs} name={name} onPick={onPick}
          empty={t('stack.f.needsNone', 'Nothing — this is a starting point.')} />
        <Side title={t('stack.f.feeds', 'Used by')} list={feeds} name={name} onPick={onPick}
          empty={t('stack.f.feedsNone', 'Nothing else in this diagram.')} />

        {node.docs && (
          <a href={node.docs} target="_blank" rel="noreferrer"
            className="inline-block text-[13px] text-[var(--primary-2)] hover:underline break-all">
            {t('stack.f.docs', 'Documentation')} ↗
          </a>
        )}
        {node.kind === 'external' && (
          <p className="text-[11px] text-[var(--faint)] border-t border-[var(--line)] pt-2">
            {t('stack.f.externalNote', 'Run by someone else — this project depends on it but does not operate it.')}
          </p>
        )}
      </div>
    </aside>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{label}</div>
      <div>{children}</div>
    </div>
  );
}

/** One side of a component's wiring — each entry jumps the selection to that component. */
function Side({ title, list, name, onPick, empty }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{title}</div>
      {list.length === 0
        ? <div className="text-[12px] text-[var(--faint)]">{empty}</div>
        : (
          <ul className="space-y-1">
            {list.map(([id, label]) => (
              <li key={id}>
                <button type="button" onClick={() => onPick(id)}
                  className="text-[13px] text-left hover:text-[var(--primary-2)] transition">
                  {name(id)}{label && <span className="text-[var(--faint)]"> · {label}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
