# Topologie — combien de machines, et quoi où

Où tourne chaque morceau de BCWEB. Commence à **un seul VPS** ; les formes suivantes
existent pour quand quelque chose de précis fait mal, et chacune dit laquelle.

Ce guide parle de **placement**. Il ne répète pas ce que les autres couvrent :

- Le mettre en route la première fois → [QUICKSTART_FR.md](QUICKSTART_FR.md)
- Le chemin complet vers la production (DNS, HTTPS, Stripe) → [DEPLOY_FR.md](DEPLOY_FR.md)
- Ce que fait chaque variable → [ENV_FR.md](ENV_FR.md)
- Activer un add-on précis (CDN, PgBouncer, R2…) → [ADDONS_FR.md](ADDONS_FR.md)

---

## À lire avant de séparer quoi que ce soit

**Séparer les machines ne rend pas un site plus rapide.** Ça déplace un goulot d'étranglement
et ça ajoute un saut réseau, une deuxième chose à sécuriser et une deuxième chose à
sauvegarder. Chaque forme ci-dessous demande strictement plus de travail que la précédente.

Monte d'un cran quand tu peux **nommer le symptôme** :

| Symptôme | Forme visée |
|---|---|
| Rien ne fait mal | Reste sur **① un VPS** |
| La base manque de RAM/IO pendant que la partie web se tourne les pouces (ou tu veux les sauvegarder séparément) | **② base sur sa propre machine** |
| Un conteneur API sature : CPU au plafond, latence qui grimpe sous charge | **③ plusieurs réplicas d'API** |
| Une seule machine web ne suit plus, même répliquée, ou tu veux des déploiements sans coupure | **④ plusieurs machines web derrière un répartiteur** |

Si tu ne peux pas nommer le symptôme, la réponse est **agrandir la machine que tu as déjà**.
Un seul VPS bien dimensionné porte cette charge très loin, et c'est le changement le moins
coûteux que tu feras jamais.

---

## ① Un VPS — la forme normale

Tout sur une machine, ce que décrit `infra/compose/docker-compose.yml` : Caddy, le build web,
l'API, Postgres, Redis, MinIO, le bot, le service de télémétrie et son propre Postgres.

```bash
cd infra/compose
cp .env.example .env      # puis édite-le — voir ENV_FR.md
docker compose up -d
```

Puis initialise la base (projets, compte admin, plans, docs, FAQ) :

```bash
docker compose exec api npm run setup
```

Renseigne `SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` dans `.env` **avant ce premier
lancement**, sinon tu obtiens `admin@bettercommunity.local` / `change-me-now`. Le compte
n'est créé que s'il n'existe pas déjà : relancer la commande ne réinitialise jamais un mot de
passe que tu aurais changé depuis.

**Dimensionnement.** 4 vCPU / 8 Go est confortable pour un site communautaire ; 2/4 suffit si
tu n'héberges pas de gros dépôts. C'est le **disque** qui s'épuise en pratique : les dépôts
hébergés et les charges utiles des catalogues vivent dans MinIO, dimensionne-le donc en face
de `hosting.totalCapacityGB`, pas en face du trafic.

**Les sauvegardes comptent plus que la topologie.** Une machine, c'est une seule chose à
perdre. Mets en place [BACKUP_FR.md](BACKUP_FR.md) avant de te soucier des formes suivantes,
et fais une restauration au moins une fois pour savoir qu'elle fonctionne.

---

## ② La base sur sa propre machine

**Passe ici quand** Postgres se dispute la RAM ou les IO avec la partie web, ou quand tu veux
sauvegarder, patcher et redémarrer la base à son propre rythme. C'est aussi la forme que tu
obtiens gratuitement en prenant un Postgres managé.

C'est un changement de `.env` et rien d'autre — l'API parle à ce que ces URL désignent :

```ini
DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require
DIRECT_DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require
```

```bash
docker compose up -d api provisioner
```

**Les deux variables, toujours.** `DATABASE_URL` est la connexion d'exécution (poolée) ;
`DIRECT_DATABASE_URL` est une connexion directe pour les migrations, qui ne peuvent pas
passer par un pooler en mode transaction. Prisma échoue avec un `P1012` quand l'une manque,
et cette erreur ne ressemble en rien à « tu as oublié une variable d'environnement ».

**Arrête le service `db` local**, pour ne pas faire tourner un Postgres dont personne ne se
sert :

```bash
docker compose stop db
```

Ne fais pas `docker compose down -v` : ça supprime le volume `db-data` avec l'ancienne base
dedans. Garde-le jusqu'à ce que la nouvelle machine ait fait ses preuves.

**Verrouille la base.** Elle est désormais joignable par le réseau :

- `sslmode=require` dans les deux URL, non négociable.
- Ferme le port 5432 à tout sauf l'IP de la machine web. Un Postgres ouvert sur Internet est
  trouvé par les scanners en quelques heures.
- Un rôle dédié pour l'application — pas `postgres`.

### Plusieurs bases

Trois choses différentes se cachent derrière cette phrase, et elles ne sont pas
interchangeables.

**La télémétrie sur son propre Postgres — déjà fait.** `TELEMETRY_DATABASE_URL` pointe vers
une instance séparée et le compose en lance déjà une. C'est le bon modèle pour des données
qui n'ont jamais besoin d'une transaction avec le reste.

