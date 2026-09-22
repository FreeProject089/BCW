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
import { applyGlassPrefs, applyTexturePref } from './lib/prefs.js';
import { readSceneConfig, applyReveal } from './hero/scene-shapes.js';
import './index.css';

// Apply saved translucent-surface prefs before first paint (no style flash).
applyGlassPrefs();
applyTexturePref();

// How sections arrive when they scroll into view — a site setting, applied on EVERY page.
//
// Not awaited, and not gating the mount: the default is the bare-selector style in the
// stylesheet, so a slow answer means the site renders exactly as it always did and then
// switches. Holding the first paint on a preference about animation would be the animation
// costing more than it is worth.
void readSceneConfig().then((c) => applyReveal(c.reveal));

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
