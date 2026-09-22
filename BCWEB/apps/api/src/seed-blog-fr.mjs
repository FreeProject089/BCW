// French for the seeded blog post that has no inline translation, keyed by slug.
//
// The blog seed (seed.mjs) keeps exactly three posts: the 1.0 release, the welcome post (both
// bilingual inline) and the Markdown guide, whose French lives here. The four catalog guides
// that used to follow it were removed from the blog, and their translations with them: the
// seed prunes every other post, so nothing ever read them.
//
// Same arrangement as seed-docs-fr.mjs, for the same reason: a translation is reviewed as a
// whole, and interleaving two languages in one array makes both hard to read.
export const BLOG_FR = {
  'markdown-guide': {
    title: 'Guide Markdown \u2014 le vocabulaire complet',
    excerpt: 'Les 32 blocs du Markdown BetterCommunity, chacun avec un exemple vivant : boutons, onglets, cartes, \u00e9tapes, math\u00e9matiques et le reste.',
    body: `Le blog, la documentation et la FAQ de BetterCommunity utilisent le **même Markdown**, plus un **système de blocs à la GitBook**. Écrivez en **Markdown** ou passez en **Visuel** — les deux enregistrent le même contenu, et le mode Visuel porte désormais la même barre d'outils « sélectionner pour formater ».

::toc[Sommaire]

:::tip[Deux façons d'écrire]
Utilisez le bouton **Blocs** en mode Markdown, ou basculez en **Visuel** et construisez le billet en glissant des blocs. Sélectionnez des mots dans l'un ou l'autre mode pour les formater.
:::

## Les bases du texte
\`**gras**\` · \`*italique*\` · \`~~barré~~\` · \`code en ligne\` · \`[un lien](https://exemple.com)\`

Une séparation entre deux sections, c'est trois tirets seuls sur leur ligne. Une citation, c'est un \`>\` en début de ligne.

## Boutons
Une seule forme, trois tailles, n'importe quelle couleur — et un logo quand c'est une marque.

:button[Regarder]{brand=youtube href=https://youtube.com} :button[Rejoindre]{brand=discord href=https://discord.gg} :button[Soutenir]{brand=kofi href=https://ko-fi.com}

\`:button[Libellé]{brand=youtube href=…}\` — marques : \`youtube\` \`discord\` \`kofi\` \`github\` \`twitch\` \`x\` \`reddit\` \`telegram\`
\`:button[Libellé]{color=#0a7 size=lg href=…}\` — tailles \`sm\` \`md\` \`lg\`, ajoutez \`outline\` pour la version discrète.

Forme courte : \`:btn[…]\` fait la même chose.

## Liens colorés
:link[un lien rouge]{color=#e11 href=/docs} — \`:link[texte]{color=#e11 href=/docs}\`. Souligné comme tous les autres liens, parce que la couleur seule n'est pas un signal que tout le monde perçoit.

## Badges et étiquettes
:badge[NOUVEAU] :badge[Sur mesure]{color="#0a7"} — \`:badge[NOUVEAU]\` ou \`:badge[N'importe quel texte]{color="#0a7"}\`. \`:tag[…]\` est la même pastille sous un autre nom.

## Emoji
:rocket: :tada: :white_check_mark: — écrits \`:rocket:\` \`:tada:\` \`:white_check_mark:\`. 384 noms, les mêmes que sur GitHub. Un nom inconnu reste tel que tu l'as tapé plutôt que de disparaître, et rien dans du code n'est touché — \`10:30:45\` et un bloc clôturé sont à l’abri.

## Icônes et touches
:icon[rocket] :kbd[Ctrl+K] — \`:icon[rocket]\` accepte n'importe quel nom lucide ou une marque ; \`:kbd[Ctrl+Shift+S]\` dessine de vraies touches.

## Encadrés
:::note[Note]
\`:::note\` \`:::tip\` \`:::success\` \`:::warning\` \`:::danger\` — et \`:::callout{icon=rocket color="#7c3aed"}\` pour le vôtre — \`:::custom\` est le même bloc, sous le nom qu'emploie le menu Blocs de l'éditeur.
:::

## Horaires et instants
:::schedule[Support]{tz=Europe/Paris}
| Jour | Ouvert |
|---|---|
| Lun-Ven | 09:00-18:00 |
| Sam | 10:00-14:00 |
:::

\`:::schedule{tz=...}\` (ou \`:::hours\`) enonce un horaire recurrent dans UN fuseau. Les lignes sont affichees exactement comme tu les as ecrites et le fuseau est nomme sur la carte, parce que les convertir serait faux : \`lundi 09:00 Europe/Paris\`, c'est 09:00 a Paris toute l'annee, et ce qui bouge au passage a l'heure d'ete, c'est l'ecart avec le lecteur. Une ligne convertie serait juste aujourd'hui et fausse en mars. Ce que le bloc calcule, c'est l'ecart **maintenant**, et il le dit.

Un instant unique n'a pas cette ambiguite, donc il EST converti : \`:time[2026-09-01T20:00]{tz=Europe/Paris}\` (ou \`:at\`) affiche ce moment dans le fuseau de chaque lecteur, en gardant ce que tu as tape dans l'infobulle. C'est la date qui rend le calcul exact - elle decide de quel cote d'un changement d'heure le moment tombe.

## Onglets
:::tabs
:::tab{title="Windows"}
Lancez \`install.exe\`.
:::
:::tab{title="Linux"}
Lancez \`./install.sh\`.
:::
:::

\`:::tabs\` qui enveloppe des blocs \`:::tab{title="…"}\`. Chaque onglet contient le markdown que vous voulez — code, images, encadrés.

## Cartes
:::cards
:::card{title="Une carte" href=/docs icon=book}
Les cartes se placent côte à côte dans \`:::cards\`. Une seule fonctionne aussi.
:::
:::

## Téléchargements
:file[setup.exe]{href=/api/assets/setup.exe size="42 Mo"} — l'icône suit l'extension : PDF, zip, image, vidéo, audio, code. \`:file[nom.ext]{href=… size="…"}\`

## Colonnes et alignement
:::columns
:::column
\`:::columns\` avec \`:::column\` à l'intérieur. \`:::row\` et \`:::col\` sont identiques.
:::
:::column
\`:::center\`, \`:::left\` et \`:::right\` alignent un bloc.
:::
:::

## Étapes
:::steps
:::step[D'abord]
Numérotées, dans l'ordre.
:::
:::step[Ensuite]
\`:::steps\` qui enveloppe des \`:::step[Titre]\`.
:::
:::

## Replier et détails
:::collapse[Cliquez pour ouvrir]
Caché jusqu'à ce qu'on le demande. \`:::collapse[Résumé]\` — \`:::details\` est identique.
:::

## Progression
\`:::progress\` est le bloc feuille de route sous un second nom — écris celui qui se lit le mieux. Il n'y a pas de pourcentage en ligne : un nombre seul est un pourcentage de rien, et c'est la feuille de route ci-dessous qui dit de quoi.

## Feuille de route
La méthode courte — des jalons, pas de JSON. Chaque puce sous un jalon devient un élément suivi :

:::roadmap[Où on en est]
:::stage[Livré]{state=done}
- Le système de blocs
:::
:::stage[En cours]{state=doing percent=40}
- Le constructeur de pages
:::
:::

\`:::stage[Titre]{state=done|doing|planned}\`, plus \`percent=\` et \`eta=\`. \`:::phase\` est le même bloc.
Pour un pourcentage par élément, mets plutôt un bloc \`json\` à l'intérieur — \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Cœur", "status": "done" }] }] }\` — ou pointe vers un fichier avec \`:::roadmap{src="https://…/progress.json"}\`. \`orientation=horizontal\` aligne les jalons sur une piste.

## Médias
Images et YouTube s'insèrent depuis la barre d'outils de l'éditeur. Un enregistrement \`.bmmreplay\` s'intègre avec \`:::replay{src="…"}\` — \`:::bmmreplay\` est identique.

## Mathématiques
Écrites \`$$…$$\`, en ligne ou en bloc :

$$E = mc^2$$

Le dollar simple \`$x$\` est volontairement désactivé : ce site affiche des prix, et « \$5 et \$10 » serait composé comme une formule.

## Tableaux et code
| Fonctionnalité | État |
|---|---|
| Thème sombre | Livré |
| Sync de dépôt | Plus rapide |

Les blocs de code délimités sont colorés par langage.

## Renvois
\`:ref[libellé]{href=…}\` crée un lien portant le nom de sa cible. Les liens internes vers la documentation affichent une carte d'aperçu au survol, avec l'icône de la page et sa première ligne.

## Nouveau dans B.MD 2.0

Dix blocs de plus, tous documentés avec des exemples vivants sur la page **Blocs de
documentation** des docs : une **chronologie** datée (\`:::timeline\` / \`:::event\`), un
**avant / après** (\`:::compare\`), des tuiles de **stats** (\`:::stats\` / \`:::stat\`), une
**citation** signée, une bannière **hero**, un **changelog** (\`:::version\`), un **spoiler**,
une **FAQ** (\`:::faq\` / \`:::q\`), une **checklist** qui compte ses cases, une **grille** à
colonnes fixes et une **jauge** en ligne (\`:meter[60]{label=Fait}\`). Les icônes viennent aussi
de **Phosphor** : \`:icon[ph:rocket]\`, avec la graisse en préfixe (\`ph-bold:\`, \`ph-fill:\`,
\`ph-duotone:\`).

:::stats
:::stat[Blocs]{value="70" delta="+22" icon=ph:stack}
:::
:::stat[Icônes]{value="3 000+" icon=ph:palette}
:::
:::

## Nouveau dans B.MD 3.0

Le reste du vocabulaire, chacun avec des exemples vivants sur la page **Blocs de documentation** :

- **Lignes de réglage** — \`:::field[Forme des tuiles]{key=icons.shape type=select icon=palette}\` (\`:::setting\` est le même bloc) : un libellé en gras, une étiquette de type, la clé en monospace, puis la description. Empile-les pour documenter un écran de réglages sans tableau.
- **Un séparateur qu'on pilote** — \`:::divider[Deuxième partie]\` met les mots au milieu du trait.
- **Un tableau habillé** — \`:::table[Légende]{style="striped bordered" align=center width=100%}\` autour d'un tableau GFM ordinaire.
- **Des images avec tout ce que \`![]()\` ne sait pas porter** — \`:img[Alt]{src=/a.png width=480 align=center caption="…" link=/grande.png border}\` (\`:image\` est le même) ; un nombre = des pixels, \`50%\` ou \`20rem\` passent tels quels.
- **Médias** — \`::audio{src=/ep12.mp3 title="Épisode 12"}\`, \`::youtube{src=https://youtu.be/ID start=90}\` (\`::yt\` est le même, servi depuis youtube-nocookie), \`::spotify{src=https://open.spotify.com/track/…}\` (aussi \`track:ID\`, \`album:ID\`, \`playlist:ID\`, \`episode:ID\`, \`show:ID\`).
- **Cartes d'API** — \`:::api[GET /api/feedback/:project]{auth=session summary="…" deprecated}\` (\`:::endpoint\` est le même), contenant des sections \`:::params\`, \`:::request\` et \`:::response{status=200}\`. \`::openapi{src=/api/openapi.json tag=feedback}\` (\`::swagger\`) dessine une spec entière sous forme de ces mêmes cartes.
- **Valeurs en direct** — \`:counter[Téléchargements]{src=/api/stats.json path=downloads refresh=60}\` (un nombre, formaté), \`:fetch[…]\` (du texte, en ligne), \`::live{src=… path=message}\` (un bloc) ; \`:action[Voter]{href=… method=POST confirm="Sûr ?" done="Merci !" counter=votes once}\` est un bouton qui appelle une URL et peut rafraîchir un compteur nommé.
- **Inclusion** — \`::include{src=/docs/partials/install.md}\` (\`::embed-md\`) rend un autre document à cet endroit, deux niveaux de profondeur au plus.
- **Diagrammes** — \`:::mermaid[Légende]\` (\`:::diagram\`) autour d'un bloc de code ; un simple bloc \`\`\`mermaid marche aussi.
- Les blocs 2.0 ont chacun un second nom : \`:::moment\` pour un événement, \`:::before\` / \`:::after\` dans un compare, \`:::kpi\` pour une stat, \`:::testimonial\` pour une \`:::quote\`, \`:::release\` pour une version, \`:::question\` pour une entrée de FAQ — et \`:::hero\`, \`:::changelog\`, \`:::spoiler\`, \`:::checklist\`, \`:::grid\` s'écrivent exactement comme ça.

Voilà tout le vocabulaire. Combinez encadrés, cartes et listes courtes pour des pages que les gens lisent vraiment.`,
  },
};
