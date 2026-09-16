// Welcome / goodbye: the two messages, the banner behind them, and a preview of the result.
//
// Split out of discord-servers.jsx because it stopped being a form. It is a small editor with
// a rendering of its own output, and it needs to mirror two files in the bot exactly:
//   apps/bot/src/features/welcome.mjs   drawBanner() — the 1200x400 image, and applyVars()
//   apps/bot/src/ui.mjs                 card() — the Components-V2 container the image rides in
//
// WHAT THE PREVIEW IS HONEST ABOUT. It redraws drawBanner() in SVG with the same geometry,
// the same palette, the same veil stops and the same text positions, so a message that is too
// long, a background that swallows the headline, or a variable that was never substituted are
// all visible here. It is NOT the bot's own renderer:
//   · the bot draws with @napi-rs/canvas in `sans-serif`, the browser with its own sans-serif,
//     so glyph widths differ by a few pixels and a name near the 22-character cut can land
//     differently;
//   · the drifting particles are re-randomised on every send, so the ones here are a fixed
//     sample of the same distribution, not the ones your members will see;
//   · the banner is a 12-frame GIF and this is one frame (phase 0);
//   · the author is drawn as "a bot", because the guild payload does not carry the bot's own
//     name or avatar.
// Those four are written into the fold under the preview, not hidden in this comment.
import { useState } from 'react';
import { AlertTriangle, Check as CheckIcon, CreditCard, Image as ImageIcon, LogIn, LogOut } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input, Field, Button, Spinner, Explain } from '../ui/ui.jsx';
import { DiscordIcon } from '../ui/brand.jsx';
import { SP, Panel, Eyebrow, Check } from '../ui/discord-kit.jsx';
import { ChannelPicker } from './discord-pickers.jsx';

// Selectable banner backgrounds — BANNER_BG in apps/bot/src/features/welcome.mjs and in the
// API's routes/bot.mjs. base = the fill, accent = the glow and the particles.
export const WBG = [
  ['dark', '#0e0c09', '245,158,11'], ['midnight', '#0a0f1e', '56,189,248'], ['plum', '#140a1e', '167,139,250'],
  ['forest', '#08160f', '52,211,153'], ['rose', '#1a0a12', '244,114,182'], ['slate', '#0f1115', '148,163,184'],
];
const BG = Object.fromEntries(WBG.map(([k, base, accent]) => [k, { base, accent }]));

/** Normalise a stored welcome object to the exact editable shape, so dirty-checking is a
 *  plain JSON compare and every field is always a defined primitive. */
export const normWelcome = (w = {}) => ({
  enabled: !!w.enabled,
  channelId: w.channelId || '',
  joinMessage: w.joinMessage || '',
  leaveMessage: w.leaveMessage || '',
  gifBg: WBG.some(([k]) => k === w.gifBg) ? w.gifBg : 'dark',
  bgImage: w.bgImage || '',
});
// isMediaPath in the bot AND in the API: a background is a path on this site, never a URL
// somebody typed. The preview applies the same test, so an image the bot will refuse is an
// image the preview refuses too — otherwise the preview would promise what does not ship.
export const isMediaPath = (s) => /^\/api\/media\/[A-Za-z0-9._/-]+$/.test(s || '');

// ── The banner, redrawn ───────────────────────────────────────────────────────────────────
const W = 1200, H = 400;
// The bot randomises 36 particles per send. A preview cannot show those, so it shows a fixed
// draw from the same distribution — seeded, so the picture does not twitch on every keystroke.
const PARTICLES = (() => {
  let s = 20260916;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return Array.from({ length: 36 }, () => ({ x: rnd() * W, y: rnd() * H, s: 2 + rnd() * 4, a: 0.15 + rnd() * 0.35 }));
})();

/**
 * drawBanner() from the bot, in SVG: same fill, same veil stops, same glow, same coordinates.
 * `title` switches the headline exactly as the bot does ('Welcome' on join, 'Goodbye' on leave).
 */
