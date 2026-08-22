# Les seeds — ce que chacun met dans la base

Une base BCWEB neuve est vide : pas de projets, pas d'admin, pas de plans d'hébergement,
pas de docs, pas de catalogue. Les seeds la remplissent. Il y en a plusieurs parce qu'ils
répondent à des questions différentes, et lancer le mauvais, c'est se retrouver avec un
site qui a l'air fini et qui ne l'est pas.

**Tous les seeds sont idempotents.** Ils font un upsert sur une clé stable (slug, e-mail,
clé de projet), donc relancer un seed rafraîchit son contenu au lieu de le dupliquer.
C'est ce qui en fait des outils de réparation et pas seulement d'amorçage.

À lancer dans le conteneur API :

```bash
docker compose -f infra/compose/docker-compose.yml exec api npm run seed
```

Ou depuis `apps/api/` avec `DATABASE_URL` défini, si tu fais tourner l'API sur la machine.

---

## En un coup d'œil

| Commande | Script | Écrit | OK sur un site en ligne ? |
|---|---|---|---|
| `npm run seed` | `apps/api/src/seed.mjs` | `Project`, `User` (l'admin), `HostingPlan`, `AdminSetting`, `Badge`, `BlogPost` | **Lis l'avertissement plus bas** |
| `npm run seed:content` | `apps/api/src/seed-content.mjs` | rien lui-même — enchaîne les quatre ci-dessous, dans l'ordre | Oui |
| `npm run seed:docs` | `apps/api/src/seed-docs.mjs` | `DocPage` (la doc utilisateur de BMM, EN + FR) | Oui |
| `npm run seed:faq` | `apps/api/src/seed-faq.mjs` | `FaqItem` | Oui |
| `npm run seed:site` | `apps/api/src/seed-site-guide.mjs` | `DocPage` (la visite guidée « Utiliser le site ») | Oui |
| `npm run seed:demo` | `apps/api/src/seed-demo.mjs` | `CatalogItem`, `User`, `Project` | **Dev uniquement** |

Deux fichiers du dossier ne sont **pas** des seeds exécutables — ce sont des données de
traduction importées par les seeds ci-dessus, et les lancer directement ne fait rien :

- `apps/api/src/seed-docs-fr.mjs` — les corps français des pages de doc, indexés par slug.
  Importé par `seed-docs.mjs`.
- `apps/api/src/seed-blog-fr.mjs` — le français des articles de blog. Importé par `seed.mjs`.

Ils vivent à côté de leur moitié anglaise plutôt que dedans parce qu'une traduction se
relit d'un bloc : on veut lire les pages françaises à la suite, pas les chercher entre des
backticks.

---

## Celui qui porte un avertissement : `npm run seed`

C'est l'amorçage. Il crée la plateforme elle-même — les projets fixes, les plans
d'hébergement, les réglages admin par défaut, les badges, les actualités — et **un compte
administrateur**.

Si `SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` ne sont pas définis, il retombe sur
`admin@bettercommunity.local` avec un mot de passe qui est **dans le dépôt**. Sur un
portable, c'est tout l'intérêt d'un défaut. Sur une base de production, c'est un compte
administrateur fonctionnel pour quiconque a lu ce dépôt.

Il y a un garde-fou : avec `NODE_ENV=production` et sans `SEED_ADMIN_PASSWORD`, le seed
refuse de tourner et dit pourquoi. Il protège le cas qu'il voit. Il ne voit pas une
préprod qui a oublié `NODE_ENV`, ni une machine « temporairement » joignable — donc définis
les deux variables et ne compte pas sur le garde-fou.

Avant le premier seed sur autre chose que ta machine :

```bash
SEED_ADMIN_EMAIL=toi@example.com SEED_ADMIN_PASSWORD='<quelque chose de long>' npm run seed
```

`infra/bootstrap.sh` les met dans l'environnement avant de seeder, pour la même raison. Les
définir *après* le seed ne fait rien — le compte existe déjà avec le mot de passe qu'il a
reçu à sa création.

---

## Le jeu de contenu : `npm run seed:content`

Une seule commande pour remettre le contenu rédigé du site après un effacement, dans le
bon ordre :

1. `seed.mjs` — la base : admin, projets, plans, articles
2. `seed-docs.mjs` — les pages de documentation (EN + FR)
3. `seed-faq.mjs` — la FAQ
4. `seed-site-guide.mjs` — le guide du site

Il s'arrête au premier échec, dit quelle étape l'a stoppé, et laisse les suivantes non
lancées. C'est voulu : un site à moitié seedé est pire qu'un site vide, parce qu'il a l'air
fini. Chaque étape étant idempotente, corriger l'étape fautive et tout relancer est sans
risque.

### Pourquoi la doc tient en deux seeds

`seed:docs` documente **BMM, l'application bureau**. `seed:site` documente **le site web** —
le catalogue, l'explorateur de dépôts, la page d'hébergement, le tableau de bord, et
comment ils s'articulent. Les deux écrivent des lignes `DocPage`, ils ne se recouvrent pas,
et un visiteur qui arrive a autant besoin du second que du premier.

---

## Dev uniquement : `npm run seed:demo`

Des éléments de catalogue dont la *forme* correspond à la production, pour qu'un stack de
dev neuf ait quelque chose à afficher et que le harnais de charge de `loadtest/` ait
quelque chose à solliciter. `seed.mjs` ne crée aucun élément de catalogue, donc sans ça la
page catalogue est vide.

Il crée des utilisateurs et des éléments de démo. À ne pas lancer sur un site que de vraies
personnes utilisent : une fois dans la liste, rien ne distingue le contenu de démo du vrai.

---

## Après un effacement

`npm run clear-content` vide le contenu utilisateur (dépôts, catalogues, éléments). Il ne
retire pas la plateforme : projets, plans, réglages et admin survivent. La récupération
habituelle est donc :

```bash
npm run clear-content   # puis, pour remettre le contenu rédigé :
npm run seed:content
```

`npm run nuke` va plus loin. Lis ce qu'il affiche avant de lui répondre.
