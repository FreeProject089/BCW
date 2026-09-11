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
  'catalog-index': {
    title: 'Index de catalogues',
    category: 'BetterCommunity',
    body: `::toc[Sur cette page]

# Index de catalogues

Un catalogue liste des choses à installer. Un **index** liste des catalogues.

Sans lui, vous suivre oblige quelqu'un à récupérer une URL pour vos applis, une autre pour
vos plugins, une autre pour vos thèmes, et à coller chacune dans un écran différent de BMM.
Un index est une seule adresse qui les amène toutes — et qui continue de marcher quand vous
en publiez une nouvelle.

## Ce que nous publions

Un seul générateur, plusieurs adresses. \`scope\`, \`app\` et \`type\` se combinent.

\`\`\`
/api/catalogs.json                     tout
/api/catalogs.json?scope=official      seulement les nôtres
/api/catalogs.json?scope=community     seulement ceux publiés par des gens
/api/catalogs.json?app=bmm             seulement pour BMM
/api/catalogs.json?type=plugin         seulement les catalogues de plugins
\`\`\`

:::note
Un flux n'est listé que si quelque chose y est réellement publié. Une entrée d'index menant
à un document vide apprend aux gens à ne plus faire confiance à l'index.
:::

## Dire pour quelle app est le vôtre

Un catalogue que vous publiez ici peut indiquer pour quel produit Better\\* il est, sur sa
carte dans **Tableau de bord → Catalogues**. Cela compte plus qu'il n'y paraît :

- BMM garde une entrée marquée \`bmm\` et écarte une entrée marquée \`bsm\`.
- Une entrée marquée **de rien** est gardée par tout le monde. « Personne ne l'a dit » n'est
  pas « pas pour vous », et tout catalogue publié avant l'existence de ce champ est dans cet
  état.

Ne rien mettre est donc sans risque ; mettre la mauvaise valeur ne l'est pas — un catalogue
étiqueté pour le mauvais produit est invisible pour ceux à qui il était destiné.

## Publier votre propre index

Servez du JSON à une adresse https stable. Ni compte ni inscription : un index se reconnaît
à sa forme, pas à qui l'héberge.

\`\`\`json
{
  "version": "1.0",
  "kind": "catalog-index",
  "name": "Mes catalogues communautaires",
  "catalogs": [
    { "type": "plugin", "app": "bmm", "name": "Nos plugins", "url": "https://example.com/plugins.json" }
  ]
}
\`\`\`

Seul \`catalogs\` est obligatoire, et à l'intérieur seuls \`type\` et \`url\`.

:::warning
\`official\` est **ignoré** partout où il apparaît. Un client décide de la confiance d'après
l'adresse depuis laquelle un catalogue a été récupéré, jamais d'après ce que le catalogue
dit de lui-même — un index capable d'accorder ce badge serait un contournement de la règle,
pas une partie d'elle.
:::
`,
  },

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
- \`bmm_signature.json\` — la signature, quand c'est BMM qui a écrit le paquet (optionnel).

Le manifeste déclare \`id\`, \`name\`, \`version\`, \`author\`, \`description\`, \`game\`, \`permissions\`, et comment il s'applique (\`scripts\`, \`folders\`, \`apply_mode\`) — plus une \`modlist\` optionnelle.

:::warning[Les permissions sont un ensemble fixe — et elles sont montrées aux utilisateurs]
Un plugin demande des capacités dans l'ensemble réel de l'API (\`mods.write\`, \`profiles.write\`, \`modpacks.write\`, \`plugins.read\`/\`write\`, \`catalog.read\`/\`write\`, \`app.read\`/\`write\`, \`repo.write\`) — **pas** des libellés libres comme « réseau » ou « fichiers ». Ne demande que ce que tu utilises ; l'utilisateur accorde chacune. Voir la [référence de l'API](/docs/api-reference).
:::

:::danger[Les deux empreintes sont vérifiées]
Le \`sha256\` de l'entrée couvre tout le \`.bmmplug\` ; \`checksums.json\` couvre chaque fichier à l'intérieur. Si l'une des deux échoue, BMM marque le plugin **invalide** et déconseille de l'installer. Les plugins du catalogue sont toujours vérifiés.
:::

## Signatures

\`checksums.json\` répond à « ce paquet est-il cohérent avec lui-même ». Il ne peut pas répondre
à « est-ce que ça vient bien de la personne qui prétend l'avoir fait » — n'importe qui
repaquetant un plugin le recalcule.

Un paquet écrit par BMM porte donc une entrée de plus, \`bmm_signature.json\` : une signature
ed25519 sur une liste de **chaque autre fichier et de son SHA-256**. Vérifier, c'est deux
questions, et les deux doivent passer — la signature vérifie-t-elle la liste, et chaque
fichier a-t-il bien l'empreinte que la liste annonce. C'est cette deuxième moitié qui compte :
ne signer que le manifeste dirait « ce plugin est intact » alors que chaque script à côté du
manifeste aurait pu être échangé.

N'importe qui peut en vérifier un sans l'installer, via **Inspecter un fichier BMM** — la
vérification tourne dans le navigateur et le fichier n'est jamais envoyé.

:::warning[Non signé ne veut pas dire invalide]
Un paquet sans \`bmm_signature.json\` se lit comme **non signé**, pas comme cassé. Tout ce qui a
été publié avant l'existence des signatures est non signé, et un paquet construit par un autre
outil que BMM le sera aussi. Et \`author_id\` est une **clé publique, pas une identité** — ça dit
que deux fichiers viennent de la même installation, pas que leur auteur est digne de
confiance. C'est pour ça que l'id est affiché à côté du verdict plutôt que transformé en nom.
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
- \`fonts/\` — optionnel (les fichiers de police que le manifeste référence).

À l'import, BMM copie **ces trois chemins et rien d'autre**. Un \`LICENSE\` ou une capture
d'écran à la racine de l'archive est abandonné sans erreur : ce qui doit survivre à
l'installation se met sous \`assets/\`.

## Le manifeste

\`id\`, \`name\`, \`author\`, \`version\`, \`mode\` (\`dark\` ou \`light\`), et une table
**\`vars\`** de propriétés personnalisées \`--bmm-*\`. Optionnels : \`fonts\`, \`assets\`,
\`global_css\`, \`pages\` (CSS par vue), \`element_overrides\` (propriétés par sélecteur) et
\`html_swaps\`.

:::warning[La table s'appelle \`vars\`, et \`id\` est un nom de dossier]
Un manifeste qui l'écrit \`tokens\` se charge sans se plaindre et ne change rien — elle est lue
par son nom.

Et \`id\` est l'endroit où le thème est installé sur le disque. Deux thèmes qui partagent le
même s'écrasent l'un l'autre sur la machine d'un inconnu, sans détection de collision ni
avertissement. Préfixez-le : \`votrenom-minuit\`, pas \`dark\`.
:::

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

Voici un fichier complet et valide — vérifié contre le schéma qui accepte les envois.
Copie-le, change les noms, et tu as quelque chose de publiable.

\`\`\`json
{
  "name": "Warm Cabin",
  "version": "1.2.0",
  "color": "#c2410c",
  "UpdateNumber": 4,
  "date": "2026-08-14",
  "assetPaths": [
    "ambience/rain_light",
    "ambience/fire_crackle",
    "ui/click"
  ]
}
\`\`\`

## Les champs

| Champ | Requis | Ce qu'il fait |
|---|---|---|
| \`name\` | oui | Ce que les gens voient dans le catalogue et dans BSM. 1 à 120 caractères. |
| \`version\` | oui | Jusqu'à 24 caractères. Comparée numériquement : \`1.10.0\` est plus récent que \`1.9.0\`. |
| \`assetPaths\` | oui | La liste des assets que le preset pilote — voir plus bas. |
| \`color\` | non | Couleur d'accent. 3 à 8 caractères hexadécimaux ; le \`#\` est facultatif. |
| \`UpdateNumber\` | non | Un nombre. Ton propre compteur de révision, affiché à côté de la version. |
| \`date\` | non | Texte libre, jusqu'à 40 caractères. \`AAAA-MM-JJ\` est la convention. |

:::tip[Les clés en plus sont conservées]
Le validateur laisse passer tout ce qu'il ne reconnaît pas, donc un champ que BSM ajoutera
plus tard ne rendra pas tes presets existants invalides. Ne compte pas sur nous pour lui
donner un sens, cela dit — seuls les champs ci-dessus sont lus ici.
:::

## Ce qui va dans assetPaths

**Un tableau de chaînes.** Chacune est un chemin d'asset tel que BSM le connaît — jusqu'à 300
caractères, jusqu'à 10 000 entrées. C'est la liste de ce que le preset touche, pas une carte
de réglages : les valeurs vivent dans BSM, ce fichier nomme les cibles.

\`\`\`json
"assetPaths": [
  "weather/thunder_far",
  "weather/thunder_near"
]
\`\`\`

:::warning[assetPaths, c'est le preset]
Tout le reste est de l'étiquetage. Un tableau vide se publie très bien et ne pilote rien une
fois installé — c'est la panne que personne ne signale, parce qu'elle a l'air d'avoir marché.
:::

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

Depuis le tableau de bord du dépôt, tu règles les accès (public / liste blanche), les bannissements et la limite d'envoi — le tout dans le bac à sable.

## Verrouiller un dépôt par clé

Un **mot de passe de téléchargement** est un secret partagé : quiconque l'a peut synchroniser, et quiconque l'a peut le transmettre. C'est ce qu'on veut pour un groupe, et le problème quand on veut n'admettre qu'une seule machine.

Une **clé publique** ne circule pas ainsi. Colle la moitié publique dans **Accès → Clés autorisées** du tableau de bord ; le client doit détenir la moitié privée et *signer* à chaque requête. Rien de ce qui passe sur le réseau ne peut être rejoué ailleurs, et révoquer un accès revient à supprimer une ligne.

:::warning[La première clé verrouille le dépôt pour tout le monde]
Sans aucune clé listée, la vérification ne s'applique pas. Dès qu'une clé est listée, elle devient une condition sur **chaque** requête — ajoute donc ta propre clé avant celle des autres, sinon tu te fermes la porte de ton propre dépôt.
:::

Acceptés : **ed25519, RSA et ECDSA** (nistp256/384/521), au format OpenSSH sur une ligne, celui que contient déjà ton fichier \`.pub\` — \`ssh-ed25519 AAAAC3… toi@machine\`. DSA n'est pas pris en charge : OpenSSH l'a retiré. Une ligne illisible est refusée au moment où tu la colles plutôt qu'enregistrée, car une clé que rien ne peut vérifier serait une exigence que rien ne pourrait jamais satisfaire.

Attention, il s'agit bien de la moitié **publique**. Ne colle jamais une clé privée ici.

## Ce que le client envoie

Pas la clé — une attestation signée à durée de vie courte, dans l'en-tête \`X-BMM-Key-Proof\` :

\`\`\`
X-BMM-Key-Proof: bmmk2.<charge>.<signature>
\`\`\`

La charge nomme le destinataire (ce serveur) : une preuve capturée ici ne peut pas être rejouée contre un autre. Côté BMM, la moitié privée se configure une fois dans **Paramètres → Identité & API → Clés d'identité** ; seul le chemin est conservé, et le fichier est lu au moment de signer.

Une requête sans preuve face à un dépôt verrouillé répond **401**, pas 403 — le client peut y faire quelque chose, et BMM lit un 401 comme « il y a un identifiant à fournir ».`,
  },

  // ── Rédaction ───────────────────────────────────────────────────────────────
  'landing-pages': {
    category: 'Rédaction',
    title: 'Construire une page d\u2019accueil',
    body: `::toc[Sur cette page]

# Construire une page d'accueil

\`/\` et \`/dev\` peuvent être arrangées bloc par bloc au lieu d'être choisies parmi trois mises
en page intégrées. **Admin → Navigation & pied de page → Constructeur de pages.**

Une page construite remplace entièrement la page intégrée. Tant que tu ne l'actives pas, rien
ne change — et l'activation est refusée si la page ne contient aucun bloc : une mise en page à
moitié faite ne peut pas devenir la page d'accueil par accident.

## De quoi une page est faite

:::columns
:::column
**Mise en page** — \`section\`, \`row\`, \`col\`. Une ligne est une flex-box qui passe à la ligne ;
donne-lui un nombre de colonnes et elle devient une vraie grille.
:::
:::column
**Contenu** — titres, textes, boutons, images, séparateurs, espaces et chiffres en direct.
:::
:::column
**Sections dynamiques** — les blocs que les pages d'accueil dessinent déjà : la vitrine, les
produits, les news, le sondage ouvert, les avis, les commandes et les tuiles développeur.
:::
:::

:::tip[Un seul bloc fait l'essentiel du travail]
Un bloc **texte** contient du markdown BetterCommunity ordinaire : encadrés, cartes, onglets,
colonnes, boutons, code et mathématiques y sont donc disponibles sans que le constructeur
sache ce qu'ils sont. Si tu cherches un bloc et ne le trouves pas, écris-le dans un bloc texte.
:::

## Des chiffres réels

Écris \`{{members}}\` dans n'importe quel bloc titre ou texte et le compte réel s'affiche. Le
panneau de droite liste chaque nom avec sa valeur actuelle à côté : tu vois ce que tu
t'apprêtes à publier.

\`members\` · \`items\` · \`downloads\` · \`repos\` · \`catalogs\` · \`posts\` · \`projects\` · \`apps\` ·
\`plugins\` · \`themes\` · \`presets\`

Un bloc **stat** est le même chiffre dessiné en tuile avec un libellé et une icône. Un nom
absent de cette liste ne rend rien plutôt que \`{{typo}}\` — un visiteur ne voit jamais le
gabarit qui a échoué.

## Ordinateur et téléphone

Deux mises en page, et celle du téléphone **hérite** par défaut : elle dessine l'arbre
ordinateur, reflué. Ce n'est pas la même chose qu'être vide, et c'est pourquoi l'onglet
téléphone le dit au lieu de recopier tes blocs en silence.

:::warning[Ne lui donne sa propre mise en page que si tu le veux vraiment]
Dès que tu appuies sur **Lui donner sa propre mise en page**, les deux cessent de se suivre.
Une modification de la page ordinateur n'atteindra plus le téléphone, et rien ne te dira
laquelle.

La plupart des pages veulent l'héritage plus deux ou trois blocs masqués. Sélectionne un bloc
et utilise **Affiché sur** — un bloc masqué sur une mise en page est grisé et hachuré dans
l'éditeur plutôt que retiré : il reste sélectionnable.
:::

## L'orbe

Chaque page décide si l'orbe de fond y est dessinée : **selon la préférence du visiteur**, ou
**masquée sur cette page**. Il n'existe volontairement aucune option qui la rallume pour
quelqu'un qui l'a coupée — il l'a fait pour une raison, et une page d'accueil n'en est pas une
assez bonne pour passer outre.

## Composants, export et import

Sélectionne un bloc puis **Enregistrer la sélection** pour le garder en composant nommé. Il
apparaît dans la palette et se dépose dans n'importe quelle page, avec de nouveaux
identifiants à chaque fois : deux copies d'un en-tête sont deux en-têtes, pas un seul qui
bouge deux fois.

**Exporter la page** écrit la page courante en JSON ; **Importer une page** la relit. Les
identifiants sont régénérés à l'entrée : importer une page exportée depuis ce même site ne
peut pas entrer en collision avec ce qui s'y trouve déjà.

:::note[Rien n'est en ligne avant d'enregistrer]
Le canevas est le vrai moteur de rendu avec les vraies données : ce que tu regardes est ce que
les visiteurs auront. Cela reste néanmoins dans ton navigateur jusqu'à **Enregistrer**.
:::
`,
  },

  'documentation-blocks': {
    category: 'Rédaction',
    title: 'Blocs de documentation',
    body: `::toc[Sur cette page]

# Blocs de documentation

Les docs et les billets de blog acceptent des blocs riches par-dessus le Markdown. Voici toute la
boîte à outils — chaque bloc est montré deux fois : la source, puis le rendu.

:::note[Écris tout avec trois deux-points]
Y compris les blocs dans les blocs. Le rendu s'occupe de l'imbrication tout seul.

Laisse une ligne vide avant une directive — \`:::note\` collé sous un paragraphe est lu comme
faisant partie de ce paragraphe — et ferme toujours ce que tu ouvres.
:::

## Les encadrés

\`\`\`
:::tip[Titre optionnel]
Ton texte ici.
:::
\`\`\`

Types : \`:::note\` · \`:::tip\` · \`:::success\` · \`:::warning\` · \`:::danger\`. Chacun a des synonymes
pour que tu écrives le mot que tu penses — \`info\` = note, \`hint\` = tip, \`check\` = success,
\`caution\` et \`important\` = warning, \`error\` = danger.

:::success[Résultat]
Ça produit un encadré coloré comme celui-ci.
:::

\`:::callout[Titre]{icon=rocket color=#c2410c}\` choisit son icône (un nom
[lucide](https://lucide.dev)) et sa couleur — \`:::custom\` est le même bloc, sous le nom
qu'emploie le menu Blocs de l'éditeur.

## Les étapes

\`\`\`
:::steps
:::step[Installer]
Télécharge et lance l'installeur.
:::
:::step[Se connecter]
Utilise ton compte BetterCommunity.
:::
:::
\`\`\`

:::steps
:::step[Installer]
Télécharge et lance l'installeur.
:::
:::step[Se connecter]
Utilise ton compte BetterCommunity.
:::
:::

La numérotation est automatique — ne numérote pas les titres toi-même. Sur \`:::steps\` : \`type\`
choisit l'alphabet (\`1\` · \`a\` · \`i\` · \`dot\`), \`start\` décale le compteur,
\`orientation=horizontal\` les met en ligne, \`color\` peint les pastilles. Sur une \`:::step\` :
\`icon\`, \`color\`, \`status=done\`.

## La feuille de route

Écris les étapes directement dedans — pas de JSON à taper :

\`\`\`
:::roadmap[Où on en est]
:::stage[Livré]{state=done}
- Questions en grille
- Vérificateur de recette
:::
:::stage[En cours]{state=doing percent=40}
- Feuilles de route dans le blog
:::
:::
\`\`\`

:::roadmap[Où on en est]
:::stage[Livré]{state=done}
- Questions en grille
- Vérificateur de recette
:::
:::stage[En cours]{state=doing percent=40}
- Feuilles de route dans le blog
:::
:::stage[Prévu]{state=planned}
- Parité MCP
:::
:::

Chaque puce sous une étape devient une ligne suivie et hérite de l'état de l'étape. \`state=\` vaut
\`done\`, \`doing\` ou \`planned\` ; \`percent=\` remplit la barre d'une étape en cours ; \`eta=\` ajoute
une date. Pour des pourcentages par ligne ou des libellés bilingues, mets un bloc de code \`json\`
dans la feuille de route ; pour des chiffres hébergés ailleurs, utilise
\`:::roadmap{src="https://…/progress.json"}\`.

## Les cartes

\`\`\`
:::cards
:::card{title="Une carte" href=/docs icon=book}
Le texte.
:::
:::
\`\`\`

Attributs : \`title\`, \`href\`, \`image\`, \`video\`, \`icon\`, \`color\`.

\`:ref[libellé]{href=…}\` est une carte servant de renvoi : le même bloc, dimensionné pour
une ligne de texte plutôt que pour une grille.

## Les colonnes

\`\`\`
:::columns
:::column
À gauche.
:::
:::column
À droite.
:::
:::
\`\`\`

Elles s'empilent sur un écran étroit : n'écris donc jamais « le tableau à gauche » dans le texte.
\`:::row\` et \`:::col\` sont les deux mêmes blocs sous des noms plus courts.
\`:::center\`, \`:::left\` et \`:::right\` alignent un bloc.

## Le bloc repliable

\`\`\`
:::details[Voir la sortie complète]
Caché jusqu'au clic.
:::
\`\`\`

:::details[Voir la sortie complète]
Caché jusqu'au clic.
:::

\`:::collapse[…]\` est le même bloc.

## Le lien de téléchargement

\`\`\`
:::file{href=/api/assets/setup.exe name="BMM Setup" size="42 Mo"}
:::
\`\`\`

Affiche une ligne de fichier avec les boutons Télécharger et Ouvrir. Sans \`icon\`, l'icône vient
de l'extension.

## Le replay de session

\`\`\`
:::replay{src="/api/assets/demo.bmmreplay" title="Installer un plugin"}
:::
\`\`\`

Joue un enregistrement \`.bmmreplay\` dans la page (\`:::bmmreplay\` est le même bloc) ; \`autoplay\` et \`loop\` sont des drapeaux nus.
Préfère un fichier hébergé ici — un replay en 404 laisse un cadre mort au milieu de la page.

## Les boutons

\`\`\`
:button[Voir la vidéo]{brand=youtube href=https://youtube.com/…}
:button[Lire le guide]{color=#0a7 size=lg href=/docs}
\`\`\`

:button[Regarder]{brand=youtube href=https://youtube.com} :button[Rejoindre]{brand=discord href=https://discord.gg} :button[Lire le guide]{color=#0a7 href=/docs}

Une seule forme, trois tailles (\`sm\` \`md\` \`lg\`), n'importe quelle couleur. \`brand\`
fixe la couleur **et** le logo ensemble — \`youtube\` \`discord\` \`kofi\` \`github\`
\`twitch\` \`x\` \`reddit\` \`telegram\` — parce qu'un bouton rouge YouTube portant un logo
Discord est une erreur que personne ne commet exprès. \`outline\` est la version discrète, et
\`:btn[…]\` est le nom court.

Un bouton sans \`href\` s'affiche en simple span plutôt qu'en lien mort.

## Les liens colorés

\`\`\`
:link[à lire d'abord]{color=#e11 href=/docs/quick-start}
\`\`\`

:link[à lire d'abord]{color=#e11 href=/docs/quick-start} — toujours souligné, comme tous les
autres liens du site. La couleur seule n'est pas un signal que tout le monde perçoit.

## Horaires et instants
:::schedule[Support]{tz=Europe/Paris}
| Jour | Ouvert |
|---|---|
| Lun-Ven | 09:00-18:00 |
| Sam | 10:00-14:00 |
:::

\`:::schedule{tz=...}\` (ou \`:::hours\`) enonce un horaire recurrent dans UN fuseau. Les lignes sont affichees exactement comme tu les as ecrites et le fuseau est nomme sur la carte, parce que les convertir serait faux : \`lundi 09:00 Europe/Paris\`, c'est 09:00 a Paris toute l'annee, et ce qui bouge au passage a l'heure d'ete, c'est l'ecart avec le lecteur. Une ligne convertie serait juste aujourd'hui et fausse en mars. Ce que le bloc calcule, c'est l'ecart **maintenant**, et il le dit.

Un instant unique n'a pas cette ambiguite, donc il EST converti : \`:time[2026-09-01T20:00]{tz=Europe/Paris}\` (ou \`:at\`) affiche ce moment dans le fuseau de chaque lecteur, en gardant ce que tu as tape dans l'infobulle. C'est la date qui rend le calcul exact - elle decide de quel cote d'un changement d'heure le moment tombe.

## Les onglets

\`\`\`
:::tabs
:::tab{title="Windows"}
Lance \`install.exe\`.
:::
:::tab{title="Linux"}
Lance \`./install.sh\`.
:::
:::
\`\`\`

:::tabs
:::tab{title="Windows"}
Lance \`install.exe\`.
:::
:::tab{title="Linux"}
Lance \`./install.sh\`.
:::
:::

Un panneau contient le markdown que tu veux, y compris d'autres blocs. La barre lit ses
libellés sur les panneaux : le nom d'un onglet et son contenu ne peuvent pas diverger.

## La progression

\`:::progress\` est le bloc feuille de route ci-dessus sous un second nom — identique
en tout point : écris celui qui se lit le mieux dans le document.

Il n'existe volontairement pas de bloc de pourcentage en ligne. Une barre seule est un
pourcentage de rien ; un jalon dans une feuille de route est un pourcentage de quelque chose
qui porte un nom.

## Les mathématiques

Écrites \`$$…$$\`, en ligne ou en bloc :

\`\`\`
$$E = mc^2$$
\`\`\`

$$E = mc^2$$

Le dollar simple \`$x$\` est volontairement désactivé. Ce site affiche des prix, et
l'alternative est que « \$5 et \$10 » soit composé comme une formule — en silence, parce
qu'un prix ne produit pas d'erreur : il devient du charabia en italique.

## Les éléments en ligne

- Touche clavier : \`:kbd[Ctrl+S]\` → :kbd[Ctrl+S]
- Icône : \`:icon[rocket]\` → :icon[rocket]
- Badge : \`:badge[Nouveau]{color="#16a34a"}\` → :badge[Nouveau]{color="#16a34a"} — \`:tag[…]\` est la même pastille sous un autre nom
- Emoji : \`:rocket:\` → :rocket: · \`:tada:\` → :tada: · \`:white_check_mark:\` → :white_check_mark:

:::note[Ce que les raccourcis ne peuvent pas casser]
Seuls les 384 noms de la liste sont remplacés : \`10:30:45\` reste un horodatage, \`3:4\` un rapport, et une phrase française finissant par deux-points reste une phrase. Le code n'est jamais touché — ni en ligne, ni clôturé — parce que la substitution s'applique aux nœuds de texte, et un bloc de code n'en est pas un. Un raccourci inconnu reste tel quel : une faute de frappe se voit au lieu de disparaître.
:::

## Le sommaire

Mets \`::toc[Sur cette page]\` en haut et il construit un résumé depuis tes titres \`##\` / \`###\`, tout seul.

## La chronologie

\`\`\`
:::timeline[Comment on en est arrivé là]
:::event[Première version]{date="2025-03-01" state=done}
La bibliothèque, les profils et le premier catalogue.
:::
:::event[Dépôts serveur]{date="2026-01-12" state=done icon=server}
Des dépôts partagés, hébergés ou auto-servis.
:::
:::event[Où on en est]{date="now" state=now}
Les niveaux, la boutique, le casino.
:::
:::event[Ensuite]{state=next}
Ce que le vote dira.
:::
:::
\`\`\`

:::timeline[Comment on en est arrivé là]
:::event[Première version]{date="2025-03-01" state=done}
La bibliothèque, les profils et le premier catalogue.
:::
:::event[Dépôts serveur]{date="2026-01-12" state=done icon=server}
Des dépôts partagés, hébergés ou auto-servis.
:::
:::event[Où on en est]{date="now" state=now}
Les niveaux, la boutique, le casino.
:::
:::event[Ensuite]{state=next}
Ce que le vote dira.
:::
:::

\`state\` vaut \`done\`, \`now\` ou \`next\` (alias : past/shipped, current/active, planned/future). \`:::moment\` est le même bloc.

## Avant / après

\`\`\`
:::compare{before="v1" after="v2"}
:::before
Un profil à la fois, et un redémarrage entre deux.
:::
:::after
Les profils basculent en direct, et le jeu est prévenu.
:::
:::
\`\`\`

:::compare{before="v1" after="v2"}
:::before
Un profil à la fois, et un redémarrage entre deux.
:::
:::after
Les profils basculent en direct, et le jeu est prévenu.
:::
:::

## Les stats

\`\`\`
:::stats
:::stat[Téléchargements]{value="12 400" delta="+8%" icon=download}
:::
:::stat[Membres]{value="2 310" delta="+3%" icon=users color=#16a34a}
:::
:::stat[Tickets ouverts]{value="7" delta="-4" icon=bug}
Depuis le mois dernier.
:::
:::
\`\`\`

:::stats
:::stat[Téléchargements]{value="12 400" delta="+8%" icon=download}
:::
:::stat[Membres]{value="2 310" delta="+3%" icon=users color=#16a34a}
:::
:::stat[Tickets ouverts]{value="7" delta="-4" icon=bug}
Depuis le mois dernier.
:::
:::

Le signe du delta choisit la couleur. Le corps est la petite ligne sous le nombre. \`:::kpi\` est le même bloc.

## La citation

\`\`\`
:::quote[Ada Lovelace]{role="Analyste, 1843" avatar=/icons/bmm.png}
La machine pourrait composer des morceaux de musique élaborés, de n'importe quel degré de complexité.
:::
\`\`\`

:::quote[Ada Lovelace]{role="Analyste, 1843" avatar=/icons/bmm.png}
La machine pourrait composer des morceaux de musique élaborés, de n'importe quel degré de complexité.
:::

\`href\` fait du nom un lien ; \`color\` recolore la barre. \`:::testimonial\` est le même bloc.

## La bannière hero

\`\`\`
:::hero[Better Mods Manager]{subtitle="Une bibliothèque, tous les jeux." icon=rocket align=center color=#7c3aed}
:button[Télécharger]{href=/p/bmm size=lg} :button[Lire la doc]{href=/docs outline}
:::
\`\`\`

:::hero[Better Mods Manager]{subtitle="Une bibliothèque, tous les jeux." icon=rocket align=center color=#7c3aed}
:button[Télécharger]{href=/p/bmm size=lg} :button[Lire la doc]{href=/docs outline}
:::

\`image=\` place une couverture au-dessus du texte ; \`align\` vaut left, center ou right.

## Le changelog

\`\`\`
:::changelog
:::version[1.4.0]{date="2026-09-01" label=latest}
- [NOUVEAU] Une galerie de modèles pour les automatisations
- [FIXÉ] Casino : un palier 1× rendait moins que la mise
:::
:::version[1.3.2]{date="2026-08-14"}
- [AMÉLIORÉ] Synchronisation des dépôts plus rapide
:::
:::
\`\`\`

:::changelog
:::version[1.4.0]{date="2026-09-01" label=latest}
- [NOUVEAU] Une galerie de modèles pour les automatisations
- [FIXÉ] Casino : un palier 1× rendait moins que la mise
:::
:::version[1.3.2]{date="2026-08-14"}
- [AMÉLIORÉ] Synchronisation des dépôts plus rapide
:::
:::

Les pastilles \`[NOUVEAU]\` / \`[FIXÉ]\` / \`[AMÉLIORÉ]\` sont le raccourci habituel. \`:::release\` est le même bloc.

## Le spoiler

\`\`\`
:::spoiler[La réponse]
Quarante-deux.
:::
\`\`\`

:::spoiler[La réponse]
Quarante-deux.
:::

## La FAQ

\`\`\`
:::faq[Les questions qu'on nous pose]
:::q[L'hébergement est-il gratuit ?]{open}
Il y a un palier gratuit ; au-dessus, tu paies la taille que tu utilises.
:::
:::q[Puis-je transférer un dépôt à un autre compte ?]
Oui — Transfert de propriété, dans le tableau de bord du dépôt.
:::
:::
\`\`\`

:::faq[Les questions qu'on nous pose]
:::q[L'hébergement est-il gratuit ?]{open}
Il y a un palier gratuit ; au-dessus, tu paies la taille que tu utilises.
:::
:::q[Puis-je transférer un dépôt à un autre compte ?]
Oui — Transfert de propriété, dans le tableau de bord du dépôt.
:::
:::

\`:::question\` est le même bloc que \`:::q\`.

## La checklist

\`\`\`
:::checklist[Jour de sortie]
- [x] Tagger la version
- [x] Écrire les notes
- [ ] Poster sur Discord
:::
\`\`\`

:::checklist[Jour de sortie]
- [x] Tagger la version
- [x] Écrire les notes
- [ ] Poster sur Discord
:::

Le compte et la barre viennent des cases cochées ; rien à tenir à jour.

## La grille

\`\`\`
:::grid{cols=3 gap=lg}
:::card[Un]
a
:::
:::card[Deux]
b
:::
:::card[Trois]
c
:::
:::
\`\`\`

Là où \`:::columns\` se dimensionne seul, \`:::grid\` prend un nombre fixe de colonnes (1–6) et se replie sur deux, puis une, sur les petits écrans.

## La jauge en ligne

\`\`\`
Migration : :meter[72]{label=Fait} · Tests : :meter[9]{max=12 color=#16a34a}
\`\`\`

Migration : :meter[72]{label=Fait} · Tests : :meter[9]{max=12 color=#16a34a}

## Les icônes Phosphor

Partout où va un nom d'icône — \`:icon[…]\`, le \`icon=\` d'une carte, une stat, un bouton — une icône **Phosphor** marche à côté de celles de lucide : \`:icon[ph:rocket]\` :icon[ph:rocket], et la graisse en préfixe : \`:icon[ph-bold:rocket]\` :icon[ph-bold:rocket] · \`:icon[ph-fill:heart]\` :icon[ph-fill:heart] · \`:icon[ph-duotone:star]\` :icon[ph-duotone:star].
Le sélecteur de chaque éditeur en liste les 1 500.

## Les lignes de réglage

\`\`\`
:::field[Forme des tuiles]{key=icons.shape type=select icon=palette}
Carrée, arrondie ou ronde. S'applique à toutes les tuiles de la bibliothèque.
:::
:::field[Sauvegarde auto]{key=editor.autosave type=toggle}
Enregistre un brouillon toutes les trente secondes pendant la frappe.
:::
\`\`\`

:::field[Forme des tuiles]{key=icons.shape type=select icon=palette}
Carrée, arrondie ou ronde. S'applique à toutes les tuiles de la bibliothèque.
:::
:::field[Sauvegarde auto]{key=editor.autosave type=toggle}
Enregistre un brouillon toutes les trente secondes pendant la frappe.
:::

Un libellé en gras, une étiquette de type optionnelle, la clé en monospace à droite, puis la description. \`anchor=\` fait de la ligne une cible de lien profond ; \`:::setting\` est le même bloc.

## Le séparateur

\`\`\`
:::divider[Deuxième partie]
:::
\`\`\`

:::divider[Deuxième partie]
:::

\`---\` trace toujours un trait simple. Celui-ci prend un libellé, posé au milieu de la ligne.

## Le tableau

\`\`\`
:::table[Offres]{style="striped bordered" align=center width=100%}
| Offre | Stockage | Prix |
|---|---|---|
| Gratuite | 200 Mo | 0 |
| Pool | au Go | mensuel |
:::
\`\`\`

:::table[Offres]{style="striped bordered" align=center width=100%}
| Offre | Stockage | Prix |
|---|---|---|
| Gratuite | 200 Mo | 0 |
| Pool | au Go | mensuel |
:::

Le tableau à l'intérieur est du GFM ordinaire : les cellules gardent liens, code et icônes. \`style\` accepte \`striped\`, \`bordered\`, \`compact\`, \`hover\`, \`plain\`, \`wide\`, \`sticky\`, \`numbers\`.

## L'image

\`\`\`
:img[Le logo]{src=/logo.png width=96 align=center caption="Tout ce que \`![alt](src)\` ne sait pas porter." border}
\`\`\`

:img[Le logo]{src=/logo.png width=96 align=center caption="Tout ce que ![alt](src) ne sait pas porter." border}

\`width\` / \`height\` / \`max\` : un nombre = des pixels, le reste (\`50%\`, \`20rem\`) passe tel quel. \`link=\` l'entoure d'un lien, \`zoom=false\` coupe la visionneuse, \`lazy=false\` la charge tout de suite. \`:image\` est le même bloc ; dans une phrase, c'est un \`<span>\`.

## Les médias

\`\`\`
::audio{src=/uploads/ep12.mp3 title="Épisode 12"}
::youtube{src=https://youtu.be/dQw4w9WgXcQ start=90}
::spotify{src=https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC compact}
\`\`\`

\`::audio\` est un lecteur natif (\`preload=none\`, rien ne se télécharge avant d'appuyer). \`::youtube\` (\`::yt\`) accepte une URL complète, une courte, un Short ou un simple id, et l'encadre depuis youtube-nocookie. \`::spotify\` prend une URL de partage ou \`track:ID\` / \`album:ID\` / \`playlist:ID\` / \`episode:ID\` / \`show:ID\` / \`artist:ID\` ; un lien non reconnu le dit à la place du lecteur.

## Les cartes d'API

\`\`\`
:::api[GET /api/feedback/:project]{auth=session summary="Les cent dernières entrées d'un projet."}
:::params
| Nom | Où | Type |
|---|---|---|
| project | chemin | string |
:::
:::request
\`GET /api/feedback/bmm\`
:::
:::response{status=200}
Un tableau JSON, le plus récent en premier.
:::
:::
\`\`\`

:::api[GET /api/feedback/:project]{auth=session summary="Les cent dernières entrées d'un projet."}
:::params
| Nom | Où | Type |
|---|---|---|
| project | chemin | string |
:::
:::request
\`GET /api/feedback/bmm\`
:::
:::response{status=200}
Un tableau JSON, le plus récent en premier.
:::
:::

La méthode colore la carte ; \`auth=\` dit qui peut l'appeler ; \`deprecated\` ajoute le badge. \`:::endpoint\` est le même bloc. \`::openapi{src=/api/openapi.json tag=feedback filter=/feedback toc}\` (\`::swagger\`) va chercher une spec et dessine chaque opération comme une de ces cartes, par le même chemin, si bien qu'une carte générée et une carte écrite à la main se ressemblent.

## Les valeurs en direct

\`\`\`
Téléchargements : :counter[downloads]{src=/api/stats.json path=downloads refresh=60 name=dl}
État : :fetch[status]{src=/api/status.json path=message}
::live{src=/api/status.json path=message refresh=30}
:action[Voter]{href=/api/vote method=POST body='{"id":1}' confirm="Sûr ?" done="Merci !" counter=dl once}
\`\`\`

\`:counter\` formate un nombre, \`:fetch\` affiche du texte en ligne et \`::live\` est la forme bloc ; \`refresh=\` est en secondes. \`:action\` est un bouton qui appelle une URL quand on appuie — \`confirm=\` demande d'abord, \`done=\` est le libellé après, \`once\` le désactive après un succès, et \`counter=\` nomme un compteur à rafraîchir. L'URL passe par la même politique que n'importe quel lien, et une URL refusée affiche un tiret plutôt que de lancer une requête.

## L'inclusion

\`\`\`
::include{src=/docs/partials/install.md}
\`\`\`

Rend un autre document à cet endroit, deux niveaux de profondeur au plus. \`::embed-md\` est le même bloc.

## Le diagramme

\`\`\`\`
:::mermaid[Le parcours d'un signalement]
\`\`\`mermaid
graph LR; Nouveau --> Examen --> Clos
\`\`\`
:::
\`\`\`\`

\`:::diagram\` est le même bloc, et un simple bloc \`\`\`mermaid sans directive marche aussi. Mermaid le dessine dans le navigateur, en mode strict.

## Deux bonus qui ne sont pas des directives

Une citation qui commence par \`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` ou
\`[!CAUTION]\` devient l'encadré correspondant — pratique quand tu colles depuis GitHub. Les
graphies françaises marchent aussi : \`[!REMARQUE]\`, \`[!ASTUCE]\`, \`[!AVERTISSEMENT]\`,
\`[!ATTENTION]\`.

Un \`[NOUVEAU]\`, \`[FIXÉ]\`, \`[AMÉLIORÉ]\`, \`[RAFFINEMENT]\`, \`[VISUEL]\` ou \`[MAJEUR]\` tout seul
devient un badge coloré (les graphies anglaises marchent également). Ce qui est dans du code
est laissé tel quel.

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
  'bcweb-api': {
    title: 'API BetterCommunity',
    category: 'Référence',
    body: `::toc[Sur cette page]

# API BetterCommunity

Une API HTTP, d'abord en lecture, pour votre propre compte, vos dépôts hébergés et le catalogue public. C'est ce qu'on utilise pour miroiter un catalogue, surveiller les changements d'un dépôt, ou brancher BetterCommunity dans un script.

Ce n'est **pas** la même chose que [l'API des plugins](/docs/api-reference), qui tourne à l'intérieur de BMM, sur votre propre machine.

