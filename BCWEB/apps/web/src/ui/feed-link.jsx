import { useState } from 'react';
import { FileJson, Copy, ExternalLink, Check } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { copyText } from './ui.jsx';

// "Give me the URL of this list, as JSON."
//
// Every one of these feeds already existed and was already public — /catalog.json,
// /c/<slug>/catalog.json, /repos.json — and none of them was reachable from the page showing
// exactly that content. So the way to point BMM at a catalog was to know the URL pattern,
// which means reading the docs to find out something the page you are on could simply hand
// you.
//
// Copy is the primary action, not "open": the URL is almost always going into BMM's
// add-a-source box or a script, not into a browser tab. Open is there because seeing the
// shape once is how people trust it.
export default function FeedLink({ path, label, hint, className = '' }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  // Absolute on purpose. A relative path is useless in the one place this is going — another
  // program — and quietly wrong if pasted somewhere with a different origin.
  const url = typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  const copy = async () => {
    if (await copyText(url)) { setDone(true); setTimeout(() => setDone(false), 1600); }
  };

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <button type="button" onClick={copy}
        title={hint || t('feed.hint', 'Copy this list as a JSON URL — paste it into BMM to add it as a source')}
        className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border border-[var(--line-strong)] hover:border-[var(--primary)] transition"
        style={{ background: 'var(--bg-solid)' }}>
        {done ? <Check size={13} className="text-success" /> : <FileJson size={13} className="text-[var(--primary-2)]" />}
        {done ? t('feed.copied', 'URL copied') : (label || t('feed.json', 'JSON feed'))}
        {!done && <Copy size={11} className="text-[var(--faint)]" />}
      </button>
      <a href={url} target="_blank" rel="noreferrer" title={t('feed.open', 'Open it in a tab')}
        className="inline-grid place-items-center w-[30px] h-[30px] rounded-lg border border-[var(--line-strong)] hover:border-[var(--primary)] transition text-[var(--faint)] hover:text-[var(--primary-2)]"
        style={{ background: 'var(--bg-solid)' }}>
        <ExternalLink size={13} />
      </a>
    </div>
  );
}
