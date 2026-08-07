// "Using the site" — a guided tour of BetterCommunity itself, page by page.
//
// Distinct from seed-docs.mjs on purpose: that one documents BMM, the desktop app. Nothing
// documented the WEBSITE, so a first-time visitor had a catalog, a repo browser, a hosting
// page and a dashboard in front of them and no explanation of how they relate.
//
// Idempotent: upserts by slug, so re-running refreshes the content without duplicating.
// Run: `docker compose exec api node src/seed-site-guide.mjs` (or `npm run setup`).
//
// Every page carries titleFr/categoryFr as well as bodyFr — a translated body under an
// English sidebar entry is a half-translated page.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const CATEGORY = 'Using the site';
const CATEGORY_FR = 'Utiliser le site';

const PAGES = [
  // ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'site-tour', title: 'Getting started here', titleFr: 'Bien démarrer ici', icon: 'compass', order: 50,
    body: `::toc[On this page]

# Getting started on BetterCommunity

This site is the **hub** around the Better\\* desktop apps. The apps install and manage things; this is where those things are published, hosted, discussed and paid for.

You do not need an account to read anything, and you do not need one to download from a public source. You need one to *publish*, to *host*, or to reach anything a creator has restricted.

:::tip[In one sentence]
**Find** content in the catalogs and repos, **add** it to BMM with one click, and — if you make things — **publish** or **host** it here.
:::

## The five things this site does

:::cards
:::card{title="Catalogs" href=/catalog icon=boxes}
Lists of plugins, themes or apps that BMM reads directly. Official ones are ours; community ones are hosted by their authors.
:::
:::card{title="Server Repos" href=/repos icon=server}
A whole mod collection, kept in sync. Join one and BMM downloads only what changed.
:::
:::card{title="Hosting" href=/hosting icon=rocket}
Storage pools you can fill with your own repos and catalogs.
:::
:::card{title="Community" href=/blog icon=users}
Blog, documentation, FAQ, member profiles.
:::
:::

## Finding your way around

**The top bar** carries the site sections, plus your language, the light/dark switch, notifications and your account menu. An administrator can add, rename and reorder those entries, so it may not look identical everywhere.

**The footer** repeats the important links and holds the legal pages and the newsletter box.

**Ctrl + K** is not here — that is BMM's command palette, in the desktop app. On the site, use the search box on the page you are on.

## Light, dark, and language

The theme switch is in the top bar and your choice is remembered on this device. If you have never touched it, you get whatever the site's default is.

The language switch does the same. Where a page has no French translation yet, you get the English with a note saying so — never an empty page.

## What to read next

| If you want to… | Go to |
|---|---|
| Get content into BMM | [Catalogs and repos](/docs/site-content) |
| Make an account, secure it, link BMM | [Your account](/docs/site-account) |
| Publish or host your own work | [Publishing and hosting](/docs/site-publishing) |
| Report something, or get help | [Getting help](/docs/site-help) |`,
    bodyFr: `::toc[Sur cette page]

# Bien démarrer sur BetterCommunity

Ce site est le **point de rencontre** autour des applications Better\\*. Les applications installent et gèrent ; ici, on publie, on héberge, on discute et on paie.

Aucun compte n'est nécessaire pour lire, ni pour télécharger depuis une source publique. Il en faut un pour *publier*, pour *héberger*, ou pour accéder à ce qu'un créateur a restreint.

:::tip[En une phrase]
**Trouve** du contenu dans les catalogues et les dépôts, **ajoute-le** à BMM en un clic, et — si tu crées — **publie** ou **héberge** ici.
:::

## Les cinq choses que fait ce site

:::cards
:::card{title="Catalogues" href=/catalog icon=boxes}
Des listes de plugins, thèmes ou apps que BMM lit directement. Les officiels sont les nôtres ; les communautaires sont hébergés par leurs auteurs.
:::
:::card{title="Dépôts serveur" href=/repos icon=server}
Une collection de mods entière, tenue à jour. Rejoins-en un et BMM ne télécharge que ce qui a changé.
:::
:::card{title="Hébergement" href=/hosting icon=rocket}
Des pools de stockage à remplir avec tes propres dépôts et catalogues.
:::
:::card{title="Communauté" href=/blog icon=users}
Blog, documentation, FAQ, profils des membres.
:::
:::

## S'orienter

**La barre du haut** porte les sections du site, la langue, le bouton clair/sombre, les notifications et le menu de ton compte. Un administrateur peut y ajouter, renommer et réordonner des entrées : elle n'est donc pas forcément identique partout.

**Le pied de page** reprend les liens importants et contient les pages légales et l'encart newsletter.

**Ctrl + K** n'existe pas ici — c'est la palette de commandes de BMM, dans l'application de bureau. Sur le site, sers-toi du champ de recherche de la page où tu es.

## Clair, sombre, et la langue

Le bouton de thème est dans la barre du haut et ton choix est retenu sur cet appareil. Si tu n'y as jamais touché, tu obtiens celui que le site propose par défaut.

Le sélecteur de langue fonctionne pareil. Quand une page n'a pas encore de traduction française, tu obtiens l'anglais avec une note qui le dit — jamais une page vide.

## Et ensuite

| Si tu veux… | Va voir |
|---|---|
| Faire entrer du contenu dans BMM | [Catalogues et dépôts](/docs/site-content) |
| Créer un compte, le sécuriser, lier BMM | [Ton compte](/docs/site-account) |
| Publier ou héberger ton travail | [Publier et héberger](/docs/site-publishing) |
| Signaler quelque chose, ou être aidé | [Obtenir de l'aide](/docs/site-help) |`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'site-content', title: 'Catalogs and repos', titleFr: 'Catalogues et dépôts', icon: 'boxes', order: 51,
    body: `::toc[On this page]

# Getting content into BMM

Two different things bring content into the app, and the difference matters.

| | A catalog | A Server Repo |
|---|---|---|
| Holds | A **list** of items you install one by one | A **whole collection**, kept in sync |
| You do | Browse, then install what you want | Join once; it stays up to date |
| Good for | Plugins, themes, apps | A squadron or group running the same set |

## Catalogs

Open [Catalogs](/catalog) and you will see the official ones and the community ones side by side.

:::note[One catalog, one type]
A catalog serves **one** kind of thing — plugins, or themes, or apps. That is not a rule we invented: BMM reads each type from its own URL, with its own format, so a mixed catalog would be one no client could read. If you want to publish two types, make two catalogs.
:::

On a catalog's page you get:

- **what is inside it** — every item with its version, size and download count;
- an **Add to BMM** button, which hands the feed URL straight to the app;
- a **Copy feed URL** button, if you would rather paste it yourself.

The bare URL — no \`?kind=\` on the end — is the one to give BMM. It already serves that catalog's own type.

## Server Repos

A repo is a whole collection with a manifest. When you sync, BMM compares hashes and downloads only the parts that changed — a small edit inside a 10 GB collection costs a few megabytes, not ten gigabytes.

Browse them at [Server Repos](/repos). A repo may be:

- **public** — anyone can join;
- **restricted** — the owner set a whitelist, a ban list, or a requirement to be signed in with a linked BMM/Discord identity;
- **private** — reachable only through a share link the owner gives you.

:::tip[Repo IDs]
Every repo has a \`BCR-XXXX-XXXX\` identifier shown on its page. Quote it when asking for help — it identifies the repo precisely, where a name may be ambiguous.
:::

## When a download asks you to sign in

That is the source's own access rule, not a site-wide one. A public source with no rules downloads without an account. If the owner set any restriction, you have to be signed in so it can check you.`,
    bodyFr: `::toc[Sur cette page]

# Faire entrer du contenu dans BMM

Deux choses différentes apportent du contenu dans l'application, et la distinction compte.

| | Un catalogue | Un dépôt serveur |
|---|---|---|
| Contient | Une **liste** d'éléments à installer un par un | Une **collection entière**, tenue à jour |
| Tu fais | Tu parcours, tu installes ce que tu veux | Tu le rejoins une fois ; il reste à jour |
| Idéal pour | Plugins, thèmes, apps | Une escadrille ou un groupe sur la même config |

## Les catalogues

Ouvre [Catalogues](/catalog) : les officiels et les communautaires y sont côte à côte.

:::note[Un catalogue, un type]
Un catalogue sert **un seul** type — plugins, ou thèmes, ou apps. Ce n'est pas une règle inventée : BMM lit chaque type depuis sa propre URL, avec son propre format. Un catalogue mixte ne serait lisible par aucun client. Pour publier deux types, fais deux catalogues.
:::

Sur la page d'un catalogue tu trouves :

- **ce qu'il contient** — chaque élément avec sa version, sa taille et son nombre de téléchargements ;
- un bouton **Ajouter à BMM**, qui transmet l'URL du flux directement à l'application ;
- un bouton **Copier l'URL du flux**, si tu préfères la coller toi-même.

L'URL nue — sans \`?kind=\` à la fin — est celle à donner à BMM. Elle sert déjà le type propre du catalogue.

## Les dépôts serveur

Un dépôt est une collection entière avec un manifeste. À la synchronisation, BMM compare les empreintes et ne télécharge que ce qui a changé : une petite modification dans une collection de 10 Go coûte quelques mégaoctets, pas dix gigaoctets.

Parcours-les depuis [Dépôts serveur](/repos). Un dépôt peut être :

- **public** — tout le monde peut le rejoindre ;
- **restreint** — le propriétaire a posé une liste blanche, une liste de bannis, ou l'obligation d'être connecté avec une identité BMM/Discord liée ;
- **privé** — accessible seulement par un lien de partage qu'il te donne.

:::tip[Identifiants de dépôt]
Chaque dépôt a un identifiant \`BCR-XXXX-XXXX\` affiché sur sa page. Cite-le quand tu demandes de l'aide : il désigne le dépôt sans ambiguïté, là où un nom peut prêter à confusion.
:::

## Quand un téléchargement demande de se connecter

C'est la règle d'accès de la source, pas une règle du site. Une source publique sans règle se télécharge sans compte. Si le propriétaire a posé une restriction, il faut être connecté pour qu'il puisse te vérifier.`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'site-account', title: 'Your account', titleFr: 'Ton compte', icon: 'user', order: 52,
    body: `::toc[On this page]

# Your account

## Signing up

Either an email and a password, or **Sign in with GitHub, Discord or Google**. The OAuth route creates the account for you and needs no password at all.

If you sign up with a provider, its profile picture becomes your avatar. You can change or remove it at any time from your profile — and once you have, linking another provider will not overwrite your choice.

## Two-factor authentication

Turn it on from your profile. You will be asked for a code from an authenticator app on each sign-in.

:::tip[A built-in authenticator]
The site has its own at **[/2fa](/2fa)** — it runs entirely in your browser, stores nothing on the server, and can scan a QR code with your camera. Useful if you do not already have an authenticator app.
:::

Some staff actions require 2FA regardless of your preference.

## Your profile

**[Profile](/profile)** holds your display name, avatar, bio, website, and two privacy switches:

- **Public profile** — whether \`/u/<your-id>\` is visible to others at all;
- **Show connections** — whether your linked accounts appear on it.

Your **BC id** is the short identifier others can quote when referring to you. It is on your profile, and copyable with one click.

## Linking BMM and Discord

Linking a **creator id** from BMM is what lets a repo or catalog recognise you when its owner restricted access by identity. Linking **Discord** does the same for Discord-based rules, and lets the bot give you your roles automatically.

## Notifications

The bell in the top bar. Anything that concerns you lands there: a submission approved, a reply on a report, a hosting term ending, a promo granted.

## The dashboard

**[Dashboard](/dashboard)** is your own things in one place — your submissions, your catalogs, your repos, your storage pools, and what you have starred.`,
    bodyFr: `::toc[Sur cette page]

# Ton compte

## S'inscrire

Soit un e-mail et un mot de passe, soit **se connecter avec GitHub, Discord ou Google**. La voie OAuth crée le compte pour toi et ne demande aucun mot de passe.

Si tu t'inscris avec un fournisseur, sa photo de profil devient ton avatar. Tu peux la changer ou la retirer quand tu veux depuis ton profil — et une fois que tu l'as fait, lier un autre fournisseur n'écrasera pas ton choix.

## L'authentification à deux facteurs

Active-la depuis ton profil. Un code d'application d'authentification te sera demandé à chaque connexion.

:::tip[Un authentificateur intégré]
Le site a le sien à **[/2fa](/2fa)** — il tourne entièrement dans ton navigateur, ne stocke rien sur le serveur, et peut scanner un QR code avec ta caméra. Pratique si tu n'as pas déjà une application dédiée.
:::

Certaines actions d'équipe exigent la 2FA quel que soit ton réglage.

## Ton profil

**[Profil](/profile)** contient ton pseudo, ton avatar, ta bio, ton site, et deux réglages de confidentialité :

- **Profil public** — si \`/u/<ton-id>\` est visible des autres ;
- **Afficher les connexions** — si tes comptes liés y apparaissent.

Ton **BC id** est l'identifiant court que les autres peuvent citer pour parler de toi. Il est sur ton profil, copiable en un clic.

## Lier BMM et Discord

Lier un **creator id** depuis BMM est ce qui permet à un dépôt ou un catalogue de te reconnaître quand son propriétaire a restreint l'accès par identité. Lier **Discord** fait pareil pour les règles Discord, et permet au bot de t'attribuer tes rôles automatiquement.

## Les notifications

La cloche dans la barre du haut. Tout ce qui te concerne y arrive : une soumission approuvée, une réponse à un signalement, une période d'hébergement qui se termine, une promo accordée.

## Le tableau de bord

**[Tableau de bord](/dashboard)** rassemble tes affaires : tes soumissions, tes catalogues, tes dépôts, tes pools de stockage, et ce que tu as mis en favori.`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'site-publishing', title: 'Publishing and hosting', titleFr: 'Publier et héberger', icon: 'upload', order: 53,
    body: `::toc[On this page]

# Publishing and hosting

## Submitting to a catalog

**[Submit](/submit)** takes a plugin, theme, app or preset and puts it in front of a moderator. Published items are public; a pending one is not listed but is reachable through its own share link, so you can show it to someone before it is approved.

You need a linked **creator id** to publish — it is what identifies the author beyond an email address.

## Hosting your own catalog

Two modes, and the choice is about where the files live:

| Mode | Downloads come from | Cost |
|---|---|---|
| **Just my catalog.json** | Your own links | Free |
| **Host files with us** | A storage pool you own | Priced by size |

Either way you pick **one type** for the catalog — see [Catalogs and repos](/docs/site-content) for why.

## Storage pools

**[Hosting](/hosting)** sells storage as a **pool**, not as a single repo. A pool is a slice of space you then fill with whatever you like: repos, catalogs, or nothing yet.

- A pool can hold several repos and catalogs at once.
- Pools can be **merged** if you buy more than one.
- A term that lapses suspends the contents for 72 hours before anything is removed — renewing inside that window restores everything.

:::note[Free tier]
There is a genuine free plan. It is one pool per account, and it is claimed once — unlinking and relinking does not reset it.
:::

## Promo codes

If you were given one, redeem it from the hosting page. A code can be a discount at checkout, a free storage pool, or a featured "boost" for a repo. The page tells you which kind it is before you commit.

## Make Your Own

**[Make Your Own](/myo)** is a paid commission service: you describe what you want, pay a consultation fee to open the conversation, and get a quote. Messages there arrive live — you do not need to refresh to see a reply.`,
    bodyFr: `::toc[Sur cette page]

# Publier et héberger

## Soumettre à un catalogue

**[Soumettre](/submit)** présente un plugin, un thème, une app ou un preset à un modérateur. Les éléments publiés sont publics ; un élément en attente n'est pas listé mais reste accessible par son propre lien de partage — tu peux donc le montrer à quelqu'un avant approbation.

Il te faut un **creator id** lié pour publier : c'est ce qui identifie l'auteur au-delà d'une adresse e-mail.

## Héberger ton propre catalogue

Deux modes, et le choix porte sur l'emplacement des fichiers :

| Mode | Les téléchargements viennent de | Coût |
|---|---|---|
| **Juste mon catalog.json** | Tes propres liens | Gratuit |
| **Héberger les fichiers chez nous** | Un pool de stockage à toi | Facturé à la taille |

Dans les deux cas tu choisis **un seul type** pour le catalogue — [Catalogues et dépôts](/docs/site-content) explique pourquoi.

## Les pools de stockage

**[Hébergement](/hosting)** vend du stockage sous forme de **pool**, pas de dépôt unique. Un pool est une tranche d'espace que tu remplis ensuite comme tu veux : des dépôts, des catalogues, ou rien pour l'instant.

- Un pool peut contenir plusieurs dépôts et catalogues à la fois.
- Les pools peuvent être **fusionnés** si tu en achètes plusieurs.
- Une échéance dépassée suspend le contenu pendant 72 heures avant toute suppression — renouveler dans cette fenêtre restaure tout.

:::note[Offre gratuite]
Il existe une vraie offre gratuite. C'est un pool par compte, réclamé une seule fois — délier puis relier un compte ne la réinitialise pas.
:::

## Les codes promo

Si on t'en a donné un, utilise-le depuis la page d'hébergement. Un code peut être une réduction à la commande, un pool de stockage offert, ou une mise en avant pour un dépôt. La page t'indique de quel type il s'agit avant que tu valides.

## Make Your Own

**[Make Your Own](/myo)** est un service de commande sur mesure : tu décris ce que tu veux, tu payes des frais de consultation pour ouvrir la conversation, et tu reçois un devis. Les messages y arrivent en direct — pas besoin de rafraîchir pour voir une réponse.`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'site-help', title: 'Getting help', titleFr: 'Obtenir de l’aide', icon: 'help-circle', order: 54,
    body: `::toc[On this page]

# Getting help

## Where to look first

| Question | Where |
|---|---|
| Short, common questions | [FAQ](/faq) |
| How BMM itself works | [Docs](/docs) |
| What changed recently | [Blog](/blog) |
| Anything else | [Contact](/contact) |

## Reporting something

The **Report** button appears on repos, catalogs, items and profiles. A report opens a private thread between you and the moderators — not a one-way form. Replies arrive live, and you can attach images.

You can follow your own reports from your dashboard. A closed thread reopens by itself if you or a moderator writes again.

## Getting a useful answer faster

Include the identifier. A repo has a \`BCR-XXXX-XXXX\` id, an account has a BC id, a catalog has its URL. Those identify a thing exactly, where a name may match several.

Say what you expected and what happened instead. "The Add to BMM button does nothing" is actionable; "the site is broken" is not.

## Account trouble

- **Lost password** — the reset link on the sign-in page.
- **Lost 2FA device** — contact the staff; a reset is a manual, verified action on purpose.
- **Suspended or banned account** — the sign-in page tells you which, and gives the reason recorded by the moderator.`,
    bodyFr: `::toc[Sur cette page]

# Obtenir de l'aide

## Où regarder d'abord

| Question | Où |
|---|---|
| Questions courtes et fréquentes | [FAQ](/faq) |
| Le fonctionnement de BMM lui-même | [Docs](/docs) |
| Ce qui a changé récemment | [Blog](/blog) |
| Tout le reste | [Contact](/contact) |

## Signaler quelque chose

Le bouton **Signaler** apparaît sur les dépôts, les catalogues, les éléments et les profils. Un signalement ouvre un fil **privé** entre toi et les modérateurs — pas un formulaire à sens unique. Les réponses arrivent en direct, et tu peux joindre des images.

Tu suis tes propres signalements depuis ton tableau de bord. Un fil clos se rouvre tout seul si toi ou un modérateur y écrit à nouveau.

## Obtenir une réponse utile plus vite

Donne l'identifiant. Un dépôt a un id \`BCR-XXXX-XXXX\`, un compte a un BC id, un catalogue a son URL. Ça désigne une chose exactement, là où un nom peut en désigner plusieurs.

Dis ce que tu attendais et ce qui s'est passé à la place. « Le bouton Ajouter à BMM ne fait rien » est exploitable ; « le site est cassé » ne l'est pas.

## Problèmes de compte

- **Mot de passe perdu** — le lien de réinitialisation sur la page de connexion.
- **Appareil 2FA perdu** — contacte l'équipe ; la réinitialisation est une action manuelle et vérifiée, volontairement.
- **Compte suspendu ou banni** — la page de connexion indique lequel, avec le motif enregistré par le modérateur.`,
  },
];

async function main() {
  let created = 0, updated = 0;
  for (const pg of PAGES) {
    const data = {
      title: pg.title, titleFr: pg.titleFr,
      category: CATEGORY, categoryFr: CATEGORY_FR,
      icon: pg.icon, order: pg.order,
      body: pg.body, bodyFr: pg.bodyFr, published: true,
    };
    const existing = await p.docPage.findUnique({ where: { slug: pg.slug }, select: { id: true } });
    if (existing) { await p.docPage.update({ where: { slug: pg.slug }, data }); updated++; }
    else { await p.docPage.create({ data: { slug: pg.slug, ...data } }); created++; }
  }
  console.log(`site guide: ${created} created, ${updated} updated, ${PAGES.length} total.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