function BannerArt({ title, name, guildName, memberCount, bg, bgImage, id }) {
  const theme = BG[bg] || BG.dark;
  const backdrop = isMediaPath(bgImage) ? bgImage : null;
  const glowX = W / 2 + 120;    // phase 0 of the bot's drifting glow
  const sub = title === 'Welcome' ? `Member #${memberCount} · ${guildName}` : `We'll miss you · ${guildName}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={`${title} · ${name}`}>
      <defs>
        <linearGradient id={`veil-${id}`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity="0.88" />
          <stop offset="0.68" stopColor="#000" stopOpacity="0.86" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} gradientUnits="userSpaceOnUse" cx={glowX} cy={H} r={W} fr="60">
          <stop offset="0" stopColor={`rgb(${theme.accent})`} stopOpacity={backdrop ? 0.1 : 0.22} />
          <stop offset="1" stopColor={`rgb(${theme.accent})`} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`face-${id}`}><circle cx="190" cy={H / 2} r="92" /></clipPath>
      </defs>
      <rect width={W} height={H} fill={theme.base} />
      {backdrop && <>
        <image href={backdrop} x="0" y="0" width={W} height={H} preserveAspectRatio="xMidYMid slice" />
        <rect width={W} height={H} fill={`url(#veil-${id})`} />
      </>}
      <rect width={W} height={H} fill={`url(#glow-${id})`} />
      {!backdrop && PARTICLES.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.s} height={p.s} fill={`rgb(${theme.accent})`} opacity={p.a} />
      ))}
      {/* The member's avatar is a real download at send time. Here it is the initial: the
          circle's size and ring are what the layout depends on, and those are exact. */}
      <g clipPath={`url(#face-${id})`}>
        <rect x="98" y="108" width="184" height="184" fill="#1f2937" />
        <text x="190" y={H / 2 + 26} textAnchor="middle" fill="#9ca3af" fontFamily="sans-serif" fontWeight="bold" fontSize="76">{(name || '?').slice(0, 1).toUpperCase()}</text>
      </g>
      <circle cx="190" cy={H / 2} r="92" fill="none" stroke="#f59e0b" strokeWidth="6" />
      <text x="340" y="170" fill="#ffffff" fontFamily="sans-serif" fontWeight="bold" fontSize="58">{title}</text>
      <text x="342" y="236" fill="#f59e0b" fontFamily="sans-serif" fontWeight="bold" fontSize="46">{(name || '').slice(0, 22)}</text>
      <text x="344" y="288" fill={backdrop ? '#e5e7eb' : '#9ca3af'} fontFamily="sans-serif" fontSize="28">{sub.slice(0, 46)}</text>
    </svg>
  );
}

// ── The message, rendered the way Discord renders it ──────────────────────────────────────
// applyVars() in the bot, with {user} left as the mention token so the pill can be drawn.
const applyVars = (tpl, { name, guildName, memberCount }) => (tpl || '')
  .replaceAll('{user}', '<@0>')
  .replaceAll('{username}', name)
  .replaceAll('{servername}', guildName)
  .replaceAll('{joinnumber}', String(memberCount))
  .replaceAll('{joindate}', new Date().toDateString());

