// prerelease (agent-prerelease): the three mails of early access, built by the shared shell
// (mailShell) and sent by the shared sender (sendMail), so the admin's wording overrides, the
// mail log and the "e-mail is switched off" rule all apply exactly as to every other mail.
//
//   prerelease-signup        your sign-up is registered (or, in an open-to-all pre-release,
//                            you are in): the member asked for it, so it always goes.
//   prerelease-selected      you were selected: the access. The mail links to the pre-release
//                            page, never to the file: the download goes through the API, which
//                            checks the selection on every request. Always goes: it answers a
//                            request the member made, and is the one they are waiting for.
//   prerelease-not-selected  not this time. Only when the editor asks for it, and never to an
//                            account that switched "Releases & early access" off.
//
// No account e-mail in a mail's body, no token in a URL. `setPrereleaseSender` is the test seam
// (the "mail stub"): tests capture what would have been sent instead of reaching SMTP.
import { sendMail, mailShell, escapeHtml } from './mail.mjs';

const SITE = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
let _sender = null;
/** Tests only: route every early-access mail through `fn(msg)` instead of SMTP. Null restores. */
export function setPrereleaseSender(fn) { _sender = typeof fn === 'function' ? fn : null; }

const fr = (u) => String(u?.locale || '').toLowerCase().startsWith('fr');
const pick = (u, pr, k) => (fr(u) && pr[`${k}Fr`]) || pr[k] || '';
/** Muted "Releases & early access" (lib.mjs NOTIF_CATEGORIES.releases). */
export const mutedReleases = (u) => !!(u?.notifPrefs && u.notifPrefs.releases === false);

async function deliver(msg) {
  try { return await (_sender || sendMail)(msg); } catch { return false; }
}

function build(mailId, user, pr, projectName, en, frText) {
  const isFr = fr(user);
  const title = pick(user, pr, 'title');
  const url = `${SITE}/prereleases/${encodeURIComponent(pr.slug)}`;
  const t = isFr ? frText : en;
  const lead = escapeHtml(t.lead.replace('{title}', title).replace('{project}', projectName || ''));
  const more = t.more ? escapeHtml(t.more) : '';
  // nosemgrep: html-in-template-string -- both values went through escapeHtml just above
  const body = `<p style="margin:0 0 14px">${lead}</p>${more ? `<p style="margin:0 0 14px">${more}</p>` : ''}`;
  const html = mailShell(t.subject.replace('{title}', title), body, { url, label: t.cta }, { mailId });
  return { to: user.email, subject: t.subject.replace('{title}', title), html, text: `${t.lead.replace('{title}', title).replace('{project}', projectName || '')}\n\n${url}`, mailId };
}

/** The sign-up is registered. `status` is the sign-up's status: `selected` in an open-to-all one. */
export async function mailSignup(user, pr, projectName, status) {
  if (!user?.email) return false;
  if (status === 'selected') return mailSelected(user, pr, projectName);
  return deliver(build('prerelease-signup', user, pr, projectName, {
    subject: 'You signed up for early access: {title}',
    lead: 'Your sign-up for {title} ({project}) is registered.',
    more: 'The team chooses who gets early access once sign-ups close. You will get a mail either way if you are selected, and you can follow your status or withdraw on the page.',
    cta: 'See the pre-release',
  }, {
    subject: 'Inscription à l’accès anticipé : {title}',
    lead: 'Ton inscription à {title} ({project}) est enregistrée.',
    more: 'L’équipe choisit qui reçoit l’accès anticipé à la fin des inscriptions. Tu recevras un mail si tu es sélectionné, et tu peux suivre ton statut ou te retirer sur la page.',
    cta: 'Voir la préversion',
  }));
}

/** Selected: the access. */
export async function mailSelected(user, pr, projectName) {
  if (!user?.email) return false;
  return deliver(build('prerelease-selected', user, pr, projectName, {
    subject: 'You have early access: {title}',
    lead: 'You were selected for early access to {title} ({project}).',
    more: 'Sign in and open the page to download it. The download is for you: the link it gives you works for a couple of minutes and only for your account.',
    cta: 'Open the pre-release',
  }, {
    subject: 'Tu as l’accès anticipé : {title}',
    lead: 'Tu as été sélectionné pour l’accès anticipé à {title} ({project}).',
    more: 'Connecte-toi et ouvre la page pour le télécharger. Le téléchargement est pour toi : le lien donné ne marche que quelques minutes et seulement pour ton compte.',
    cta: 'Ouvrir la préversion',
  }));
}

/** Not this time. Skipped for an account that muted releases. */
export async function mailNotSelected(user, pr, projectName) {
  if (!user?.email || mutedReleases(user)) return false;
  return deliver(build('prerelease-not-selected', user, pr, projectName, {
    subject: 'Early access: {title}',
    lead: 'Thank you for signing up for {title} ({project}). You were not selected this time.',
    more: 'Places were limited. The next pre-releases are listed on the site.',
    cta: 'See the pre-releases',
  }, {
    subject: 'Accès anticipé : {title}',
    lead: 'Merci de t’être inscrit à {title} ({project}). Tu n’as pas été sélectionné cette fois.',
    more: 'Les places étaient limitées. Les prochaines préversions sont listées sur le site.',
    cta: 'Voir les préversions',
  }));
}
