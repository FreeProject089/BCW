// The brand marks moved into the markdown kit — the directives are what need them, and a kit
// whose brand buttons render blank elsewhere is a kit that only works here. Re-exported from
// their old home so the twenty-odd files that import them here keep working, and so there is
// still exactly one copy of each path.
export { GithubIcon, GoogleIcon, KofiIcon, RedditIcon, XIcon, YoutubeIcon, TwitchIcon, MastodonIcon, BlueskyIcon, InstagramIcon, TelegramIcon, TiktokIcon } from '../markdown/brands.jsx';

// The site's Discord touchpoints use BetterCommunity's own "BetterDiscord" mark rather than the
// generic Discord glyph. It is a full-colour logo, so it is an <img> of the hosted asset, not a
// currentColor path — a colour className passed by a caller is a harmless no-op on it. The
// markdown kit (markdown/brands.jsx) keeps the plain Discord glyph, so `:button{brand=discord}`
// in a portable doc still renders the neutral mark.
export function DiscordIcon({ size = 16, className = '' }) {
  return <img src="/icons/discord.png" alt="" aria-hidden="true" width={size} height={size} className={`object-contain ${className}`} style={{ display: 'inline-block' }} />;
}

export const APP_LOGO = { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', installer: '/icons/bi.png', bi: '/icons/bi.png' };
export function AppLogo({ pkey, size = 22, className = '', fallback: F }) {
  const src = APP_LOGO[pkey];
  if (src) return <img src={src} alt="" width={size} height={size} className={`rounded-md object-contain ${className}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  return F ? <F size={size} className={className} /> : null;
}
