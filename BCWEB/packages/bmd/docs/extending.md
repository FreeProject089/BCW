# Extending B.MD

Five ways to go beyond the built-in vocabulary, from the smallest to the largest.

## Attributes every block takes

```
:::card[Title]{radius=0 variant=quiet class="mine other" #intro}
```

- `radius=` — a number is pixels; `8`, `1rem`, `0`. Sets `--r` on the block, and `--r` cascades,
  so the buttons inside a square card are square too. `<Markdown radius="10px">` or
  `configureMarkdown({ radius: '10px' })` does it for every block.
- `variant=` — adds `doc-variant-<name>`. The kit styles none of them; they are hooks for your
  stylesheet: `.md-body .doc-card.doc-variant-quiet { background: transparent }`.
- `class=` and the `.class` / `#id` shorthands — passed through (sanitised to plain names).

## Style variants

The stylesheet is scoped to `.md-body` and `.doc-*` and uses no `!important`, so a rule in your
own stylesheet wins by specificity or by order. A variant is a class you name in the document
and style in CSS:

```css
.md-body .doc-callout.doc-variant-thin { border-left-width: 1px; padding: 6px 12px; }
.md-body .doc-stats.doc-variant-mono .doc-stat-value { font-family: ui-monospace, monospace; }
```

## A block of your own

```js
import { registerBlock } from '@bettercommunity/bmd/plugins';

registerBlock('pricing', {
  attrs: ({ label, attrs }) => ({ 'data-plan': label, 'data-price': attrs.price || '' }),
  component: ({ node, children }) => {
    const p = node.properties;
    return <div className="pricing"><b>{p.dataPlan}</b> {p.dataPrice}<div>{children}</div></div>;
  },
});
```

```
:::pricing[Pro]{price=€9}
Everything in Free, plus…
:::
```

A registered block gets the same inputs a built-in one has (label, attributes, children) and
goes through the same sanitiser: its tag is `doc-x-<name>`, which cannot collide with an HTML
element or with the kit's own tags, and only `data-*` attributes survive. `leaf: true` makes it
an inline `:name[…]` directive.

Several at once, with their stylesheet:

```js
import { definePlugin } from '@bettercommunity/bmd/plugins';
const pricing = definePlugin({
  name: 'pricing',
  blocks: { pricing: {…}, plan: {…} },
  css: '.md-body .doc-x-plan { … }',
});
pricing.install();      // idempotent
pricing.uninstall();
```

## The syntax tree

```js
import { parseMarkdown, walkAst, extractHeadings, extractLinks, extractText } from '@bettercommunity/bmd/ast';

const tree = parseMarkdown(md, { pageMap });      // mdast, after the kit's transform
walkAst(tree, (node) => { if (node.type === 'containerDirective') console.log(node.name); });
extractHeadings(md);    // [{ depth, text, id }] — the ids the renderer gives them
extractLinks(md);       // every link, image and directive destination, with its line
extractText(md);        // for a search index
```

The tree is standard mdast, so every remark utility works on it. Directives arrive as
`containerDirective` / `leafDirective` / `textDirective` with `data.hName` and
`data.hProperties` already set — exactly what the renderer draws from.

## Links that go somewhere

```js
import { validateLinks } from '@bettercommunity/bmd/links';
const { ok, issues } = validateLinks(md, { pageMap });
// issues: [{ level: 'error'|'warning', code, href, text, line, hint }]
```

Anchors are checked against the document's own headings, internal paths against `pageMap`,
and the shapes that are wrong on their face (`//host`, `javascript:`, whitespace) are named.
`http://` is a warning. No network: what needs one belongs in your CI, not in an editor.

## HTML out

```js
import { renderHtml, documentHtml, cssUrl } from '@bettercommunity/bmd/export';
renderHtml(md, { lang: 'en' });                       // the .md-body element
documentHtml(md, { title, css, scheme: 'dark' });     // a standalone page
```

## Wiki links and includes

`[[Install]]`, `[[Install|read this]]`, `[[Install#linux]]`, `[[#top]]` resolve against
`pageMap` by title, by path, or by a path's last segment. A miss stays as text with
`doc-ref-missing`, so the page reads and the link checker can point at it.

`::include{src=/docs/partials/install.md}` renders another document in place, two levels deep.
`configureMarkdown({ resolveInclude: async (src) => text })` decides how the text is found —
a fetch by default, subject to the URL policy.

## The blocks that call a server

`:counter`, `::live`, `:action`, `::openapi` and `::include` put their URL through the same
policy as a link, with `kind: 'api'`. `policy.allowHosts` therefore decides which servers a
document may talk to; an empty list means any https host, which is the right default for a site
whose authors are staff and the wrong one for a site whose authors are the public.
