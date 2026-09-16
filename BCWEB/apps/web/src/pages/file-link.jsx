// /f/<token> — a file behind a link that stops working: a Make Your Own delivery, a file an
// admin attached to a mail. The page says what the file is, until when the link works, and
// hands the download over to the API (which records it — a delivery's first download is the
// proof both sides see in the conversation). Past the date it says so instead of a bare 410.
import { useParams, Link } from 'react-router-dom';
import { Download, Clock, FileX2, LogIn } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { PageHeader, Button, Card, Spinner } from '../ui/ui.jsx';

const fmtBytes = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '');

export default function FileLink() {
  const { token } = useParams();
  const { t } = useI18n();
  const { data, loading, error } = useAsync(() => api.get(`/f/${encodeURIComponent(token)}/info`), [token]);
  if (loading && !data) return <div className="py-16 text-center"><Spinner /></div>;
  const gone = !data || error;
  const st = data?.status;
  const ok = st === 'ok' && !data?.needsSignIn;
  const REASON = {
    expired: t('flink.expired', 'This link has expired. The file is no longer available.'),
    revoked: t('flink.revoked', 'This link was withdrawn. The file is no longer available.'),
    exhausted: t('flink.exhausted', 'This link has been used the maximum number of times.'),
    purged: t('flink.expired', 'This link has expired. The file is no longer available.'),
  };
  return (
    <div className="max-w-md mx-auto py-12">
      <PageHeader icon={ok ? Download : FileX2} title={t('flink.title', 'File')} subtitle={gone ? t('flink.gone', 'There is no file at this address.') : (data.fileName || t('flink.afile', 'A file shared with you'))} />
      {!gone && (
        <Card className="p-5 space-y-3">
          <div className="text-sm text-[var(--muted)] flex flex-wrap gap-x-3 gap-y-1">
            {data.bytes ? <span>{fmtBytes(data.bytes)}</span> : null}
            {data.expiresAt && <span className="inline-flex items-center gap-1"><Clock size={13} /> {ok ? t('flink.until', 'Available until {d}').replace('{d}', fmtDate(data.expiresAt)) : t('flink.expiredOn', 'Expired on {d}').replace('{d}', fmtDate(data.expiresAt))}</span>}
            {data.downloads ? <span>{t('flink.downloads', 'Downloaded {n} time(s)').replace('{n}', data.downloads)}</span> : null}
          </div>
          {data.needsSignIn && (
            <div className="text-sm">
              <p className="mb-2">{t('flink.signin', 'This file belongs to an account. Sign in with it to download.')}</p>
              <Link to={`/auth?next=${encodeURIComponent(`/f/${token}`)}`}><Button variant="primary"><LogIn size={14} /> {t('nav.signin', 'Sign in')}</Button></Link>
            </div>
          )}
          {ok && (
            <div>
              <a href={`/api/f/${encodeURIComponent(token)}`} rel="noreferrer"><Button variant="primary"><Download size={14} /> {t('flink.download', 'Download')}</Button></a>
              {data.kind === 'myo' && <p className="text-[11px] text-[var(--faint)] mt-2">{t('flink.myo.note', 'Your first download is recorded in the request’s conversation as proof of delivery; the link then stays valid for 7 more days at most.')}</p>}
            </div>
          )}
          {!ok && !data.needsSignIn && <p className="text-sm text-[var(--muted)]">{REASON[st] || REASON.expired}</p>}
        </Card>
      )}
    </div>
  );
}
