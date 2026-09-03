// The icon set B.MD draws from.
//
// Three sources behind one name: the curated lucide set below (bundled, so the common ones
// cost nothing at runtime), the brand marks in brands.jsx (lucide has none of them), and
// `app:` logos the host configures. Anything else that LOOKS like a lucide name is fetched
// as a mask — see cdnIconUrl in config.js for how a project turns that off.
import { Hash } from 'lucide-react';
/* kit:brands:start */
import { GithubIcon, GoogleIcon, KofiIcon, DiscordIcon, RedditIcon, XIcon, YoutubeIcon,
  TwitchIcon, MastodonIcon, BlueskyIcon, InstagramIcon, TelegramIcon, TiktokIcon } from './brands.jsx';
/* kit:brands:end */
import {
  Info, Lightbulb, AlertTriangle, Flame, CheckCircle2, BookOpen, Star, Rocket, Zap, Heart, Boxes, Newspaper,
  Shield, Lock, Key, Download, Upload, Settings, Terminal, Code2, Package, Globe, Server,
  Database, Cpu, Bell, Users, User, Folder, File, Link2, ExternalLink, Play, Puzzle,
  Palette, Wrench, GitBranch, Bug, Sparkles, Clock,
  FileArchive, FileText, FileImage, FileVideo, FileAudio, FileCode, FileDown,
  ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { appIcon, cdnIconUrl } from './config.js';

const ICONS = {
  info: Info, lightbulb: Lightbulb, tip: Lightbulb, alert: AlertTriangle, warning: AlertTriangle,
  fire: Flame, danger: Flame, check: CheckCircle2, success: CheckCircle2, book: BookOpen, star: Star,
  rocket: Rocket, zap: Zap, heart: Heart, shield: Shield, lock: Lock, key: Key, download: Download,
  upload: Upload, settings: Settings, terminal: Terminal, code: Code2, package: Package, globe: Globe,
  server: Server, database: Database, cpu: Cpu, bell: Bell, users: Users, user: User, folder: Folder,
  file: File, link: Link2, external: ExternalLink, play: Play, plugin: Puzzle, palette: Palette,
  wrench: Wrench, git: GitBranch, bug: Bug, sparkles: Sparkles, clock: Clock, hash: Hash,
  'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown,
  // The three the topbar asks for by their lucide names. They resolved through the CDN mask
  // below, which works and meant every page on the site fetched three icons from jsdelivr
  // before it could finish drawing its own navigation. Curated here, they are components.
  boxes: Boxes, newspaper: Newspaper, 'book-open': BookOpen,
  'file-archive': FileArchive, 'file-text': FileText, 'file-image': FileImage, 'file-video': FileVideo,
  'file-audio': FileAudio, 'file-code': FileCode, 'file-download': FileDown,
  // Brands, drawn locally. Above the lucide fallback on purpose: these are the names people
  // write, and the fallback either fetched a mask from a CDN or drew nothing at all.
/* kit:brands:start */
  github: GithubIcon, google: GoogleIcon, kofi: KofiIcon, 'ko-fi': KofiIcon, discord: DiscordIcon,
  reddit: RedditIcon, x: XIcon, twitter: XIcon, youtube: YoutubeIcon, twitch: TwitchIcon,
  mastodon: MastodonIcon, bluesky: BlueskyIcon, instagram: InstagramIcon, telegram: TelegramIcon,
  tiktok: TiktokIcon,
/* kit:brands:end */
};

// Map a filename/URL to the most fitting lucide file icon (falls back to download).

export const ICON_NAMES = Object.keys(ICONS);
// A brand icon (Simple Icons) is written `simple:<slug>` / `si:<slug>` and rendered
// from the Simple Icons CDN; everything else is a lucide icon from ICONS.
function simpleSlug(n) { const m = String(n || '').toLowerCase().match(/^(?:simple|si):(.+)$/); return m ? m[1].replace(/[^a-z0-9-]/g, '') : null; }

/**
 * The local mark for a `simple:` slug, when there is one.
 *
 * Thirteen brands are already inline in this bundle, and `simple:discord` fetched Discord's
 * logo from a CDN anyway — the same drawing, over the network, with a chance of not arriving.
 * `si:` and `simple:` are the Simple Icons spelling, so the slugs line up with the names the
 * ICONS table already answers to; where they do, the local one wins.
 *
 * This is most of what "reduce the CDN dependency" means in practice: the brands people
 * actually write are the ones that stop being requests.
 */
const localBrand = (slug) => ICONS[slug] || null;

// Any lucide icon not in the curated ICONS map still renders — as a CSS-mask over
// the lucide-static CDN svg, so it inherits currentColor like a real component.
function lucideMask(name, size, className = '') {
  const url = cdnIconUrl('lucide', name);
  if (!url) return <Hash aria-hidden className={className} style={{ display: 'inline-block', width: size, height: size, verticalAlign: '-2px' }} />;
  return <span aria-hidden className={className} style={{ display: 'inline-block', width: size, height: size, backgroundColor: 'currentColor', WebkitMask: `url(${url}) center / contain no-repeat`, mask: `url(${url}) center / contain no-repeat`, verticalAlign: '-2px' }} />;
}
const isLucideName = (n) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n);

