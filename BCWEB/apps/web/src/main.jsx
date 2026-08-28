import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './pages/auth.jsx';
import { ThemeProvider } from './ui/theme.jsx';
import { I18nProvider } from './i18n.jsx';
import { DialogProvider, ToastProvider } from './ui/ui.jsx';
import { UploadProvider } from './pages/uploads.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import App from './App.jsx';
import { applyGlassPrefs } from './lib/prefs.js';
import { bootSitePages } from './lib/site-pages.js';
import './index.css';

// Apply saved translucent-surface prefs before first paint (no style flash).
applyGlassPrefs();

// Same reasoning, one level up: which landing page this site HAS is resolved before React
// mounts, so the first frame is the right page rather than the default one being replaced a
// moment later. Cached in localStorage, so a returning visitor waits for nothing; gated with
// a deadline, so a dead API costs a fraction of a second and not the site.
//
// A `.then` and not a top-level await: this project's browser target does not have TLA
// (esbuild refuses the build), and lowering the target to get one keyword would drop the
// browsers the target names on purpose.
bootSitePages().then(() => {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <I18nProvider>
          <ThemeProvider>
            <ToastProvider>
              <DialogProvider>
                <AuthProvider>
                  <UploadProvider>
                    <ErrorBoundary>
                      <App />
                    </ErrorBoundary>
                  </UploadProvider>
                </AuthProvider>
              </DialogProvider>
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
});
