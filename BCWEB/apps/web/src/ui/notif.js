// icon + accent + human "type" label per notification kind. Lives in its own tiny module
// (no page code) so the nav bell menu (App.jsx) can import it eagerly WITHOUT pulling the
// whole dashboard page into the initial bundle — which lets dashboard.jsx be route-split.
// `tint` is the soft background of the icon chip; `label` is the small type badge.
import { CheckCircle2, XCircle, ShieldCheck, RefreshCw, TrendingUp, Rocket, Server, Clock, Bell, Bell as BellIcon, Send, Star, AlertTriangle, BadgeCheck, Ticket, Gift } from 'lucide-react';
import { KofiIcon } from './brand.jsx';

export const NOTIF = {
  submission_approved: { icon: CheckCircle2, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Approved' },
  submission_rejected: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Rejected' },
  repo_verified: { icon: ShieldCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Verified' },
  repo_published: { icon: CheckCircle2, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Published' },
  repo_rejected: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Rejected' },
  repo_access_granted: { icon: ShieldCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Access' },
  repo_renew: { icon: RefreshCw, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Renewal' },
  repo_upgrade: { icon: TrendingUp, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Upgrade' },
  hosting_started: { icon: Rocket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Hosting' },
  hosting_online: { icon: Server, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Online' },
  hosting_stopped: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Stopped' },
  hosting_expiring: { icon: Clock, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Expiring' },
  announcement: { icon: BellIcon, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Announcement' },
  admin_broadcast: { icon: Send, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Broadcast' },
  feature_active: { icon: Star, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Featured' },
  server_alert: { icon: AlertTriangle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Alert' },
  creator_linked: { icon: BadgeCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Linked' },
  discord_linked: { icon: BadgeCheck, tone: 'text-[#5865F2]', tint: 'bg-indigo-500/12', label: 'Discord' },
  kofi_reward: { icon: KofiIcon, tone: 'text-orange-400', tint: 'bg-orange-500/12', label: 'Ko-fi' },
  promo_redeemed: { icon: Ticket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Promo' },
  discount: { icon: Ticket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Discount' },
  free_hosting: { icon: Gift, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Gift' },
  free_boost: { icon: Gift, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Boost' },
};
export const NOTIF_FALLBACK = { icon: Bell, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Update' };
