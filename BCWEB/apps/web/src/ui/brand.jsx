// The brand marks moved into the markdown kit — the directives are what need them, and a kit
// whose brand buttons render blank elsewhere is a kit that only works here. Re-exported from
// their old home so the twenty-odd files that import them here keep working, and so there is
// still exactly one copy of each path.
// Discord uses the STANDARD Discord glyph (a currentColor path from the markdown kit), NOT our
// own "BetterDiscord" mark — reverted on request. One copy of each brand path, re-exported here
// so the ~twenty files importing from ui/brand keep working.
export { GithubIcon, GoogleIcon, KofiIcon, DiscordIcon, RedditIcon, XIcon, YoutubeIcon, TwitchIcon, MastodonIcon, BlueskyIcon, InstagramIcon, TelegramIcon, TiktokIcon } from '../markdown/brands.jsx';

export const APP_LOGO = { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', installer: '/icons/bi.png', bi: '/icons/bi.png' };
export function AppLogo({ pkey, size = 22, className = '', fallback: F }) {
  const src = APP_LOGO[pkey];
  if (src) return <img src={src} alt="" width={size} height={size} className={`rounded-md object-contain ${className}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  return F ? <F size={size} className={className} /> : null;
}
