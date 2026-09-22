// /verify-copy: drop the signed copy of a conversation, see whether it is genuine.
//
// The check runs on the server against the key it signs with (POST /conversation-copy/verify),
// never against a key the file carries: a file that brings its own key proves nothing. The
// offline recipe in the archive's HOW-TO-VERIFY.txt needs nothing from this page.
import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Upload, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Card, PageHeader, Spinner, Explain } from '../ui/ui.jsx';

export default function CopyVerify() {
  const { t } = useI18n();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const { data: key } = useAsync(() => api.get('/conversation-copy/key').catch(() => null), []);
  const check = async (file) => {
    if (!file) return;
    setBusy(true); setRes(null);
    try {
      let doc;
      try { doc = JSON.parse(await file.text()); } catch { setRes({ valid: false, reason: 'malformed' }); return; }
      setRes(await api.post('/conversation-copy/verify', { doc }));
    } catch { setRes({ valid: false, reason: 'failed' }); } finally { setBusy(false); }
  };
  const why = (r) => ({
    tampered: t('cv.tampered', 'This copy was changed after it was signed. Do not trust its content.'),
    other_key: t('cv.otherkey', 'This copy was not signed by this site.'),
    wrong_format: t('cv.format', 'This is not a conversation copy.'),
    malformed: t('cv.malformed', 'This file is not a signed copy. Use conversation.signed.json from the archive.'),
  }[r] || t('common.failed', 'Failed.'));
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <PageHeader icon={ShieldCheck} title={t('cv.title', 'Check a conversation copy')} subtitle={t('cv.sub', 'Drop conversation.signed.json from the archive you were sent.')} />
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); check(e.dataTransfer.files?.[0]); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 cursor-pointer text-sm ${drag ? 'border-[var(--ring)] tint-primary' : 'border-[var(--line)] text-[var(--muted)]'}`}>
        {busy ? <Spinner /> : <Upload size={22} aria-hidden />}
        <span>{t('cv.drop', 'Drop the file here, or click to choose it')}</span>
        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => check(e.target.files?.[0])} />
      </label>
      {res && (res.valid ? (
        <Card className="p-4 border-success-border bg-success-bg">
          <div className="flex items-center gap-2 font-semibold text-success"><ShieldCheck size={18} aria-hidden /> {t('cv.valid', 'Genuine and unmodified')}</div>
          <div className="text-[13px] mt-1.5">
            <b>{res.conversation.subject}</b> · {t('th.about', 'About')} {res.conversation.about} · {res.conversation.messages} {t('cv.msgs', 'messages')}
            <div className="text-[12px] text-[var(--muted)]">{t('cv.issued', 'Copy issued {d}').replace('{d}', new Date(res.conversation.issuedAt).toLocaleString())}</div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-error-border bg-error-bg">
          <div className="flex items-center gap-2 font-semibold text-error"><ShieldAlert size={18} aria-hidden /> {t('cv.invalid', 'Not valid')}</div>
          <p className="text-[13px] mt-1">{why(res.reason)}</p>
        </Card>
      ))}
      <Explain summary={t('cv.offline.lead', 'You can also check it without this site.')} className="text-[12px]">
        {t('cv.offline', 'The archive has the signed bytes, the signature and the public key, and HOW-TO-VERIFY.txt gives the openssl command. Compare the key with the one below before trusting it.')}
      </Explain>
      {key?.keyId && <p className="text-[12px] text-[var(--muted)] flex items-center gap-1.5"><KeyRound size={12} aria-hidden /> {t('cv.keyid', 'Key id')} <code className="font-mono">{key.keyId}</code> · Ed25519</p>}
    </div>
  );
}
