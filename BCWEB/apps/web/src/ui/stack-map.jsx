import { useMemo, useState } from 'react';
import { stackLayers, STACK_KINDS } from '../lib/stack-layout.js';

// A project's stack, drawn the way `terraform graph` reads: what nothing depends on at the
// left, and everything that needs it to its right.
//
// It draws a CONFIG an admin wrote, never the live infra map. That map is admin-only for a
// reason — it lists secret names and every published port — and a project page is public.
// What is published here is what somebody deliberately put in the project config, which is
// also why it can say things the machine does not know, like which box is somebody else's.

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

const NODE_W = 148;
const NODE_H = 54;
const GAP_X = 76;
const GAP_Y = 18;

export default function StackMap({ stack, t = (k, d) => d }) {
  const nodes = Array.isArray(stack?.nodes) ? stack.nodes.filter((n) => n && n.id) : [];
  const edges = Array.isArray(stack?.edges) ? stack.edges : [];
  const [hover, setHover] = useState(null);

  const laid = useMemo(() => stackLayers(nodes, edges), [nodes, edges]);
  const { columns, edges: clean, cycles } = laid;

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

  const kindsUsed = STACK_KINDS.filter((k) => nodes.some((n) => (n.kind || 'app') === k));
  const dim = (id) => hover && hover !== id && !clean.some(([a, b]) => (a === hover && b === id) || (b === hover && a === id));

  return (
    <div>
      {stack.note && <p className="text-sm text-[var(--muted)] mb-4">{stack.note}</p>}

      {/* Scrolls inside itself. A stack with six columns does not fit a phone, and a diagram
          that widens its parent breaks every layout beside it. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} style={{ minWidth: Math.min(W + 16, 980), width: '100%' }}
          role="img" aria-label={t('stack.a11y', '{n} components across {c} layers')
            .replace('{n}', String(nodes.length)).replace('{c}', String(columns.length))}>
          {/* Edges under the boxes, so a line never crosses a name. */}
          {clean.map(([from, to], i) => {
            const a = at.get(from); const b = at.get(to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2;
            const x2 = b.x; const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const lit = hover === from || hover === to;
            return (
              <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                fill="none" stroke="var(--line-strong, var(--line))" strokeWidth="2"
                opacity={hover ? (lit ? 1 : 0.15) : 0.55} />
            );
          })}

          {columns.flatMap((col) => col).map((n) => {
            const k = KIND[n.kind] || KIND.app;
            const pos = at.get(n.id);
            return (
              <g key={n.id} transform={`translate(${pos.x},${pos.y})`}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                opacity={dim(n.id) ? 0.3 : 1} style={{ cursor: n.note ? 'help' : 'default' }}>
                <title>{n.note ? `${n.label || n.id} — ${n.note}` : (n.label || n.id)}</title>
                <rect width={NODE_W} height={NODE_H} rx="10"
                  fill="var(--surface-2)" stroke={k.ink || 'var(--line)'} strokeWidth="2"
                  strokeDasharray={k.ink ? undefined : '5 4'} />
                {/* The kind's colour as a bar, beside the name rather than instead of it. */}
                {k.ink && <rect x="0" y="0" width="4" height={NODE_H} rx="2" fill={k.ink} />}
                <text x="14" y="23" fontSize="13" fill="var(--text)">{n.label || n.id}</text>
                <text x="14" y="40" fontSize="10.5" fill="var(--muted)">{k.label}</text>
              </g>
            );
          })}
        </svg>
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
              {KIND[k].label}
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
                  <td className="py-1 pr-3 text-[var(--muted)]">{(KIND[n.kind] || KIND.app).label}</td>
                  <td className="py-1 text-[var(--muted)]">
                    {clean.filter(([, to]) => to === n.id).map(([from]) => from).join(', ') || '—'}
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
