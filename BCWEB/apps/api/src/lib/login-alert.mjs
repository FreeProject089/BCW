// "Somebody signed in to your account" — and when it is worth saying so.
//
// ── What counts as new ────────────────────────────────────────────────────────
// Not a new IP. A phone changes address several times a day without going anywhere, and an
// alert that fires on that is one people filter to a folder in a week — at which point the
// one that mattered is in the folder too. The IP is still IN the mail, because it is useful
// once you are already reading; it is just not what decides to send it.
//
// Three things are worth a mail, in this order of urgency:
//
//   after_failures — a success on this address after several failures in the last quarter of
//                    an hour. Somebody was guessing and then stopped guessing. This is the
//                    only one that fires on a KNOWN device, because a guesser who succeeds
//                    from the owner's own machine is a guesser who has the machine.
//   new_country    — the account signed in from a country it has never signed in from. The
//                    country comes from the same geo lookup the Sessions panel shows, so what
//                    the mail says and what the panel says are the same fact.
//   new_device     — a browser/OS/device combination this account has never used. Coarse on
//                    purpose: it survives a browser update, and it does not fire because
//                    somebody opened a private window.
//
// ── What is deliberately silent ───────────────────────────────────────────────
// The FIRST session an account ever has. There is nothing to compare it to, the person is
// looking at the screen, and "welcome — by the way, a new device signed in" is the mail that
// teaches somebody this alert means nothing. A first success after failures still speaks.
//
// And a repeat: the same reason on the same fingerprint inside a day is sent once. Two
// browsers open on one laptop is not two events.
//
// ── Why this is a preference, and why it is not in `security` ─────────────────
// `security` is locked — a ban, a revoked key, an app losing access, a closure. What those
// have in common is that they have ALREADY happened TO the account, the person did not cause
// them, and if the notice is muted the fact is gone.
//
// A sign-in alert is none of those. It is a routine event the person caused themselves in
// almost every case, it fires on a schedule they control (every time they pick up a new
// laptop), and — the part that decides it — muting it loses nothing: /me/sessions lists every
// signed-in device at all times, with where and when, and is where you revoke one. The mail
// is a push copy of something already visible and already actionable. Locking a category that
// is 99% self-caused is how a locked category gets ignored, and the categories that must
// never be ignored are in the locked one.
//
// So: a mutable `logins` category, and ONE switch for both deliveries. A preference that
// silences the bell and not the inbox is a rule written twice.

import { notify, NOTIF_CATEGORIES } from './lib.mjs';
import { sendMail, mailShell, escapeHtml, emailEnabled } from './mail.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

/** Recent failures on an address that make the next success interesting. Same window and
 *  same threshold as the proof-of-work escalation in /auth/login — one definition of "this
 *  address is being guessed at", used by the two things that care. */
export const FAIL_WINDOW_MS = 15 * 60_000;
export const FAIL_THRESHOLD = 3;
/** One notice per reason per fingerprint per day. */
export const DEDUP_MS = 24 * 3600 * 1000;

/** The device identity an alert is keyed on. Coarse, lowercased, never the IP. */
export function fingerprintOf(session) {
  return ['browser', 'os', 'device']
    .map((k) => String(session?.[k] || '').trim().toLowerCase() || '?')
    .join('|');
}

/**
 * Decide, from facts only. No database, no clock, no mail — so the rule can be tested as a
 * rule.
 *
 * `knownFingerprints` / `knownCountries` describe the account BEFORE this sign-in; passing
 * sets that already contain the new session is the one mistake that makes this silently
 * never fire, which is why the caller gathers them first and this function cannot.
 */
export function classifyLogin({ priorSessionCount = 0, knownFingerprints, knownCountries, fingerprint, country, recentFails = 0 }) {
  if (recentFails >= FAIL_THRESHOLD) return { reason: 'after_failures', fails: recentFails };
  // Nothing to be new against.
  if (!priorSessionCount) return null;
  const c = String(country || '').trim().toUpperCase();
  if (c && knownCountries && !knownCountries.has(c)) return { reason: 'new_country' };
  if (fingerprint && knownFingerprints && !knownFingerprints.has(fingerprint)) return { reason: 'new_device' };
  return null;
}

/** Everything about the account's history this decision needs, read BEFORE the new session
 *  row exists. */
export async function priorLoginContext(p, userId) {
  const rows = await p.session.findMany({
    where: { userId },
    // A bound, not a page: what is being computed is a set of distinct values, and nobody
    // legitimately has hundreds of devices. An account that somehow does gets its oldest
    // devices forgotten, which can only make the alert MORE likely to fire.
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { browser: true, os: true, device: true, country: true },
  }).catch(() => []);
  return {
    priorSessionCount: rows.length,
    knownFingerprints: new Set(rows.map(fingerprintOf)),
    knownCountries: new Set(rows.map((r) => String(r.country || '').trim().toUpperCase()).filter(Boolean)),
  };
}

