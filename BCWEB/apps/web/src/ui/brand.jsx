// The brand marks moved into the markdown kit — the directives are what need them, and a kit
// whose brand buttons render blank elsewhere is a kit that only works here. Re-exported from
// their old home so the twenty-odd files that import them here keep working, and so there is
// still exactly one copy of each path.
// Discord uses the STANDARD Discord glyph (a currentColor path from the markdown kit), NOT our
// own "BetterDiscord" mark — reverted on request. One copy of each brand path, re-exported here
// so the ~twenty files importing from ui/brand keep working.
export { GithubIcon, GoogleIcon, KofiIcon, DiscordIcon, RedditIcon, XIcon, YoutubeIcon, TwitchIcon, MastodonIcon, BlueskyIcon, InstagramIcon, TelegramIcon, TiktokIcon } from '@bettercommunity/bmd/brands';

export const APP_LOGO = { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', installer: '/icons/bi.png', bi: '/icons/bi.png' };
// `name` as well as `pkey`: home-sections.jsx has passed `name` since it was written, and this
// only read `pkey` — so the landing's product rows drew NO logo and nobody noticed, because the
// row still had its text. A prop that is silently ignored is the worst kind of wrong.
export function AppLogo({ pkey, name, size = 22, className = '', fallback: F }) {
  const src = APP_LOGO[pkey || name];
  if (src) return <img src={src} alt="" width={size} height={size} className={`logo-plate rounded-md object-contain ${className}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  return F ? <F size={size} className={className} /> : null;
}
