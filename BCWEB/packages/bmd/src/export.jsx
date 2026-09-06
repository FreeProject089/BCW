// A document, as a string of HTML — for an e-mail, a static page, a PDF pipeline, a CMS that
// cannot run React.
//
// The same `<Markdown>` the site renders with, through react-dom's static renderer, so what
// comes out is exactly what a reader would have seen — not a second renderer that agrees with
// the first most of the time. The interactive blocks render their resting state: a tab strip
// with its first panel open, a counter with its label and no number, a mermaid block as the
// diagram's source in a `<pre>`.
//
// The stylesheet is NOT inlined here: this file cannot read `markdown.css` in a browser and
// should not read the filesystem in a component library. `cssUrl` says where it is; a node
// caller reads it, a browser caller fetches it, and `documentHtml` takes the text.
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from './index.jsx';

/** Where the kit's stylesheet lives, for whoever wants to inline it. */
export const cssUrl = new URL('./markdown.css', import.meta.url).href;

/**
 * The HTML for one document — the `<div class="md-body">…</div>` and nothing around it.
 *
 * @param {string} md
 * @param {object} [opt]   the same props `<Markdown>` takes: lang, pageMap, toc, radius, className
 */
export function renderHtml(md, opt = {}) {
  return renderToStaticMarkup(<Markdown {...opt}>{md || ''}</Markdown>);
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A whole page: doctype, title, the kit's CSS (when given), a token block for the colours the
 * CSS reads, and the rendered document. Everything needed for the file to open on its own.
 *
 * @param {string} md
 * @param {object} [opt]
 * @param {string} [opt.title]
 * @param {string} [opt.css]        the text of markdown.css (see cssUrl)
 * @param {string} [opt.extraCss]   anything to append — a brand's tokens, a font
 * @param {'light'|'dark'} [opt.scheme]
 * @param {string} [opt.lang]       the html lang and the renderer's language
 * @param {object} [opt.render]     forwarded to renderHtml
 */
export function documentHtml(md, opt = {}) {
  const scheme = opt.scheme === 'dark' ? 'dark' : 'light';
  const tokens = scheme === 'dark'
    ? ':root{color-scheme:dark;--text:#f3efe9;--muted:#a39b8f;--faint:#8a8278;--line:#2a2620;--line-strong:#3a352d;--surface:#141210;--surface-2:#1b1814;--bg-solid:#0f0d0b;--primary:#f97316;--primary-2:#fb923c;--success:#22c55e;--warning:#f59e0b;--error:#ef4444;}'
    : ':root{color-scheme:light;--text:#17140f;--muted:#57514a;--faint:#726b61;--line:#e6e0d8;--line-strong:#d5cec4;--surface:#f3eee6;--surface-2:#ece5db;--bg-solid:#fff;--primary:#f97316;--primary-2:#ea580c;--success:#16a34a;--warning:#d97706;--error:#dc2626;}';
  const body = renderHtml(md, { lang: opt.lang || 'en', ...(opt.render || {}) });
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(opt.lang || 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(opt.title || 'Document')}</title>`,
    `<style>${tokens}body{margin:0;background:var(--bg-solid);font:15px/1.7 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--text)}main{max-width:820px;margin:0 auto;padding:32px 20px}</style>`,
    opt.css ? `<style>${opt.css}</style>` : '',
    opt.extraCss ? `<style>${opt.extraCss}</style>` : '',
    '</head>',
    '<body><main>',
    body,
    '</main></body>',
    '</html>',
  ].filter(Boolean).join('\n');
}
