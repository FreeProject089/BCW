import React from 'react';
import { getConsent } from '../lib/analytics.js';

// Root error boundary. Without it, a render-time throw in any page unmounts the whole
// React tree — the user gets a blank white screen with no way out. This catches the
// error, shows a friendly recovery card, and reports it to /analytics/error (with the
// React component stack, which window.onerror doesn't have). Note: once a boundary
// catches an error React no longer rethrows it to window.onerror, so reporting HERE is
// required to keep the crash telemetry that lib/analytics.js otherwise collects.
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    try {
      if (getConsent() !== 'all') return; // same consent gate as the rest of analytics
      const body = JSON.stringify({
        path: location.pathname,
        message: String(error?.message || error || 'render error').slice(0, 300) || 'render error',
        stack: `${error?.stack || ''}\n${info?.componentStack || ''}`.trim().slice(0, 4000) || undefined,
      });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/analytics/error', new Blob([body], { type: 'application/json' }));
      else fetch('/api/analytics/error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch { /* never let the reporter itself throw */ }
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Class component can't use the i18n hook — read the saved language directly.
    let fr = false;
    try { fr = localStorage.getItem('bcw_lang') === 'fr'; } catch { /* ignore */ }
    const t = fr
      ? { title: 'Une erreur est survenue', body: 'Quelque chose s’est mal passé en affichant cette page. Tu peux recharger, ou revenir à l’accueil.', reload: 'Recharger', home: 'Accueil' }
      : { title: 'Something went wrong', body: 'An error occurred while rendering this page. You can reload, or head back home.', reload: 'Reload', home: 'Home' };
    return (
      <div role="alert" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>{t.title}</h1>
          <p style={{ color: 'var(--muted, #8a8f98)', margin: '0 0 20px', lineHeight: 1.5 }}>{t.body}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => location.reload()}>{t.reload}</button>
            <a className="btn" href="/">{t.home}</a>
          </div>
        </div>
      </div>
    );
  }
}
