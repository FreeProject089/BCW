// Admin → Settings: the hosts live B.MD blocks may fetch from (SECURITY_SUMMARY §9).
//
// `:counter`, `::live`, `::chart`, `:action`, `::include`… fetch in the visitor's browser. They
// may reach this site, plus the hosts listed here: EMPTY by default. The API stores the list
// (routes/bmd-hosts.mjs, strict: a line that is not a host name is refused with its index);
// lib/bmd-hosts.js puts it in force in the renderer.
//
// The browser is the second check: the site CSP's connect-src must name the host as well
// (CSP_CONNECT_SRC_EXTRA on the caddy container, guides/run/ENV_EN.md). Saying so here is the
// point of the second paragraph: a host added only here still fails, in the console.
import { useEffect, useState } from 'react';
import { Radio, Save } from 'lucide-react';
import { Button, Card, Spinner, Textarea, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { applyBmdHosts } from '../lib/bmd-hosts.js';

/** One typed line as a host: a pasted https://host/path keeps its host. */
function lineHost(line) {
  const s = String(line || '').trim().toLowerCase();
  if (!s) return '';
  try { if (/^https?:\/\//i.test(s)) return new URL(s).hostname; } catch { /* kept as typed */ }
  return s.replace(/\.$/, '');
}
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function BmdHostsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get('/admin/bmd-hosts')
      .then((v) => { setSaved(v.hosts || []); setText((v.hosts || []).join('\n')); })
      .catch(() => setErr(true));
  }, []);

  if (err) return <Card className="p-5 mt-6 text-sm text-[var(--muted)]">{t('abh.err', 'Could not load the live-block host list.')}</Card>;
  if (!saved) return <div className="py-6 grid place-items-center"><Spinner /></div>;

  const lines = text.split('\n').map(lineHost).filter(Boolean);
  const bad = lines.filter((h) => !HOST.test(h));
  const hosts = [...new Set(lines.filter((h) => HOST.test(h)))];
  const dirty = JSON.stringify(hosts) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      const v = await api.put('/admin/bmd-hosts', { hosts });
      setSaved(v.hosts); setText(v.hosts.join('\n')); applyBmdHosts(v.hosts);
      toast.success(t('common.saved', 'Saved.'));
    } catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-5 mt-6 space-y-3" data-bmd-hosts>
      <h3 className="font-semibold flex items-center gap-2"><Radio size={16} /> {t('abh.title', 'Live blocks: hosts they may read from')}</h3>
      <p className="text-[13px] text-[var(--muted)]">{t('abh.desc', 'Live blocks in pages, posts and docs (counter, live value, chart, action, include) fetch data in the visitor’s browser. They may always read from this site. List here the other hosts they may read from; empty means this site only. A host covers its subdomains.')}</p>
      <p className="text-[13px] text-[var(--muted)]">{t('abh.csp', 'The browser checks a second time: each host must also be in CSP_CONNECT_SRC_EXTRA on the server (the caddy container), or the request is refused there.')}</p>
      <label className="block text-sm">
        <span className="block mb-1">{t('abh.hosts', 'Hosts, one per line')}</span>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'api.example.com\nstats.example.org'} spellCheck={false} />
      </label>
      {bad.length > 0 && <p className="text-[12px] text-error" role="alert">{t('abh.bad', 'Not a host name, will be refused: {list}').replace('{list}', bad.join(', '))}</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty || bad.length > 0}><Save size={14} /> {t('common.save', 'Save')}</Button>
        {dirty && <span className="text-[12px] text-[var(--muted)]">{t('abh.dirty', 'Unsaved changes')}</span>}
      </div>
    </Card>
  );
}
