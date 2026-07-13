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

export async function sendMail({ to, subject, html, text, headers }) {
  if (!emailEnabled()) return false;
  const from = process.env.SMTP_FROM || 'BetterCommunity <no-reply@localhost>';
  await tx().sendMail({ from, to, subject, html, text, headers });
  return true;
}

// Escape user/admin-supplied text before interpolating it into an email's HTML body,
// so a display name or reason like `<img onerror=…>` can't inject markup into the mail
// (CWE-79). Always run untrusted values through this when building email HTML.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Inline markdown (on already-escaped text): images, links, bold, italic, inline code.
// Only `http(s)` URLs are linked/embedded so a `javascript:`/`data:` value can't sneak in.
function inlineMd(s) {
  return s
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:10px;margin:6px 0">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#c2410c;text-decoration:underline">$1</a>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(120,120,120,.16);padding:1px 5px;border-radius:5px;font-size:.92em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
}

// Convert a markdown string to email-safe HTML. Escapes first (so embedded raw HTML is
// inert), strips BetterCommunity custom md.jsx directives (::name[…] / ::: fences — they
// can't render in an email), then renders standard blocks with inline styles. Trusted-
// author content (admin broadcast / blog intro), but escaping keeps it injection-safe.
export function mdToEmailHtml(md) {
  const src = String(md ?? '')
    .replace(/^:::.*$/gm, '')                              // container fences → drop, keep inner
    .replace(/^\s*::\w+(?:\[[^\]]*\])?(?:\{[^}]*\})?\s*$/gm, '') // leaf directive lines → drop
    .replace(/::\w+\[([^\]]*)\](?:\{[^}]*\})?/g, '$1');    // inline directive → keep its label
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = []; let para = []; let list = null; // list = {type:'ul'|'ol', items:[]}
  const flushPara = () => { if (para.length) { out.push(`<p style="margin:0 0 14px">${inlineMd(escapeHtml(para.join('\n')).replace(/\n/g, '<br>'))}</p>`); para = []; } };
  const flushList = () => { if (list) { const tag = list.type; out.push(`<${tag} style="margin:0 0 14px;padding-left:22px">${list.items.map((it) => `<li style="margin:4px 0">${inlineMd(escapeHtml(it))}</li>`).join('')}</${tag}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr style="border:none;border-top:1px solid #eae4da;margin:18px 0">'); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const sz = [22, 19, 17, 15][m[1].length - 1]; out.push(`<h${m[1].length} style="margin:18px 0 10px;font-size:${sz}px;font-weight:800;line-height:1.3">${inlineMd(escapeHtml(m[2]))}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote style="margin:0 0 14px;padding:8px 16px;border-left:3px solid #f97316;color:#6f685d">${inlineMd(escapeHtml(m[1]))}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join('\n') || '<p style="margin:0"></p>';
}

// Branded, email-client-safe HTML wrapper (table layout, inline styles = LIGHT default).
// A <style> block adds a dark variant via prefers-color-scheme for clients that support it
// (Apple/iOS Mail, Outlook.com…); elsewhere it degrades to light. Optional CTA button (+
// raw link fallback) and a footer. `cta`: { url, label }.
export function mailShell(title, bodyHtml, cta) {
  const btn = cta
    ? `<tr><td style="padding-top:26px"><a href="${cta.url}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:12px;font-weight:700;font-size:15px;box-shadow:0 6px 18px -6px rgba(249,115,22,.5)">${cta.label}</a></td></tr>
       <tr><td class="bc-faint" style="padding-top:18px;color:#918a80;font-size:12px;line-height:1.5">Or paste this link into your browser:<br><a href="${cta.url}" style="color:#c2410c;word-break:break-all;text-decoration:none">${cta.url}</a></td></tr>`
    : '';
  const style = `<style>
    @media (prefers-color-scheme: dark){
      .bc-bg{background:#0a0907 !important}
      .bc-card{background:#141210 !important;border-color:#242019 !important}
      .bc-title,.bc-brand{color:#f3efe9 !important}
      .bc-text{color:#a39b8f !important}
      .bc-faint{color:#8a8278 !important}
      .bc-hr{border-color:#242019 !important}
    }
  </style>`;
  return `${style}<div class="bc-bg" style="margin:0;padding:36px 16px;background:#f4f1ec;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;margin:0 auto">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td>${brandLogo()}</td>
        <td class="bc-brand" style="padding-left:11px;font-weight:800;font-size:18px;color:#1a1714;letter-spacing:-.01em"><span style="color:#f97316">Better</span>Community</td>
      </tr></table>
    </td></tr>
    <tr><td class="bc-card" style="background:#ffffff;border:1px solid #eae4da;border-radius:20px;padding:34px;box-shadow:0 12px 40px -18px rgba(30,20,5,.18)">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="border-bottom:3px solid #f97316;width:38px;padding-bottom:16px"></td></tr>
        <tr><td style="padding-top:16px"><h1 class="bc-title" style="margin:0 0 12px;font-size:22px;color:#1a1714;letter-spacing:-.02em;font-weight:800">${title}</h1></td></tr>
        <tr><td class="bc-text" style="color:#5d5750;font-size:15px;line-height:1.66">${bodyHtml}</td></tr>
        ${btn}
      </table>
    </td></tr>
    <tr><td style="padding:20px 4px 0;text-align:center;color:#a39b8f;font-size:12px">
      © ${new Date().getFullYear()} BetterCommunity · <a href="${SITE}" style="color:#918a80;text-decoration:none">bettercommunity.ch</a>
    </td></tr>
  </table>
</div>`;
}
