// The one-time "set this up your way" dialog.
//
// It exists because the alternative was a cookie banner that asked one question and nine
// settings nobody knew about. Somebody arriving for the first time met a consent prompt, and
// everything else — the 3D orb on an old laptop, the fireworks, the undo window — stayed at
// whatever we had decided until they went looking. Most people never went looking.
//
// It REPLACES the cookie banner rather than stacking on top of it: consent is one of the
// choices here, and answering it dismisses the banner through the same stored value the
// banner itself reads. Two prompts asking about cookies would be worse than the one we had.
//
// Deliberately not blocking anything: there is a "skip" that keeps every default. A first
// visit interrupted by a settings form is a first visit somebody leaves.
import { useState, useEffect } from 'react';
import { Cookie, Orbit, Sparkles, Palette, Globe, Layers, Undo2, Rocket, Check } from 'lucide-react';
import { Button, Card } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useTheme } from './theme.jsx';
import { getConsent, setConsent } from '../lib/analytics.js';
import {
    getGlassPrefs, setGlassPrefs, getUndoDisabled, setUndoDisabled,
    getHero3dDisabled, setHero3dDisabled,
} from '../lib/prefs.js';
import { fxPref, setFxPref } from '../lib/fx-pref.js';
import { SKIP_KEY } from './IntroContext.jsx';

// Bumping this asks everyone again. Only do that when the SET of questions changes in a way
// that matters — a new choice people would want, not a reworded label.
export const WELCOME_KEY = 'bcw_welcome_v1';

export function shouldShowWelcome() {
    if (typeof window === 'undefined') return false;
    try {
        if (localStorage.getItem(WELCOME_KEY)) return false;
        // Somebody who already answered the cookie banner is not a first-time visitor, and
        // re-prompting them would read as the site forgetting what they said.
        if (getConsent()) return false;
        return true;
    } catch { return false; }
}

