// Admin > Settings > "OS mode (beta)" (aios, agent-bcw-ai-os): the site-wide switch.
//
// Off: nobody sees the header switch, the Settings card or the desktop, whatever they chose,
// and the OS shortcuts are not registered (the shell that owns them is never mounted). Their
// preference and saved window layouts stay in their browser, so switching it back on returns
// everybody to what they had. Stored as AdminSetting `os.enabled` through the ordinary settings
// door (checkAdminSetting accepts a boolean and nothing else), read by GET /site/features.
import { useEffect, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { Card, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { OsBeta, setOsSiteEnabled } from '../ui/os/os-mode.jsx';

export function AdminOsModeCard({ className = '' }) {
  const { t } = useI18n();
  const toast = useToast();
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/site/features').then((d) => setOn(d?.os?.enabled !== false)).catch(() => setOn(true)); }, []);
  const flip = async (v) => {
    setBusy(true);
    try {
      await api.put('/admin/settings/os.enabled', { value: v });
      setOn(v);
      setOsSiteEnabled(v);
      toast.success(v ? t('aos.on', 'OS mode is available again. Members who had it on get their desktop back.') : t('aos.off', 'OS mode is off for everybody. Preferences and layouts are kept for when it comes back.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Card className={`p-4 sm:p-5 mb-4 ${className}`} id="os-mode-site">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><AppWindow size={14} className="text-[var(--accent-ink)]" aria-hidden /></span>
        <span className="text-sm font-semibold">{t('aos.t', 'OS mode for the dashboards')}</span>
        <OsBeta />
        <button type="button" role="switch" aria-checked={!!on} disabled={on === null || busy} onClick={() => flip(!on)}
          aria-label={t('aos.t', 'OS mode for the dashboards')}
          className={`tap-44 ms-auto relative w-10 h-6 rounded-full transition shrink-0 disabled:opacity-60 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{t('aos.s', 'Lets members show their dashboard, and staff the admin, as a desktop of windows. Off hides every way in for everybody; their layouts stay in their browsers.')}</p>
    </Card>
  );
}
export default AdminOsModeCard;
