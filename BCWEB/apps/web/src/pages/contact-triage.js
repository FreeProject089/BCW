// The contact triage, as data: the two questions, and what each destination asks for.
//
// The page used to be one form with a topic dropdown, which asked everybody the same three
// things and therefore asked nobody the right ones. It now asks two short questions and ends
// somewhere that fits: the notice form for a rights claim, the report flow for content or a
// person, and otherwise a small form with the two or three fields that answer actually needs.
//
// Kept out of the JSX on purpose. `apps/api/src/lib/contact-triage.mjs` is the server's copy
// of the same table (it validates every field again — the form's disabled button stops
// nothing), and `apps/api/test/contact-triage.test.mjs` imports BOTH files and fails when the
// required fields drift apart. That check only works while this file stays plain data with no
// imports: add a React import here and the test can no longer load it.
//
// No icons here for the same reason. The page maps a destination id to a lucide icon itself.

/** Labels are `{ en, fr }` everywhere. The page picks by language; nothing is English-only. */
const L = (en, fr) => ({ en, fr });

/**
 * The destinations. `kind` is the queue it files into — kept here only so a reader can see
 * where a destination lands; the SERVER derives it from the destination id and ignores
 * anything the browser says about it.
 *
 * `route` marks the two that are not a form on this page at all: an existing flow does the
 * job properly and already knows what the law asks for, so the triage hands over to it with
 * what has been typed rather than growing a second copy of it.
 */
export const DESTINATIONS = {
  rights: {
    route: 'rights',
    title: L('A copyright or takedown claim', 'Une réclamation de droits ou un retrait'),
    lead: L('The notice form asks for the work, where it appears, on what basis you hold the right, and the two statements the law asks for.',
      'Le formulaire de notification demande l’œuvre, où elle apparaît, à quel titre tu détiens le droit, et les deux déclarations exigées par la loi.'),
  },
  report: {
    route: 'report',
    title: L('Report content or someone', 'Signaler un contenu ou quelqu’un'),
    lead: L('Goes to the moderation team, with the conversation in your dashboard.',
      'Va à l’équipe de modération, avec la conversation dans ton tableau de bord.'),
  },
  hosting: {
    kind: 'billing',
    title: L('A hosting question', 'Une question d’hébergement'),
    lead: L('Plans, pools, storage, a repo that does not fit.', 'Plans, pools, stockage, un dépôt qui ne rentre pas.'),
    fields: [
      { name: 'pool', type: 'text', required: true, max: 200,
        label: L('Pool, repo or plan concerned', 'Pool, dépôt ou plan concerné'),
        placeholder: L('Pool name, or a link to the repo', 'Nom du pool, ou un lien vers le dépôt') },
      { name: 'need', type: 'text', max: 200,
        label: L('Storage or plan wanted', 'Stockage ou plan souhaité'),
        placeholder: L('200 GB, or the plan name', '200 Go, ou le nom du plan') },
    ],
  },
  invoice: {
    kind: 'billing',
    title: L('A billing or invoice question', 'Une question de facturation'),
    lead: L('A payment, a refund, an invoice you cannot find.', 'Un paiement, un remboursement, une facture introuvable.'),
    fields: [
      { name: 'invoice', type: 'text', required: true, max: 120,
        label: L('Invoice or payment reference', 'Référence de facture ou de paiement'),
        placeholder: L('From the receipt e-mail, or your billing page', 'Dans l’e-mail de reçu, ou sur ta page de facturation') },
      { name: 'amount', type: 'text', max: 40, label: L('Amount', 'Montant'), placeholder: L('12.00 CHF', '12.00 CHF') },
      { name: 'paidAt', type: 'text', max: 40, label: L('Date of the payment', 'Date du paiement'), placeholder: L('2026-09-01', '01/09/2026') },
    ],
  },
  account: {
    kind: 'account',
    title: L('A problem with my account', 'Un problème avec mon compte'),
    lead: L('Sign-in, two-factor, a linked account, a name.', 'Connexion, double authentification, un compte lié, un nom.'),
    fields: [
      { name: 'account', type: 'text', required: true, max: 200,
        label: L('Account (e-mail or display name)', 'Compte (e-mail ou nom affiché)') },
      { name: 'tried', type: 'textarea', required: true, max: 600,
        label: L('What you already tried', 'Ce que tu as déjà essayé'),
        placeholder: L('Password reset, another browser, the code from the app…', 'Réinitialisation, un autre navigateur, le code de l’application…') },
    ],
  },
  data_export: {
    kind: 'data_export',
    title: L('Send me a copy of my data', 'M’envoyer une copie de mes données'),
    lead: L('We send it to the address you give here. Write from the account address, or sign in first: we cannot send an account’s data to an address nothing links to it.',
      'Nous l’envoyons à l’adresse indiquée ici. Écris depuis l’adresse du compte, ou connecte-toi d’abord : nous ne pouvons pas envoyer les données d’un compte à une adresse que rien ne relie à lui.'),
    fields: [
      { name: 'account', type: 'text', required: true, max: 200,
        label: L('Account (e-mail or display name)', 'Compte (e-mail ou nom affiché)') },
    ],
  },
  data_delete: {
    kind: 'data_delete',
    title: L('Delete my data', 'Supprimer mes données'),
    lead: L('Erasure is permanent. Two things cannot go: moderation decisions about you, and payment records we are required to keep.',
      'La suppression est définitive. Deux choses ne peuvent pas partir : les décisions de modération te concernant et les enregistrements de paiement que la loi nous impose de conserver.'),
    fields: [
      { name: 'account', type: 'text', required: true, max: 200,
        label: L('Account (e-mail or display name)', 'Compte (e-mail ou nom affiché)') },
      { name: 'permanent', type: 'check', required: true,
        label: L('I understand this cannot be undone.', 'Je comprends que c’est irréversible.') },
    ],
  },
  security: {
    kind: 'security',
    title: L('A security problem', 'Un problème de sécurité'),
    lead: L('Tell us where it is and what it lets someone do. Do not put passwords, tokens or other people’s data in this form: we reply to the address you give and ask for the details there.',
      'Dis-nous où c’est et ce que ça permet de faire. Ne mets ni mot de passe, ni jeton, ni données d’autres personnes dans ce formulaire : nous répondons à l’adresse indiquée et demandons les détails par ce biais.'),
    fields: [
      { name: 'area', type: 'text', required: true, max: 200,
        label: L('Where it is (page, endpoint or app)', 'Où c’est (page, endpoint ou application)') },
      { name: 'impact', type: 'textarea', max: 400,
        label: L('What someone could do with it', 'Ce que quelqu’un pourrait en faire') },
      { name: 'nosecrets', type: 'check', required: true,
        label: L('No passwords, tokens or data about other people in this message.',
          'Aucun mot de passe, jeton ni donnée d’autres personnes dans ce message.') },
    ],
  },
  bug: {
    kind: 'bug',
    title: L('Something is broken', 'Quelque chose est cassé'),
    lead: L('A page, a button, an upload that fails.', 'Une page, un bouton, un envoi qui échoue.'),
    fields: [
      { name: 'where', type: 'text', required: true, max: 300,
        label: L('Where it happens (page or address)', 'Où ça arrive (page ou adresse)') },
      { name: 'version', type: 'text', max: 120,
        label: L('App or browser version', 'Version de l’application ou du navigateur') },
    ],
  },
  other: {
    kind: 'other',
    title: L('Something else', 'Autre chose'),
    lead: L('Anything that does not fit above.', 'Tout ce qui ne rentre pas au-dessus.'),
    fields: [],
  },
};