export default function WelcomePrefs() {
    const { t, lang, setLang } = useI18n();
    const { theme, toggle: toggleTheme } = useTheme();
    const [open, setOpen] = useState(false);
    // Mounted hidden and revealed after a beat: appearing in the same frame as the page
    // reads as an error dialog rather than a greeting.
    useEffect(() => {
        if (!shouldShowWelcome()) return undefined;
        const id = setTimeout(() => setOpen(true), 700);
        return () => clearTimeout(id);
    }, []);

    const [analytics, setAnalytics] = useState(true);
    const [orb, setOrb] = useState(() => !getHero3dDisabled());
    // What was actually in effect when the page booted, so the reload below fires only on a
    // real change rather than on every save.
    const [orbAtOpen] = useState(() => !getHero3dDisabled());
    const [intro, setIntro] = useState(() => { try { return localStorage.getItem(SKIP_KEY) !== '1'; } catch { return true; } });
    const [fx, setFx] = useState(() => fxPref() !== 'off');
    const [glass, setGlass] = useState(() => !!getGlassPrefs()?.on);
    const [undo, setUndo] = useState(() => !getUndoDisabled());

    if (!open) return null;

    const close = (save) => {
        try {
            if (save) {
                // Consent LAST of the writes but first in meaning: it is the one with a legal
                // basis attached, and writing it is what dismisses the cookie banner.
                setHero3dDisabled(!orb);
                localStorage.setItem(SKIP_KEY, intro ? '0' : '1');
                setFxPref(fx ? 'on' : 'off');
                setGlassPrefs({ ...(getGlassPrefs() || {}), on: glass });
                setUndoDisabled(!undo);
                setConsent(analytics ? 'all' : 'essential');
            } else {
                // Skipping still has to answer consent, or the banner appears the moment this
                // closes and the person is asked twice. Skipping means the private default.
                setConsent('essential');
            }
            localStorage.setItem(WELCOME_KEY, '1');
        } catch { /* storage unavailable — the dialog simply will not stick */ }
        setOpen(false);
        // The orb is decided once at mount, so a change to it only lands on the next load —
        // and only then. Comparing against the value captured when this dialog opened, not
        // against the one just written: `orb === getHero3dDisabled()` reads as a sensible
        // check and is always false, because one is "on" and the other is "off".
        if (save && orb === orbAtOpen) return;
        if (save) window.location.reload();
    };

    const Toggle = ({ icon: Icon, title, desc, on, onChange }) => (
        <button type="button" onClick={() => onChange(!on)}
            className="w-full flex items-center gap-3 py-2.5 text-left border-b border-[var(--line)] last:border-0">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] shrink-0">
                <Icon size={14} className="text-[var(--primary-2)]" />
            </span>
            <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-[var(--muted)] mt-0.5">{desc}</span>
            </span>
            <span role="switch" aria-checked={on}
                className={`relative w-10 h-6 rounded-full transition shrink-0 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
                <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </span>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[100] grid place-items-center p-4 print:hidden"
            style={{ background: 'color-mix(in srgb, #000 55%, transparent)' }}
            role="dialog" aria-modal="true" aria-label={t('wp.title', 'Make it yours')}>
            <Card className="w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-solid)' }}>
                <div className="flex items-center gap-2 mb-1">
                    <Rocket size={18} className="text-[var(--primary-2)]" />
                    <h2 className="font-semibold">{t('wp.title', 'Make it yours')}</h2>
                </div>
                <p className="text-xs text-[var(--muted)] mb-4">
                    {t('wp.sub', 'A few choices, saved on this browser only. All of them live in Settings afterwards, and nothing here is permanent.')}
                </p>

                <div className="grid grid-cols-2 gap-2 mb-3">
                    <label className="text-xs">
                        <span className="block text-[var(--muted)] mb-1 flex items-center gap-1"><Globe size={12} /> {t('wp.lang', 'Language')}</span>
                        <select value={lang} onChange={(e) => setLang(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-sm">
                            <option value="en">English</option>
                            <option value="fr">Français</option>
                        </select>
                    </label>
                    <label className="text-xs">
                        <span className="block text-[var(--muted)] mb-1 flex items-center gap-1"><Palette size={12} /> {t('wp.theme', 'Theme')}</span>
                        <select value={theme} onChange={(e) => { if (e.target.value !== theme) toggleTheme(); }}
                            className="w-full px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-sm">
                            <option value="dark">{t('set.dark', 'Dark')}</option>
                            <option value="light">{t('set.light', 'Light')}</option>
                        </select>
                    </label>
                </div>

                <div className="rounded-xl border border-[var(--line)] px-3">
                    {/* Consent first, and worded as what it is rather than as a feature. */}
                    <Toggle icon={Cookie} on={analytics} onChange={setAnalytics}
                        title={t('wp.analytics', 'Anonymous usage statistics')}
                        desc={t('wp.analytics.d', 'First-party only, no advertising, no third-party tracking. Off is a complete answer.')} />
                    <Toggle icon={Orbit} on={orb} onChange={setOrb}
                        title={t('wp.orb', '3D hero orb')}
                        desc={t('wp.orb.d', 'The WebGL scene behind the pages. Off means it is never rendered — lighter on an older machine and on battery.')} />
                    <Toggle icon={Sparkles} on={intro} onChange={setIntro}
                        title={t('wp.intro', 'Intro animation')}
                        desc={t('wp.intro.d', 'Plays once per full page load.')} />
                    <Toggle icon={Sparkles} on={fx} onChange={setFx}
                        title={t('wp.fx', 'Celebration effects')}
                        desc={t('wp.fx.d', 'Fireworks during a site event.')} />
                    <Toggle icon={Layers} on={glass} onChange={setGlass}
                        title={t('wp.glass', 'Translucent surfaces')}
                        desc={t('wp.glass.d', 'Frosted cards and dialogs instead of solid ones.')} />
                    <Toggle icon={Undo2} on={undo} onChange={setUndo}
                        title={t('wp.undo', 'Undo window')}
                        desc={t('wp.undo.d', 'Deletes and saves wait a few seconds so you can take them back.')} />
                </div>

                <div className="flex items-center gap-2 mt-4">
                    <Button size="sm" variant="primary" onClick={() => close(true)}><Check size={14} /> {t('wp.save', 'Save these')}</Button>
                    {/* Skipping is a real option and says what it does, rather than being a
                        greyed-out escape hatch that implies the wrong thing happened. */}
                    <Button size="sm" variant="ghost" onClick={() => close(false)}>{t('wp.skip', 'Keep the defaults')}</Button>
                </div>
            </Card>
        </div>
    );
}
