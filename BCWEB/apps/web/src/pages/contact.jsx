import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { Button, Card, Field, Input, PageHeader, Spinner, useToast } from '../ui/ui.jsx';
import { Mail, MessageSquare, Send, ShieldCheck, BadgeCheck } from 'lucide-react';
import { GithubIcon, DiscordIcon, KofiIcon, RedditIcon } from '../ui/brand.jsx';
import { api } from '../lib/api.js';

export function Contact() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const fr = lang === 'fr';
  const [msg, setMsg] = useState({ name: '', email: '', body: '' });
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
      await api.post('/contact', { name: msg.name.trim(), email: msg.email.trim(), body: msg.body.trim(), pow });
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
        <div className="px-6 py-4 border-b border-[var(--line)] bg-gradient-to-r from-orange-500/12 via-amber-500/6 to-transparent flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500"><MessageSquare size={16} className="text-white" /></span>
          <div><div className="font-semibold leading-tight">{fr ? 'Envoyer un message' : 'Send a message'}</div>
            <div className="text-xs text-[var(--muted)]">{fr ? 'Reçu directement par l’équipe — réponse par email.' : 'Goes straight to the team — we reply by email.'}</div></div>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-emerald-500/15 mb-4"><BadgeCheck size={28} className="text-emerald-400" /></span>
            <div className="text-lg font-semibold">{fr ? 'Message envoyé !' : 'Message sent!'}</div>
            <p className="text-sm text-[var(--muted)] mt-1.5 max-w-sm mx-auto">{fr ? 'Merci — on te répond dès que possible. Pour du temps réel, rejoins le Discord ci-dessus.' : 'Thanks — we’ll get back to you soon. Prefer real-time? Join the Discord above.'}</p>
            <Button className="mt-5" onClick={() => { setSent(false); setMsg({ name: '', email: '', body: '' }); }}>{fr ? 'Envoyer un autre' : 'Send another'}</Button>
          </div>
        ) : (
          <div className="p-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={fr ? 'Ton nom' : 'Your name'}><Input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} maxLength={100} placeholder={fr ? 'Ton nom ou pseudo' : 'Your name or handle'} /></Field>
              <Field label={fr ? 'Ton email' : 'Your email'} hint={msg.email && !emailOk ? (fr ? 'Email invalide' : 'Invalid email') : undefined}>
                <Input type="email" value={msg.email} onChange={(e) => setMsg({ ...msg, email: e.target.value })} maxLength={254} placeholder="you@example.com" className={msg.email && !emailOk ? '!border-red-500/40' : ''} /></Field>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">Message <span className="normal-case font-normal text-[var(--faint)]">({fr ? 'markdown supporté' : 'markdown supported'})</span></label>
                <span className={`text-[11px] ${msg.body.length > 2000 ? 'text-red-400' : 'text-[var(--faint)]'}`}>{msg.body.length}/2000</span>
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