/**
 * Question one. Every answer either IS a destination or opens question two.
 *
 * Two questions is the ceiling. A third is where a person decides the form is a form about
 * forms and writes to the Discord instead.
 */
export const Q1 = [
  { id: 'report', icon: 'flag', label: L('Report content or someone', 'Signaler un contenu ou quelqu’un'),
    sub: L('Spam, abuse, malware, stolen work', 'Spam, abus, malware, travail volé'), next: 'locate' },
  { id: 'rights', icon: 'scale', label: L('A copyright or takedown claim', 'Une réclamation de droits ou un retrait'),
    sub: L('My work, my mark, my personal data', 'Mon œuvre, ma marque, mes données personnelles'), next: 'locate' },
  { id: 'billing', icon: 'card', label: L('Hosting, billing or an invoice', 'Hébergement, facturation ou facture'),
    sub: L('Plans, pools, payments', 'Plans, pools, paiements'), next: 'billing' },
  { id: 'account', icon: 'user', label: L('My account or my data', 'Mon compte ou mes données'),
    sub: L('Sign-in, a copy of my data, erasure', 'Connexion, copie de mes données, suppression'), next: 'account' },
  { id: 'security', icon: 'shield', label: L('A security problem', 'Un problème de sécurité'),
    sub: L('A flaw, a leak, something that should not be reachable', 'Une faille, une fuite, quelque chose qui ne devrait pas être accessible'), dest: 'security' },
  { id: 'bug', icon: 'bug', label: L('Something is broken', 'Quelque chose est cassé'),
    sub: L('A page, a button, an upload', 'Une page, un bouton, un envoi'), dest: 'bug' },
  { id: 'other', icon: 'message', label: L('Something else', 'Autre chose'),
    sub: L('A question, a partnership, an idea', 'Une question, un partenariat, une idée'), dest: 'other' },
];

/**
 * Question two, by the branch question one chose.
 *
 * `locate` is not a list of choices but one field: the address of the thing. It is asked here
 * rather than on the far side because both flows it feeds start by resolving exactly that,
 * and a person who has just been sent to a second page and asked the same question a third
 * time closes the tab.
 */
