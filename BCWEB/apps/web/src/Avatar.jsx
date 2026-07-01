import BoringAvatar from 'boring-avatars';

// On-brand Boring Avatars. Variant + seed come from the user's saved avatar,
// falling back to a stable seed (id / display name).
export const VARIANTS = ['beam', 'marble', 'sunset', 'bauhaus', 'ring', 'pixel'];
const PALETTE = ['#f97316', '#f59e0b', '#fb923c', '#fbbf24', '#9a3412'];

export function avatarOf(user) {
  return { variant: user?.avatar?.variant || 'beam', seed: user?.avatar?.seed || user?.id || user?.displayName || 'bcw' };
}

export default function Avatar({ user, variant, seed, size = 40, className = '' }) {
  const a = user ? avatarOf(user) : { variant: variant || 'beam', seed: seed || 'bcw' };
  return (
    <span className={`inline-block rounded-full overflow-hidden align-middle ${className}`} style={{ width: size, height: size }}>
      <BoringAvatar size={size} name={seed || a.seed} variant={variant || a.variant} colors={PALETTE} />
    </span>
  );
}
