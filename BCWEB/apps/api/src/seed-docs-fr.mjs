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
- Un rafraîchissement peut demander un scope **plus étroit** (RFC 6749 §6) et l’obtient ;
  en demander un plus large est refusé avec \`invalid_scope\`.
- Le compte est revérifié à **chaque** rafraîchissement. S’il a été suspendu, banni ou
  fermé, le rafraîchissement échoue en \`invalid_grant\` et toute la famille de jetons est
  révoquée — une application ne peut pas survivre au compte qui l’a autorisée.
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
    title: 'Catalogue de presets (BSM)',
    category: 'BetterCommunity',
    body: `::toc[Sur cette page]

# Catalogue de presets · BSM

Un preset BSM est **un seul fichier JSON**. Pas de ZIP, pas de manifeste séparé, aucune
arborescence — ses métadonnées vivent dans le fichier, et c'est pour ça qu'un preset se
partage en le collant.

## Un preset entier

Voici un fichier complet et valide. Copie-le, change les noms, et tu as quelque chose de
publiable.

\`\`\`json
{
  "name": "Warm Cabin",
  "version": "1.2.0",
  "color": "#c2410c",
  "UpdateNumber": 4,
  "date": "2026-08-14",
  "assetPaths": {
    "ambience/rain_light": { "gain": -3.5, "pitch": 1.0 },
    "ambience/fire_crackle": { "gain": 2.0, "pitch": 0.96 },
    "ui/click": { "gain": -6.0 }
  }
}
\`\`\`

## Les champs

| Champ | Requis | Ce qu'il fait |
|---|---|---|
| \`name\` | oui | Ce que les gens voient dans le catalogue et dans BSM. |
| \`version\` | oui | Comparée numériquement : \`1.10.0\` est plus récent que \`1.9.0\`. |
| \`assetPaths\` | oui | La carte de ce que le preset change — voir plus bas. |
| \`color\` | non | Couleur d'accent sur la carte du catalogue. Une chaîne hexadécimale. |
| \`UpdateNumber\` | non | Ton propre compteur de révision, affiché à côté de la version. |
| \`date\` | non | Date de publication, \`AAAA-MM-JJ\`. |

:::warning[assetPaths, c'est le preset]
Tout le reste est de l'étiquetage. Un \`assetPaths\` vide se publie très bien et ne change rien
une fois installé — c'est la panne que personne ne signale, parce qu'elle a l'air d'avoir
marché.
:::

## Ce qui va dans assetPaths

Les clés sont des chemins d'assets tels que BSM les connaît ; les valeurs disent quoi en faire.

| Clé | Type | Sens |
|---|---|---|
| \`gain\` | nombre | Changement de volume en dB. Négatif = plus discret. |
| \`pitch\` | nombre | Vitesse de lecture. \`1.0\` = inchangé. |
| \`mute\` | booléen | Le fait taire, quoi que dise le gain. |

\`\`\`json
"assetPaths": {
  "weather/thunder_far": { "gain": -12.0 },
  "weather/thunder_near": { "mute": true }
}
\`\`\`

## Le publier

::::steps[D'un fichier à une fiche]{type=1}
:::step[Exporte-le depuis BSM]
Ton preset est déjà un fichier — BSM l'écrit. Ouvre-le dans un éditeur de texte si tu veux
vérifier le nom et la version avant qu'il parte.
:::
:::step[Soumets-le]
**Tableau de bord → Proposer du contenu**, projet **BSM**, type **Preset**. Joins le \`.json\`.
:::
:::step[Attends un humain]
Chaque soumission est relue. Tu reçois une notification dans les deux cas, et un refus dit
pourquoi.
:::
:::step[Regarde les chiffres]
Téléchargements et vues arrivent sur ton tableau de bord. Le tri du catalogue se fait par
populaire (tout temps ou mois), récent, ou le plus vu — donc un preset sur lequel les gens
reviennent continue de remonter.
:::
::::

:::card{title="Utiliser les presets dans BMM" href=/docs/presets icon=sliders}
Installer, exporter, passer de l'un à l'autre.
:::
`,
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
  'sandbox': {
    title: 'Essayer l’API sans rien casser',
    category: 'Développeurs',
    body: `::toc[Sur cette page]

# Essayer l’API sans rien casser

Toute écriture de l’API publique peut être lancée en **répétition** : authentifiée pour de
vrai, scope vérifié pour de vrai, puis rien n’est écrit. Le but : apprendre l’API ne doit
jamais te coûter tes propres données.

## La console

**/dev → Tester un appel.** Choisis un endpoint, colle une clé, envoie. Tu reçois le vrai
code de statut et le vrai corps de réponse — refus compris, qui sont la moitié intéressante.

Le bac à sable est **actif par défaut pour les écritures** et ne peut pas être activé pour
les lectures (voir plus bas). Ta clé reste dans le navigateur ; elle part vers l’API et
nulle part ailleurs.

## À la main

Un seul en-tête :

\`\`\`
X-BCW-Sandbox: 1
\`\`\`

Un appel simulé répond \`200\` avec un corps qui dit ce qu’il aurait fait :

\`\`\`json
{
  "sandbox": true,
  "method": "PATCH",
  "path": "/v1/account",
  "scope": "account:write",
  "note": "Sandbox: authentication and scope were checked, and nothing was written."
}
\`\`\`

## Ce qui reste réel

Tout, sauf l’écriture :

| Vérifié | Toujours actif en bac à sable |
|---|---|
| La clé est-elle réelle, non révoquée, non expirée ? | Oui — une mauvaise clé reçoit \`401 invalid_key\` |
| Porte-t-elle le scope ? | Oui — \`403 insufficient_scope\`, en nommant ce qui manque |
| Le compte est-il suspendu ou banni ? | Oui — \`403\`, avec \`status\` |
| Limites de débit | Oui |
| Enregistré dans la vue d’usage du propriétaire | Oui, en tant qu’appel bac à sable |

:::tip[Pourquoi les contrôles restent]
Une console qui les sauterait t’apprendrait une API qui n’existe pas : tu écrirais ton
intégration contre une fiction permissive et découvrirais les vraies règles en production.
:::

## Ce qu’il ne fera pas

- **Un \`GET\` n’est jamais simulé.** Une lecture ne change rien par définition : il n’y a
  rien à répéter, et te répondre avec des données inventées rendrait la console pire
  qu’inutile pour ce à quoi elle sert. L’en-tête est ignoré sur les lectures.
- **Ça ne compte pas comme usage.** Les appels bac à sable sont comptés à part du trafic
  réel : explorer ne gonfle jamais les chiffres de tes clés.

## Lire un refus

| Corps | Ce qui ne va pas |
|---|---|
| \`{"error":"unauthenticated"}\` | Pas d’en-tête \`Authorization: Bearer <clé>\` |
| \`{"error":"invalid_key"}\` | Inconnue, révoquée ou expirée — une seule réponse pour les trois, volontairement |
| \`{"error":"insufficient_scope","required":"…","granted":[…]}\` | La clé est bonne, le scope manque |
| \`{"error":"account_suspended"}\` | Le compte derrière la clé est sous sanction |

:::warning[Un 403 est un résultat, pas un échec]
Si le bac à sable te refuse pour un scope manquant, c’est la réponse : ton intégration
aurait été refusée aussi. Ajoute le scope à la clé plutôt que de le contourner.
:::
`,
  },
  'storage-pools': {
    title: 'Pools de stockage',
    category: 'Hébergement',
    body: `::toc[Sur cette page]

# Pools de stockage

L’hébergement s’achète sous forme de **pool d’espace**, pas de dépôt. Tu achètes l’espace
d’abord et tu décides ensuite de ce que tu y mets : des dépôts serveur, des éléments de
catalogue, ou rien pour l’instant.

## Pourquoi un pool et pas un dépôt

Parce qu’un dépôt est une décision qu’on doit pouvoir changer. Un pool peut contenir
plusieurs dépôts et plusieurs catalogues à la fois, ils se partagent son espace, et déplacer
du contenu entre eux ne coûte rien. Un achat soudé à un seul dépôt t’obligeait à racheter le
jour où tu en voulais un deuxième.

:::tip[Rien n’est réservé]
Un nouveau pool démarre vide. Sa totalité est disponible pour ce que tu y mets en premier.
:::

## Ce qui consomme l’espace

Tout ce qui est stocké : les fichiers de chaque dépôt, et le contenu de chaque élément de
catalogue hébergé dans le pool. Le chiffre affiché est **recalculé** à partir du contenu, pas
accumulé — supprimer quelque chose rend donc l’espace immédiatement, sans comptabilité à
attendre.

## Quand un terme se termine

Un abonnement a un terme. Avant qu’il n’arrive à échéance tu reçois **un avertissement** —
un par terme, pas un rappel quotidien.

S’il se termine sans renouvellement :

1. L’abonnement passe en expiré et le pool rétrécit de la part de cet abonnement.
2. Tout ce qui dépasse l’espace restant est **suspendu** : les dépôts cessent de servir, les
   éléments de catalogue cessent d’être listés.
3. Une fenêtre de grâce de **72 heures** s’ouvre avant toute suppression.

Renouveler dans la fenêtre restaure tous les dépôts et catalogues du pool et efface
l’avertissement — le contenu était suspendu, jamais jeté.

:::warning[Un pool à plusieurs abonnements rétrécit, il ne s’arrête pas]
Si un pool est alimenté par plusieurs abonnements et qu’un seul se termine, le pool perd
simplement la part de cet abonnement et garde en ligne tout ce qui tient encore. Seul le
contenu qui ne rentre plus est suspendu.
:::

## L’offre gratuite

Chaque compte peut réclamer un dépôt gratuit et un élément de catalogue gratuit. La
réclamation est mémorisée par compte : délier puis relier n’en redonne pas un deuxième.

## Propriété

Un pool appartient à un compte. Transférer un dépôt à quelqu’un d’autre le sort de ton pool
pour le mettre dans le sien — l’espace suit le contenu, et les deux pools sont recalculés.
`,
  },
  'blog-posts': {
    title: 'Écrire un article de blog',
    category: 'Rédaction',
    body: `::toc[Sur cette page]

# Écrire un article de blog

L’éditeur de blog accepte les mêmes blocs que la documentation — encadrés, cartes, touches
clavier, badges, sommaire. Si tu as écrit une page de doc, tu connais déjà la syntaxe : voir
**Blocs de documentation**. Ce qui suit, c’est ce qu’un article a en plus.

## Les morceaux d’un article

| Champ | À quoi il sert |
|---|---|
| Titre & accroche | L’accroche est le texte de la carte dans les listes. Écris-la : un premier paragraphe tronqué se lit comme une erreur. |
| Couverture | Affichée sur la carte, et en haut de l’article sauf si tu le désactives — utile quand ton premier bloc est déjà une image. |
| Corps | Du Markdown, plus la boîte à outils de blocs. |

## Les deux langues

Titre, accroche et corps ont chacun leur version française. Un corps français manquant
retombe silencieusement sur l’anglais — le lecteur ne voit aucun avertissement, donc un
article non traduit a l’air terminé. Remplis les deux, ou accepte que la moitié de tes
lecteurs reçoive l’autre langue.

## Co-auteurs

Un article a un auteur et autant de **co-auteurs** que nécessaire. Ils sont crédités sur
l’article et peuvent le modifier. Ajoute-les avant publication : un crédit ajouté après coup
est un crédit que personne n’a vu.

## Réactions

Les réactions sont **désactivées par défaut**. Active-les et choisis jusqu’à trois emoji —
une réaction par lecteur et par article. Trois est une limite voulue : un mur d’emoji ne
mesure rien.

## Publier

Un article est un brouillon tant qu’il n’a pas de date de publication. Publier fait deux
choses au-delà de le rendre visible :

- Cela peut **annoncer l’article à la newsletter**, une seule fois. Un article déjà annoncé
  ne l’est jamais deux fois : modifier puis republier ne renvoie pas de mail à tes abonnés.
- Cela démarre l’**historique des modifications**. Chaque enregistrement suivant est
  conservé, dans la limite de rétention fixée par les administrateurs, et tu peux comparer
  ou restaurer n’importe lequel.

:::warning[Une annonce ne se rattrape pas]
Il n’y a pas d’annulation d’envoi. Vérifie l’accroche et la version française avant de
publier, parce que c’est ce texte-là qui part.
:::

## Où apparaît un article

Un article peut être rattaché à un projet ou à un projet vitrine, ce qui décide de l’endroit
où il est listé. Les actualités de la page d’accueil sont un réglage séparé : être publié ne
met pas un article en une s’il n’a rien à y faire.
`,
  },
  'webhooks': {
    title: 'Webhooks',
    category: 'Développeurs',
    body: `::toc[Sur cette page]

# Webhooks

Arrête de demander. Enregistre une adresse et on l'appelle quand il arrive quelque chose à ce
qui t'appartient.

## Pourquoi plutôt que du polling

Une intégration sans webhooks interroge \`/v1/catalogs\` toutes les minutes au cas où un élément
aurait été publié. C'est du gâchis des deux côtés et toujours en retard d'une minute. Un
webhook, c'est la même information, au moment où elle devient vraie.

## En mettre un en place

::::steps[De rien à une livraison]{type=1}
:::step[Ajoute l'endpoint]
**/dev/config → Webhooks → Ajouter.** L'URL doit être en \`https\` (localhost est accepté
pendant le développement). Ne coche que les événements sur lesquels tu vas agir.
:::
:::step[Garde la clé de signature]
Elle est affichée une seule fois, comme une clé API. On la conserve pour signer ; on ne peut
pas te la remontrer. Une clé perdue se renouvelle, jamais ne se récupère.
:::
:::step[Vérifie ce qui arrive]
Chaque livraison porte \`X-BCW-Signature: v1=…\`, \`X-BCW-Timestamp\` et \`X-BCW-Event\`. Calcule
un HMAC-SHA256 sur \`timestamp + "." + corps\` avec ta clé, et compare.

:::danger[Vérifie aussi l'horodatage]
Une signature seule permet à quiconque a vu une livraison de te la rejouer indéfiniment.
Rejette tout \`X-BCW-Timestamp\` vieux de plus de quelques minutes.
:::
:::
:::step[Réponds 2xx, vite]
Tout le reste compte comme un échec. Dix secondes au maximum — mets le vrai travail en file et
réponds. Un récepteur qui traite en ligne est un récepteur qui expire sous la charge.
:::
::::

## Vérifier, en code

\`\`\`javascript
import crypto from 'node:crypto';

export function verify(req, rawBody, secret) {
  const ts = req.headers['x-bcw-timestamp'];
  const sig = String(req.headers['x-bcw-signature'] || '').replace(/^v1=/, '');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // fenêtre anti-rejeu
  const mine = crypto.createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  // Temps constant : un === normal livre la réponse un caractère à la fois.
  return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}
\`\`\`

:::warning[Signe le corps BRUT]
Pas l'objet parsé puis re-sérialisé. L'ordre des clés et les espaces changent, la signature ne
correspond plus, et la cause est invisible.
:::

## Ce qu'on envoie

\`\`\`json
{
  "event": "catalog.item.published",
  "at": "2026-08-14T09:12:44.019Z",
  "data": { "id": "cl…", "slug": "warm-cabin", "name": "Warm Cabin", "kind": "preset" }
}
\`\`\`

Les événements de téléchargement portent un \`count\` : ils sont fusionnés en une livraison par
sujet et par minute, parce qu'un webhook par téléchargement sur un élément populaire serait un
déni de service qu'on infligerait à ton serveur.

## Quand ça se passe mal

- **Les tentatives** s'espacent d'une minute à dix heures, sur six essais.
- **Vingt échecs d'affilée** désactivent l'endpoint et te préviennent. Répare le récepteur,
  réactive-le — le compteur repart de zéro, donc une mauvaise livraison ensuite ne le
  redésactive pas.
- **Une URL refusée** (adresse privée, mauvais schéma) n'est pas réessayée du tout. Elle serait
  refusée à l'identique à chaque fois.
- **Chaque tentative est conservée 30 jours**, avec le contenu et la réponse, et chacune peut
  être rejouée — le même contenu, ce qui est exactement l'intérêt après avoir réparé un
  récepteur qui était tombé.

:::card{title="En configurer un" href=/dev/config icon=webhook}
Endpoints, clés et journal de livraison.
:::
`,
  },
};
