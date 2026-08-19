import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Button, Card, Field, Input, PageHeader, Spinner, useToast } from '../ui/ui.jsx';
import { Mail, MessageSquare, Send, ShieldCheck, BadgeCheck } from 'lucide-react';
import { GithubIcon, DiscordIcon, KofiIcon, RedditIcon } from '../ui/brand.jsx';
import { api } from '../lib/api.js';

// Sender-declared subject. Mirrors CONTACT_KINDS in the API, which validates against a
// closed list — so a kind here that the server does not know is rejected rather than filed
// into a queue nobody counts.
const KINDS = [
  { v: 'other', en: 'Something else', fr: 'Autre chose' },
  { v: 'bug', en: 'A bug or something broken', fr: 'Un bug ou quelque chose de cassé' },
  { v: 'billing', en: 'Billing or hosting', fr: 'Facturation ou hébergement' },
  { v: 'appeal', en: 'Appealing a moderation decision', fr: 'Contester une décision de modération' },
  { v: 'data_export', en: 'Send me a copy of my data', fr: 'M’envoyer une copie de mes données' },
  { v: 'data_delete', en: 'Delete my data', fr: 'Supprimer mes données' },
  // The two the Terms send people here for. Without them a legal notice arrives as
  // 'other' and is triaged as a support ticket.
  { v: 'report', en: 'Report illegal or harmful content', fr: 'Signaler un contenu illégal ou préjudiciable' },
  { v: 'copyright', en: 'Copyright or other rights claim', fr: 'Droit d’auteur ou autre atteinte à mes droits' },
];

// Prefilled only when the field is still empty, so choosing a kind never overwrites
// something already typed.
const TEMPLATES = {
  data_export: {
    en: 'I would like a copy of the personal data you hold about me.\n\nAccount (email or display name):\n',
    fr: 'Je souhaite recevoir une copie des données personnelles que vous détenez à mon sujet.\n\nCompte (e-mail ou nom affiché) :\n',
  },
  data_delete: {
    en: 'I would like my personal data deleted.\n\nAccount (email or display name):\n',
    fr: 'Je souhaite la suppression de mes données personnelles.\n\nCompte (e-mail ou nom affiché) :\n',
  },
  // Asks for the four things DSA Art. 16 needs to make a notice give us actual
  // knowledge. Prefilled rather than validated: a notice missing a line is still a
  // notice and we would rather receive it than reject it at the form.
  report: {
    en: 'What is wrong:\n\nExact location (URL or page):\n\nWhy you believe it is illegal or breaks the rules:\n\nI am acting in good faith and believe this information is accurate: yes\n',
    fr: 'Ce qui ne va pas :\n\nEmplacement exact (URL ou page) :\n\nPourquoi tu penses que c’est illégal ou contraire aux règles :\n\nJ’agis de bonne foi et je crois ces informations exactes : oui\n',
  },
  // The rights-holder notice. The last line matters: a listing may only be a LINK, in
  // which case delisting is all we can do and they need to notify the real host too.
  copyright: {
    en: 'The work or right concerned:\n\nWhere it appears here (URL or page):\n\nOn what basis you hold the right:\n\nHow to reach you:\n\nI am acting in good faith and believe this information is accurate: yes\n',
    fr: 'L’œuvre ou le droit concerné :\n\nOù il apparaît ici (URL ou page) :\n\nÀ quel titre tu détiens ce droit :\n\nComment te joindre :\n\nJ’agis de bonne foi et je crois ces informations exactes : oui\n',
  },
};

