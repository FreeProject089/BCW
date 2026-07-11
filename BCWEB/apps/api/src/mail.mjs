// Transactional email (email confirmation + password reset). Uses SMTP via nodemailer.
// If EMAIL_ENABLED !== 'true' (or SMTP isn't configured) sendMail is a no-op returning
// false — callers fall back gracefully (e.g. the reset endpoint returns a devToken).
import nodemailer from 'nodemailer';

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

export async function sendMail({ to, subject, html, text }) {
  if (!emailEnabled()) return false;
  const from = process.env.SMTP_FROM || 'BetterCommunity <no-reply@localhost>';
  await tx().sendMail({ from, to, subject, html, text });
  return true;
}

// Escape user/admin-supplied text before interpolating it into an email's HTML body,
// so a display name or reason like `<img onerror=…>` can't inject markup into the mail
// (CWE-79). Always run untrusted values through this when building email HTML.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Branded HTML wrapper with an optional CTA button (+ the raw link as a fallback).
export function mailShell(title, bodyHtml, cta) {
  const btn = cta
    ? `<div style="margin-top:20px"><a href="${cta.url}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">${cta.label}</a></div>
       <div style="color:#6f685d;font-size:12px;margin-top:18px">Or paste this link into your browser:<br><span style="color:#a39b8f;word-break:break-all">${cta.url}</span></div>`
    : '';
  return `<div style="font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;background:#0e0c09;color:#f3efe9;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#15120d;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:28px">
    <div style="font-weight:800;font-size:18px;margin-bottom:10px"><span style="color:#f97316">Better</span>Community</div>
    <h1 style="font-size:19px;margin:0 0 8px">${title}</h1>
    <div style="color:#a39b8f;font-size:14px;line-height:1.6">${bodyHtml}</div>
    ${btn}
  </div></div>`;
}
