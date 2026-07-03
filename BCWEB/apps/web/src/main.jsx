import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import { ThemeProvider } from './theme.jsx';
import { I18nProvider } from './i18n.jsx';
import { DialogProvider, ToastProvider } from './ui.jsx';
import { UploadProvider } from './uploads.jsx';
import App from './App.jsx';
import { applyGlassPrefs } from './prefs.js';
import './index.css';

// Apply saved translucent-surface prefs before first paint (no style flash).
applyGlassPrefs();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>
            <DialogProvider>
              <AuthProvider>
                <UploadProvider>
                  <App />
                </UploadProvider>
              </AuthProvider>
            </DialogProvider>
          </ToastProvider>
        </ThemeProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>
);
