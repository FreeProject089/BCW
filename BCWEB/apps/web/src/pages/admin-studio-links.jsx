// Admin → Settings: the studio's link policy (PLAN-STUDIO-2026 decision D7, phase 5).
//
// Which hosts a studio block may open with an "Open another site" step. The rule lives in the
// studio package (normalizeLinkPolicy / hostAllowed, packages/studio/src/actions.js) and the API
// checks it at every studio save (lib/studio-doc.mjs); this screen only edits the value:
//   · block (default): every https host except the listed ones, each behind the "you are
//     leaving" screen visitors always get;
//   · allow: only the listed hosts.
// A host covers its subdomains. A pasted URL is reduced to its host before it is sent, and the
// server refuses anything that is still not a host name, naming the line.
import { useEffect, useState } from 'react';
import { ExternalLink, Save } from 'lucide-react';
import { Button, Card, Spinner, Textarea, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { normalizeHost } from '../lib/canvas.js';
import { setStudioLinks } from '../lib/studio-links.js';

/** One typed line as a host: a pasted https://host/path keeps its host. */
function lineHost(line) {
  const s = String(line || '').trim();
  if (!s) return '';
  try { if (/^https?:\/\//i.test(s)) return new URL(s).hostname; } catch { /* kept as typed */ }
  return s;
}

export function StudioLinksCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [mode, setMode] = useState('block');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get('/admin/studio/links')
      .then((v) => { setSaved(v); setMode(v.mode); setText((v.hosts || []).join('\n')); })
      .catch(() => setErr(true));
  }, []);

  if (err) return <Card className="p-5 mt-6 text-sm text-[var(--muted)]">{t('asl.err', 'Could not load the studio link policy.')}</Card>;
  if (!saved) return <div className="py-6 grid place-items-center"><Spinner /></div>;

  const lines = text.split('\n').map(lineHost).filter(Boolean);
  const bad = lines.filter((h) => !normalizeHost(h));
  const hosts = [...new Set(lines.map(normalizeHost).filter(Boolean))];
  const dirty = mode !== saved.mode || JSON.stringify(hosts) !== JSON.stringify(saved.hosts || []);

  const save = async () => {
    setBusy(true);
    try {
      const v = await api.put('/admin/studio/links', { mode, hosts });
      setSaved(v); setText(v.hosts.join('\n')); setStudioLinks(v);
      toast.success(t('common.saved', 'Saved.'));
    } catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-5 mt-6 space-y-3" data-studio-links>
      <h3 className="font-semibold flex items-center gap-2"><ExternalLink size={16} /> {t('asl.title', 'Studio: links to other sites')}</h3>
      <p className="text-[13px] text-[var(--muted)]">{t('asl.desc', 'A block drawn in the studio can open another site (https only). Visitors always see a screen that names the site they are going to before they leave. This decides which sites a studio page may send them to; it is checked when a page is saved and again when it is shown.')}</p>
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name="asl-mode" checked={mode === 'block'} onChange={() => setMode('block')} className="mt-1" />
          <span>{t('asl.block', 'Every site except the ones below')}<span className="block text-[12px] text-[var(--muted)]">{t('asl.block.h', 'The default. An empty list lets every https site through.')}</span></span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name="asl-mode" checked={mode === 'allow'} onChange={() => setMode('allow')} className="mt-1" />
          <span>{t('asl.allow', 'Only the sites below')}<span className="block text-[12px] text-[var(--muted)]">{t('asl.allow.h', 'An empty list turns every link to another site off.')}</span></span>
        </label>
      </div>
      <label className="block text-sm">
        <span className="block mb-1">{t('asl.hosts', 'Sites, one per line (a site covers its subdomains)')}</span>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'github.com\nyoutube.com'} spellCheck={false} />
      </label>
      {bad.length > 0 && <p className="text-[12px] text-error" role="alert">{t('asl.bad', 'Not a site name, will be refused: {list}').replace('{list}', bad.join(', '))}</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty || bad.length > 0}><Save size={14} /> {t('common.save', 'Save')}</Button>
        {dirty && <span className="text-[12px] text-[var(--muted)]">{t('asl.dirty', 'Unsaved changes')}</span>}
      </div>
    </Card>
  );
}