export const Q2 = {
  locate: {
    kind: 'locate',
    title: L('Where is it?', 'Où est-ce ?'),
    hint: L('Paste the address of the repo, catalogue, item or profile. You can leave this empty.',
      'Colle l’adresse du dépôt, du catalogue, de l’élément ou du profil. Tu peux laisser vide.'),
  },
  billing: {
    kind: 'choice',
    title: L('Which is it?', 'C’est laquelle ?'),
    options: [
      { dest: 'hosting', icon: 'server', label: L('A hosting plan, a pool or a repo', 'Un plan d’hébergement, un pool ou un dépôt') },
      { dest: 'invoice', icon: 'receipt', label: L('A payment, a refund or an invoice', 'Un paiement, un remboursement ou une facture') },
    ],
  },
  account: {
    kind: 'choice',
    title: L('Which is it?', 'C’est laquelle ?'),
    options: [
      { dest: 'account', icon: 'user', label: L('I cannot use my account', 'Je n’arrive pas à utiliser mon compte') },
      { dest: 'data_export', icon: 'download', label: L('Send me a copy of my data', 'M’envoyer une copie de mes données') },
      { dest: 'data_delete', icon: 'trash', label: L('Delete my data', 'Supprimer mes données') },
    ],
  },
};

/**
 * What a `?topic=` link fills in — the links the hosting page and the pricing page already
 * send, plus one per destination so any page can point straight at a form.
 *
 * A topic now names a DESTINATION and skips the questions; the body template is still what
 * tells somebody what to write. `scripts/check-contact-topics.mjs` fails when a link names a
 * topic this table does not have, which is the whole reason the table is a table.
 *
 * `enterprise-hosting` is kept: the pricing page linked it before the three-way split, and
 * old links live on in bookmarks and in messages already sent.
 */
export const TOPICS = {
  'hosting-plan': {
    dest: 'hosting',
    en: 'Hi, I need a hosting plan that is not on the pricing page.\n\nBandwidth / upload:\nHow many repos or catalogues:\nAnything else (SLA, dedicated resources, invoicing):\n',
    fr: "Bonjour, j'ai besoin d'un plan d'hébergement qui n'est pas sur la page des tarifs.\n\nBande passante / upload :\nCombien de dépôts ou de catalogues :\nAutre chose (SLA, ressources dédiées, facturation) :\n",
  },
  'host-project': {
    dest: 'hosting',
    en: "Hi, I'd like you to host a project of mine.\n\nWhat it is (site, Discord bot, app, service):\nWhat it runs on (Node, PHP, Next.js, Python, other):\nDoes it need to run all the time, or only on request:\nRoughly how much traffic:\nAnything it must reach (a database, an API, a domain):\n",
    fr: "Bonjour, j'aimerais que vous hébergiez un de mes projets.\n\nCe que c'est (site, bot Discord, app, service) :\nSur quoi ça tourne (Node, PHP, Next.js, Python, autre) :\nEst-ce que ça doit tourner en permanence, ou seulement à la demande :\nÀ peu près quel trafic :\nCe que ça doit pouvoir joindre (une base, une API, un domaine) :\n",
  },
  'enterprise-hosting': {
    dest: 'hosting',
    en: "Hi, I'd like a custom (enterprise) hosting plan.\nMy needs:\n- Bandwidth / upload:\n- Dedicated resources / SLA:\n- Other:",
    fr: "Bonjour, je souhaite un plan d'hébergement sur mesure (entreprise).\nMes besoins :\n- Bande passante / upload :\n- Ressources dédiées / SLA :\n- Autre :",
  },
  'billing-invoice': { dest: 'invoice', en: '', fr: '' },
  'account-help': { dest: 'account', en: '', fr: '' },
  'data-export': { dest: 'data_export', en: '', fr: '' },
  'data-delete': { dest: 'data_delete', en: '', fr: '' },
  'security-report': { dest: 'security', en: '', fr: '' },
  'bug-report': { dest: 'bug', en: '', fr: '' },
  'general': { dest: 'other', en: '', fr: '' },
};

/** The required field names of a destination — what the server and this file must agree on. */
export const requiredFields = (dest) =>
  (DESTINATIONS[dest]?.fields || []).filter((f) => f.required).map((f) => f.name).sort();

/** Is every required field of `dest` filled in `values`? The send button's own rule. */
export function fieldsComplete(dest, values) {
  const spec = DESTINATIONS[dest];
  if (!spec) return false;
  for (const f of spec.fields || []) {
    if (!f.required) continue;
    const v = values?.[f.name];
    if (f.type === 'check') { if (v !== true) return false; continue; }
    if (!String(v ?? '').trim()) return false;
    if (String(v).trim().length > f.max) return false;
  }
  return true;
}
