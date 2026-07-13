// Transactional email (email confirmation + password reset). Uses SMTP via nodemailer.
// If EMAIL_ENABLED !== 'true' (or SMTP isn't configured) sendMail is a no-op returning
// false — callers fall back gracefully (e.g. the reset endpoint returns a devToken).
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';

const SITE = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

// The BetterCommunity mark for the email header. Embedded as a data: URI so it renders
// even when SITE_URL is localhost (a mail client can't reach the dev server). Cached
// after the first read; falls back to a CSS monogram if the file isn't shipped.
let _logoTag;
function brandLogo() {
  if (_logoTag !== undefined) return _logoTag;
  for (const rel of ['../../../logo.png', '../../../apps/web/public/logo.png', '../logo.png']) {
    try {
      const b64 = readFileSync(new URL(rel, import.meta.url)).toString('base64');
      _logoTag = `<img src="data:image/png;base64,${b64}" width="36" height="36" alt="" style="border-radius:9px;display:block">`;
      return _logoTag;
    } catch { /* try next */ }
  }
  _logoTag = `<div style="width:36px;height:36px;border-radius:9px;background:#f97316;color:#fff;font-weight:800;font-size:15px;text-align:center;line-height:36px;font-family:system-ui,sans-serif">BC</div>`;
  return _logoTag;
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

// Branded, email-client-safe HTML wrapper (table layout, inline styles). LIGHT theme to
// match BetterCommunity's default (white + orange) look. Optional CTA button (+ raw link
// fallback) and a footer. `cta`: { url, label }.
export function mailShell(title, bodyHtml, cta) {
  const btn = cta
    ? `<tr><td style="padding-top:26px"><a href="${cta.url}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:12px;font-weight:700;font-size:15px;box-shadow:0 6px 18px -6px rgba(249,115,22,.5)">${cta.label}</a></td></tr>
       <tr><td style="padding-top:18px;color:#918a80;font-size:12px;line-height:1.5">Or paste this link into your browser:<br><a href="${cta.url}" style="color:#c2410c;word-break:break-all;text-decoration:none">${cta.url}</a></td></tr>`
    : '';
  return `<div style="margin:0;padding:36px 16px;background:#f4f1ec;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;margin:0 auto">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td>${brandLogo()}</td>
        <td style="padding-left:11px;font-weight:800;font-size:18px;color:#1a1714;letter-spacing:-.01em"><span style="color:#f97316">Better</span>Community</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #eae4da;border-radius:20px;padding:34px;box-shadow:0 12px 40px -18px rgba(30,20,5,.18)">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="border-bottom:3px solid #f97316;width:38px;padding-bottom:16px"></td></tr>
        <tr><td style="padding-top:16px"><h1 style="margin:0 0 12px;font-size:22px;color:#1a1714;letter-spacing:-.02em;font-weight:800">${title}</h1></td></tr>
        <tr><td style="color:#5d5750;font-size:15px;line-height:1.66">${bodyHtml}</td></tr>
        ${btn}
      </table>
    </td></tr>
    <tr><td style="padding:20px 4px 0;text-align:center;color:#a39b8f;font-size:12px">
      © ${new Date().getFullYear()} BetterCommunity · <a href="${SITE}" style="color:#918a80;text-decoration:none">bettercommunity.ch</a>
    </td></tr>
  </table>
</div>`;
}