// The inline subset Discord actually applies inside a text display, plus its mention pills.
// Not a markdown engine: anything outside this list is shown as typed, which is also what
// Discord does with it.
const TOKEN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|`[^`\n]+`|<@&?!?\d+>|<#\d+>|@everyone|@here)/g;
const Pill = ({ children }) => (
  <span className="rounded px-1 tint-primary text-[var(--accent-ink)] font-medium">{children}</span>
);
function renderInline(text, name) {
  return text.split(TOKEN).filter((s) => s !== '' && s !== undefined).map((part, i) => {
    const key = `${i}-${part.slice(0, 8)}`;
    if (/^\*\*.*\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^__.*__$/.test(part)) return <u key={key}>{part.slice(2, -2)}</u>;
    if (/^~~.*~~$/.test(part)) return <s key={key}>{part.slice(2, -2)}</s>;
    if (/^\*.*\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^`.*`$/.test(part)) return <code key={key} className="rounded px-1 bg-[var(--surface-2)] text-[0.92em]">{part.slice(1, -1)}</code>;
    if (/^<@&?!?\d+>$/.test(part)) return <Pill key={key}>@{name}</Pill>;
    if (/^<#\d+>$/.test(part)) return <Pill key={key}>#{part.slice(2, -1)}</Pill>;
    if (part === '@everyone' || part === '@here') return <Pill key={key}>{part}</Pill>;
    return <span key={key}>{part}</span>;
  });
}

/**
 * One message as Discord draws it: the author line, then the Components-V2 container — an
 * accent bar down the left, the text, and the banner in a media gallery under it.
 */
function DiscordPreview({ title, accent, message, sample, bg, bgImage, id }) {
  const { t } = useI18n();
  const text = applyVars(message, sample);
  const lines = text.split('\n');
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 bg-[#313338] text-[#dbdee1]">
      <div className="flex gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-[#5865F2] shrink-0"><DiscordIcon size={18} className="text-white" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[13.5px] font-medium text-white">{t('ds.wc.pv.bot', 'Your bot')}</span>
            <span className="text-[10px] font-semibold px-1 py-px rounded bg-[#5865F2] text-white">{t('ds.wc.pv.tag', 'BOT')}</span>
            <span className="text-[10.5px] text-[#949ba4]">{t('ds.wc.pv.now', 'just now')}</span>
          </div>
          {/* The container: Discord paints a 4px accent bar down its left edge. */}
          <div className="mt-1.5 rounded-lg border border-[#3f4147] bg-[#2b2d31] overflow-hidden flex">
            <span className="w-1 shrink-0" style={{ background: accent }} />
            <div className="min-w-0 flex-1 p-2.5">
              {text.trim()
                ? <div className="text-[13.5px] leading-[1.35] whitespace-pre-wrap break-words">{lines.map((l, i) => <div key={i}>{renderInline(l, sample.name) }</div>)}</div>
                : <div className="text-[13px] text-[#949ba4] italic">{t('ds.wc.pv.empty', 'No text: the banner goes out on its own.')}</div>}
              <div className="mt-2 rounded-lg overflow-hidden border border-[#3f4147]">
                <BannerArt title={title} name={sample.name} guildName={sample.guildName} memberCount={sample.memberCount} bg={bg} bgImage={bgImage} id={id} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── One side of the editor ────────────────────────────────────────────────────────────────
// The art strip is the point of the header: two cards with the same controls need to be told
// apart before they are read, and the banner art does that faster than a heading can.
function Side({ art, icon: Icon, label, hint, value, onChange, placeholder, preview }) {
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="relative h-16 sm:h-20">
        <img src={art} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
        {/* The art is white-heavy, and the label sits on it in both themes. */}
        <span className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/10" />
        <span className="absolute inset-0 flex items-center gap-2 px-3 sm:px-4 text-white font-semibold text-sm">
          <Icon size={16} /> {label}
        </span>
      </div>
      <div className={`${SP.card} ${SP.stack}`}>
        <Field label={label} hint={hint}>
          <Input value={value} onChange={(e) => onChange(e.target.value.slice(0, 500))} placeholder={placeholder} />
        </Field>
        {preview}
      </div>
    </div>
  );
}

/**
 * `value` is a normWelcome'd object, `onChange` gets the next one. `channels` is the bot's
 * live list; `guild` gives the preview its name and member count. `bannerPolicy` is the
 * admin's off / free / paid gate, and `onBuyBanner` / `onUpload` are the host's network calls.
 */
export function WelcomeEditor({ value, onChange, channels, guild, bannerPolicy, onBuyBanner, buying, onUpload }) {
  const { t } = useI18n();
  const w = value;
  const set = (patch) => onChange({ ...w, ...patch });
  const [sampleName, setSampleName] = useState('');
  const sample = {
    name: sampleName.trim() || t('ds.wc.pv.sample', 'NewMember'),
    guildName: guild?.name || t('ds.wc.pv.server', 'Your server'),
    memberCount: guild?.memberCount ?? 1,
  };
  const bp = bannerPolicy || { allowed: true, paid: false, unlocked: false, priceCents: 0 };
  const price = `${((bp.priceCents || 0) / 100).toFixed(2)}`;

  return (
    <div className={SP.page}>
      <Check checked={w.enabled} onChange={(on) => set({ enabled: on })} className="!text-sm font-medium">
        {t('ds.wc.on', 'Post a banner when someone joins or leaves')}
      </Check>

      {w.enabled && (<>
        <Panel className={SP.stack}>
          <div className={`grid sm:grid-cols-2 ${SP.grid}`}>
            <Field label={t('ds.wc.channel2', 'Channel')} hint={t('ds.wc.channel.h2', 'Where both messages are posted.')}>
              <ChannelPicker channels={channels} value={w.channelId} onChange={(v) => set({ channelId: v })} />
            </Field>
            <Field label={t('ds.wc.pv.name', 'Preview this name')} hint={t('ds.wc.pv.name.h', 'Only changes the preview below, nothing is saved.')}>
              <Input value={sampleName} onChange={(e) => setSampleName(e.target.value.slice(0, 32))} placeholder={t('ds.wc.pv.sample', 'NewMember')} />
            </Field>
          </div>
          <Explain summary={t('ds.wc.vars.sum', 'Five variables can go in either message.')}>
            <p>{t('ds.wc.vars', '{user} is a mention, {username} the plain name, {servername} this server, {joinnumber} their rank as an arrival, {joindate} the day. Discord bold, italic, underline, strike and `code` all work.')}</p>
          </Explain>
        </Panel>

        <div className={`grid lg:grid-cols-2 ${SP.grid}`}>
          <Side art="/discord/banner-join.svg" icon={LogIn} label={t('ds.wc.join', 'Join message')}
            hint={t('ds.wc.join.h', 'Sent with the Welcome banner.')}
            value={w.joinMessage} onChange={(v) => set({ joinMessage: v })} placeholder={t('ds.wc.join.ph', 'Welcome {user} to {servername}!')}
            preview={<div className={SP.tight}>
              <Eyebrow>{t('ds.wc.pv', 'Preview, as Discord shows it')}</Eyebrow>
              <DiscordPreview id="join" title="Welcome" accent="#f59e0b" message={w.joinMessage} sample={sample} bg={w.gifBg} bgImage={w.bgImage} />
            </div>} />
          <Side art="/discord/banner-leave.svg" icon={LogOut} label={t('ds.wc.leave', 'Leave message')}
            hint={t('ds.wc.leave.h', 'Sent with the Goodbye banner, in grey.')}
            value={w.leaveMessage} onChange={(v) => set({ leaveMessage: v })} placeholder={t('ds.wc.leave.ph', '{username} has left.')}
            preview={<div className={SP.tight}>
              <Eyebrow>{t('ds.wc.pv', 'Preview, as Discord shows it')}</Eyebrow>
              <DiscordPreview id="leave" title="Goodbye" accent="#6b7280" message={w.leaveMessage} sample={sample} bg={w.gifBg} bgImage={w.bgImage} />
            </div>} />
        </div>

        <Explain summary={t('ds.wc.pv.trust.sum', 'What the preview does not model.')}>
          <p>{t('ds.wc.pv.trust', 'The banner is redrawn here with the same sizes, colours and text positions as the bot, so a message that is too long or a background that swallows the headline shows up. Four things differ: the real banner is a short animated GIF and this is its first frame, its drifting specks are re-drawn on every send, the avatar is a real download rather than an initial, and the fonts are your browser’s rather than the server’s, so a name near the 22-character cut can land a pixel or two differently. The bot’s own name and avatar are not in this page’s data, so the author is drawn generically.')}</p>
        </Explain>

        <Panel className={SP.stack}>
          <Eyebrow>{t('ds.wc.bg', 'Banner background')}</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {WBG.map(([k, col]) => (
              <button key={k} type="button" onClick={() => set({ gifBg: k })} title={k} aria-label={k} aria-pressed={w.gifBg === k}
                className={`w-8 h-8 rounded-lg border-2 transition ${w.gifBg === k ? 'border-[var(--primary)] scale-105' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} style={{ background: col }} />
            ))}
          </div>
          {/* Off: the admin does not offer custom banners. Paid and not unlocked: a one-time
              purchase gate (an existing image is kept, no new upload). Free or unlocked: the
              uploader. A custom banner is always at most one — replacing it drops the old file
              server-side. */}
          {!bp.allowed && (
            <div className="rounded-lg border border-[var(--line)] panel p-3 text-[12px] text-[var(--muted)] flex items-center gap-2">
              <AlertTriangle size={13} className="text-[var(--faint)] shrink-0" /> {t('ds.wc.bg.off', 'Custom banner backgrounds are turned off for this bot. The colour presets above are available to everyone.')}
            </div>
          )}
          {bp.allowed && bp.paid && !bp.unlocked && (
            <div className="rounded-lg border b-primary tint-primary p-3">
              <div className="text-[12.5px] font-semibold flex items-center gap-1.5"><ImageIcon size={13} className="text-[var(--accent-ink)]" /> {t('ds.wc.bg.paidt', 'Custom banner, a one-time upgrade')}</div>
              <p className="text-[11.5px] text-[var(--muted)] mt-1">{t('ds.wc.bg.paid2', 'A custom welcome banner for this server is a one-time upgrade ({p}). It stays unlocked for this server afterwards.').replace('{p}', price)}</p>
              <Button size="sm" variant="primary" className="mt-2.5" disabled={buying} onClick={onBuyBanner}>
                {buying ? <Spinner /> : <><CreditCard size={13} /> {t('ds.wc.bg.buy', 'Unlock for {p}').replace('{p}', price)}</>}
              </Button>
            </div>
          )}
          {bp.allowed && (!bp.paid || bp.unlocked) && (
            <Field label={t('ds.wc.bgimg', 'Custom background (optional)')} hint={t('ds.wc.bgimg.h4', 'Replaces the colour in both banners. One image per server; a new upload removes the old.')}>
              {bp.paid && bp.unlocked && <div className="text-[11px] text-success mb-1.5 inline-flex items-center gap-1"><CheckIcon size={11} /> {t('ds.wc.bg.unlocked', 'Unlocked for this server')}</div>}
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" onClick={onUpload}><ImageIcon size={13} /> {t('ds.wc.bgimg.upload', 'Upload')}</Button>
                <Input className="flex-1 min-w-[140px]" value={w.bgImage} onChange={(e) => set({ bgImage: e.target.value.slice(0, 300) })} placeholder="/api/media/blog/…" aria-label={t('ds.wc.bgimg', 'Custom background (optional)')} />
                {w.bgImage && <button type="button" onClick={() => set({ bgImage: '' })} className="px-1.5 rounded-lg text-error hover:bg-error-bg shrink-0" title={t('common.remove', 'Remove')}>×</button>}
              </div>
              {w.bgImage && !isMediaPath(w.bgImage) && (
                <div className="text-[11px] text-warning flex items-center gap-1 mt-1.5"><AlertTriangle size={11} /> {t('ds.wc.bgimg.bad', 'Not an uploaded-media link, it must start with /api/media/. The colour will be used instead.')}</div>
              )}
            </Field>
          )}
        </Panel>
      </>)}
    </div>
  );
}