const HEADLINE = {
  after_failures: 'Your account was signed in to after several failed attempts',
  new_country: 'Your account was signed in to from a new country',
  new_device: 'Your account was signed in to on a new device',
};
const LEAD = {
  after_failures: 'Somebody tried your password several times and then got in. If that was you finding the right one, there is nothing to do. If it was not, treat this as a compromise: change your password now, and sign every other device out.',
  new_country: 'This is the first time your account has been used from this country.',
  new_device: 'This is the first time your account has been used on this browser.',
};

/** Where the sign-in came from, as a sentence a person can check against their own day. */
function whereLine(session) {
  const place = [session?.city, session?.region, session?.country].filter(Boolean).join(', ');
  const what = [session?.browser, session?.os].filter(Boolean).join(' on ');
  return { place: place || 'an unknown location', what: what || 'an unrecognised browser' };
}

/**
 * Raise the alert, if there is one to raise.
 *
 * Never throws and never blocks a sign-in: it is called without being awaited. A person who
 * cannot be told about their login must still be able to log in.
 */
export async function maybeAlertLogin(p, user, prior, { recentFails = 0, sessionId = null } = {}) {
  try {
    // The row issueSession has just written — the geo and UA parsing already happened there,
    // and doing it twice would be two answers to one question.
    const session = sessionId
      ? await p.session.findUnique({ where: { id: sessionId }, select: { id: true, ip: true, browser: true, os: true, device: true, country: true, region: true, city: true, createdAt: true } })
      : await p.session.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, ip: true, browser: true, os: true, device: true, country: true, region: true, city: true, createdAt: true } });
    if (!session) return null;
    const fingerprint = fingerprintOf(session);
    const verdict = classifyLogin({ ...prior, fingerprint, country: session.country, recentFails });
    if (!verdict) return null;

    // Already said, recently, about the same thing.
    const since = new Date(Date.now() - DEDUP_MS);
    const dup = await p.loginAlert.findFirst({ where: { userId: user.id, reason: verdict.reason, fingerprint, createdAt: { gte: since } }, select: { id: true } });
    if (dup) return null;

    await p.loginAlert.create({ data: { userId: user.id, reason: verdict.reason, fingerprint, country: session.country || null, ip: session.ip || null, sessionId: session.id } });

    // One switch, both deliveries. notify() applies the category itself; the mail has to be
    // asked the same question explicitly or the switch would silence half of it.
    const kind = `login_${verdict.reason}`;
    const { place, what } = whereLine(session);
    await notify(p, user.id, kind,
      `${HEADLINE[verdict.reason]} — ${what}, from ${place}. If this was not you, change your password and sign out everywhere.`,
      { bodyFr: `${what}, depuis ${place}. Si ce n'était pas vous, changez votre mot de passe et déconnectez tous vos appareils.`, href: '/profile' });

    if (!emailEnabled()) return verdict.reason;
    const cat = 'logins';
    if (!NOTIF_CATEGORIES[cat]?.locked) {
      const u = await p.user.findUnique({ where: { id: user.id }, select: { notifPrefs: true } });
      if (u?.notifPrefs && u.notifPrefs[cat] === false) return verdict.reason;
    }
    const when = new Date(session.createdAt || Date.now()).toUTCString();
    // The full IP, as on /me/sessions: the account holder is the one person entitled to see
    // where their own account was used from, and this mail goes to nobody else.
    const rows = [
      ['When', when],
      ['Where', place],
      ['Device', what],
      ['IP address', session.ip || 'unknown'],
    ].map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#918a80">${k}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('');
    const body = `<p style="margin:0 0 14px">${escapeHtml(LEAD[verdict.reason])}</p>`
      + `<table role="presentation" style="border-collapse:collapse;font-size:14px;margin:0 0 14px">${rows}</table>`
      + '<p style="margin:0 0 14px">Your signed-in devices are listed in your account, and you can sign any of them out from there.</p>';
    await sendMail({
      to: user.email,
      mailId: 'login-alert',
      subject: HEADLINE[verdict.reason],
      html: mailShell(HEADLINE[verdict.reason], body, { url: `${SITE_URL}/profile`, label: 'Check my devices' }, { mailId: 'login-alert' }),
      text: `${HEADLINE[verdict.reason]}\n${when} · ${place} · ${what} · ${session.ip || 'unknown IP'}\n${SITE_URL}/profile`,
    }).catch(() => {});
    return verdict.reason;
  } catch { return null; }
}
