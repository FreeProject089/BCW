// Personalise (N-os): the OS mode's settings, opened from the start menu, the desktop's
// right-click menu and the taskbar's. The wallpaper, the size of the desktop icons, where the
// taskbar sits and what it shows, window animations, and the two resets.
//
// It writes the same per-account preference as Settings → "Dashboards: OS mode"
// (os-mode.jsx readOsPrefs / writeOsPrefs), so the two cannot disagree. A dialog inside the
// shell, opaque (it is a popup), focus kept inside while it is open, Escape closes it.

import { useEffect, useRef } from 'react';
import { X, Image as ImageIcon, LayoutGrid, PanelBottom, Sparkles, RotateCcw, Eye } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';

function Choice({ label, value, options, onChange }) {
  return (
    <div className="os-pz-choice" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={`os-lx-chip${value === k ? ' is-on' : ''}`} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`os-pz-switch${on ? ' is-on' : ''}`}>
      <span aria-hidden />
    </button>
  );
}

function Row({ icon: Icon, title, children }) {
  return (
    <div className="os-pz-row">
      <span className="os-pz-ic" aria-hidden><Icon size={15} /></span>
      <span className="os-pz-title">{title}</span>
      <span className="os-pz-ctl">{children}</span>
    </div>
  );
}

export default function OsPersonalize({ prefs, setPrefs, hiddenCount, onShowIcons, onReset, onClose }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.querySelector('[role="radio"][aria-checked="true"], button')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (opener?.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <div className="os-scrim os-scrim-dim" aria-hidden onPointerDown={() => closeRef.current()} />
      <div ref={ref} className="os-pz" role="dialog" aria-modal="true" aria-labelledby="os-pz-t">
        <div className="os-pz-head">
          <h2 id="os-pz-t" className="os-pz-h">{t('os.pz.t', 'Personalise')}</h2>
          <button type="button" className="os-win-btn os-win-close" onClick={() => closeRef.current()} aria-label={t('os.win.close', 'Close')} title={t('os.win.close', 'Close')}><X size={15} aria-hidden /></button>
        </div>
        <div className="os-pz-body">
          <Row icon={ImageIcon} title={t('os.wall', 'Wallpaper')}>
            <Choice label={t('os.wall', 'Wallpaper')} value={prefs.wallpaper} onChange={(v) => setPrefs({ wallpaper: v })}
              options={[['scene', t('os.wall.scene', '3D scene')], ['gradient', t('os.wall.gradient', 'Gradient')], ['plain', t('os.wall.plain', 'Plain')]]} />
          </Row>
          <Row icon={LayoutGrid} title={t('os.pz.icons', 'Desktop icons')}>
            <Choice label={t('os.pz.icons', 'Desktop icons')} value={prefs.icons} onChange={(v) => setPrefs({ icons: v })}
              options={[['sm', t('os.pz.sm', 'Small')], ['md', t('os.pz.md', 'Medium')], ['lg', t('os.pz.lg', 'Large')]]} />
          </Row>
          <Row icon={PanelBottom} title={t('os.pz.bar', 'Taskbar position')}>
            <Choice label={t('os.pz.bar', 'Taskbar position')} value={prefs.bar} onChange={(v) => setPrefs({ bar: v })}
              options={[['bottom', t('os.pz.bottom', 'Bottom')], ['top', t('os.pz.top', 'Top')]]} />
          </Row>
          <Row icon={PanelBottom} title={t('os.pz.labels', 'Names on the taskbar buttons')}>
            <Switch on={prefs.labels} onChange={(v) => setPrefs({ labels: v })} label={t('os.pz.labels', 'Names on the taskbar buttons')} />
          </Row>
          <Row icon={PanelBottom} title={t('os.pz.seconds', 'Seconds on the clock')}>
            <Switch on={prefs.seconds} onChange={(v) => setPrefs({ seconds: v })} label={t('os.pz.seconds', 'Seconds on the clock')} />
          </Row>
          <Row icon={Sparkles} title={t('os.pz.anim', 'Window animations')}>
            <Switch on={prefs.anim} onChange={(v) => setPrefs({ anim: v })} label={t('os.pz.anim', 'Window animations')} />
          </Row>
          <p className="os-pz-note">{t('os.pz.anim.d', 'Animations stay off when your system asks for reduced motion.')}</p>
          <Row icon={Eye} title={t('os.pz.hidden', 'Icons removed from the desktop: {n}').replace('{n}', String(hiddenCount))}>
            <button type="button" className="os-lx-act" disabled={!hiddenCount} onClick={onShowIcons}>{t('os.pz.showall', 'Show them again')}</button>
          </Row>
          <Row icon={RotateCcw} title={t('os.reset', 'Reset layout')}>
            <button type="button" className="os-lx-act" onClick={onReset}>{t('os.pz.reset.b', 'Reset')}</button>
          </Row>
        </div>
      </div>
    </>
  );
}
