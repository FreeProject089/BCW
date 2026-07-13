// Blog reaction types are stored as icon *names* (not emoji). This is the shared
// palette + a small renderer used by the editor picker and the post reactions bar.
import { ThumbsUp, Heart, Flame, PartyPopper, Star, Rocket, Laugh, Smile, Sparkles, CheckCircle2 } from 'lucide-react';

export const REACTION_ICONS = {
  'thumbs-up': ThumbsUp, heart: Heart, fire: Flame, party: PartyPopper, star: Star,
  rocket: Rocket, laugh: Laugh, smile: Smile, sparkles: Sparkles, check: CheckCircle2,
};
export const REACTION_OPTIONS = Object.keys(REACTION_ICONS);

export function ReactionIcon({ name, size = 16, className = '' }) {
  const I = REACTION_ICONS[name] || Sparkles;
  return <I size={size} className={className} aria-hidden />;
}
