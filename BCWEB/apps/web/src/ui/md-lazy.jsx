// The markdown renderer, fetched the first time a page actually renders markdown.
//
// M18 (agent-perf-M18). home.jsx, polls.jsx and project-content.jsx are in the first-load
// graph (App.jsx imports home.jsx, which imports the poll teaser and the charity widget), and
// each rendered `<Markdown>` somewhere: an admin's custom section, a poll's help text, release
// notes. That kept the whole renderer (react-markdown, remark, rehype, parse5, the B.MD
// directives) in every visitor's first download, for blocks most first views never show.
// This component takes the same props as ui/md.jsx's default export and loads it on demand.
//
// Only for EAGER modules. A lazily loaded page should keep importing ui/md.jsx directly: it is
// already off the first-load path, and a static import there costs no extra round trip.
//
// Deliberately no manual chunk and no side-effect import of md.jsx anywhere eager: either one
// puts the renderer back into the first load (see scripts/bundle-budget.mjs, which counts the
// entry's static imports as well as the preloads).
import { lazy, Suspense } from 'react';
import './md-lite.js'; // the kit's configuration must be in place before any icon renders

const Renderer = lazy(() => import('./md.jsx'));

export default function LazyMarkdown(props) {
  // The fallback keeps the block's box without flashing raw markdown syntax at the reader.
  return (
    <Suspense fallback={<div className={props.className || undefined} aria-busy="true" style={{ minHeight: '1.25em' }} />}>
      <Renderer {...props} />
    </Suspense>
  );
}
