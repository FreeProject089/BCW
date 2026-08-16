// Transactional email (email confirmation + password reset). Uses SMTP via nodemailer.
// If EMAIL_ENABLED !== 'true' (or SMTP isn't configured) sendMail is a no-op returning
// false — callers fall back gracefully (e.g. the reset endpoint returns a devToken).
import nodemailer from 'nodemailer';
import { BRAND_LOGO_DATA_URI } from './brand-logo-data.mjs';

const SITE = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

// The real BetterCommunity icon for the email header — the logo is embedded as a base64
// data URI (see brand-logo-data.mjs) so it always renders, with no "BC" text fallback and
// no dependence on the container's file layout or a reachable SITE_URL.
function brandLogo() {
  return `<img src="${BRAND_LOGO_DATA_URI}" width="36" height="36" alt="BetterCommunity" style="border-radius:9px;display:block">`;
}

let transporter = null;
function tx() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT) === '465', // implicit TLS on 465, STARTTLS otherwise
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export function emailEnabled() {
  return process.env.EMAIL_ENABLED === 'true' && !!process.env.SMTP_HOST;
}

export async function sendMail({ to, subject, html, text, headers, attachments }) {
  if (!emailEnabled()) return false;
  const from = process.env.SMTP_FROM || 'BetterCommunity <no-reply@localhost>';
  // `attachments` is forwarded explicitly. This function destructures its argument, so a
  // caller passing something it does not name gets it SILENTLY DROPPED — a data-export mail
  // would have gone out with no data in it and nothing would have failed.
  await tx().sendMail({ from, to, subject, html, text, headers, attachments });
  return true;
}

// Escape user/admin-supplied text before interpolating it into an email's HTML body,
// so a display name or reason like `<img onerror=…>` can't inject markup into the mail
// (CWE-79). Always run untrusted values through this when building email HTML.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Markdown → email-safe HTML ────────────────────────────────────────────────
// Renders standard markdown AND BetterCommunity's custom md.jsx blocks (callouts, cards,
// columns, :badge chips, tables…) with inline styles for email clients. Everything is
// escaped at the text/attribute level (only http(s) URLs, sanitised colours) so trusted-
// author content still can't inject markup/CSS (CWE-79).
function safeUrl(u) { const v = String(u ?? '').trim(); return /^https?:\/\//i.test(v) ? v : ''; }
function safeColor(c) { const v = String(c ?? '').trim(); return (/^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]+$/i.test(v) || /^rgba?\([\d.,\s%]+\)$/i.test(v)) ? v : ''; }
function mdAttrs(s) { const out = {}; if (!s) return out; const re = /([\w-]+)=("[^"]*"|'[^']*'|[^\s}]+)/g; let m; while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); return out; }

// Inline markdown on RAW text. `:badge[…]{color}` is extracted first (its colour comes
// from the raw source) into a placeholder, then the text is escaped, standard inline
// tokens are applied, and the placeholders are restored. `:icon[…]` can't render in email.
function inlineMd(raw) {
  const holders = [];
  let s = String(raw ?? '')
    .replace(/:badge\[([^\]]*)\](?:\{([^}]*)\})?/g, (_, txt, at) => {
      const c = safeColor(mdAttrs(at).color) || '#64748b';
      holders.push(`<span style="display:inline-block;background:${c};color:#fff;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:1px">${escapeHtml(txt)}</span>`);
      return `${holders.length - 1}`;
    })
    .replace(/:icon\[[^\]]*\](?:\{[^}]*\})?/g, '');
  s = escapeHtml(s)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:10px;margin:6px 0">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#c2410c;text-decoration:underline">$1</a>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(120,120,120,.16);padding:1px 5px;border-radius:5px;font-size:.92em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return s.replace(/(\d+)/g, (_, i) => holders[+i]);
}

const MAIL_CALLOUT = { tip: '#16a34a', note: '#2563eb', info: '#2563eb', hint: '#16a34a', success: '#16a34a', check: '#16a34a', warning: '#d97706', caution: '#d97706', important: '#7c3aed', danger: '#dc2626', error: '#dc2626', callout: '#7c3aed' };

