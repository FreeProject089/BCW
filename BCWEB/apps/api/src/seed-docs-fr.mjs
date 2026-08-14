// French for the seeded documentation, keyed by slug.
//
// Kept beside seed-docs.mjs rather than inside it: the English bodies are already long
// enough that interleaving a second language made each page hard to read, and a translation
// is reviewed as a whole — you want to read the French pages in a row, not hunt for them
// between backticks.
//
// The seed treats a missing entry as "English only" rather than failing, so adding a page to
// seed-docs.mjs never breaks the seed; it just shows up untranslated until someone writes it
// here. `titleFr` and `categoryFr` were never written by the seed at all — the columns exist
// (the docs gained French titles in a migration) and nothing populated them, so the sidebar
// and every category heading stayed English for a French reader even on the three pages that
// did have a French body.
export const DOCS_FR = {
  'sso': {
    title: 'Se connecter avec BetterCommunity',
    category: 'Développeurs',
    body: `::toc[Sur cette page]

# Se connecter avec BetterCommunity

Laisse les gens se connecter à **ton** application avec leur compte BetterCommunity. C’est
de l’**OpenID Connect** standard : si ton langage a une bibliothèque OIDC, tu as déjà un
client, et il n’y a aucun SDK maison à installer.

## Enregistrer ton application

Profil → **Se connecter avec BetterCommunity** → *Enregistrer une application*. Tu obtiens
un \`client_id\` et un \`client_secret\` **montré une seule fois** — il n’est stocké que sous
forme de hachage, donc un secret perdu se renouvelle, il ne se retrouve pas.

Deux choses à ne pas rater à l’enregistrement :

- **Les URIs de redirection sont comparées à l’identique.** C’est là qu’est livré le code
  d’autorisation, donc les règles sont strictes : \`https\` uniquement, sauf
  \`http://localhost\` en développement ; pas de \`#fragment\`, pas d’identifiants intégrés,
  pas de joker dans l’hôte. Un refus te dit quelle règle a été touchée.
- **Public ou confidentiel.** Si ton application tourne là où les utilisateurs peuvent lire
  son code (mobile, bureau, site en une page), coche *client public*. Aucun secret n’est
  délivré et **PKCE devient obligatoire** — c’est le bon échange : un secret embarqué dans
  une application n’est pas un secret.

Ton application démarre **non vérifiée**. Elle fonctionne exactement pareil ; ce qui change,
c’est que l’écran de consentement indique qu’elle n’a pas été relue et qui l’a enregistrée.
N’importe qui peut taper n’importe quel nom dans un formulaire, et cet écran existe
précisément pour répondre à « c’est quoi, cette application, vraiment ».

## Découverte

Tout le reste découle d’un seul document :

\`\`\`
GET /.well-known/openid-configuration
\`\`\`

Il annonce les endpoints d’autorisation, de token, userinfo, révocation et fin de session,
l’URL du JWKS et les scopes supportés. Pointe ta bibliothèque dessus plutôt que d’écrire les
chemins en dur.

## Le flux

Code d’autorisation avec PKCE :

\`\`\`
GET /oauth2/authorize
  ?response_type=code
  &client_id=<ton id>
  &redirect_uri=<une que tu as enregistrée>
  &scope=openid profile email
  &state=<aléatoire, vérifié au retour>
  &code_challenge=<S256 de ton verifier>
  &code_challenge_method=S256
\`\`\`

La personne se connecte (ou l’est déjà), voit ce que tu demandes, et revient sur ton URI de
redirection avec \`code\` et \`state\`. Échange-le :

\`\`\`
POST /oauth2/token
  grant_type=authorization_code
  code=<le code>
  redirect_uri=<la même>
  client_id=<ton id>
  code_verifier=<ton verifier>           # clients publics
  client_secret=<ton secret>             # clients confidentiels
\`\`\`

Tu reçois un \`id_token\` (RS256, vérifie-le contre le JWKS), un \`access_token\` et un
\`refresh_token\`.

Trois comportements à attendre, parce qu’ils sont voulus :

- Un code est **à usage unique**. Le rejouer échoue en \`invalid_grant\`.
- Les refresh tokens **tournent** : chaque rafraîchissement en renvoie un nouveau et révoque
  l’ancien. Présenter un refresh token révoqué échoue — c’est la détection de réutilisation,
  et ça veut dire que quelqu’un a une copie de ton jeton.
- \`prompt=none\` n’affiche jamais d’écran. Il répond \`login_required\` ou \`consent_required\`,
  ce qui le rend utilisable dans une iframe cachée.

## Scopes

| Scope | Ce que ça te donne |
|---|---|
| \`openid\` | Obligatoire. L’\`id_token\` et le claim \`sub\`. |
| \`profile\` | \`name\` et \`picture\`. |
| \`email\` | \`email\` et \`email_verified\`. |
| \`items\` | \`GET /oauth2/me/items\` — leurs éléments de catalogue. |
| \`repos\` | \`GET /oauth2/me/repos\` — les Server-Repos qu’ils possèdent. |
| \`pools\` | \`GET /oauth2/me/pools\` — leurs pools de stockage et l’usage. |
| \`catalogs\` | \`GET /oauth2/me/catalogs\` — les catalogues qu’ils possèdent. |
| \`payments\` | \`GET /oauth2/me/payments\` — leurs propres factures. Montants et dates, jamais de données de carte. |
| \`polls\` | \`GET /oauth2/me/polls\` — leurs réponses aux sondages. |

Demande ce que tu utilises. Chaque scope en trop est une ligne de plus sur laquelle
quelqu’un doit se prononcer.

## Types de sujet

Choisi à l’enregistrement et **jamais modifiable** :

- **public** — \`sub\` est l’id utilisateur BetterCommunity, la même valeur pour tous les
  clients.
- **pairwise** — \`sub\` est opaque et propre à ton client : deux clients qui compareraient
  leurs notes ne peuvent pas savoir qu’il s’agit de la même personne.

Impossible d’en changer ensuite : ça ré-identifierait tous tes utilisateurs d’un coup, leurs
comptes seraient orphelins et non migrés.

## Se déconnecter

\`GET /oauth2/logout\` (déconnexion initiée par le client) termine la session BetterCommunity
et revient sur ton \`post_logout_redirect_uri\` s’il est enregistré.

## Pas ça : les clés API

Si ton programme agit en **ton** nom — un script, une synchro, un bot que tu fais tourner —
c’est une [clé API](/docs/api-reference) qu’il te faut. Les clés sont personnelles et
scopées, et elles n’ont besoin du consentement de personne puisqu’elles agissent pour une
seule personne : toi. Le SSO est pour les applications qui agissent au nom des *autres*.

Essaie l’un ou l’autre depuis le [hub développeurs](/dev) : il envoie un vrai appel avec une
vraie clé et te montre la vraie réponse, refus compris.
`,
  },

  // ── Premiers pas ────────────────────────────────────────────────────────────
  'introduction': {
    category: 'Premiers pas',
    title: 'Introduction',
    body: `::toc[Sur cette page]

# Bienvenue dans BetterModsManager

**BetterModsManager (BMM)** est une application de bureau qui installe, organise et met à jour tes mods — avec une API de plugins, un moteur de thèmes, et un lien intégré vers **BetterCommunity**, où les créateurs publient applications, plugins, thèmes et presets.

:::tip[Tu débutes ?]
File directement au :icon[rocket] **[Démarrage rapide](/docs/quick-start)** — tes premiers mods seront gérés en deux minutes.
:::

## Ce que tu peux faire

:::cards
:::card{title="Gérer tes mods" icon=boxes}
Garde chaque mod dans une seule bibliothèque, active-les ou désactive-les, et mets-les à jour depuis une empreinte vérifiée.
:::
:::card{title="Étendre avec des plugins" icon=puzzle}
Installe des plugins communautaires qui ajoutent de vraies fonctionnalités à l'app.
:::
:::card{title="Tout thémer" icon=palette}
Crée et partage des thèmes avec l'éditeur visuel.
:::
:::card{title="Publier & partager" href=/docs/publishing icon=upload}
Propose tes propres applications, plugins, thèmes et presets au catalogue BetterCommunity.
:::
:::

## Les deux moitiés

| | Ce que c'est |
|---|---|
| **BMM** | L'application de bureau que tu fais tourner chez toi. |
| **BetterCommunity** | Le hub web pour découvrir, publier et héberger du contenu. |`,
  },

  'quick-start': {
    category: 'Premiers pas',
    title: 'Démarrage rapide',
    body: `# Démarrage rapide

D'une installation neuve à une bibliothèque gérée, en trois étapes.

## 1 · Installer & lancer

Télécharge BMM, lance l'installeur, ouvre l'app. Au premier démarrage elle prépare ton dossier de bibliothèque — tu pourras le changer plus tard dans les **Paramètres**.

## 2 · Ajouter tes mods

Glisse tes mods dans la **Bibliothèque**, ou installe-les depuis le catalogue. Chaque mod devient une carte que tu peux activer, désactiver ou mettre à jour.

## 3 · Explorer

Une fois la bibliothèque en place, va voir les [plugins](/docs/plugins), les [thèmes](/docs/themes) et le [catalogue](/docs/community).`,
  },

  // ── Utiliser BMM ────────────────────────────────────────────────────────────
  'library-and-mods': {
    category: 'Utiliser BMM',
    title: 'Ta bibliothèque & tes mods',
    body: `::toc[Sur cette page]

# Ta bibliothèque & tes mods

La **Bibliothèque** est le foyer de tous les mods que tu gères.

## Ajouter des mods

- **Glisser-déposer** un fichier ou un dossier de mod sur la Bibliothèque.
- **Installer depuis le catalogue** — parcours [BetterCommunity](/docs/community) et installe en un clic.

## Gérer un mod

Chaque mod est une carte. Depuis elle, tu peux :

- **Activer / désactiver** sans rien supprimer,
- **Mettre à jour** quand une nouvelle version existe (depuis une empreinte vérifiée),
- **Inspecter** ses détails, sa version et sa source.

:::warning[Les mods archivés restent archivés]
Un mod zippé est stocké tel quel en \`.zip\` et extrait dans un cache temporaire à la demande — tu ne perds jamais l'archive d'origine.
:::

## Retrouver quelque chose

La zone de recherche et les filtres d'état, en haut de la Bibliothèque, réduisent instantanément une grosse collection.`,
  },

  'plugins': {
    category: 'Utiliser BMM',
    title: 'Plugins',
    body: `::toc[Sur cette page]

# Plugins

Les plugins étendent BMM avec de vraies nouvelles fonctionnalités — panneaux supplémentaires, intégrations, automatisations, et plus.

## Installer un plugin

Installe un \`.bmmplug\` depuis le catalogue, ou dépose-le dans l'app. Les plugins sont cloisonnés et demandent les permissions dont ils ont besoin dès le départ.

:::tip[Découvrir des plugins]
Parcours la section **Plugins** sur [BetterCommunity](/docs/community) pour voir ce que la communauté a construit.
:::

## Les permissions

Un plugin déclare les capacités qu'il veut (réseau, fichiers, deeplinks…). Tu les approuves avant qu'il ne s'exécute, et tu peux les revoir à tout moment.

:::card{title="Publier ton propre plugin" href=/docs/plugin-catalog icon=upload}
Voir le format de catalogue \`.bmmplug\` pour empaqueter et proposer un plugin.
:::`,
  },

  'themes': {
    category: 'Utiliser BMM',
    title: 'Thèmes & éditeur de thèmes',
    body: `::toc[Sur cette page]

# Thèmes & éditeur de thèmes

BMM est entièrement thémable. Prends un thème fourni, ou dessine le tien dans l'**éditeur visuel**.

## Utiliser un thème

Ouvre **Paramètres → Apparence** et choisis parmi les thèmes fournis (mode clair inclus), ou applique celui que tu as installé depuis le catalogue.

## Créer un thème

L'éditeur expose les **tokens** de design de l'app — couleurs, surfaces, bordures, texte. Ajuste-les en direct et regarde toute l'app suivre.

:::tip
Comme tout passe par des tokens, ton thème s'applique de façon cohérente sur chaque page et chaque composant.
:::

## Partager un thème

Exporte ton thème en \`.bmmtheme\` et propose-le au catalogue pour que d'autres l'installent.

:::card{title="Format du catalogue de thèmes" href=/docs/theme-catalog icon=book}
Empaqueter et publier un \`.bmmtheme\`.
:::`,
  },

  'presets': {
    category: 'Utiliser BMM',
    title: 'Presets (BSM)',
    body: `# Presets (BSM)

Un preset est un ensemble de réglages partageable pour BSM. Installe-en un pour appliquer une configuration éprouvée en quelques secondes, ou exporte la tienne pour la partager.

## Installer un preset

Installe un \`.json\` de preset depuis le catalogue, ou importe directement un fichier.

## Partager un preset

Exporte ta configuration et propose-la au catalogue **Preset**.`,
  },

  // ── BetterCommunity ─────────────────────────────────────────────────────────
  'community': {
    category: 'BetterCommunity',
    title: 'Communauté & blog',
    body: `::toc[Sur cette page]

# BetterCommunity

**BetterCommunity** est le hub web — et une page à l'intérieur même de BMM — où tu découvres du contenu et suis l'actualité.

## Le catalogue

Parcours et installe les **applications, plugins, thèmes et presets** publiés par la communauté. Tout s'installe directement dans BMM.

## Le blog

Les équipes des projets y publient notes de version, guides et annonces. Tu peux les lire sur le web ou dans la page **Blog BetterCommunity** de BMM.

:::tip[Réactions & commentaires]
Les billets acceptent les réactions, et les éditeurs collaborent sur les brouillons avec des fils de commentaires et un historique complet.
:::

## Publier

Envie de partager ton propre travail ?

:::card{title="Publier au catalogue" href=/docs/publishing icon=upload}
Comment proposer applications, plugins, thèmes et presets.
:::`,
  },

  'publishing': {
    category: 'BetterCommunity',
    title: 'Publier au catalogue',
    body: `::toc[Sur cette page]

# Publier au catalogue

Partage ton travail avec tous les utilisateurs de BMM en le proposant au catalogue BetterCommunity.

## Choisis ton type

:::cards
:::card{title="Application" href=/docs/app-catalog icon=boxes}
Une entrée d'application autonome.
:::
:::card{title="Plugin" href=/docs/plugin-catalog icon=puzzle}
Un \`.bmmplug\` qui étend BMM.
:::
:::card{title="Thème" href=/docs/theme-catalog icon=palette}
Un design \`.bmmtheme\`.
:::
:::card{title="Preset" href=/docs/preset-catalog icon=sliders}
Un ensemble de réglages BSM.
:::
:::

## Héberger tes fichiers

Tu peux pointer vers ton propre lien de téléchargement, ou nous laisser héberger le contenu. Pour un dépôt, voir **[Dépôts serveur](/docs/server-repos)**.

:::warning[Chaque proposition est relue]
Les fichiers restent dans une zone temporaire jusqu'à l'approbation d'un modérateur — ils rejoignent alors le catalogue public.
:::`,
  },

  'app-catalog': {
    category: 'BetterCommunity',
    title: "Format du catalogue d'applications",
    body: `::toc[Sur cette page]

# Format du catalogue d'applications

Un catalogue d'applications est un \`catalog.json\` avec un tableau \`apps\`. Chaque entrée décrit une application autonome ; BMM l'installe en un clic.

## L'enveloppe

\`\`\`json
{ "version": "1.0", "name": "Mon catalogue", "description": "…", "apps": [ … ] }
\`\`\`

## Une entrée — champs obligatoires

| Champ | Valeurs |
|---|---|
| \`id\` | Slug unique (tirets). |
| \`title\` | Nom affiché (attention : \`title\`, pas \`name\`). |
| \`description\` | 1 à 3 phrases, affichées sur la carte. |
| \`category\` | \`game\` · \`utility\` · \`other\` |
| \`price\` | \`free\` · \`freemium\` · \`paid\` |
| \`tags\` | 3 au maximum. |
| \`download.url\` | Lien de téléchargement direct. |
| \`download.file_type\` | \`zip\` · \`exe\` · \`msi\` · \`script\` |

## Champs optionnels

\`version\`, \`requirements\`, \`md_link\`, \`images.thumb\` (16:9, ≥400×225) et \`images.extra\`, \`download.size\`.

:::note[Intégrité]
\`download.sha256\` est optionnel mais **recommandé** — BMM le vérifie à l'installation.
:::

:::tip[Ne l'écris pas à la main]
Crée les applications officielles via **Admin → Catalogues**, ou les applications communautaires via **Tableau de bord → Proposer du contenu**. Dans les deux cas BMM construit le \`catalog.json\` et un deeplink \`bmm://\`, donc un bouton « Installer dans BMM » fonctionne tout seul. Héberge le fichier toi-même, ou chez nous.
:::`,
  },

  'plugin-catalog': {
    category: 'BetterCommunity',
    title: 'Catalogue de plugins (.bmmplug)',
    body: `::toc[Sur cette page]

# Catalogue de plugins · \`.bmmplug\`

Deux choses partagent cette page : l'**entrée de catalogue** (ce que liste un flux \`plugins\`) et le **paquet \`.bmmplug\`** (le fichier lui-même). Ce n'est pas la même chose : l'entrée pointe vers le paquet.

## L'entrée de catalogue

Émise dans un tableau \`plugins\`. **Obligatoire :** \`id\`, \`name\`, \`version\`, \`author\`, \`download_url\`. **Optionnel :** \`game\`, \`description\`, \`official\`, \`tags\`, \`icon_url\`, et un \`sha256\` du \`.bmmplug\`.

## Le paquet \`.bmmplug\` (un ZIP)

- \`plugin.json\` — le manifeste (**obligatoire**).
- \`icon.png\` — 40×40 (optionnel).
- \`checksums.json\` — **sha256 de chaque fichier** du paquet.

Le manifeste déclare \`id\`, \`name\`, \`version\`, \`author\`, \`description\`, \`game\`, \`permissions\`, et comment il s'applique (\`scripts\`, \`folders\`, \`apply_mode\`) — plus une \`modlist\` optionnelle.

:::warning[Les permissions sont un ensemble fixe — et elles sont montrées aux utilisateurs]
Un plugin demande des capacités dans l'ensemble réel de l'API (\`mods.write\`, \`profiles.write\`, \`modpacks.write\`, \`plugins.read\`/\`write\`, \`catalog.read\`/\`write\`, \`app.read\`/\`write\`, \`repo.write\`) — **pas** des libellés libres comme « réseau » ou « fichiers ». Ne demande que ce que tu utilises ; l'utilisateur accorde chacune. Voir la [référence de l'API](/docs/api-reference).
:::

:::danger[Les deux empreintes sont vérifiées]
Le \`sha256\` de l'entrée couvre tout le \`.bmmplug\` ; \`checksums.json\` couvre chaque fichier à l'intérieur. Si l'une des deux échoue, BMM marque le plugin **invalide** et déconseille de l'installer. Les plugins du catalogue sont toujours vérifiés.
:::`,
  },

  'theme-catalog': {
    category: 'BetterCommunity',
    title: 'Catalogue de thèmes (.bmmtheme)',
    body: `::toc[Sur cette page]

# Catalogue de thèmes · \`.bmmtheme\`

Comme pour les plugins, il y a une **entrée de catalogue** et le **paquet \`.bmmtheme\`**.

## L'entrée de catalogue

Émise dans un tableau \`themes\` : \`id\`, \`name\`, \`description\`, \`author\`, \`version\`, \`url\` (le téléchargement), \`tags\`.

## Le paquet \`.bmmtheme\` (un ZIP)

- \`theme.json\` — le manifeste (**obligatoire**).
- \`assets/\` — optionnel (images embarquées : logo, fond d'écran, mascotte).

Le manifeste porte \`id\`, \`name\`, \`author\`, \`version\`, une table \`tokens\` de variables CSS \`--bmm-*\`, et des \`overrides\` optionnels par sélecteur.

:::tip[Ne l'écris pas à la main]
Exporte un thème depuis l'**[éditeur de thèmes](/docs/themes)** de l'app — il écrit un \`theme.json\` valide. Publie ensuite via **Tableau de bord → Proposer du contenu** (Projet **BMM**, Type **Thème**). L'installation s'applique instantanément et se défait.
:::`,
  },

  'preset-catalog': {
    category: 'BetterCommunity',
    title: 'Catalogue de presets (BSM)',
    body: `# Catalogue de presets · BSM

Un preset BSM est **un seul fichier JSON** — pas de ZIP, pas de manifeste séparé. Ses métadonnées vivent dans le fichier.

## Les champs

| Champ | Obligatoire | Sens |
|---|---|---|
| \`name\` | oui | Nom du preset. |
| \`version\` | oui | Version sémantique. |
| \`assetPaths\` | oui | Les chemins d'assets que le preset pilote. |
| \`color\` | non | Couleur d'accent. |
| \`UpdateNumber\` | non | Compteur de révision. |
| \`date\` | non | Date de publication. |

:::tip[Publier]
Propose via **Tableau de bord → Proposer du contenu** (Projet **BSM**, Type **Preset**). Sur le catalogue, on peut télécharger, télécharger en multi-sélection, et trier par *populaire (tout temps / mois)*, *plus récent* ou *plus vu* — chaque téléchargement compte dans tes statistiques.
:::

:::card{title="Utiliser les presets" href=/docs/presets icon=sliders}
Installer et exporter des presets dans BMM.
:::`,
  },

  // ── Hébergement ─────────────────────────────────────────────────────────────
  'server-repos': {
    category: 'Hébergement',
    title: 'Dépôts serveur',
    body: `::toc[Sur cette page]

# Dépôts serveur

Héberge un dépôt chez nous pour que les utilisateurs de BMM installent et mettent à jour ton contenu depuis une URL stable.

## Comment ça marche

- Nous faisons tourner le dépôt ; **toi**, tu gères son contenu et ses accès.
- L'hébergement est **prépayé par période** — choisis la taille qu'il te faut. Supprimer un dépôt arrête les renouvellements à venir ; il n'y a aucun abonnement à résilier.
- Tu obtiens une URL gérée automatiquement (\`propriétaire/dépôt\`), ou tu pointes BMM vers ton propre dépôt auto-hébergé.

## Limites & tarifs

Stockage, débit d'envoi et CPU sont fixés par dépôt. La première tranche de stockage est gratuite ; tu ne paies que ce qui dépasse.

:::warning[La suppression a un délai de grâce]
Un dépôt supprimé est conservé **72 heures** avant l'effacement de ses fichiers — tu peux revenir en arrière depuis ton tableau de bord pendant ce délai.
:::

## Gérer les accès

Depuis le tableau de bord du dépôt, tu règles les accès (public / liste blanche), les bannissements et la limite d'envoi — le tout dans le bac à sable.`,
  },

  // ── Rédaction ───────────────────────────────────────────────────────────────
  'documentation-blocks': {
    category: 'Rédaction',
    title: 'Blocs de documentation',
    body: `::toc[Sur cette page]

# Blocs de documentation

Les docs et les billets de blog acceptent des blocs riches par-dessus le Markdown. Voici la boîte à outils.

## Les encadrés

\`\`\`
:::tip[Titre optionnel]
Ton texte ici.
:::
\`\`\`

Types : \`:::note\` · \`:::tip\` · \`:::success\` · \`:::warning\` · \`:::danger\`.

:::success[Résultat]
Ça produit un encadré coloré comme celui-ci.
:::

## Les cartes

\`\`\`
:::cards
:::card{title="Une carte" href=/docs icon=book}
Le texte.
:::
:::
\`\`\`

## Les éléments en ligne

- Touche clavier : \`:kbd[Ctrl+S]\` → :kbd[Ctrl+S]
- Icône : \`:icon[rocket]\` → :icon[rocket]
- Badge : \`:badge[Nouveau]{color="#16a34a"}\` → :badge[Nouveau]{color="#16a34a"}

## Le sommaire

Mets \`::toc[Sur cette page]\` en haut et il construit un résumé depuis tes titres \`##\` / \`###\`, tout seul.

:::tip[Annotations]
Entoure un texte d'un \`<doc-comment data-comment="…">\` pour ajouter une note au survol — parfait pour un terme de glossaire.
:::`,
  },

  // ── Référence ───────────────────────────────────────────────────────────────
  // 'api-reference' already carries its French body inline in seed-docs.mjs.
  'api-reference': {
    category: 'Référence',
    title: "Référence de l'API plugins",
  },
};
