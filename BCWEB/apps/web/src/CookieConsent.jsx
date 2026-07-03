import { useState } from 'react';
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui.jsx';
import { useI18n } from './i18n.jsx';
import { getConsent, setConsent } from './analytics.js';
import { loadGtmIfConsented } from './gtm.js';

// GDPR cookie banner. Essential cookies (the session) are always on; analytics
// is opt-in. Choice persists in localStorage.
export default function CookieConsent() {
  const { t } = useI18n();
  const [choice, setChoice] = useState(getConsent());
  if (choice) return null;
  const decide = (v) => { setConsent(v); setChoice(v); if (v === 'all') loadGtmIfConsented(); };
  return (
    <div className="fixed bottom-4 left-4 z-[55] w-[26rem] max-w-[calc(100vw-2rem)] anim-slide">
      <div className="card p-5" style={{ boxShadow: '0 20px 50px -16px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Cookie size={18} className="text-[var(--primary-2)]" />
          <div className="font-semibold">{t('cookie.title')}</div>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {t('cookie.body')} <Link to="/cookies" className="text-orange-400 underline">{t('cookie.policy')}</Link>.
        </p>
        <div className="flex gap-2 mt-4">
          <Button variant="primary" className="flex-1" onClick={() => decide('all')}>{t('cookie.all')}</Button>
          <Button className="flex-1" onClick={() => decide('essential')}>{t('cookie.essential')}</Button>
        </div>
      </div>
    </div>
  );
}