// Render one BetterCommunity container directive to email HTML. Inner content is rendered
// recursively so nested blocks (cards inside :::cards, etc.) work.
// Same alphabets as the web renderer (ui/md.jsx). Duplicated deliberately and kept small:
// the API cannot import from the web bundle, and a shared package for four lines would be a
// build dependency between two apps that otherwise share none. If one changes, change both —
// which is why they are this short.
const MAIL_ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
function mailStepMarker(kind, n) {
  if (kind === 'a' || kind === 'alpha') return n <= 26 ? String.fromCharCode(64 + n) : String(n);
  if (kind === 'i' || kind === 'roman') return MAIL_ROMAN[n - 1] || String(n);
  if (kind === 'dot' || kind === 'none' || kind === 'bullet') return '\u2022';
  return String(n);
}

/** Split a block's lines into its DIRECT children of the given names, keeping anything else
 *  as already-rendered html. Needed because the mail renderer works on lines rather than on a
 *  tree, so "which step am I in" has to be answered by counting colons. */
function splitDirectChildren(lines, names) {
  const out = []; let plain = [];
  const flush = () => { if (plain.length) { const h = renderBlocks(plain); if (h.trim()) out.push({ directive: false, html: h }); plain = []; } };
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(:{3,})([a-zA-Z][\w-]*)\s*(\[[^\]]*\])?\s*(\{[^}]*\})?\s*$/);
    if (open && names.includes(open[2].toLowerCase())) {
      const n = open[1].length;
      const closeRe = new RegExp(`^:{${n},}\\s*$`); const openRe = new RegExp(`^:{${n},}[a-zA-Z]`);
      const inner = []; let depth = 1; let j = i + 1;
      for (; j < lines.length; j++) {
        if (closeRe.test(lines[j])) { depth--; if (depth === 0) break; inner.push(lines[j]); }
        else { if (openRe.test(lines[j])) depth++; inner.push(lines[j]); }
      }
      flush();
      out.push({ directive: true, label: open[3] ? open[3].slice(1, -1) : '', attrs: mdAttrs(open[4] || ''), html: renderBlocks(inner) });
      i = j;
      continue;
    }
    plain.push(lines[i]);
  }
  flush();
  return out;
}

