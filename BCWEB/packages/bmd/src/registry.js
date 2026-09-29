// The directive registry: every name the parser understands, as data.
//
// The parser (directives.js) dispatches on `name === '…'`, which is the fastest way to write a
// block and the worst way to LIST them — a reference page copied by hand from that chain is a
// page that is wrong the day somebody adds a block. So the list lives here, beside the parser,
// and everything that shows the vocabulary reads it: the /dev/bmd page, the npm README table
// (scripts/gen-readme.mjs), and the smoke test that renders every example from the published
// tarball.
//
// It cannot drift silently. `apps/web/test/bmd-registry.test.mjs` extracts the names the
// parser dispatches on and fails when this list and that chain disagree in either direction —
// a block the parser draws and this file does not name, or a name here the parser ignores.
// `check-md-renders` renders every `example` and fails when one leaks its own syntax.
//
// No imports and no React: this file is plain data, so a build tool, a docs generator or a
// test can read it without a renderer.

/** Where each directive sits on a reference page. The order is the reading order. */
export const DIRECTIVE_GROUPS = [
  { id: 'callouts', label: { en: 'Callouts', fr: 'Encadrés' } },
  { id: 'layout', label: { en: 'Layout', fr: 'Mise en page' } },
  { id: 'content', label: { en: 'Content blocks', fr: 'Blocs de contenu' } },
  { id: 'inline', label: { en: 'Inline', fr: 'En ligne' } },
  { id: 'media', label: { en: 'Media and diagrams', fr: 'Médias et diagrammes' } },
  { id: 'api', label: { en: 'API documentation', fr: 'Documentation d’API' } },
  { id: 'live', label: { en: 'Live and interactive', fr: 'Dynamique et interactif' } },
];

