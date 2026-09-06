// What the "Insert a block" menu offers, and the text each entry drops into the document.
//
// Data, not components, so a host can show the same list in its own menu, add to it, or hand
// it to a command palette. `${cursor}` marks where the caret lands; `${sel}` is the selected
// text when there is one (a block wraps it, an inline one replaces it).
export const SNIPPET_GROUPS = [
  {
    id: 'text', icon: 'text-cursor', label: 'Text', items: [
      { id: 'h2', label: 'Heading', inline: true, md: '## ${sel|Heading}' },
      { id: 'bold', label: 'Bold', inline: true, md: '**${sel|bold}**' },
      { id: 'italic', label: 'Italic', inline: true, md: '*${sel|italic}*' },
      { id: 'code', label: 'Inline code', inline: true, md: '`${sel|code}`' },
      { id: 'mark', label: 'Highlight', inline: true, md: '==${sel|marked}==' },
      { id: 'strike', label: 'Strikethrough', inline: true, md: '~~${sel|gone}~~' },
      { id: 'link', label: 'Link', inline: true, md: '[${sel|text}](https://${cursor})' },
      { id: 'wiki', label: 'Wiki link', inline: true, md: '[[${sel|Page title}]]' },
      { id: 'footnote', label: 'Footnote', inline: true, md: '${sel}[^1]\n\n[^1]: ${cursor}' },
      { id: 'kbd', label: 'Keys', inline: true, md: ':kbd[${sel|Ctrl+K}]' },
      { id: 'badge', label: 'Badge', inline: true, md: ':badge[${sel|NEW}]{color="#0a7"}' },
      { id: 'icon', label: 'Icon', inline: true, md: ':icon[${sel|rocket}]' },
      { id: 'emoji', label: 'Emoji', inline: true, md: ':${sel|rocket}:' },
      { id: 'quote', label: 'Quote', md: '> ${sel|Quoted text}' },
      { id: 'codeblock', label: 'Code block', md: '```${cursor}\n${sel}\n```' },
      { id: 'math', label: 'Maths', md: '$$${sel|E = mc^2}$$' },
    ],
  },
  {
    id: 'callouts', icon: 'info', label: 'Callouts', items: [
      { id: 'note', label: 'Note', md: ':::note[${cursor}Title]\n${sel|Body}\n:::' },
      { id: 'tip', label: 'Tip', md: ':::tip[${cursor}Title]\n${sel|Body}\n:::' },
      { id: 'warning', label: 'Warning', md: ':::warning[${cursor}Title]\n${sel|Body}\n:::' },
      { id: 'danger', label: 'Danger', md: ':::danger[${cursor}Title]\n${sel|Body}\n:::' },
      { id: 'callout', label: 'Custom', md: ':::callout[${cursor}Title]{icon=rocket color=#7c3aed}\n${sel|Body}\n:::' },
      { id: 'details', label: 'Collapsible', md: ':::details[${cursor}Show more]\n${sel|Hidden until opened.}\n:::' },
      { id: 'spoiler', label: 'Spoiler', md: ':::spoiler[${cursor}Reveal]\n${sel|The answer.}\n:::' },
    ],
  },
  {
    id: 'layout', icon: 'layout-grid', label: 'Layout', items: [
      { id: 'cards', label: 'Card grid', md: '::::cards\n:::card[First]{icon=rocket href=/}\n${sel|One.}\n:::\n:::card[Second]{icon=book}\nTwo.\n:::\n::::' },
      { id: 'card', label: 'Card', md: ':::card[${cursor}Title]{icon=rocket href=/}\n${sel|Body}\n:::' },
      { id: 'columns', label: 'Columns', md: '::::columns\n:::column\n${sel|Left}\n:::\n:::column\nRight\n:::\n::::' },
      { id: 'grid', label: 'Grid', md: '::::grid{cols=3}\n:::card[A]\n1\n:::\n:::card[B]\n2\n:::\n:::card[C]\n3\n:::\n::::' },
      { id: 'tabs', label: 'Tabs', md: '::::tabs\n:::tab{title="Windows"}\n${sel|First panel}\n:::\n:::tab{title="macOS"}\nSecond panel\n:::\n::::' },
      { id: 'steps', label: 'Steps', md: '::::steps[${cursor}How to]\n:::step[First]\n${sel|Do this.}\n:::\n:::step[Then]\nDo that.\n:::\n::::' },
      { id: 'hero', label: 'Hero', md: ':::hero[${cursor}Title]{subtitle="One line under it" color=#0a7 align=center}\n${sel}\n:::' },
      { id: 'center', label: 'Centered', md: ':::center\n${sel|Centered content}\n:::' },
      { id: 'table', label: 'Styled table', md: ':::table[${cursor}Caption]{style="striped bordered"}\n| Column | Column |\n|---|---|\n| ${sel|cell} | cell |\n:::' },
    ],
  },
  {
    id: 'content', icon: 'list-checks', label: 'Content', items: [
      { id: 'timeline', label: 'Timeline', md: '::::timeline[${cursor}Title]\n:::event[Shipped]{date="2026-01-01" state=done}\n${sel|What happened.}\n:::\n:::event[Next]{date="2026-06-01" state=next}\nWhat is planned.\n:::\n::::' },
      { id: 'changelog', label: 'Changelog', md: '::::changelog\n:::version[1.0.0]{date="2026-01-01" label=latest}\n- [NEW] ${sel|Something}\n:::\n::::' },
      { id: 'stats', label: 'Stats', md: '::::stats\n:::stat[${cursor}Users]{value="12 400" delta="+8%" icon=users}\n:::\n:::stat[Uptime]{value="99.9%" icon=activity}\n:::\n::::' },
      { id: 'quote', label: 'Pull quote', md: ':::quote[${cursor}Who said it]{role="Role"}\n${sel|The words.}\n:::' },
      { id: 'faq', label: 'FAQ', md: '::::faq[${cursor}Questions]\n:::q[First question?]\n${sel|Answer.}\n:::\n:::q[Second?]\nAnswer.\n:::\n::::' },
      { id: 'checklist', label: 'Checklist', md: ':::checklist[${cursor}Launch]\n- [x] ${sel|Done}\n- [ ] Not yet\n:::' },
      { id: 'compare', label: 'Before / after', md: '::::compare{before="v1" after="v2"}\n:::before\n${sel|Then}\n:::\n:::after\nNow\n:::\n::::' },
      { id: 'roadmap', label: 'Roadmap', md: '::::roadmap[${cursor}Where we are]\n:::stage[Shipped]{state=done}\n- ${sel|Item}\n:::\n:::stage[Next]{state=planned}\n- Item\n:::\n::::' },
      { id: 'schedule', label: 'Schedule', md: ':::schedule[${cursor}Support]{tz=Europe/Paris}\n| Day | Open |\n|---|---|\n| Mon-Fri | 09:00-18:00 |\n:::' },
      { id: 'time', label: 'Instant', inline: true, md: ':time[${sel|2026-09-01T20:00}]{tz=Europe/Paris}' },
      { id: 'tag', label: 'Tag', inline: true, md: ':tag[${sel|Beta}]' },
      { id: 'styledlink', label: 'Styled link', inline: true, md: ':link[${sel|Read more}]{href=/${cursor} color=#0a7}' },
      { id: 'divider', label: 'Divider', md: '---' },
      { id: 'align', label: 'Align right', md: ':::right\n${sel|Right-aligned}\n:::' },
      { id: 'meter', label: 'Meter', inline: true, md: ':meter[${sel|60}]{label=Done}' },
      { id: 'toc', label: 'Table of contents', md: '::toc[${cursor}On this page]' },
    ],
  },
  {
    id: 'media', icon: 'image', label: 'Media', items: [
      { id: 'image', label: 'Image', md: ':img[${sel|Alt text}]{src=https://${cursor} width=480 align=center caption="Caption"}' },
      { id: 'file', label: 'File', inline: true, md: ':file[${sel|report.pdf}]{href=/${cursor} size="1.2 MB"}' },
      { id: 'button', label: 'Button', inline: true, md: ':button[${sel|Open}]{href=https://${cursor} brand=youtube}' },
      { id: 'audio', label: 'Audio', md: '::audio{src=https://${cursor} title="${sel|Episode}"}' },
      { id: 'youtube', label: 'YouTube', md: '::youtube{src=https://youtu.be/${cursor}}' },
      { id: 'spotify', label: 'Spotify', md: '::spotify{src=https://open.spotify.com/track/${cursor}}' },
      { id: 'replay', label: 'BMM replay', md: ':::replay[${sel|Title}]{src=/${cursor}.bmmreplay}\n:::' },
      { id: 'mermaid', label: 'Diagram', md: ':::mermaid[${sel|Caption}]\n```\ngraph TD\n  A[Start] --> B[${cursor}Next]\n```\n:::' },
    ],
  },
  {
    id: 'api', icon: 'plug', label: 'API & live', items: [
      { id: 'api', label: 'Endpoint', md: ':::api[${cursor}GET /api/things]{auth=key summary="What it does"}\n:::params\n| Name | In | Type | Required | Description |\n|---|---|---|---|---|\n| `id` | path | string | yes | ${sel|Which one} |\n:::\n:::response{status=200}\n```json\n{ "ok": true }\n```\n:::\n:::' },
      { id: 'openapi', label: 'OpenAPI document', md: '::openapi{src=${cursor}/api/openapi.json}' },
      { id: 'counter', label: 'Live value (inline)', inline: true, md: ':counter[${sel|Downloads}]{src=${cursor}/api/stats path=downloads format=compact refresh=60}' },
      { id: 'live', label: 'Live value (block)', md: '::live{src=${cursor}/api/stats path=members label="Members" format=number refresh=60}' },
      { id: 'livestats', label: 'Live stats row', md: '::::stats\n:::stat[Members]{src=/api/stats path=members icon=users}\n:::\n:::stat[Downloads]{src=/api/stats path=downloads format=compact icon=download}\n:::\n:::stat[Published]{src=/api/stats path=items icon=package}\n:::\n::::' },
      { id: 'action', label: 'Action button', inline: true, md: ':action[${sel|Vote}]{href=${cursor}/api/vote method=POST done="Thanks!"}' },
      { id: 'include', label: 'Include', md: '::include{src=${cursor}/docs/partials/x.md}' },
    ],
  },
];

/** Every snippet, flat, for a palette or a search box. */
export const SNIPPETS = SNIPPET_GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));

/**
 * The text to insert, given the selection. Returns `{ text, cursor }` where `cursor` is the
 * offset inside `text` the caret should land on (the end when nothing was marked).
 */
export function expandSnippet(md, selection = '') {
  const sel = String(selection || '');
  let text = String(md || '').replace(/\$\{sel\|([^}]*)\}/g, (m, dflt) => (sel || dflt)).replace(/\$\{sel\}/g, sel);
  const at = text.indexOf('${cursor}');
  text = text.replace(/\$\{cursor\}/g, '');
  return { text, cursor: at >= 0 ? at : text.length };
}
