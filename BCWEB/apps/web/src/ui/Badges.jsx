import { IconGlyph } from './md.jsx';

// lucide export name → CDN kebab-case (BadgeCheck → badge-check), so seed/PascalCase names
// and the picker's kebab names both resolve through IconGlyph.
const kebab = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\s+/g, '-').toLowerCase();

// Render a single profile badge (Twitch-chat style). iconType:
//  • "lucide" → a lucide icon (name, any case) rendered colour-inheriting
//  • "brand"  → a Simple Icons brand (slug), rendered in the brand colour
//  • "image"  → an image URL or data URI (svg/png)
export function BadgeIcon({ badge, size = 15 }) {
  if (!badge) return null;
  if (badge.iconType === 'image' || /^(https?:|data:)/i.test(badge.icon || '')) {
    return <img src={badge.icon} alt="" width={size} height={size} className="inline-block object-contain align-[-2px]" style={{ width: size, height: size }} />;
  }
  if (badge.iconType === 'brand') return <IconGlyph name={`simple:${badge.icon}`} size={size} className="inline-block align-[-2px]" />;
  return <span style={{ color: badge.color || 'var(--primary)' }} className="inline-flex align-[-2px]"><IconGlyph name={kebab(badge.icon)} size={size} /></span>;
}

// A row of badge chips shown next to a username. Each has a tooltip (name — description).
// Pass `max` to cap how many render (a "+N" chip covers the rest).
export function Badges({ badges, size = 15, max = 8, className = '' }) {
  if (!badges?.length) return null;
  const shown = badges.slice(0, max);
  const extra = badges.length - shown.length;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {shown.map((b) => (
        <span key={b.id || b.slug} title={b.description ? `${b.name} — ${b.description}` : b.name}
          className="inline-grid place-items-center rounded-md p-[3px]"
          style={{ background: `color-mix(in srgb, ${b.color || 'var(--primary)'} 16%, transparent)` }}>
          <BadgeIcon badge={b} size={size} />
        </span>
      ))}
      {extra > 0 && <span className="text-[11px] text-[var(--faint)] font-semibold">+{extra}</span>}
    </span>
  );
}