## Obtenir une clé

Les clés se créent depuis votre **page de profil**, section *Clés API*. Chaque clé a un nom, un ensemble de portées, et une expiration facultative.

:::warning[La clé n'est affichée qu'une fois]
Le serveur ne conserve qu'une empreinte de votre clé : il ne peut donc réellement pas vous la remontrer. Copiez-la à la création. Si vous la perdez, révoquez-la et créez-en une autre — c'est le seul chemin.
:::

Vous pouvez détenir jusqu'à 20 clés actives. Une clé ne peut pas en créer une autre : la création exige votre session de navigateur, donc révoquer une clé qui a fuité met vraiment fin au problème.

## S'authentifier

\`\`\`bash
curl -H "Authorization: Bearer bck_VOTRE_CLE" https://VOTRE-HOTE/api/v1/account
\`\`\`

\`X-API-Key\` fonctionne aussi, si un en-tête « bearer » est malcommode dans votre client.

Les échecs sont volontairement peu bavards : une clé qui n'a jamais existé, une clé révoquée et une clé expirée répondent toutes \`401 invalid_key\`. Une clé réelle mais dépourvue de la portée nécessaire répond \`403 insufficient_scope\` et vous dit laquelle manquait.

## Portées

Une clé a exactement les droits que ses portées décrivent, et une clé sans portée ne peut rien.

| Portée | Ce que ça ouvre |
|---|---|
| \`account:read\` | Votre profil. |
| \`account:write\` | Votre nom affiché et votre bio. |
| \`repos:read\` | Vos dépôts, la liste de leurs fichiers, leur historique de changements. |
| \`catalog:read\` | Les éléments publiés du catalogue et leur historique. |
| \`users:read\` | Les profils publics — exactement ce que voit un visiteur non connecté. |

Rien de ce qui dépense de l'argent, modifie un contrôle d'accès ou supprime quoi que ce soit n'est accessible par clé. C'est délibéré : une clé vit dans un script, sur une machine que nous ne maîtrisons pas ; en perdre une doit vous coûter un accès en lecture, et rien de plus.

## Points d'accès

### \`GET /api/v1/scopes\`

Toutes les portées et leur signification. Aucune clé requise — c'est ainsi qu'un client découvre ce qu'il doit demander.

### \`GET /api/v1/account\` · \`account:read\`

\`\`\`json
{ "user": { "id": "…", "displayName": "…", "bio": "…", "role": "USER", "createdAt": "…" },
  "scopes": ["account:read"] }
\`\`\`

### \`PATCH /api/v1/account\` · \`account:write\`

Accepte \`displayName\` (2 à 60 caractères) et \`bio\` (jusqu'à 500). Tout le reste est ignoré, et un corps sans rien d'exploitable répond \`400 nothing_to_update\`.

### \`GET /api/v1/repos\` · \`repos:read\`

Vos dépôts hébergés : id, nom, statut, \`hostPath\`, s'ils sont publiés et listés, si le manifeste a été vérifié, le \`sha\` du contenu, et le stockage utilisé par rapport au quota.

### \`GET /api/v1/repos/:id/files\` · \`repos:read\`

Tous les fichiers que BetterCommunity détient pour ce dépôt — chemin, taille, sha256, type de contenu, dernière modification.

C'est la réponse à un manque réel : un hébergement web ordinaire avec listage de répertoire laisse BMM découvrir seul les fichiers d'un dépôt, or BetterCommunity ne sert pas de listage. Ce point d'accès est ce listage.

### \`GET /api/v1/repos/:id/changes\` · \`repos:read\`

Ce qui est arrivé au contenu du dépôt, du plus récent au plus ancien.

\`\`\`json
{ "retentionDays": 30,
  "changes": [ { "action": "upload", "path": "mods/foo/data.pak", "at": "2026-08-11T09:12:04.000Z" },
               { "action": "delete", "path": "mods/old/bad.pak", "at": "2026-08-10T22:40:11.000Z" } ] }
\`\`\`

\`action\` vaut \`upload\`, \`delete\`, \`publish\`, \`unpublish\`, \`settings\`, \`access\`, \`ban\` ou \`unban\`.

:::warning[L'historique a un horizon]
L'historique par dépôt est élagué à 30 jours et 1000 entrées. \`retentionDays\` vous dit où se trouve la limite. Si vous êtes resté absent plus longtemps, relisez la liste des fichiers — ne lisez pas un flux de changements vide comme « rien n'a changé ».
:::

### \`GET /api/v1/users/:id\` · \`users:read\`

Un profil public : nom affiché, avatar, bio, badges, date d'inscription, les connexions que le propriétaire a choisi de montrer, ainsi que ses dépôts et catalogues listés. Jamais d'adresse e-mail.

\`:id\` accepte un id de compte ou un **BC id** (\`BCU-XXXX-XXXX\`), pour qu'une intégration BMM ne disposant que d'un identifiant de créateur puisse le résoudre sans connaître l'id interne.

Un profil privé répond \`403 private_profile\` ; un compte banni ou inconnu répond \`404\`.

:::warning[Une clé n'est pas un badge de modération]
Connecté sur le site, un modérateur peut ouvrir un profil privé. Via l'API, **personne ne le peut** — le profil est construit comme pour un visiteur non connecté, quel que soit le rôle du propriétaire de la clé. Les pouvoirs d'équipe vivent derrière une session de navigateur et la double authentification ; un jeton collé dans un script, ce n'est pas ça.
:::

### \`GET /api/v1/users?q=\` · \`users:read\`

Recherche par nom affiché, BC id, id de dépôt ou slug de catalogue — chacun des trois derniers étant résolu vers son propriétaire. Uniquement les profils publics et non bannis : une recherche ne peut donc jamais faire apparaître ce qu'un accès direct refuserait. Deux caractères minimum ; \`?limit=\` jusqu'à 100.

### \`GET /api/v1/catalog\` · \`catalog:read\`

Les éléments publiés seulement. Filtrez avec \`?kind=APP|PLUGIN|THEME|PRESET\`. Les éléments encore en relecture, refusés ou masqués ne sont pas visibles par une clé — le processus de relecture n'est pas quelque chose qu'une clé API contourne.

### \`GET /api/v1/catalog/changes\` · \`catalog:read\`

Ajouts et retraits, du plus récent au plus ancien.

\`\`\`json
{ "changes": [ { "slug": "my-theme", "kind": "THEME", "action": "published",
                 "version": "1.2.0", "id": "clx…", "at": "2026-08-11T09:12:04.000Z" },
               { "slug": "old-plugin", "kind": "PLUGIN", "action": "deleted",
                 "version": null, "id": null, "at": "2026-08-09T14:02:55.000Z" } ] }
\`\`\`

\`action\` vaut \`created\`, \`updated\`, \`published\`, \`rejected\`, \`hidden\`, \`restored\` ou \`deleted\`.

Un élément supprimé l'est vraiment — sa ligne n'existe plus — donc \`id\` revient à \`null\` et **c'est le slug qui sert d'identité pour indexer votre miroir**. Ce flux est le seul endroit où un retrait est consigné ; rien d'autre n'y survit.

## Interroger périodiquement

Les deux flux de changements acceptent \`?since=<ISO-8601>\` et ne renvoient que ce qui est plus récent, ainsi que \`?limit=\` (100 par défaut, 500 au maximum).

\`\`\`bash
curl -H "Authorization: Bearer $CLE" \
  "https://VOTRE-HOTE/api/v1/catalog/changes?since=2026-08-01T00:00:00Z&limit=200"
\`\`\`

Une valeur \`since\` illisible est ignorée plutôt que rejetée : un client qui rejoue un mauvais curseur récupère tout, au lieu de boucler sur une erreur 400.

Les points d'accès en lecture autorisent 120 requêtes par minute ; la gestion des clés et les écritures, 30.`,
  },
};
