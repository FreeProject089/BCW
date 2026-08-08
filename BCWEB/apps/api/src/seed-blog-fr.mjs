// French for the seeded blog posts, keyed by slug.
//
// The four news posts (welcome, what's-new, roadmap, hosting) were already bilingual inline.
// The five reference posts — the Markdown guide and the four catalog guides — were not, and
// nothing said so: an untranslated post renders in English with a small "not translated"
// note, which is easy to miss when the four posts above it are French.
//
// Same arrangement as seed-docs-fr.mjs, for the same reason: a translation is reviewed as a
// whole, and interleaving two languages in one array makes both hard to read.
export const BLOG_FR = {
  'markdown-guide': {
    title: 'Guide Markdown — rédiger notes et billets',
    excerpt: 'Toutes les possibilités Markdown du blog : badges, encadrés, médias, tableaux et le reste.',
    body: `Le blog BetterCommunity utilise le **même Markdown** que les notes de version de BMM, plus un **système de blocs** à la GitBook. Écris en **Markdown** ou passe en mode **Visuel** (blocs glissés-déposés) — les deux enregistrent le même contenu.

::toc[Sommaire]

:::tip[Deux façons d'écrire]
Utilise le bouton **Blocs** (mode Markdown) pour insérer des blocs riches, ou bascule en **Visuel** pour construire le billet en déplaçant les blocs. Le contenu produit est identique dans les deux cas.
:::

## Les bases du texte
\`**gras**\` · \`*italique*\` · \`~~barré~~\` · \`\\\`code en ligne\\\`\` · \`[un lien](https://example.com)\`

## Les badges de changement
Encadre un mot-clé de crochets pour obtenir une pastille colorée :

- [NOUVEAU] Ajout d'un thème sombre
- [AMÉLIORÉ] Chargement du catalogue plus rapide
- [FIXÉ] Plantage à l'ouverture d'un dépôt vide
- [RAFFINEMENT] Espacements resserrés · [VISUEL] Nouvelle animation · [MAJEUR] Grosse réécriture

Les graphies anglaises marchent aussi : \`[NEW]\`, \`[IMPROVED]\`, \`[FIXED]\`, \`[REFINE]\`, \`[VISUAL]\`, \`[MAJOR]\`.

## Les encadrés
Les encadrés utilisent les icônes lucide (pas d'emoji). Choisis un type, ou fabrique le tien :

:::warning[Attention]
N'installe du contenu que depuis des sources auxquelles tu fais confiance.
:::
:::callout[Personnalisé]{icon=rocket color="#7c3aed"}
Un encadré personnalisé te laisse choisir l'icône et la couleur.
:::

Types : \`note\`, \`tip\`, \`success\`, \`warning\`, \`danger\`, ou \`callout\` pour un sur-mesure. L'ancienne forme \`> [!TIP]\` en citation fonctionne toujours.

## Les blocs riches
Insère-les depuis le menu **Blocs** (ou construis-les en mode **Visuel**) :

:::details[Section repliable]
Du contenu masqué qui se déplie au clic — et qui accepte du **markdown** à l'intérieur.
:::

::::cards
:::card{title="Cartes" icon=star}
Regroupe des liens ou des points saillants dans une grille adaptative.
:::
:::card{title="Docs" href=/docs icon=book}
Une carte peut pointer n'importe où.
:::
::::

Ajoute un raccourci clavier comme :kbd[Ctrl+S], une icône en ligne :icon[sparkles], des colonnes, des blocs de code et un sommaire \`::toc\` — tout depuis le même menu.

## Les médias
Sers-toi des boutons de la barre d'outils pour les images, YouTube, la vidéo et les liens — ils insèrent le bon extrait à ta place.

## Tableaux & code
| Fonctionnalité | État |
|---|---|
| Thème sombre | Livré |
| Synchro des dépôts | Plus rapide |

\`\`\`json
{ "name": "exemple", "version": "1.0.0" }
\`\`\`

## Roadmap / suivi d'avancement
Intègre le même suivi d'avancement personnalisable que celui des pages projet — directement dans un billet ou une page de doc.

:::note[Deux sources]
**Distante** — pointe vers un fichier JSON hébergé : \`:::roadmap{src="https://example.com/progress.json" title="Roadmap"}:::\`
**Statique** — mets un bloc de code \`json\` à l'intérieur du bloc \`:::roadmap{title="Roadmap"} … :::\`. Forme : \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Cœur", "status": "done" }, { "label": "Docs", "status": "progress", "percent": 40 }] }] }\`. États : \`done\` · \`progress\` · \`planned\` ; en option \`percent\`, \`eta\`, et des jauges \`code\`/\`art\`/\`lastUpdate\`. Les libellés acceptent \`{ "en": …, "fr": … }\` pour une roadmap bilingue.
:::

Voilà tout — combine badges, encadrés et listes courtes pour des billets propres et lisibles.`,
  },

  'guide-app-catalog': {
    title: "Format du catalogue d'applications",
    excerpt: 'Comment publier une application dans le catalogue BMM.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Applications]{color="#16a34a"}

Le **catalogue d'applications** est un \`catalog.json\` hébergé, avec un tableau \`apps\`.

:::tip[Publier]
Crée les applications officielles via **Admin → Catalogues** ; les communautaires via **Tableau de bord → Proposer du contenu**. Les deux construisent un deeplink \`bmm://\`, donc un bouton « Installer dans BMM » fonctionne tout seul.
:::

## Une entrée — champs obligatoires
| Champ | Valeurs |
|---|---|
| \`id\` | slug unique (tirets) |
| \`title\` | nom affiché |
| \`description\` | 1 à 3 phrases |
| \`category\` | \`game\` · \`utility\` · \`other\` |
| \`price\` | \`free\` · \`freemium\` · \`paid\` |
| \`tags\` | 3 au maximum |
| \`download.url\` | lien direct |
| \`download.file_type\` | \`zip\` · \`exe\` · \`msi\` · \`script\` |

## Champs optionnels
:::note[Intégrité]
\`download.sha256\` est optionnel mais **recommandé** — BMM le vérifie à l'installation. Également : \`version\`, \`requirements\`, \`md_link\`, \`images.thumb\` (16:9 ≥400×225), \`images.extra\`, \`download.size\`.
:::

:::card{title="Référence complète dans la doc" href=/docs/app-catalog icon=book}
Le format de référence, toujours à jour, vit dans la documentation.
:::`,
  },

  'guide-plugin-catalog': {
    title: 'Catalogue de plugins & format .bmmplug',
    excerpt: "Champs du catalogue, contenu du paquet .bmmplug, et comment l'intégrité est vérifiée.",
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Plugins]{color="#7c3aed"}

Une entrée de catalogue de plugin (**obligatoire**) : \`id\`, \`name\`, \`version\`, \`author\`, \`download_url\`. Optionnel : \`game\`, \`description\`, \`official\`, \`tags\`, \`icon_url\`, et un \`sha256\` du \`.bmmplug\`.

## Le paquet .bmmplug (un ZIP)
- \`plugin.json\` — le manifeste (**obligatoire**)
- \`icon.png\` — 40×40 (optionnel)
- \`checksums.json\` — **le sha256 de chaque fichier** du paquet (intégrité)

## L'intégrité
Le \`sha256\` de l'entrée couvre tout le \`.bmmplug\` ; \`checksums.json\` couvre chaque fichier à l'intérieur. BMM vérifie les deux.

:::danger[Confiance]
Si l'une des deux empreintes échoue, le plugin est marqué **invalide** et une fenêtre recommande de **ne pas l'installer**. N'installe que des plugins qui passent la vérification — ceux du catalogue le sont toujours.
:::

:::card{title="Référence complète dans la doc" href=/docs/plugin-catalog icon=book}
Le format .bmmplug en entier, dans la documentation.
:::`,
  },

  'guide-preset-catalog': {
    title: 'Catalogue de presets (BSM)',
    excerpt: "Le format d'un preset BSM, et comment le publier.",
    body: `:badge[Catalogue]{color="#2563eb"} :badge[BSM]{color="#db2777"}

Un preset BSM est un seul JSON : \`name\`, \`version\`, \`assetPaths\` (**obligatoires**) ; \`color\`, \`UpdateNumber\`, \`date\` (optionnels). Ses métadonnées vivent dans le fichier.

:::tip[Publier]
Publie via **Tableau de bord → Proposer du contenu** (Projet **BSM**, Type **Preset**). Sur le catalogue, on peut **télécharger**, **télécharger en multi-sélection**, et trier par *populaire (tout temps / mois)*, *plus récent* ou *plus vu* — chaque téléchargement compte dans les statistiques de celui qui a publié.
:::

:::card{title="Référence complète dans la doc" href=/docs/preset-catalog icon=book}
Le format des presets BSM, dans la documentation.
:::`,
  },

  'guide-theme-catalog': {
    title: 'Catalogue de thèmes (.bmmtheme)',
    excerpt: 'Ce que contient un .bmmtheme, et le chemin le plus court pour en publier un.',
    body: `:badge[Catalogue]{color="#2563eb"} :badge[Thèmes]{color="#d97706"}

Un \`.bmmtheme\` est un ZIP avec \`theme.json\` (**obligatoire**) et un dossier \`assets/\` optionnel. Le manifeste porte \`id\`, \`name\`, \`author\`, \`version\`, une table \`tokens\` de variables CSS \`--bmm-*\`, et des \`overrides\` optionnels par sélecteur.

:::tip[Le chemin le plus court]
Exporte-en un depuis l'**éditeur de thèmes** de l'app — il écrit un \`theme.json\` valide. Publie ensuite via **Tableau de bord → Proposer du contenu** (Projet **BMM**, Type **Thème**). L'installation s'applique instantanément et se défait.
:::

:::card{title="Référence complète dans la doc" href=/docs/theme-catalog icon=book}
Le format du paquet .bmmtheme, dans la documentation.
:::`,
  },
};
