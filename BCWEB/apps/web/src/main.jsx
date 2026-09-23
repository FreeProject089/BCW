import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './pages/auth.jsx';
import { ThemeProvider } from './ui/theme.jsx';
import { I18nProvider, loadLang, langReady, storedLang } from './i18n.jsx';
import { DialogProvider, ToastProvider } from './ui/ui.jsx';
import { UploadProvider } from './pages/uploads.jsx';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import App from './App.jsx';
import { applyGlassPrefs, applyTexturePref, getHero3dDisabled } from './lib/prefs.js';
import { readSceneConfig, applyReveal } from './hero/scene-read.js'; // M18: three-free (scene-shapes.js imports three.js)
import { registerServiceWorker } from './lib/pwa.js';
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

// The service worker: the app shell offline, hashed assets from disk, /api never cached.
// A no-op in dev (and it unregisters anything a built preview left behind) — see lib/pwa.js.
registerServiceWorker();

// M18 (agent-perf-M18): the 3D backdrop is no longer modulepreloaded by index.html (three.js
// and GSAP left the first-load path). Start fetching its chunk now, in parallel with the first
// render, rather than when <Hero3D> first renders: with the intro on, the page is held until
// the scene can play, so every millisecond of that fetch is a millisecond of blank page.
// Same module the App.jsx lazy() imports, so this is one fetch, not two.
if (!getHero3dDisabled()) void import('./hero/Hero3D.jsx').catch(() => { /* App.jsx retries and contains a failure */ });

const mount = () => createRoot(document.getElementById('root')).render(
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

// M18 (agent-perf-M18): French is a chunk of its own now (src/i18n-fr.js). A visitor whose
// saved language is French waits for it before the FIRST render, so the first frame is already
// French: rendering English and swapping would flash every label and shift the layout as their
// lengths change. English visitors mount at once. A failed fetch mounts anyway (English).
const first = storedLang();
if (langReady(first)) mount();
else loadLang(first).then(mount, mount);