function renderDirective(name, label, attrs, innerLines) {
  const body = renderBlocks(innerLines);
  if (name === 'card' || name === 'ref') {
    const title = attrs.title || label; const href = safeUrl(attrs.href || attrs.link); const img = safeUrl(attrs.image);
    const inside = `${img ? `<img src="${img}" alt="" style="max-width:100%;border-radius:10px;margin:0 0 10px">` : ''}${title ? `<div style="font-weight:700;font-size:16px;margin-bottom:6px">${inlineMd(title)}</div>` : ''}${body}`;
    const box = `<div style="border:1px solid #eae4da;border-radius:14px;padding:16px;margin:0 0 14px">${inside}</div>`;
    return href ? `<a href="${href}" style="text-decoration:none;color:inherit;display:block">${box}</a>` : box;
  }
  if (name === 'details' || name === 'collapse') return `<div style="border:1px solid #eae4da;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-weight:700;margin-bottom:8px">${inlineMd(label || attrs.title || 'Details')}</div>${body}</div>`;
  if (name === 'file') { const href = safeUrl(attrs.href || attrs.url); return `<div style="border:1px solid #eae4da;border-radius:12px;padding:12px 16px;margin:0 0 14px"><a href="${href}" style="color:#c2410c;font-weight:600;text-decoration:none">&#x2913; ${inlineMd(label || attrs.name || 'Download')}</a>${attrs.size ? ` <span style="color:#918a80;font-size:12px">(${escapeHtml(attrs.size)})</span>` : ''}</div>`; }
  if (name === 'center' || name === 'left' || name === 'right') return `<div style="text-align:${name};margin:0 0 14px">${body}</div>`;
  // Steps keep their numbers. They were in the flatten list below, which meant the children
  // rendered and the markers disappeared — a procedure arriving as three unrelated
  // paragraphs. A table with a marker cell, because e-mail has no counters and no flexbox.
  if (name === 'steps') {
    const kind = String(attrs.type || attrs.marker || '1').toLowerCase();
    let n = Math.max(1, parseInt(attrs.start, 10) || 1);
    const rows = splitDirectChildren(innerLines, ['step', 'stage']).map((child) => {
      if (!child.directive) return child.html;
      const marker = mailStepMarker(kind, n++);
      const title = child.label || child.attrs.title || '';
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 12px"><tr>
        <td width="34" valign="top" style="width:34px;padding:0 12px 0 0">
          <div style="width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:#f97316;color:#ffffff;font-weight:700;font-size:13px">${escapeHtml(marker)}</div>
        </td>
        <td valign="top">${title ? `<div style="font-weight:700;margin:2px 0 6px">${inlineMd(title)}</div>` : ''}${child.html}</td>
      </tr></table>`;
    });
    const heading = label || attrs.title;
    return `${heading ? `<div style="font-weight:700;margin:0 0 10px">${inlineMd(heading)}</div>` : ''}${rows.join('')}`;
  }
  // A roadmap is a live tracker on the web and cannot be one here, so the e-mail gets the
  // phases as a plain list rather than an empty box pretending something failed to load.
  if (name === 'roadmap' || name === 'progress') {
    const code = innerLines.join('\n').match(/```json\s*([\s\S]*?)```/);
    let items = [];
    try {
      const doc = code ? JSON.parse(code[1]) : null;
      items = (doc?.categories || []).flatMap((c) => [{ head: c.name }, ...(c.items || []).map((it) => ({ label: it.label, status: it.status, percent: it.percent }))]);
    } catch { /* an unreadable block is not worth breaking the mail over */ }
    const heading = label || attrs.title || 'Roadmap';
    if (!items.length) return `<div style="border:1px solid #eae4da;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-weight:700">${inlineMd(heading)}</div><div style="color:#918a80;font-size:13px">See it on the site.</div></div>`;
    const MARK = { done: '&#x2713;', progress: '&#x2192;', planned: '&#x25CB;' };
    const li = items.map((it) => (it.head
      ? `<div style="font-weight:700;margin:10px 0 4px">${inlineMd(it.head)}</div>`
      : `<div style="margin:2px 0;color:#3f3a34">${MARK[it.status] || '&#x25CB;'} ${inlineMd(String(it.label || ''))}${it.percent != null ? ` <span style="color:#918a80">(${Number(it.percent)}%)</span>` : ''}</div>`)).join('');
    return `<div style="border:1px solid #eae4da;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-weight:700;margin-bottom:4px">${inlineMd(heading)}</div>${li}</div>`;
  }
  // Grid wrappers: email can't do real columns — stack the children.
  if (['cards', 'columns', 'column', 'step'].includes(name)) return body;
  // Everything else → a callout box (tip/note/warning/danger/info/success/custom…).
  const color = safeColor(attrs.color) || MAIL_CALLOUT[name] || '#2563eb';
  const title = label || attrs.title || '';
  return `<div style="border:1px solid #eae4da;border-left:4px solid ${color};border-radius:12px;padding:14px 16px;margin:0 0 14px;background:rgba(120,120,120,.05)">${title ? `<div style="font-weight:700;color:${color};margin-bottom:6px">${inlineMd(title)}</div>` : ''}${body}</div>`;
}

// Render plain markdown (no ::: containers): headings, GFM tables, lists, quotes, hr, paras.
function renderMarkdown(text) {
  const lines = String(text).split('\n');
  const out = []; let para = []; let list = null;
  const flushPara = () => { if (para.length) { out.push(`<p style="margin:0 0 14px">${inlineMd(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type} style="margin:0 0 14px;padding-left:22px">${list.items.map((it) => `<li style="margin:4px 0">${inlineMd(it)}</li>`).join('')}</${list.type}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // GFM table: a `| … |` row followed by a `|---|---|` separator.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara(); flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line); const rows = []; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      i--;
      const th = head.map((c) => `<th style="text-align:left;padding:8px 12px;border-bottom:2px solid #eae4da;font-weight:700">${inlineMd(c)}</th>`).join('');
      const tb = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:8px 12px;border-bottom:1px solid #eae4da">${inlineMd(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table role="presentation" style="border-collapse:collapse;width:100%;margin:0 0 16px;font-size:14px"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr style="border:none;border-top:1px solid #eae4da;margin:18px 0">'); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const sz = [22, 19, 17, 15][m[1].length - 1]; out.push(`<h${m[1].length} style="margin:18px 0 10px;font-size:${sz}px;font-weight:800;line-height:1.3">${inlineMd(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote style="margin:0 0 14px;padding:8px 16px;border-left:3px solid #f97316;color:#6f685d">${inlineMd(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n');
}

// Render an array of lines, peeling off ::: container directives (matched by colon count
// so nesting like :::: cards > ::: card works) and passing everything else to renderMarkdown.
function renderBlocks(lines) {
  const out = []; let plain = [];
  const flushPlain = () => { if (plain.length) { const h = renderMarkdown(plain.join('\n')); if (h.trim()) out.push(h); plain = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(/^(:{3,})([a-zA-Z][\w-]*)\s*(\[[^\]]*\])?\s*(\{[^}]*\})?\s*$/);
    if (open) {
      const n = open[1].length; const name = open[2].toLowerCase();
      const label = open[3] ? open[3].slice(1, -1) : ''; const attrs = mdAttrs(open[4] || '');
      const inner = []; let depth = 1; let j = i + 1;
      const closeRe = new RegExp(`^:{${n},}\\s*$`); const openRe = new RegExp(`^:{${n},}[a-zA-Z]`);
      for (; j < lines.length; j++) {
        if (closeRe.test(lines[j])) { depth--; if (depth === 0) break; inner.push(lines[j]); }
        else { if (openRe.test(lines[j])) depth++; inner.push(lines[j]); }
      }
      i = j;
      flushPlain();
      out.push(renderDirective(name, label, attrs, inner));
      continue;
    }
    // Leaf directive line (`::toc[…]` etc.) — nothing to render in an email → drop.
    if (/^::[a-zA-Z][\w-]*(?:\[[^\]]*\])?(?:\{[^}]*\})?\s*$/.test(line)) continue;
    plain.push(line);
  }
  flushPlain();
  return out.join('\n');
}

export function mdToEmailHtml(md) {
  return renderBlocks(String(md ?? '').replace(/\r\n/g, '\n').split('\n')) || '<p style="margin:0"></p>';
}

// Branded, email-client-safe HTML wrapper (table layout, inline styles = LIGHT default).
// A <style> block adds a dark variant via prefers-color-scheme for clients that support it
// (Apple/iOS Mail, Outlook.com…); elsewhere it degrades to light. Optional CTA button (+
// raw link fallback) and a footer. `cta`: { url, label }.
export function mailShell(title, bodyHtml, cta, opts = {}) {
  // These arguments are POSITIONAL, and calling this with an options object is an easy mistake
  // that fails in the worst way available: `title` stringifies to "[object Object]", bodyHtml
  // is undefined, the mail SENDS, and the recipient gets a broken message. It happened to the
  // GDPR data export, which is exactly the mail that must not look untrustworthy.
  //
  // Thrown rather than coerced. A shell that quietly unpacked `{title, body}` would make both
  // call styles work and the next reader would have to know which one this file wants.
  if (title !== null && typeof title === 'object') {
    throw new TypeError('mailShell(title, bodyHtml, cta, opts) takes positional arguments — you passed an object as `title`.');
  }
  // Escape the CTA url/label even though callers validate them — they can carry the
  // admin-supplied broadcast link, and this is HTML attribute + text context (CWE-79).
  const url = cta ? escapeHtml(cta.url) : '';
  const label = cta ? escapeHtml(cta.label) : '';
  const btn = cta
    ? `<tr><td style="padding-top:26px"><a href="${url}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:12px;font-weight:700;font-size:15px;box-shadow:0 6px 18px -6px rgba(249,115,22,.5)">${label}</a></td></tr>
       <tr><td class="bc-faint" style="padding-top:18px;color:#918a80;font-size:12px;line-height:1.5">Or paste this link into your browser:<br><a href="${url}" style="color:#c2410c;word-break:break-all;text-decoration:none">${url}</a></td></tr>`
    : '';
  // The heading is the ONE field a broadcast lets an admin type freely, and it was the
  // one interpolation here that was not escaped — so a subject containing `&` or `<`
  // (an ampersand in a plan name is enough) broke the markup of every copy sent.
  const safeTitle = escapeHtml(title);
  // A caller may pass plain prose rather than HTML (several do). Wrapping it gives that
  // text the same paragraph spacing as markdown-rendered bodies instead of a naked run
  // of text jammed against the heading.
  const body = /^\s*</.test(String(bodyHtml || '')) ? bodyHtml : `<p style="margin:0 0 14px">${bodyHtml}</p>`;
  // The inbox preview line. Without one, clients grab whatever text comes first — which
  // here is the footer's copyright, so every message previewed as "© 2026 BetterCommunity".
  // Hidden in the body itself: there is no other way to set it.
  const preheader = escapeHtml(opts.preheader || String(title || ''));
  // The dark palette, and how it is switched on.
  //
  // A real send leaves it behind `prefers-color-scheme`, which is the only thing an email
  // client understands. The PREVIEW needs to show either mode on demand — and inside an
  // iframe that media query follows the OS, not the admin's toggle — so `scheme` can pin
  // it: 'dark' emits the same declarations unconditionally, 'light' omits them entirely.
  // Same rules either way, so what the preview shows is what the client will apply.
  const darkDecls = `
      .bc-bg{background:#0a0907 !important}
      .bc-card{background:#141210 !important;border-color:#242019 !important}
      .bc-title,.bc-brand{color:#f3efe9 !important}
      .bc-text{color:#a39b8f !important}
      .bc-faint{color:#8a8278 !important}
      .bc-hr{border-color:#242019 !important}`;
  const scheme = opts.scheme === 'dark' || opts.scheme === 'light' ? opts.scheme : 'auto';
  const darkBlock = scheme === 'light' ? ''
    : scheme === 'dark' ? darkDecls
    : `@media (prefers-color-scheme: dark){${darkDecls}
    }`;
  const style = `<style>
    ${darkBlock}
    /* Phones: the card's 34px padding eats a third of a 320px screen. */
    @media (max-width:520px){
      .bc-card{padding:22px !important;border-radius:16px !important}
      .bc-bg{padding:18px 10px !important}
    }
  </style>`;
  // A COMPLETE document, not a fragment. The dark-mode and responsive rules were being
  // emitted as a bare leading <style> with no <html>/<head> around it — which clients are
  // free to drop or, worse, render as text. <head> is where they look for it, and the
  // charset meta is what stops a "—" from arriving as mojibake.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${scheme === 'auto' ? 'light dark' : scheme}"><title>${safeTitle}</title>${style}</head><body style="margin:0;padding:0;background:#f4f1ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${preheader}</div>
<div class="bc-bg" style="margin:0;padding:36px 16px;background:#f4f1ec;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;margin:0 auto">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td>${brandLogo()}</td>
        <td class="bc-brand" translate="no" style="padding-left:11px;font-weight:800;font-size:18px;color:#1a1714;letter-spacing:-.01em"><span style="color:#f97316">Better</span>Community</td>
      </tr></table>
    </td></tr>
    <tr><td class="bc-card" style="background:#ffffff;border:1px solid #eae4da;border-radius:20px;padding:34px;box-shadow:0 12px 40px -18px rgba(30,20,5,.18)">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="border-bottom:3px solid #f97316;width:38px;padding-bottom:16px"></td></tr>
        <tr><td style="padding-top:16px"><h1 class="bc-title" style="margin:0 0 12px;font-size:22px;color:#1a1714;letter-spacing:-.02em;font-weight:800">${safeTitle}</h1></td></tr>
        <tr><td class="bc-text" style="color:#5d5750;font-size:15px;line-height:1.66">${body}</td></tr>
        ${btn}
      </table>
    </td></tr>
    <tr><td style="padding:20px 4px 0;text-align:center;color:#a39b8f;font-size:12px">
      © ${new Date().getFullYear()} BetterCommunity · <a href="${SITE}" style="color:#918a80;text-decoration:none">bettercommunity.ch</a>
    </td></tr>
  </table>
</div>
</body></html>`;
}