**Les réplicas de lecture** — mêmes données, lectures réparties. Rien dans l'application ne
route les lectures aujourd'hui : un client Prisma, une URL. L'ajouter veut dire l'extension
`@prisma/extension-read-replicas` dans le `db()` de `lib.mjs`, plus la gestion du **retard de
réplication** : après une écriture, lire sur un réplica peut renvoyer l'ancienne valeur, donc
tout parcours « j'écris puis je relis aussitôt » doit être forcé sur le primaire. N'ajoute pas
de réplicas avant le cache et PgBouncer, moins chers et généralement suffisants.

**Le sharding** — utilisateurs répartis sur N bases par clé. Prisma ne le fait pas ; ce serait
du routage applicatif, et les jointures inter-shards, les transactions et les compteurs
deviennent chacun un projet à part entière. Ce n'est presque certainement pas ta réponse.

---

## ③ Plusieurs réplicas d'API — une seule machine web

**Passe ici quand** un conteneur API sature. L'API est sans état, et son cache comme son
limiteur de débit sont partagés via Redis : les réplicas se comportent comme un seul.

C'est `docker compose up -d --scale api=3` et rien d'autre — le port hôte est une plage et
Caddy re-résout `api`, donc les deux choses qui demandaient une édition manuelle sont déjà
dans le dépôt. [ADDONS_FR.md](ADDONS_FR.md) §3 donne le détail, dont le seul proxy qui reste
statique.

Deux choses à avoir en place d'abord :

- **PgBouncer** (§2). Chaque réplica ouvre ses propres connexions à la base ; c'est le pooler
  qui borne le total. Postgres épuise ses créneaux de connexion bien avant son CPU.
- **`REDIS_URL` renseignée.** Au-delà du cache et du limiteur, le chat en direct (commandes
  sur mesure et fils de signalement) publie via Redis pour qu'un message atteigne les lecteurs
  sur **tous** les réplicas. Sans elle, le bus est en processus : un message publié sur le
  réplica A n'atteint jamais un lecteur sur le réplica B, qui ne voit simplement rien jusqu'à
  ce qu'il recharge.

---

## ④ Plusieurs machines web

**Passe ici quand** même une API répliquée sur une machine ne suit plus, ou quand tu veux des
déploiements progressifs sans coupure.

Chaque machine web fait tourner Caddy + web + réplicas d'API ; Postgres, Redis et MinIO sont
partagés et doivent déjà être **hors** de ces machines (forme ②). Ce qui change :

- **Un répartiteur de charge devant**, et **les sessions collantes ne sont pas nécessaires** —
  l'authentification est un cookie signé, donc n'importe quelle machine peut servir n'importe
  quelle requête. C'est cette propriété qui rend la forme simple ; ne la casse pas en mettant
  de l'état dans un processus.
- **Redis devient une infrastructure obligatoire**, plus un add-on. C'est ce qui fait du
  limiteur un budget unique partagé, du cache un cache cohérent, et du chat en direct un chat
  inter-machines.
- **Le stockage objet doit être partagé** — MinIO sur son propre hôte, ou R2
  ([ADDONS_FR.md](ADDONS_FR.md) §4). Deux machines avec deux MinIO locaux, c'est un fichier
  téléversé qui existe sur l'une et renvoie 404 sur l'autre.
- **Une seule machine fait tourner les singletons.** Le bot Discord et le sweeper ne doivent
  pas tourner en double : deux bots répondent deux fois à chaque commande, et deux sweepers se
  disputent les mêmes lignes. Une seule machine.
- **`COOKIE_DOMAIN`** doit couvrir tous les noms d'hôte que tu sers, sinon les sessions cassent
  dès que le répartiteur déplace quelqu'un d'une machine à l'autre.

Il n'y a aucun manifeste Kubernetes dans ce dépôt. Une version antérieure de ce guide
affirmait qu'un dossier infra/k8s existait ; ce n'est pas le cas, et envoyer quelqu'un vers un dossier
absent est pire que de ne rien dire.

Rien dans le projet n'exige Kubernetes de toute façon. Compose sur deux ou trois machines se
raisonne et se débogue plus facilement à trois heures du matin, qui est le seul moment où la
différence compte.

---

## Quoi vérifier après chaque déplacement

Quelle que soit la forme obtenue, vérifie les mêmes quatre choses :

```bash
curl -sS https://<ton-domaine>/api/health          # l'API répond
curl -sS https://<ton-domaine>/api/ready           # elle atteint la base
docker compose logs --tail=50 api                  # pas de boucle de redémarrage
```

Puis, depuis le dépôt :

```bash
cd apps/api && npm run test:e2e                    # du HTTP réel contre le site en marche
```

Vise ailleurs avec `E2E_BASE_URL=https://<ton-domaine>`. C'est en lecture seule. Si ça affiche
`NOTHING WAS TESTED`, aucun serveur n'a répondu — un run où tout est sauté sort quand même en
code 0, donc lis cette bannière plutôt que le code de sortie.

Et restaure une sauvegarde sur une machine jetable. Une sauvegarde jamais restaurée est une
hypothèse, pas une sauvegarde.
