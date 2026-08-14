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

/**
 * The catalogue index feeds, as a menu.
 *
 * FeedLink hands over the ONE list you are looking at. This hands over the standing
 * addresses — every catalogue, only the official ones, only the community ones, one
 * project, one type — which is what somebody setting BMM up actually wants: an address
 * that keeps being right when new catalogues are published, rather than a snapshot of
 * today's filter.
 *
 * The list is built from what the generator accepts (scope · app · type in
 * routes/catalogs.mjs), so a type added there and not here shows up as a gap rather than
 * as a wrong URL. `preset` is in it because BMM automations publish under that type; it
 * was the one that had no way in.
 */
export function FeedMenu({ project = '', kind = '', className = '' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const idx = (qs) => `${origin}/api/catalogs.json${qs ? `?${qs}` : ''}`;
  const rows = [
    { k: 'all', label: t('feed.ix.all', 'Every catalogue'), url: idx('') },
    { k: 'off', label: t('feed.ix.official', 'Official only'), url: idx('scope=official') },
    { k: 'com', label: t('feed.ix.community', 'Community only'), url: idx('scope=community') },
    ...(project ? [{ k: 'proj', label: t('feed.ix.project', 'This project only'), url: idx(`app=${encodeURIComponent(project)}`) }] : []),
    ...(kind ? [{ k: 'kind', label: t('feed.ix.kind', 'This type only'), url: idx(`type=${encodeURIComponent(kind.toLowerCase())}`) }] : []),
  ];

  const take = async (r) => {
    if (await copyText(r.url)) { setCopied(r.k); setTimeout(() => setCopied(''), 1600); }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        title={t('feed.ix.hint', 'Addresses that list catalogues rather than items. Paste one into BMM → Settings → Catalogue index.')}
        className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border border-[var(--line-strong)] hover:border-[var(--primary)] transition"
        style={{ background: 'var(--bg-solid)' }}>
        <FileJson size={13} className="text-[var(--primary-2)]" />
        {t('feed.ix.btn', 'Index feeds')}
      </button>
      {open && (
        <>
          {/* Click-away first in the DOM and under the menu: a menu that only closes via its
              own button is one people leave open and then click through. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          {/* Opaque, never a translucent surface: the "Translucent surfaces" setting would
              otherwise render this over whatever card sits behind it. */}
          <div className="absolute right-0 mt-1 z-[61] w-[300px] rounded-xl border border-[var(--line-strong)] shadow-lg p-1"
            style={{ background: 'var(--bg-solid)' }}>
            {rows.map((r) => (
              <div key={r.k} className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-[var(--surface-2)]">
                <button type="button" className="flex-1 text-left min-w-0" onClick={() => take(r)}>
                  <div className="text-[12px]">{r.label}</div>
                  <div className="text-[10px] text-[var(--faint)] truncate">{r.url.replace(origin, '')}</div>
                </button>
                {copied === r.k
                  ? <Check size={13} className="text-success shrink-0" />
                  : <Copy size={11} className="text-[var(--faint)] shrink-0" />}
                <a href={r.url} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--faint)] hover:text-[var(--primary-2)]"
                  title={t('feed.open', 'Open it in a tab')} onClick={(e) => e.stopPropagation()}>
                  <ExternalLink size={12} />
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
