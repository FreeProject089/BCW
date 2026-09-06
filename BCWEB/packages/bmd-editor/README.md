# @bettercommunity/bmd-editor

The editor for [B.MD](../bmd/) documents, as one React component. A block menu that knows
every directive, a live preview through the real renderer, a layout that is side-by-side on a
desktop and Write / Preview tabs on a phone, a link checker, an outline, the AST, and an
"Export HTML" button.

It is a **separate package** on purpose: a site that only reads documents ships the renderer
and nothing of this.

```bash
npm i @bettercommunity/bmd-editor @bettercommunity/bmd
```

```jsx
import BmdEditor from '@bettercommunity/bmd-editor';
import '@bettercommunity/bmd/markdown.css';

function Compose() {
  const [md, setMd] = useState('# Hello');
  return <BmdEditor value={md} onChange={setMd} lang="en" pageMap={pageMap} onSave={save} />;
}
```

## Props

| Prop | What it does |
|---|---|
| `value`, `onChange` | the markdown, controlled |
| `lang` | `en` / `fr` — the toolbar's words and the renderer's language |
| `pageMap` | the renderer's page map: hover cards, `[[wiki links]]`, and what the link checker judges internal paths against |
| `layout` | `auto` (default: tabs under `breakpoint`, split above), `split`, `tabs` |
| `breakpoint` | the width below which `auto` means tabs (900) |
| `height` | the editing area (`'60vh'`) |
| `toolbar`, `status` | show the toolbar / the status bar |
| `snippetGroups` | replace the block menu — same shape as `SNIPPET_GROUPS` |
| `onSave` | called on Ctrl+S with the markdown |
| `exportTitle` | the `<title>` of an exported page |
| `markdownProps` | anything else for `<Markdown>` — `roadmap`, `replay`, `radius`, `toc` |

Keys: Ctrl+B bold, Ctrl+I italic, Ctrl+E code, Ctrl+K link, Ctrl+/ the block menu, Ctrl+S save,
Tab indents.

## The block menu

`SNIPPET_GROUPS` (also exported from `./snippets`) is the list: text, callouts, layout, content,
media, API & live. Each entry is `{ id, label, md, inline? }`; `${sel}` / `${sel|default}` is the
selection and `${cursor}` is where the caret lands. `expandSnippet(md, selection)` does the
substitution, so a host can reuse the list in a command palette.

## Export

"Export HTML" fetches the renderer's stylesheet (`cssUrl`) and calls `documentHtml()` — a
standalone page with the tokens, the CSS and the rendered document, downloaded as a file.
