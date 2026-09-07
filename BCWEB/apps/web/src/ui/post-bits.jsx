// The three pieces of a post that other pages need.
//
// They lived in pages/blog.jsx, so docs, pages and home imported the whole blog page to get
// them — and blog.jsx is lazily imported by the router, which makes it the entry-chunk hoist
// this repo has met before: a module imported both lazily and statically cannot be split off,
// so the blog page's code rode along in every chunk that wanted an avatar row.
//
// Nothing here is blog-specific. AuthorsRow draws an author list; the two hooks read and pin
// per-heading comment counts, which docs uses as much as the blog does.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';

// Author + collaborators avatar row. Solo → avatar + name; 2+ → avatars only.
export function AuthorsRow({ authors, size = 22 }) {
  const list = (authors || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {/* Overlapping (stacked) avatars, NO ring — a background-coloured ring left a visible
          crescent ("demi-cercle") on any surface it didn't exactly match. Each avatar's own
          round edge is the separator; stacking right-to-left keeps the first one on top. */}
      <span className="flex -space-x-1.5 shrink-0">
        {list.slice(0, 4).map((a, i) => <span key={a.id || i} className="rounded-full" style={{ zIndex: 10 - i }} title={a.displayName}><Avatar user={a} size={size} /></span>)}
      </span>
      {list.length === 1 && <span className="text-xs text-[var(--faint)] truncate">{list[0].displayName}</span>}
    </span>
  );
}


// Heading-anchor slug — matches the md.jsx renderer's heading ids + comment anchors.
export const headingSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
// Inject a clickable "💬 N" pill onto each heading that has comments pinned to it, so
// hovering the section reveals a way to open those comments. Imperative because the
// headings are rendered by <Markdown> (outside React's tree).
export function useSectionCommentPills(rootRef, sectionComments, onOpen, deps) {
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    root.querySelectorAll('.section-comment-pill').forEach((e) => e.remove()); // clear stale (count/slug change)
    // Add a pill only to headings that don't already have one — so the MutationObserver
    // (which re-injects after <Markdown> re-renders, e.g. on a reaction) never loops.
    const inject = () => {
      for (const [slug, n] of Object.entries(sectionComments || {})) {
        let h; try { h = root.querySelector(`#${CSS.escape(slug)}`); } catch { continue; }
        if (!h || h.querySelector('.section-comment-pill')) continue;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'section-comment-pill'; btn.innerHTML = `💬 ${n}`;
        btn.title = `${n} comment${n > 1 ? 's' : ''} pinned here — open`;
        btn.style.cssText = 'margin-left:8px;font-size:11px;font-weight:600;vertical-align:middle;padding:1px 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--primary-2);cursor:pointer;opacity:.5;transition:opacity .15s,border-color .15s';
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.borderColor = 'var(--primary)'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '.5'; btn.style.borderColor = 'var(--line)'; });
        btn.addEventListener('click', (e) => { e.preventDefault(); onOpen(); });
        h.appendChild(btn);
      }
    };
    inject();
    const obs = new MutationObserver(() => inject());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
// Build slug→count of comments pinned to a section (silent on permission errors).
export function useSectionComments(base, enabled) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!enabled) return;
    api.get(`${base}/comments`).then((r) => {
      const m = {}; (r.comments || []).forEach((c) => { if (c.anchor) { const s = headingSlug(c.anchor); m[s] = (m[s] || 0) + 1; } });
      setMap(m);
    }).catch(() => setMap({}));
  }, [base, enabled]);
  return map;
}
