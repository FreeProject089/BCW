// Settings → "Dashboards: OS mode" (M1). The same preference the switch in each dashboard's
// header writes (os-mode.jsx), so the two can never disagree, plus the wallpaper and a reset
// of the saved window layouts.
//
// The admin row is shown with the nav's own predicate (lib/roles.js canAdmin), never a
// re-derived one: a switch for a dashboard the topbar does not offer would be noise.

import { AppWindow, LayoutDashboard, ShieldCheck, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { Card, Select, Button, useToast } from '../ui.jsx';
import { useAuth } from '../../pages/auth.jsx';
import { canAdmin } from '../../lib/roles.js';
import { useOsPrefs, clearOsLayout, OS_MIN_WIDTH } from './os-mode.jsx';

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}
      className={`tap-44 relative w-10 h-6 rounded-full transition shrink-0 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
      <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
    </button>
  );
}

function Row({ icon: Icon, title, desc, children }) {
  return (
    <div className="py-3 border-b border-[var(--line)] last:border-0">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><Icon size={16} className="text-[var(--accent-ink)]" /></span>
        <div className="flex-1 min-w-0 text-sm font-medium">{title}</div>
        <div className="shrink-0">{children}</div>
      </div>
      {desc && <div className="ps-12 mt-0.5 text-xs text-[var(--muted)]">{desc}</div>}
    </div>
  );
}

export function OsModeSettingsCard({ className = '' }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const { uid, prefs, set } = useOsPrefs();
  if (!user) return null;
  const admin = canAdmin(user);
  const reset = () => {
    clearOsLayout('dashboard', uid);
    clearOsLayout('admin', uid);
    toast.success(t('os.set.reset.done', 'Window layouts forgotten. The next visit starts on an empty desktop.'));
  };
  return (
    <Card className={`p-4 sm:p-5 ${className}`} id="os-mode">
      <div className="flex items-center gap-2.5 mb-2 pb-2.5 border-b border-[var(--line)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><AppWindow size={14} className="text-[var(--accent-ink)]" /></span>
        <span className="text-sm font-semibold">{t('os.set.t', 'Dashboards: OS mode')}</span>
      </div>
      <p className="text-xs text-[var(--muted)] mb-1">
        {t('os.set.s', 'Show a dashboard as a desktop: each screen opens in a window you can move, resize, minimise and put side by side, with a taskbar and a start menu that searches. Classic stays the default. Screens narrower than {w}px always use the classic layout.').replace('{w}', String(OS_MIN_WIDTH))}
      </p>
      <Row icon={LayoutDashboard} title={t('os.set.dash', 'My dashboard')}>
        <Toggle on={prefs.dashboard} onChange={(v) => set({ dashboard: v })} label={t('os.set.dash', 'My dashboard')} />
      </Row>
      {admin && (
        <Row icon={ShieldCheck} title={t('os.set.admin', 'Admin dashboard')}>
          <Toggle on={prefs.admin} onChange={(v) => set({ admin: v })} label={t('os.set.admin', 'Admin dashboard')} />
        </Row>
      )}
      <Row icon={ImageIcon} title={t('os.wall', 'Wallpaper')} desc={t('os.set.wall.d', 'The 3D scene is the site backdrop behind the desktop; the others paint it from the site theme.')}>
        <Select className="!w-auto" value={prefs.wallpaper} onChange={(e) => set({ wallpaper: e.target.value })}>
          <option value="scene">{t('os.wall.scene', '3D scene')}</option>
          <option value="gradient">{t('os.wall.gradient', 'Gradient')}</option>
          <option value="plain">{t('os.wall.plain', 'Plain')}</option>
        </Select>
      </Row>
      <Row icon={RotateCcw} title={t('os.set.reset', 'Saved window layouts')} desc={t('os.set.reset.d', 'Open windows and their positions are kept in this browser, for this account. Forgetting them changes nothing on the site.')}>
        <Button size="sm" onClick={reset}>{t('os.set.reset.b', 'Forget')}</Button>
      </Row>
    </Card>
  );
}
