import * as Lucide from 'lucide-react';

// Render a single profile badge (Twitch-chat style). iconType:
//  • "lucide" → a named lucide-react icon (icon = the export name, e.g. "BadgeCheck")
//  • "image" / "brand" → an image URL or data URI (svg/png), e.g. an uploaded logo
// The colour tints a lucide icon; images render as-is.
export function BadgeIcon({ badge, size = 15 }) {
  if (!badge) return null;
  if (badge.iconType === 'image' || badge.iconType === 'brand') {
    return <img src={badge.icon} alt="" width={size} height={size} className="inline-block object-contain align-[-2px]" style={{ width: size, height: size }} />;
  }
  const Ico = Lucide[badge.icon] || Lucide.BadgeCheck;
  return <Ico size={size} style={{ color: badge.color || 'var(--primary)' }} className="inline-block align-[-2px]" />;
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
