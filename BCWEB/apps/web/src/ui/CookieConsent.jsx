import { useState } from 'react';
import { Cookie, ShieldCheck, BarChart3, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { getConsent, setConsent } from '../lib/analytics.js';
import { loadGtmIfConsented } from '../lib/gtm.js';

// GDPR cookie consent manager. Essential cookies (the session) are always on and can't
// be refused; analytics is opt-in. Compliance points baked in here:
//  • "Reject" is exactly as prominent and one-click as "Accept" (no dark patterns).
//  • A "Customise" view gives granular per-category control before consenting.
//  • Nothing non-essential loads until an explicit choice is made (analytics stays off).
// The stored outcome is still 'all' | 'essential' so the rest of the app is unchanged.
export default function CookieConsent() {
  const { t } = useI18n();
  const [choice, setChoice] = useState(getConsent());
  const [customise, setCustomise] = useState(false);
  const [analytics, setAnalytics] = useState(false); // granular toggle in the customise view
  if (choice) return null;
  const decide = (v) => { setConsent(v); setChoice(v); if (v === 'all') loadGtmIfConsented(); };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:right-auto z-[55] sm:w-[28rem] anim-slide" role="dialog" aria-modal="false" aria-label={t('cookie.title', 'Cookies')}>
      <div className="card p-5" style={{ boxShadow: '0 20px 50px -16px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Cookie size={18} className="text-[var(--primary-2)]" />
          <div className="font-semibold">{t('cookie.title', 'Cookies')}</div>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {t('cookie.body', 'We use essential cookies to run the site, and optional analytics to understand usage. You choose.')} <Link to="/legal/cookies" className="text-orange-400 underline">{t('cookie.policy', 'Cookie policy')}</Link>.
        </p>

        {/* Granular categories — shown once the visitor opens "Customise". */}
        {customise && (
          <div className="mt-4 space-y-2">
            <div className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">{t('cookie.cat.essential', 'Essential')} <span className="text-[10px] uppercase tracking-wide text-emerald-400">{t('cookie.always', 'always on')}</span></div>
                <div className="text-xs text-[var(--faint)] mt-0.5">{t('cookie.cat.essential.d', 'Sign-in session and security. The site can’t work without these.')}</div>
              </div>
              <span className="w-9 h-5 rounded-full bg-emerald-500/70 relative shrink-0 opacity-70" aria-hidden><span className="absolute top-0.5 left-[18px] w-4 h-4 rounded-full bg-white" /></span>
            </div>
            <button type="button" onClick={() => setAnalytics((v) => !v)} aria-pressed={analytics} className="w-full text-left flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 hover:border-[var(--line-strong)] transition">
              <BarChart3 size={16} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t('cookie.cat.analytics', 'Analytics')}</div>
                <div className="text-xs text-[var(--faint)] mt-0.5">{t('cookie.cat.analytics.d', 'Anonymous, first-party usage stats (no ads, no cross-site tracking).')}</div>
              </div>
              <span className={`w-9 h-5 rounded-full relative shrink-0 transition ${analytics ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${analytics ? 'left-[18px]' : 'left-0.5'}`} /></span>
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          {customise ? (
            <Button variant="primary" className="flex-1 min-w-[8rem]" onClick={() => decide(analytics ? 'all' : 'essential')}><Check size={15} /> {t('cookie.save', 'Save choices')}</Button>
          ) : (
            <>
              {/* Reject and Accept share the same prominence — required for valid consent. */}
              <Button variant="primary" className="flex-1 min-w-[7rem]" onClick={() => decide('all')}>{t('cookie.all', 'Accept all')}</Button>
              <Button variant="primary" className="flex-1 min-w-[7rem] !bg-[var(--surface-2)] !text-[var(--text)] !border-[var(--line)]" onClick={() => decide('essential')}>{t('cookie.reject', 'Reject non-essential')}</Button>
            </>
          )}
        </div>
        <button type="button" onClick={() => setCustomise((v) => !v)} className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
          {customise ? t('cookie.back', 'Back') : t('cookie.customise', 'Customise')}
        </button>
      </div>
    </div>
  );
}