// `forms`: how it is written. `container` = `:::name … :::`, `leaf` = `::name{…}` on its own
// line, `text` = `:name[…]{…}` inside a sentence.
// `parent`: the block it belongs inside, when it only makes sense there.
// `fetches`: reads or calls a URL at render time (through the URL policy, without cookies).
export const DIRECTIVES = [
  // ── callouts ────────────────────────────────────────────────────────────────
  { name: 'note', aliases: ['info'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'A neutral note with a title.', fr: 'Une note neutre avec un titre.' },
    example: ':::note[Heads up]\nThe key is read from your environment.\n:::' },
  { name: 'tip', aliases: ['hint'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'A suggestion worth following.', fr: 'Un conseil utile.' },
    example: ':::tip[Shortcut]\nPress :kbd[Ctrl+K] to search.\n:::' },
  { name: 'success', aliases: ['check'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'Something that worked, or a done state.', fr: 'Une réussite, ou un état terminé.' },
    example: ':::success[Published]\nYour catalog is live.\n:::' },
  { name: 'warning', aliases: ['caution', 'important'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'Read this before going on.', fr: 'À lire avant de continuer.' },
    example: ':::warning[Breaking change]\nThe old endpoint stops answering in May.\n:::' },
  { name: 'danger', aliases: ['error'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'Something that loses data or money.', fr: 'Ce qui fait perdre des données ou de l’argent.' },
    example: ':::danger[Irreversible]\nDeleting a pool deletes its files.\n:::' },
  { name: 'callout', aliases: ['custom'], forms: ['container'], group: 'callouts', attrs: ['title', 'icon', 'color'],
    summary: { en: 'A callout with your own icon and colour.', fr: 'Un encadré avec votre icône et votre couleur.' },
    example: ':::callout[Launch day]{icon=rocket color="#7c3aed"}\nEverything ships at noon.\n:::' },

  // ── layout ──────────────────────────────────────────────────────────────────
  { name: 'cards', aliases: [], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'A responsive grid of cards.', fr: 'Une grille de cartes adaptative.' },
    example: ':::cards\n:::card[Plugins]{icon=puzzle href=/docs/plugins}\nExtend BMM.\n:::\n:::card[Themes]{icon=palette href=/docs/themes}\nRestyle it.\n:::\n:::' },
  { name: 'card', aliases: ['ref'], forms: ['container'], group: 'layout', attrs: ['title', 'href', 'icon', 'image', 'video', 'color'],
    summary: { en: 'One card: a title, a body, an optional link and cover.', fr: 'Une carte : titre, texte, lien et image facultatifs.' },
    example: ':::card[Read the guide]{icon=book-open href=/docs}\nEverything in one place.\n:::' },
  { name: 'tabs', aliases: [], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'Tabs; one :::tab per panel.', fr: 'Des onglets, un :::tab par panneau.' },
    example: ':::tabs\n:::tab{title="npm"}\n`npm i @bettercommunity/bmd`\n:::\n:::tab{title="pnpm"}\n`pnpm add @bettercommunity/bmd`\n:::\n:::' },
  { name: 'tab', aliases: [], forms: ['container'], group: 'layout', parent: 'tabs', attrs: ['title'],
    summary: { en: 'One panel of a :::tabs block.', fr: 'Un panneau d’un bloc :::tabs.' },
    example: ':::tabs\n:::tab{title="Windows"}\nRun the installer.\n:::\n:::' },
  { name: 'steps', aliases: [], forms: ['container'], group: 'layout', attrs: ['title', 'type', 'marker', 'start', 'orientation', 'shape', 'color'],
    summary: { en: 'A numbered procedure (1/2/3, a/b/c, i/ii/iii, dots or icons).', fr: 'Une procédure numérotée (1/2/3, a/b/c, i/ii/iii, points ou icônes).' },
    example: ':::steps[Get started]\n:::step[Install]\nAdd the package.\n:::\n:::step[Render]\nPass it a string.\n:::\n:::' },
  { name: 'step', aliases: [], forms: ['container'], group: 'layout', parent: 'steps', attrs: ['title', 'icon', 'done', 'color'],
    summary: { en: 'One step of a :::steps block.', fr: 'Une étape d’un bloc :::steps.' },
    example: ':::steps\n:::step[One]{done}\nFinished.\n:::\n:::' },
  { name: 'columns', aliases: ['row'], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'Equal columns that stack on a phone.', fr: 'Des colonnes égales qui s’empilent sur mobile.' },
    example: ':::columns\n:::column\n### Left\nAny markdown.\n:::\n:::column\n### Right\nAny markdown.\n:::\n:::' },
  { name: 'column', aliases: ['col'], forms: ['container'], group: 'layout', parent: 'columns', attrs: [],
    summary: { en: 'One column of a :::columns block.', fr: 'Une colonne d’un bloc :::columns.' },
    example: ':::columns\n:::column\nOne column.\n:::\n:::' },
  { name: 'grid', aliases: [], forms: ['container'], group: 'layout', attrs: ['cols', 'gap'],
    summary: { en: 'A fixed-column grid (1 to 6) that folds on narrow screens.', fr: 'Une grille à colonnes fixes (1 à 6) qui se replie sur petit écran.' },
    example: ':::grid{cols=3}\n:badge[One]\n\n:badge[Two]\n\n:badge[Three]\n:::' },
  { name: 'center', aliases: [], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'Centre what is inside.', fr: 'Centre le contenu.' },
    example: ':::center\n**Centred**\n:::' },
  { name: 'left', aliases: [], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'Align what is inside to the start.', fr: 'Aligne le contenu au début.' },
    example: ':::left\nStart-aligned.\n:::' },
  { name: 'right', aliases: [], forms: ['container'], group: 'layout', attrs: [],
    summary: { en: 'Align what is inside to the end.', fr: 'Aligne le contenu à la fin.' },
    example: ':::right\nEnd-aligned.\n:::' },
  { name: 'divider', aliases: [], forms: ['leaf', 'container'], group: 'layout', attrs: ['title'],
    summary: { en: 'A horizontal rule, optionally labelled.', fr: 'Un séparateur, avec un libellé facultatif.' },
    example: '::divider[Or]' },
  { name: 'details', aliases: ['collapse'], forms: ['container'], group: 'layout', attrs: ['title'],
    summary: { en: 'A collapsed section the reader opens.', fr: 'Une section repliée que le lecteur ouvre.' },
    example: ':::details[Show the full log]\nEverything that happened.\n:::' },
  { name: 'spoiler', aliases: [], forms: ['container'], group: 'layout', attrs: ['title'],
    summary: { en: 'Hidden until clicked, no script needed.', fr: 'Masqué jusqu’au clic, sans script.' },
    example: ':::spoiler[Reveal the answer]\nIt was the butler.\n:::' },
  { name: 'faq', aliases: [], forms: ['container'], group: 'layout', attrs: ['title'],
    summary: { en: 'A list of questions that open on their answers.', fr: 'Une liste de questions qui s’ouvrent sur leur réponse.' },
    example: ':::faq[Questions]\n:::q[Is it free?]\nYes, MIT.\n:::\n:::' },
  { name: 'q', aliases: ['question'], forms: ['container'], group: 'layout', parent: 'faq', attrs: ['title', 'open'],
    summary: { en: 'One question of a :::faq block.', fr: 'Une question d’un bloc :::faq.' },
    example: ':::faq\n:::q[Does it need a build step?]{open}\nNo.\n:::\n:::' },

  // ── content blocks ──────────────────────────────────────────────────────────
  { name: 'table', aliases: [], forms: ['container'], group: 'content', attrs: ['title', 'style', 'align', 'width'],
    summary: { en: 'A styled GFM table with a caption.', fr: 'Un tableau GFM stylé, avec légende.' },
    example: ':::table[Plans]{style="striped bordered"}\n| Plan | Price |\n|---|---|\n| Free | 0 |\n| Pro | 5 |\n:::' },
  { name: 'timeline', aliases: [], forms: ['container'], group: 'content', attrs: ['title'],
    summary: { en: 'Dated events on a rail.', fr: 'Des événements datés sur une frise.' },
    example: ':::timeline[History]\n:::event[3.0]{date=2026-09-07 state=done}\nAPI cards, live values.\n:::\n:::event[npm]{state=next}\nPublished.\n:::\n:::' },
  { name: 'event', aliases: ['moment'], forms: ['container'], group: 'content', parent: 'timeline', attrs: ['title', 'date', 'state', 'icon', 'color'],
    summary: { en: 'One event of a :::timeline (state done, now or next).', fr: 'Un événement d’une :::timeline (état done, now ou next).' },
    example: ':::timeline\n:::event[Beta]{date=2026-09-01 state=now}\nOpen to everyone.\n:::\n:::' },
  { name: 'compare', aliases: [], forms: ['container'], group: 'content', attrs: ['before', 'after'],
    summary: { en: 'Two sides, before and after.', fr: 'Deux côtés, avant et après.' },
    example: ':::compare{before="2.x" after="3.0"}\n:::before\nA zip to copy.\n:::\n:::after\nOne npm install.\n:::\n:::' },
  { name: 'before', aliases: [], forms: ['container'], group: 'content', parent: 'compare', attrs: ['title'],
    summary: { en: 'The left side of a :::compare.', fr: 'Le côté gauche d’un :::compare.' },
    example: ':::compare\n:::before\nOld.\n:::\n:::after\nNew.\n:::\n:::' },
  { name: 'after', aliases: [], forms: ['container'], group: 'content', parent: 'compare', attrs: ['title'],
    summary: { en: 'The right side of a :::compare.', fr: 'Le côté droit d’un :::compare.' },
    example: ':::compare\n:::before\nOld.\n:::\n:::after\nNew.\n:::\n:::' },
  { name: 'stats', aliases: [], forms: ['container'], group: 'content', attrs: [],
    summary: { en: 'A row of key numbers.', fr: 'Une rangée de chiffres clés.' },
    example: ':::stats\n:::stat[Downloads]{value="12 400" delta=+8% icon=download}\n:::\n:::stat[Errors]{value=3 delta=-40%}\n:::\n:::' },
  { name: 'stat', aliases: ['kpi'], forms: ['container'], group: 'content', parent: 'stats', attrs: ['title', 'value', 'delta', 'icon', 'color'],
    summary: { en: 'One number; the sign of its delta colours it.', fr: 'Un chiffre ; le signe de l’écart le colore.' },
    example: ':::stats\n:::stat[Users]{value=1200 delta=+3%}\n:::\n:::' },
  { name: 'quote', aliases: ['testimonial'], forms: ['container'], group: 'content', attrs: ['title', 'role', 'avatar', 'href', 'color'],
    summary: { en: 'A quotation with its author.', fr: 'Une citation et son auteur.' },
    example: ':::quote[Ada]{role="Maintainer"}\nIt rendered the first time.\n:::' },
  { name: 'hero', aliases: [], forms: ['container'], group: 'content', attrs: ['title', 'subtitle', 'image', 'icon', 'color', 'align'],
    summary: { en: 'A page header with a title, a subtitle and actions.', fr: 'Un en-tête de page : titre, sous-titre et actions.' },
    example: ':::hero[B.MD]{subtitle="Markdown with blocks" icon=sparkles}\n:button[Install]{href=/dev/bmd}\n:::' },
  { name: 'changelog', aliases: [], forms: ['container'], group: 'content', attrs: ['title'],
    summary: { en: 'Release notes, one :::version each.', fr: 'Des notes de version, un :::version chacune.' },
    example: ':::changelog\n:::version[3.1.0]{date=2026-09-26 label=latest}\n- [NEW] Published on npm.\n:::\n:::' },
  { name: 'version', aliases: ['release'], forms: ['container'], group: 'content', parent: 'changelog', attrs: ['title', 'date', 'label'],
    summary: { en: 'One release of a :::changelog.', fr: 'Une version d’un :::changelog.' },
    example: ':::changelog\n:::version[1.0.0]{date=2026-01-01}\n- [FIXED] A typo.\n:::\n:::' },
  { name: 'checklist', aliases: [], forms: ['container'], group: 'content', attrs: ['title', 'color'],
    summary: { en: 'A task list whose header counts the ticked items.', fr: 'Une liste de tâches dont l’en-tête compte les cases cochées.' },
    example: ':::checklist[Release]\n- [x] Tests\n- [x] Changelog\n- [ ] Tag\n:::' },
  { name: 'field', aliases: ['setting'], forms: ['container'], group: 'content', attrs: ['title', 'type', 'key', 'icon', 'color', 'anchor'],
    summary: { en: 'A labelled settings row: a label, a type, a key and a description.', fr: 'Une ligne de réglage : libellé, type, clé et description.' },
    example: ':::field[Corner radius]{type=number key=radius icon=square}\nApplies to every block.\n:::' },

  // ── inline ──────────────────────────────────────────────────────────────────
  { name: 'badge', aliases: ['tag'], forms: ['text'], group: 'inline', attrs: ['color'],
    summary: { en: 'A small coloured label.', fr: 'Une petite étiquette colorée.' },
    example: 'Status :badge[NEW]{color="#0a7"}' },
  { name: 'icon', aliases: [], forms: ['text'], group: 'inline', attrs: ['name'],
    summary: { en: 'An icon: lucide, ph:, simple:, iso: or app: names.', fr: 'Une icône : noms lucide, ph:, simple:, iso: ou app:.' },
    example: 'Ship it :icon[rocket] :icon[ph:heart]' },
  { name: 'kbd', aliases: [], forms: ['text'], group: 'inline', attrs: [],
    summary: { en: 'Keyboard keys, drawn as keycaps.', fr: 'Des touches, dessinées comme des touches de clavier.' },
    example: 'Press :kbd[Ctrl+Shift+P]' },
  { name: 'meter', aliases: [], forms: ['text'], group: 'inline', attrs: ['label', 'max', 'color'],
    summary: { en: 'A small inline progress bar.', fr: 'Une petite barre de progression en ligne.' },
    example: 'Translated :meter[72]{label=FR}' },
  { name: 'button', aliases: ['btn'], forms: ['text'], group: 'inline', attrs: ['href', 'brand', 'color', 'size', 'outline', 'icon'],
    summary: { en: 'A link drawn as a button; brand= picks a logo and colour.', fr: 'Un lien en forme de bouton ; brand= choisit logo et couleur.' },
    example: ':button[Source]{brand=github href=https://github.com} :button[Docs]{href=/docs outline}' },
  { name: 'link', aliases: [], forms: ['text'], group: 'inline', attrs: ['href', 'color'],
    summary: { en: 'A coloured link.', fr: 'Un lien coloré.' },
    example: 'See :link[the changelog]{href=/dev/bmd color="#0a7"}' },
  { name: 'file', aliases: [], forms: ['text', 'leaf'], group: 'inline', attrs: ['href', 'size', 'icon', 'name'],
    summary: { en: 'A download row with an icon picked from the extension.', fr: 'Une ligne de téléchargement, icône choisie selon l’extension.' },
    example: ':file[report.pdf]{href=/files/report.pdf size="1.2 MB"}' },
  { name: 'time', aliases: ['at'], forms: ['text'], group: 'inline', attrs: ['tz', 'format'],
    summary: { en: 'One instant, shown in the reader’s own time zone.', fr: 'Un instant, affiché dans le fuseau du lecteur.' },
    example: 'Maintenance :time[2026-10-01T20:00]{tz=Europe/Paris}' },
  { name: 'toc', aliases: [], forms: ['leaf'], group: 'inline', attrs: ['title', 'depth', 'numbered'],
    summary: { en: 'A table of contents built from the headings.', fr: 'Une table des matières construite depuis les titres.' },
    example: '## Install\n\n## Configure\n\n::toc[On this page]{depth=3}' },

  // ── media and diagrams ──────────────────────────────────────────────────────
  { name: 'img', aliases: ['image'], forms: ['text', 'leaf'], group: 'media', attrs: ['src', 'width', 'height', 'align', 'caption', 'link', 'zoom', 'lazy', 'border', 'rounded'],
    summary: { en: 'An image with size, alignment, caption and zoom.', fr: 'Une image avec taille, alignement, légende et zoom.' },
    example: '::img[A diagram]{src=/icon-192.png width=96 caption="The logo" rounded}' },
  { name: 'audio', aliases: [], forms: ['text', 'leaf'], group: 'media', attrs: ['src', 'title'],
    summary: { en: 'An audio player.', fr: 'Un lecteur audio.' },
    example: ':audio[Episode 1]{src=/media/ep1.mp3}' },
  { name: 'youtube', aliases: ['yt'], forms: ['leaf'], group: 'media', attrs: ['src', 'id', 'start'],
    summary: { en: 'A YouTube video, from youtube-nocookie.', fr: 'Une vidéo YouTube, via youtube-nocookie.' },
    example: '::youtube{src=https://youtu.be/dQw4w9WgXcQ}' },
  { name: 'spotify', aliases: [], forms: ['leaf'], group: 'media', attrs: ['src', 'compact', 'theme'],
    summary: { en: 'A Spotify track, album, playlist, episode, show or artist.', fr: 'Un titre, album, playlist, épisode, podcast ou artiste Spotify.' },
    example: '::spotify{src=https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC compact}' },
  { name: 'mermaid', aliases: ['diagram'], forms: ['container'], group: 'media', attrs: ['title', 'theme', 'look'],
    summary: { en: 'A Mermaid diagram (strict security level). A ```mermaid fence works too.', fr: 'Un diagramme Mermaid (niveau strict). Un bloc ```mermaid marche aussi.' },
    example: ':::mermaid[Flow]\n```\ngraph LR\n  A[Write] --> B[Render]\n```\n:::' },

  // ── API documentation ───────────────────────────────────────────────────────
  { name: 'api', aliases: ['endpoint'], forms: ['container'], group: 'api', attrs: ['title', 'auth', 'summary', 'deprecated'],
    summary: { en: 'An endpoint card: method, path, auth and sections.', fr: 'Une carte d’endpoint : méthode, chemin, auth et sections.' },
    example: ':::api[GET /v1/account]{auth=key summary="Who the key belongs to"}\n:::response{status=200}\n`{ "id": "u_1" }`\n:::\n:::' },
  { name: 'params', aliases: [], forms: ['container'], group: 'api', parent: 'api', attrs: ['title'],
    summary: { en: 'The parameters table of an :::api card.', fr: 'Le tableau des paramètres d’une carte :::api.' },
    example: ':::api[GET /v1/repos/:id]\n:::params\n| Name | In | Type |\n|---|---|---|\n| id | path | string |\n:::\n:::' },
  { name: 'request', aliases: [], forms: ['container'], group: 'api', parent: 'api', attrs: ['title'],
    summary: { en: 'The request body of an :::api card.', fr: 'Le corps de requête d’une carte :::api.' },
    example: ':::api[PATCH /v1/account]\n:::request\n`{ "displayName": "Ada" }`\n:::\n:::' },
  { name: 'response', aliases: [], forms: ['container'], group: 'api', parent: 'api', attrs: ['title', 'status'],
    summary: { en: 'One response of an :::api card, by status.', fr: 'Une réponse d’une carte :::api, par statut.' },
    example: ':::api[GET /v1/scopes]\n:::response{status=200}\nA list of scopes.\n:::\n:::' },
  { name: 'openapi', aliases: ['swagger'], forms: ['leaf'], group: 'api', fetches: true, attrs: ['src', 'tag', 'filter', 'toc'],
    summary: { en: 'Fetches an OpenAPI 3 / Swagger 2 document and draws every operation as :::api cards.', fr: 'Charge un document OpenAPI 3 / Swagger 2 et dessine chaque opération en cartes :::api.' },
    example: '::openapi{src=/api/openapi.json tag=feedback}' },

  // ── live and interactive ────────────────────────────────────────────────────
  { name: 'counter', aliases: [], forms: ['text'], group: 'live', fetches: true, attrs: ['src', 'path', 'refresh', 'format', 'prefix', 'suffix'],
    summary: { en: 'A number read from a JSON URL, refreshed on a timer.', fr: 'Un nombre lu dans une URL JSON, rafraîchi à intervalle.' },
    example: 'API up: :counter[Health]{src=/api/health path=ok format=text}' },
  { name: 'fetch', aliases: [], forms: ['text'], group: 'live', fetches: true, attrs: ['src', 'path', 'refresh', 'format'],
    summary: { en: 'Any value read from a JSON URL, inline.', fr: 'Une valeur lue dans une URL JSON, en ligne.' },
    example: 'Status: :fetch[Status]{src=/api/health path=ok format=text}' },
  { name: 'live', aliases: [], forms: ['leaf'], group: 'live', fetches: true, attrs: ['src', 'path', 'refresh', 'format'],
    summary: { en: 'A value read from a JSON URL, as its own block.', fr: 'Une valeur lue dans une URL JSON, en bloc.' },
    example: '::live{src=/api/health path=ok format=text}' },
  { name: 'action', aliases: [], forms: ['text'], group: 'live', fetches: true, attrs: ['href', 'method', 'body', 'confirm', 'done', 'counter', 'once', 'icon', 'color'],
    summary: { en: 'A button that calls a URL, always without the reader’s cookies; a write asks first.', fr: 'Un bouton qui appelle une URL, toujours sans les cookies du lecteur ; une écriture demande d’abord.' },
    example: ':action[Ping]{href=/api/health method=GET done="Pong"}' },
  { name: 'include', aliases: ['embed-md'], forms: ['leaf'], group: 'live', fetches: true, attrs: ['src'],
    summary: { en: 'Renders another markdown document in place (two levels deep).', fr: 'Affiche un autre document markdown sur place (deux niveaux).' },
    example: '::include{src=/docs/partials/install.md}' },
  { name: 'schedule', aliases: ['hours'], forms: ['container'], group: 'live', attrs: ['title', 'tz'],
    summary: { en: 'A table of repeating hours, converted to the reader’s time zone.', fr: 'Un tableau d’horaires récurrents, converti dans le fuseau du lecteur.' },
    example: ':::schedule[Support]{tz=Europe/Paris}\n| Day | Hours |\n|---|---|\n| Mon-Fri | 09:00-18:00 |\n:::' },