export function Contact() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const fr = lang === 'fr';
  const [msg, setMsg] = useState({ name: '', email: '', body: '', kind: 'other' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Prefill from the account when logged in — the message is linked to the
  // account server-side regardless, this is just a convenience.
  useEffect(() => { if (user) setMsg((m) => ({ ...m, name: m.name || user.displayName || '', email: m.email || user.email || '' })); }, [user]);
  // Prefill the body from a ?topic= (e.g. the Enterprise hosting "Contact us" button).
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('topic') === 'enterprise-hosting') {
      const tmpl = fr
        ? "Bonjour, je souhaite un plan d'hébergement sur mesure (entreprise).\nMes besoins :\n- Stockage :\n- Bande passante / upload :\n- Ressources dédiées / SLA :\n- Autre :"
        : 'Hi, I\'d like a custom (enterprise) hosting plan.\nMy needs:\n- Storage:\n- Bandwidth / upload:\n- Dedicated resources / SLA:\n- Other:';
      setMsg((m) => ({ ...m, body: m.body || tmpl }));
    }
    // Report template for logged-out users sent here by a Report button (?report=type&id=&label=).
    const rType = params.get('report');
    if (rType) {
      const label = params.get('label') || ''; const rid = params.get('id') || '';
      const ref = `${rType}${label ? ` "${label}"` : ''}${rid ? ` (${rid})` : ''}`;
      const tmpl = fr
        ? `Signalement — ${ref}\n\nRaison :\n\nDétails :\n\n(Astuce : connecte-toi pour suivre ton signalement et échanger avec l'équipe dans ton tableau de bord.)`
        : `Report — ${ref}\n\nReason:\n\nDetails:\n\n(Tip: sign in to track your report and chat with the team from your dashboard.)`;
      setMsg((m) => ({ ...m, body: m.body || tmpl }));
    }
  }, [params, fr]);
  const channels = [
    { icon: DiscordIcon, label: 'Discord', sub: fr ? 'Support & communauté, en direct' : 'Fastest support & community', href: 'https://discord.com/invite/CTaaEF9R75' },
    { icon: GithubIcon, label: 'GitHub', sub: fr ? 'Signaler un bug / une issue' : 'Report bugs & issues', href: 'https://github.com/FreeProject089' },
    { icon: KofiIcon, label: 'Ko-fi', sub: fr ? 'Soutenir le projet' : 'Support the project', href: 'https://ko-fi.com/bettercommunity', kofi: true },
    { icon: RedditIcon, label: 'Reddit', sub: fr ? 'Discussions' : 'Discussions', href: 'https://www.reddit.com/r/BetterModManager/' },
  ];
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.email);
  const valid = msg.name.trim().length >= 1 && emailOk && msg.body.trim().length >= 5;
  const send = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow')); // anti-spam proof-of-work
      await api.post('/contact', { name: msg.name.trim(), email: msg.email.trim(), body: msg.body.trim(), kind: msg.kind, pow });
      setSent(true);
    } catch (x) {
      const err = x.data?.error;
      toast.error(err === 'daily_limit' ? (fr ? (user ? 'Limite quotidienne atteinte (5/jour).' : 'Limite quotidienne atteinte (3/jour). Connecte-toi pour 5/jour.') : (user ? 'Daily limit reached (5/day).' : 'Daily limit reached (3/day). Log in for 5/day.'))
        : err === 'invalid_input' ? (fr ? 'Vérifie les champs.' : 'Check the fields.') : (fr ? 'Échec de l’envoi.' : 'Failed to send.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={Mail} title="Contact" subtitle={fr ? 'Questions, bugs, partenariats — écris-nous.' : 'Questions, bug reports, partnerships — reach the team.'} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {channels.map((c) => (
          <a key={c.label} href={c.href} target="_blank" rel="noreferrer">
            <Card hover className="p-5 h-full"><c.icon size={22} className={c.kofi ? 'text-orange-400' : 'text-[var(--primary-2)]'} />
              <div className="font-semibold mt-3">{c.label}</div><div className="text-xs text-[var(--muted)] mt-0.5">{c.sub}</div></Card>
          </a>
        ))}
      </div>

      <Card className="overflow-hidden">
        {/* gradient header strip */}
        <div className="px-6 py-4 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-2"><MessageSquare size={16} className="text-white" /></span>
          <div><div className="font-semibold leading-tight">{fr ? 'Envoyer un message' : 'Send a message'}</div>
            <div className="text-xs text-[var(--muted)]">{fr ? 'Reçu directement par l’équipe — réponse par email.' : 'Goes straight to the team — we reply by email.'}</div></div>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-success-bg mb-4"><BadgeCheck size={28} className="text-success" /></span>
            <div className="text-lg font-semibold">{fr ? 'Message envoyé !' : 'Message sent!'}</div>
            <p className="text-sm text-[var(--muted)] mt-1.5 max-w-sm mx-auto">{fr ? 'Merci — on te répond dès que possible. Pour du temps réel, rejoins le Discord ci-dessus.' : 'Thanks — we’ll get back to you soon. Prefer real-time? Join the Discord above.'}</p>
            <Button className="mt-5" onClick={() => { setSent(false); setMsg({ name: '', email: '', body: '', kind: 'other' }); }}>{fr ? 'Envoyer un autre' : 'Send another'}</Button>
          </div>
        ) : (
          <div className="p-6">
            {/* Asked FIRST, because two of these are not support tickets. An export or
                erasure request carries a legal deadline, and one filed as free text among
                "the download button is grey" is found by whoever happens to read it. The
                answer is a routing hint, never a decision — staff can re-file it. */}
            <Field label={fr ? 'C’est à quel sujet ?' : 'What is this about?'}>
              <select
                value={msg.kind}
                onChange={(e) => setMsg((m) => ({ ...m, kind: e.target.value, body: m.body || (TEMPLATES[e.target.value]?.[fr ? 'fr' : 'en'] || '') }))}
                className="input w-full"
              >
                {KINDS.map((k) => <option key={k.v} value={k.v}>{fr ? k.fr : k.en}</option>)}
              </select>
            </Field>
            {(msg.kind === 'data_export' || msg.kind === 'data_delete') && (
              <div className="mt-2 mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[12px] text-[var(--muted)]">
                {msg.kind === 'data_export'
                  ? (fr
                    ? 'Nous vous enverrons une copie de vos données à cette adresse. Écrivez depuis l’adresse du compte, ou connectez-vous avant d’envoyer : nous ne pouvons pas envoyer les données d’un compte à une adresse que rien ne relie à lui.'
                    : 'We will send a copy of your data to this address. Write from the account’s address, or sign in before sending — we cannot send an account’s data to an address nothing links to it.')
                  : (fr
                    ? 'La suppression est définitive. Certaines choses ne peuvent pas partir : les décisions de modération vous concernant et les enregistrements de paiement que la loi nous impose de conserver. Tout le reste s’en va.'
                    : 'Erasure is permanent. Some things cannot go: moderation decisions about you, and payment records we are required to keep. Everything else does.')}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={fr ? 'Ton nom' : 'Your name'}><Input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} maxLength={100} placeholder={fr ? 'Ton nom ou pseudo' : 'Your name or handle'} /></Field>
              <Field label={fr ? 'Ton email' : 'Your email'} hint={msg.email && !emailOk ? (fr ? 'Email invalide' : 'Invalid email') : undefined}>
                <Input type="email" value={msg.email} onChange={(e) => setMsg({ ...msg, email: e.target.value })} maxLength={254} placeholder="you@example.com" className={msg.email && !emailOk ? '!border-error-border' : ''} /></Field>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">Message <span className="normal-case font-normal text-[var(--faint)]">({fr ? 'markdown supporté' : 'markdown supported'})</span></label>
                <span className={`text-[11px] ${msg.body.length > 2000 ? 'text-error' : 'text-[var(--faint)]'}`}>{msg.body.length}/2000</span>
              </div>
              <div className="rounded-xl border border-[var(--line)] overflow-hidden focus-within:border-[var(--line-strong)] transition-colors" style={{ background: 'var(--surface-2)' }}>
                <textarea value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} maxLength={2000} rows={6}
                  placeholder={fr ? 'Décris ta question, ton bug ou ta proposition…' : 'Describe your question, bug, or proposal…'}
                  className="w-full bg-transparent px-3.5 py-3 text-sm outline-none resize-y leading-relaxed text-[var(--text)]" style={{ minHeight: 150 }} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
              <p className="text-xs text-[var(--faint)] flex items-center gap-1.5"><ShieldCheck size={13} className="text-[var(--primary-2)]" /> {fr ? 'Ton email sert uniquement à te répondre.' : 'Your email is only used to reply to you.'}</p>
              <Button variant="primary" disabled={!valid || busy} onClick={send}>{busy ? <Spinner /> : <><Send size={15} /> {fr ? 'Envoyer' : 'Send message'}</>}</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
