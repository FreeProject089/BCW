import BoringAvatar from 'boring-avatars';

// On-brand Boring Avatars. Variant + seed come from the user's saved avatar,
// falling back to a stable seed (id / display name).
export const VARIANTS = ['beam', 'marble', 'sunset', 'bauhaus', 'ring', 'pixel'];
export const PALETTES = {
  orange: ['#f97316', '#f59e0b', '#fb923c', '#fbbf24', '#9a3412'],
  ocean: ['#0ea5e9', '#22d3ee', '#3b82f6', '#6366f1', '#0c4a6e'],
  forest: ['#22c55e', '#16a34a', '#84cc16', '#14b8a6', '#064e3b'],
  candy: ['#ec4899', '#f43f5e', '#a855f7', '#f59e0b', '#831843'],
  mono: ['#e2e8f0', '#94a3b8', '#64748b', '#334155', '#0f172a'],
};
const DEFAULT = PALETTES.orange;

export function avatarOf(user) {
  const a = user?.avatar || {};
  return { variant: a.variant || 'beam', seed: a.seed || user?.id || user?.displayName || 'bcw', colors: a.colors || DEFAULT, image: a.image || null };
}

export default function Avatar({ user, variant, seed, colors, image, size = 40, className = '' }) {
  const a = user ? avatarOf(user) : { variant: variant || 'beam', seed: seed || 'bcw', colors: colors || DEFAULT, image: image || null };
  const img = image ?? a.image; // custom uploaded photo wins over the generated avatar
  return (
    <span className={`inline-block rounded-full overflow-hidden align-middle bg-[var(--surface-2)] ${className}`} style={{ width: size, height: size }}>
      {img ? <img src={img} alt="" width={size} height={size} className="w-full h-full object-cover" />
        : <BoringAvatar size={size} name={seed || a.seed} variant={variant || a.variant} colors={colors || a.colors} />}
    </span>
  );
}