// A project/showcase icon accepting EITHER an image URL (uploaded svg/png, or a
// logo) OR an icon name (lucide / `simple:brand`). Falls back to `fallback` when
// unset — one field, every source (used by the topbar pill + project header).
export function ShowcaseIcon({ icon, size = 16, className = '', rounded = 4, fallback = null }) {
  if (!icon) return fallback;
  if (/^(https?:|data:|\/)/i.test(icon)) {
    return <img src={icon} alt="" width={size} height={size} className={className} style={{ display: 'inline-block', objectFit: 'contain', borderRadius: rounded }} />;
  }
  return <IconGlyph name={icon} size={size} className={className} />;
}

/**
 * Project logos, usable anywhere IconGlyph is, via the `app:<key>` name — `app:bmm` draws
 * /icons/bmm.png.
 *
 * Configured rather than hard-coded, because these paths are one site's asset layout. They
 * are the only thing in this file that was specific to BetterCommunity by VALUE rather than
 * by import, and a kit that silently 404s every logo in another project is not portable.
 *
 * Module-level and not a context: `IconGlyph` is exported and used outside `<Markdown>` — the
 * icon picker, reaction rows — where no provider is in scope.
 */

/**
 * The `app:` keys worth offering in a picker.
 *
 * A function, not a const: a const is computed once at module load, which is BEFORE the host
 * app has had a chance to call `configureMarkdown` — so a project that supplied its own icons
 * would get a picker listing ours.
 */

// Standalone icon glyph by name (used by the icon picker + reaction-style UIs).
export function IconGlyph({ name, size = 18, className = '' }) {
  const app = String(name || '').match(/^app:(.+)$/);
  // App marks sit on a white rounded chip (hairline border + padding) so a transparent logo
  // reads on any surface and doesn't look brute — matching the BMM icon picker.
  if (app && appIcon(app[1])) {
    const r = Math.max(3, Math.round(size * 0.24));
    const pad = Math.max(1, Math.round(size * 0.12));
    return (
      <span className={`inline-flex items-center justify-center ${className}`} style={{ width: size + 2, height: size + 2, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: r, padding: pad, boxSizing: 'border-box', verticalAlign: 'middle' }}>
        <img src={appIcon(app[1])} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      </span>
    );
  }
  const slug = simpleSlug(name);
  const Local = slug && localBrand(slug);
  if (Local) return <Local size={size} className={className} aria-hidden />;
  if (slug && cdnIconUrl('brand', slug)) return <img src={cdnIconUrl('brand', slug)} loading="lazy" width={size} height={size} alt="" className={className} style={{ display: 'inline-block' }} />;
  if (slug) return <Hash size={size} className={className} aria-hidden />;
  const n = String(name || '').toLowerCase();
  const I = ICONS[n];
  if (I) return <I size={size} className={className} aria-hidden />;
  if (isLucideName(n)) return lucideMask(n, size, className);
  return <Hash size={size} className={className} aria-hidden />;
}

// Inline lucide icon by name (tolerant of hast property key casing).
export function DocIcon({ node }) {
  const p = node?.properties || {};
  const name = String(p.dataName || p['data-name'] || p.name || '').toLowerCase();
  const slug = simpleSlug(name);
  const Local = slug && localBrand(slug);
  if (Local) return <Local className="doc-icon-svg" size={16} aria-hidden />;
  if (slug && cdnIconUrl('brand', slug)) return <img src={cdnIconUrl('brand', slug)} loading="lazy" width={16} height={16} alt="" className="doc-icon-svg" style={{ display: 'inline-block', verticalAlign: '-2px' }} />;
  if (slug) return <Hash className="doc-icon-svg" size={16} aria-hidden />;
  const Ico = ICONS[name];
  if (Ico) return <Ico className="doc-icon-svg" size={16} aria-hidden />;
  if (isLucideName(name)) return lucideMask(name, 16, 'doc-icon-svg');
  return <Hash className="doc-icon-svg" size={16} aria-hidden />;
}
