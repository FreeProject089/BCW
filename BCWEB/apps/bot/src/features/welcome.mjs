// Welcome / bye. Posts a 1200x400 banner (BCWEB dark theme + the member's avatar)
// inside a brand-colored embed with the variable-driven message. Canvas is
// optional — if it fails to load, the embed still goes out without the banner.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { guildConfig } from '../config.mjs';
import { api, SITE_URL } from '../api.mjs';

let canvas = null, canvasTried = false;
async function loadCanvas() {
  if (canvasTried) return canvas;
  canvasTried = true;
  try { canvas = await import('@napi-rs/canvas'); } catch { canvas = null; }
  return canvas;
}
let gifenc = null, gifTried = false;
async function loadGif() {
  if (gifTried) return gifenc;
  gifTried = true;
  try {
    const m = await import('gifenc');
    // gifenc is CJS — under a dynamic ESM import its exports land on .default.
    // This was THE bug that silently killed the welcome image: GIFEncoder was
    // undefined, banner() threw, and the message went out with no attachment.
    gifenc = (m.default && m.default.GIFEncoder) ? m.default : m;
    if (typeof gifenc.GIFEncoder !== 'function') gifenc = null;
  } catch { gifenc = null; }
  return gifenc;
}

function applyVars(tpl, member, joinnumber) {
  return (tpl || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{servername}', member.guild.name)
    .replaceAll('{joinnumber}', String(joinnumber ?? member.guild.memberCount))
    .replaceAll('{joindate}', new Date().toDateString());
}

const W = 1200, H = 400;

// A custom background is a MEDIA PATH on the site, never a URL somebody typed — the same
// rule, and the same regex, as isMediaPath in apps/api/src/routes/bot.mjs. This process
// runs inside the Docker network, so "fetch whatever the config says" would let a crafted
// config reach anything on it. A validated path joined onto SITE_URL cannot be aimed
// elsewhere. `..` is refused explicitly rather than left to the character class, because
// that is the part somebody edits later.
const MEDIA_PATH = /^\/api\/media\/blog\/[A-Za-z0-9._/-]+$/;
const isMediaPath = (v) => typeof v === 'string' && MEDIA_PATH.test(v) && !v.includes('..');

// Selectable banner backgrounds — must mirror BANNER_BG in apps/api/src/routes/bot.mjs
// so the admin preview and the real sent banner match. base = fill, accent = glow/dots.
const BANNER_BG = {
  dark: { base: '#0e0c09', accent: '245,158,11' },
  midnight: { base: '#0a0f1e', accent: '56,189,248' },
  plum: { base: '#140a1e', accent: '167,139,250' },
  forest: { base: '#08160f', accent: '52,211,153' },
  rose: { base: '#1a0a12', accent: '244,114,182' },
  slate: { base: '#0f1115', accent: '148,163,184' },
};

// Draw the static parts (bcweb dark bg, avatar, text). `phase` (0..1) animates the
// orange glow + drifting particles so the banner can be encoded as a GIF. `title`
// switches the headline: "Welcome" for joins, "Goodbye" for leaves.
function drawBanner(ctx, avatar, member, particles, phase, title = 'Welcome', bg = 'dark', backdrop = null) {
  const theme = BANNER_BG[bg] || BANNER_BG.dark;
  ctx.fillStyle = theme.base; ctx.fillRect(0, 0, W, H);
  if (backdrop) {
    // Cover-fit, then a scrim. The scrim is not a style choice: the headline is white and
    // the sub-line grey, and somebody will eventually pick a photograph of a snowy field.
    // Darker on the left where the avatar and text sit, lighter on the right so the
    // picture is still a picture. Mirrors paintBackdrop in the API.
    const scale = Math.max(W / backdrop.width, H / backdrop.height);
    const w = backdrop.width * scale, h = backdrop.height * scale;
    ctx.drawImage(backdrop, (W - w) / 2, (H - h) / 2, w, h);
    const veil = ctx.createLinearGradient(0, 0, W, 0);
    // A plateau across the text band, then a fast drop so the right third of the picture
    // stays a picture. See paintBackdrop in the API for what was measured and why a smooth
    // ramp could not do both jobs.
    veil.addColorStop(0, 'rgba(0,0,0,0.88)');
    veil.addColorStop(0.68, 'rgba(0,0,0,0.86)');
    veil.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = veil; ctx.fillRect(0, 0, W, H);
  }
  // shifting accent glow. Over a photograph this is decoration on top of decoration, so it
  // is kept but faint — a custom background should still read as the background.
  const gx = W / 2 + Math.cos(phase * Math.PI * 2) * 120;
  const g = ctx.createRadialGradient(gx, H, 60, gx, H, W);
  g.addColorStop(0, `rgba(${theme.accent},${backdrop ? 0.1 : 0.22})`); g.addColorStop(1, `rgba(${theme.accent},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // drifting particles — dropped entirely over a picture, where they read as dust on a lens.
  if (!backdrop) for (const p of particles) {
    const y = (p.y + phase * p.spd * H) % H;
    ctx.fillStyle = `rgba(${theme.accent},${p.a})`;
    ctx.fillRect(p.x, y, p.s, p.s);
  }
  if (avatar) {
    const r = 92, cx = 190, cy = H / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2); ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  const sub = title === 'Welcome' ? `Member #${member.guild.memberCount} · ${member.guild.name}` : `We'll miss you · ${member.guild.name}`;
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 58px sans-serif'; ctx.fillText(title, 340, 170);
  ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 46px sans-serif'; ctx.fillText(member.user.username.slice(0, 22), 342, 236);
  // Grey on a solid theme; near-white over a photograph. Muted grey is a choice that only
  // works against a background you control, and this one is chosen by somebody else.
  ctx.fillStyle = backdrop ? '#e5e7eb' : '#9ca3af'; ctx.font = '28px sans-serif'; ctx.fillText(sub.slice(0, 46), 344, 288);
}

// Build a ~1.5s animated GIF banner (falls back to a static PNG if the GIF encoder
// isn't available, and to nothing if canvas itself is missing). Exported for tests.
export async function banner(member, title = 'Welcome', bg = 'dark', bgImage = null) {
  const C = await loadCanvas();
  if (!C) { console.warn('[bot] banner skipped: @napi-rs/canvas unavailable'); return null; }
  const { createCanvas, loadImage } = C;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  let avatar = null;
  try { avatar = await loadImage(member.user.displayAvatarURL({ extension: 'png', size: 256 })); } catch { /* optional */ }
  // Loaded ONCE here, not inside the frame loop: a GIF is twelve frames, and decoding the
  // same picture twelve times would turn one join into twelve downloads.
  let backdrop = null;
  if (isMediaPath(bgImage)) {
    try { backdrop = await loadImage(SITE_URL + bgImage); }
    catch (e) { console.warn('[bot] welcome background could not be loaded:', e.message); }
  }
  const particles = Array.from({ length: 36 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: 2 + Math.random() * 4, a: 0.15 + Math.random() * 0.35, spd: 0.4 + Math.random() * 1.2 }));
  const name = title === 'Welcome' ? 'welcome' : 'goodbye';

  const G = await loadGif();
  if (G) {
    try {
      const { GIFEncoder, quantize, applyPalette } = G;
      const enc = GIFEncoder();
      const FRAMES = 12;
      for (let f = 0; f < FRAMES; f++) {
        drawBanner(ctx, avatar, member, particles, f / FRAMES, title, bg, backdrop);
        const { data } = ctx.getImageData(0, 0, W, H);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        enc.writeFrame(index, W, H, { palette, delay: 120 });
      }
      enc.finish();
      return new AttachmentBuilder(Buffer.from(enc.bytes()), { name: `${name}.gif` });
    } catch (e) { console.warn('[bot] gif encode failed, falling back to png:', e.message); }
  }
  // Fallback: single static frame.
  drawBanner(ctx, avatar, member, particles, 0, title, bg, backdrop);
  return new AttachmentBuilder(await cv.encode('png'), { name: `${name}.png` });
}

// Embed wrapping the banner: the GIF/PNG rides inside the embed via its
// attachment:// name, so the whole message is one clean brand-colored card.
function welcomeEmbed(text, img, color) {
  const embed = new EmbedBuilder().setColor(color).setDescription(text).setTimestamp();
  if (img) embed.setImage(`attachment://${img.name}`);
  return embed;
}

export async function onMemberAdd(member) {
  api.activity(member.guild.id, member.id, 'join', member.user); // record server-join for telemetry (per guild)
  const cfg = await guildConfig(member.guild.id); const w = cfg.welcome || {};
  if (!cfg.enabled || !w.enabled || !w.channelId) return;
  const ch = member.guild.channels.cache.get(w.channelId);
  if (!ch?.send) return;
  // Banner failures are LOGGED (not swallowed) so a missing image is diagnosable.
  const img = await banner(member, 'Welcome', w.gifBg, w.bgImage).catch((e) => { console.warn('[bot] welcome banner failed:', e.message); return null; });
  await ch.send({ embeds: [welcomeEmbed(applyVars(w.joinMessage, member), img, 0xf59e0b)], files: img ? [img] : [] })
    .catch((e) => console.warn('[bot] welcome send failed:', e.message));
}

export async function onMemberRemove(member) {
  const cfg = await guildConfig(member.guild.id); const w = cfg.welcome || {};
  if (!cfg.enabled || !w.enabled || !w.channelId) return;
  const ch = member.guild.channels.cache.get(w.channelId);
  if (!ch?.send) return;
  // The bye message gets its own banner too (same style, "Goodbye" headline).
  const img = await banner(member, 'Goodbye', w.gifBg, w.bgImage).catch((e) => { console.warn('[bot] bye banner failed:', e.message); return null; });
  await ch.send({ embeds: [welcomeEmbed(applyVars(w.leaveMessage, member), img, 0x6b7280)], files: img ? [img] : [] })
    .catch((e) => console.warn('[bot] bye send failed:', e.message));
}