/* kit:injected:start */
  { name: 'roadmap', aliases: ['progress'], forms: ['container'], group: 'live', attrs: ['title', 'orientation'],
    summary: { en: 'A roadmap in stages, with progress.', fr: 'Une feuille de route par étapes, avec avancement.' },
    example: ':::roadmap[Plan]\n:::stage[Shipped]{state=done}\n- Renderer\n:::\n:::stage[Next]\n- npm\n:::\n:::' },
  { name: 'stage', aliases: ['phase'], forms: ['container'], group: 'live', parent: 'roadmap', attrs: ['title', 'state', 'percent'],
    summary: { en: 'One stage of a :::roadmap.', fr: 'Une étape d’une :::roadmap.' },
    example: ':::roadmap\n:::stage[Now]{state=now percent=40}\n- Docs\n:::\n:::' },
  { name: 'replay', aliases: ['bmmreplay'], forms: ['container'], group: 'live', fetches: true, attrs: ['title', 'src'],
    summary: { en: 'A recorded .bmmreplay session, played in place.', fr: 'Une session .bmmreplay enregistrée, rejouée sur place.' },
    example: ':::replay[Tour]{src=/media/tour.bmmreplay}\n:::' },
/* kit:injected:end */
];

/** Every name the parser answers to, aliases included, lower-case. */
export function directiveNames() {
  const out = [];
  for (const d of DIRECTIVES) out.push(d.name, ...(d.aliases || []));
  return out;
}

/** The registry entry for a name or an alias, or `undefined`. */
export function findDirective(name) {
  const n = String(name || '').toLowerCase();
  return DIRECTIVES.find((d) => d.name === n || (d.aliases || []).includes(n));
}

/** How a directive is written, as the opening of its syntax: `:::name`, `::name` or `:name`. */
export function directiveSyntax(d) {
  const form = (d && d.forms && d.forms[0]) || 'container';
  return `${form === 'container' ? ':::' : form === 'leaf' ? '::' : ':'}${d ? d.name : ''}`;
}
