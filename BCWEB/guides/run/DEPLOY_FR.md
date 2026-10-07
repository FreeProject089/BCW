# BCWEB — Guide de déploiement en production (FR)

> 🇬🇧 English version: [DEPLOY_EN.md](DEPLOY_EN.md)

Comment déployer toute la stack BetterCommunity Web (SPA + API Fastify + Postgres +
Redis + stockage objet + bot Discord + télémétrie + Caddy) sur un vrai serveur, avec HTTPS
automatique. Tout tourne dans Docker Compose derrière Caddy.

---

## 1. Ce qu'il te faut

- Un serveur Linux (VPS ou box) avec **Docker + Docker Compose v2** et une **IP publique**.
- **Ports 80 et 443 ouverts** sur Internet (80 est requis pour le challenge ACME de
  Let's Encrypt, 443 sert le HTTPS).
- Un **domaine** que tu contrôles (ex. `community.example.com`) — et éventuellement un
  sous-domaine `telemetry.example.com`.
- Des clés Stripe (test ou live) si tu veux l'hébergement/boosts payants.

## 2. Cloner & configurer

```bash
git clone --recurse-submodules <ton-repo> bcweb
cd bcweb/BCW/BCWEB           # (le compose est sous infra/compose)
cp infra/compose/.env.example infra/compose/.env
```

Édite `infra/compose/.env` — les clés importantes :

| Clé | Rôle |
|---|---|
| `SITE_URL` | URL publique complète, ex. `https://community.example.com` (mails, redirections Stripe, liens du bot) |
| `SITE_DOMAIN` | Ton domaine **nu**, ex. `community.example.com` — Caddy s'y attache et **provisionne le HTTPS**. (Défaut dev local : `http://localhost:5176`) |
| `COOKIE_DOMAIN` | `.ton-domaine.com` (point initial) pour que le cookie de session atteigne aussi les sous-domaines (telemetry) |
| `POSTGRES_PASSWORD` | Un mot de passe DB solide |
| `JWT_SECRET` | Une longue chaîne aléatoire (`openssl rand -hex 32`) |
| `BOT_SHARED_SECRET` | Longue chaîne aléatoire — le secret partagé API↔bot |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Depuis le dashboard Stripe (voir §6) |
| `DISCORD_TOKEN` | Optionnel — sinon défini depuis le dashboard admin |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Identifiants du stockage objet (le service `storage` fourni les prend comme les siens). L'API refuse de démarrer en prod sur un `S3_SECRET_KEY` vide, `change-me…` ou de moins de 24 caractères ([ENV_FR.md](ENV_FR.md) §4) |

> **Ne commit jamais `.env`.** Il contient des secrets réels et est gitignore. Seul
> `.env.example` est versionné.

## 3. Pointer le DNS vers le serveur

Chez ton fournisseur DNS :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `community.example.com` | IPv4 du serveur |
| `AAAA` (optionnel) | `community.example.com` | IPv6 du serveur |
| `A` (optionnel) | `telemetry.example.com` | IPv4 du serveur |

Attends la propagation : `nslookup community.example.com` doit renvoyer ton IP.

## 4. Lancer la stack

```bash
cd infra/compose
docker compose up -d --build
docker compose ps            # chaque service doit être "healthy"/"running"
docker compose logs -f caddy # regarde le certificat TLS s'émettre
```

Caddy provisionne et renouvelle automatiquement un certificat Let's Encrypt pour
`SITE_DOMAIN` — **aucune gestion manuelle de certificat**. La première émission prend
quelques secondes une fois le DNS résolu.

L'API applique les migrations commitées au démarrage (`boot-migrate.mjs` → `prisma migrate
deploy`), le schéma est donc créé automatiquement. Va sur `https://community.example.com` —
l'app doit s'afficher en HTTPS.

## 5. Premier admin

1. Crée le premier compte via l'interface.
2. Passe-le admin en base (une seule fois) :
   ```bash
   docker compose exec db psql -U bcweb -d bcweb -c \
     "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='toi@example.com';"
   ```
3. Recharge — la zone **Admin** est disponible (modération, quotas d'hébergement, bot,
   analytics, réglages).

## 6. Stripe (paiements)

1. Dans le dashboard Stripe, récupère ta **clé secrète** → `STRIPE_SECRET_KEY`.
2. Crée un endpoint webhook vers
   `https://community.example.com/hosting/webhook` (un alias `/webhook` marche aussi).
   Abonne au minimum : `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`.
3. Copie le **secret de signature** de l'endpoint (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. `docker compose up -d api` pour recharger.

> **Si le webhook était en panne pendant qu'on payait :** rien n'est perdu. Chaque checkout
> est inscrit dans un registre `PendingCheckout` à l'ouverture ; au démarrage, et toutes les
> dix minutes, l'API demande à Stripe ce qu'il est advenu de ceux encore ouverts et les termine
> par le même code que le webhook. Admin → **Hébergement & facturation → Paiements en
> attente** montre le registre et a un bouton **Réconcilier maintenant** pour les impatients.
> Un paiement qu'il a fallu terminer ainsi est signalé sur la page Erreurs admin (source
> `reconcile`) et notifié aux super-admins.

> **Sans `STRIPE_WEBHOOK_SECRET`, le webhook renvoie 503** — aucun paiement n'est
> enregistré ni provisionné. L'onglet admin **Discord bot → Payments** affiche un
> diagnostic ✓/✗ pour la clé Stripe + le secret webhook.
>
> **Test local :** `stripe listen --forward-to http://localhost:3000/hosting/webhook`
> et utilise le `whsec_…` affiché comme `STRIPE_WEBHOOK_SECRET`. Le conteneur API est
> sur **:3000** (pas le `:4242` d'exemple de Stripe).

## 7. Bot Discord (optionnel)

Soit tu définis `DISCORD_TOKEN` dans `.env`, soit tu le laisses vide et tu colles le
token dans l'onglet admin **Discord bot** (il se connecte sous ~20s, sans redémarrage).
L'app Discord doit avoir les intents privilégiés **Server Members + Message Content**
activés dans le Developer Portal.

## 8. Télémétrie (optionnel)

Le dashboard de télémétrie BMM tourne dans son propre service (`telemetry` +
`telemetry-db`). Pointe `telemetry.example.com` vers le serveur et définis
`TELEMETRY_INTERNAL_URL` + `TELEMETRY_ADMIN_KEY` dans `.env` pour gérer ses limites
depuis l'admin BCWEB.

`/demo`, sur cette même origine, ouvre le dashboard sur des **données générées**, toute
écriture, suppression ou export étant refusée : de quoi montrer à quoi ressemble le dashboard
sans montrer la télémétrie de qui que ce soit. Ce n'est pas une page publique : sur cette
origine, tout sauf les chemins d'ingestion passe par le `forward_auth` de l'edge, donc `/demo`
demande toujours une session BCWEB avec le droit télémétrie.

**Erreurs en direct (Issues).** Les installations BMM qui envoient leurs erreurs en direct les
postent sur `/issues` sur la même origine ; Caddy laisse passer ce chemin comme `/batch` (clé
d’ingestion publique, son propre compteur). L’écran **Issues** du tableau les affiche en direct et
demande les étiquettes de Laya par l’API (voir [AI_LAYA_FR.md](AI_LAYA_FR.md) §12) ;
`TELEMETRY_ISSUES_AI=0` coupe cela de ce côté.

## 8b. SSO — « Se connecter avec BetterCommunity » (provider OpenID Connect)

BCWEB est un **fournisseur OpenID Connect** standard — d'autres services (les tiens ou
tiers) peuvent laisser les gens se connecter avec leur compte BetterCommunity. **Zéro
config** : la clé de signature RS256 est générée automatiquement à la première utilisation
et l'issuer est ton `SITE_URL`. Caddy route déjà `/.well-known/*` et `/oauth2/*` vers l'API.

1. **Enregistre le client** dans Admin → **SSO / OAuth** : un nom, la/les redirect URI(s), et
   les scopes (`openid`, `profile`, `email`). Tu obtiens un **client_id**, et pour un client
   confidentiel (serveur) un **client_secret affiché une seule fois** (garde-le ; tu peux le
   faire tourner). Les clients publics (SPA / mobile) utilisent **PKCE** et n'ont pas de secret.
2. **Pointe la lib OIDC du client sur le document de découverte** — il trouve tout le reste :
   ```
   https://community.example.com/.well-known/openid-configuration
   ```
   Il annonce les endpoints authorize / token / userinfo / jwks / revoke, `RS256`, et PKCE `S256`.

Flux : **authorization code + PKCE** standard ; écran de consentement brandé (mémorisé après
la première fois) ; tokens RS256 (vérifiés via le JWKS) ; les refresh tokens **tournent** (la
réutilisation est détectée et révoque toute la famille de tokens).

## 8c. Email (confirmation de compte + réinitialisation du mot de passe)

L'email transactionnel est **désactivé par défaut** — sans lui, la réinitialisation du mot de
passe renvoie le token dans la réponse de l'API (flux dev) et aucun email de confirmation
n'est envoyé. Pour l'activer en production, mets ceci dans `.env` puis `docker compose up -d api` :
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.ton-fournisseur.com
SMTP_PORT=587                # 465 = TLS implicite, sinon STARTTLS
SMTP_USER=…
SMTP_PASS=…
SMTP_FROM=BetterCommunity <no-reply@ton-domaine.com>
```
Une fois activé : les nouvelles inscriptions reçoivent un **email de confirmation** (lien →
`/verify-email`), et les **réinitialisations** envoient un lien valable 1 heure (→
`/auth?reset=…`). Les deux tokens sont à usage unique. N'importe quel fournisseur SMTP
convient — celui de ton hébergeur, SendGrid, Mailgun, Amazon SES, ou un relais auto-hébergé.

## 8d. IA pour la modération (optionnelle, éteinte par défaut)

Rien à faire pour une installation normale : sans elle, le moteur de règles modère seul. Pour
ajouter le classifieur Laya comme second avis, mets `COMPOSE_PROFILES=ai` et une `LAYA_API_KEY`
dans `.env`, lance une fois `docker compose --profile ai build laya`, puis `docker compose up -d` :
un `laya-fetch` ponctuel télécharge le modèle (~0,7 Go) et `laya` le sert sur un réseau interne
sans port publié, plafonné à 1,5 CPU et 2 Go. Choisis ensuite le fournisseur dans Admin →
Modération → Fournisseur d'IA. La coupure d'urgence, les chiffres de ressources, l'option d'API
externe et ce qu'elle implique pour la vie privée : [AI_LAYA_FR.md](AI_LAYA_FR.md).

## 9. Mise à jour

### La méthode courte

```bash
infra/deploy.sh
```

Sauvegarde, récupère, reconstruit, attend que l'API réponde vraiment, et **remet le commit
précédent si elle ne répond pas**. Utilise celle-là.

| Option | Effet |
|---|---|
| `--dry-run` | Affiche chaque étape sans rien changer. Sans risque, même maintenant. |
| `--no-backup` | Saute le dump — seulement si tu viens d'en faire un. |
| `--no-rollback` | Laisse la version cassée en place pour l'examiner. |

Il refuse de démarrer si l'arbre de travail a des modifications non commitées : le retour
arrière est un `git reset --hard` et les emporterait.

### Ce qu'il attend

`/ready` renvoie **503** tant que l'API ne peut pas interroger la base. Le script attend donc
que le site fonctionne, pas qu'un processus existe. Les migrations tournent au démarrage du
conteneur, donc cette fenêtre les couvre aussi. `READY_TIMEOUT=120` secondes par défaut.

### La seule chose qu'il ne fera pas

**Il ne remet pas la base en arrière.** Les migrations ne vont que dans un sens : revenir au
commit précédent restaure le code et laisse le schéma où il est. Un retour arrière qui
annulerait les données en silence pourrait détruire tout ce qui a été écrit entre la
sauvegarde et la panne, et toi seul peux en juger — le script affiche donc l'emplacement du
dump et s'arrête. La restauration est en section 10.

### À la main

```bash
git pull
cd infra/compose
docker compose up -d --build      # reconstruit les images modifiées, migrations au boot
```

Les mises à jour sont **gracieuses** dans les deux cas : quand le conteneur API est remplacé,
il capte le `SIGTERM`, termine les requêtes en cours, puis ferme ses connexions DB/Redis avant
de quitter (budget de 10 s) — un rebuild ne coupe jamais une requête en vol. Avec 2+ réplicas
(section suivante), le déploiement est invisible pour les utilisateurs.

### Depuis GitHub (CD)

`.github/workflows/deploy.yml` déploie la pointe de `master` sur le VPS. Le compromis que
redoutait le paragraphe qui se trouvait ici (une clé dans les secrets GitHub est une nouvelle
porte) est réglé par ce que cette clé a le droit de faire : **une seule commande imposée**.

- **La clé.** Une clé ed25519 dédiée, dans `~/.ssh/authorized_keys` de l'utilisateur de
  déploiement sous la forme
  `restrict,command="/srv/BetterCommunity/deploy-gate.sh" ssh-ed25519 AAAA… bcweb-deploy@github-actions`.
  `restrict` coupe le terminal et toute redirection ; `command=` fait exécuter la porte par sshd,
  quoi que le client demande. Une clé volée ne donne ni shell, ni copie de fichier, ni tunnel
  vers la base.
- **La porte** (`infra/deploy-gate.sh`, installée HORS du dépôt avec
  `install -m 0755 BCWEB/infra/deploy-gate.sh /srv/BetterCommunity/deploy-gate.sh`, pour qu'un
  commit ne puisse pas réécrire la porte qui le déploie) n'accepte que `status` et
  `deploy <sha de 40 caractères> [--dry-run]`, et le sha doit être la pointe actuelle de
  `origin/master`, récupérée par le serveur lui-même. Elle refuse un dépôt modifié, prend un
  verrou (un déploiement à la fois), lance `infra/deploy.sh` (sauvegarde, pull, build, attente
  de `/ready`, retour du code en arrière s'il ne démarre pas) et journalise dans
  `/srv/BetterCommunity/deploy-logs/`.
- **L'interrupteur.** Tant que `/srv/BetterCommunity/deploy-gate.disabled` existe, tout
  déploiement est refusé (`status` répond toujours). `touch` pour couper le CD tout de suite,
  `rm` pour le rouvrir.
- **Déclenchement.** À la main : Actions > *BCWEB deploy (production)* > Run workflow sur
  `master`, avec une case « dry run ». Automatiquement après une *BCWEB CI* verte sur un push
  vers `master`, seulement si la variable du dépôt `CD_AUTO_DEPLOY` vaut exactement `true`. Les
  deux passent par l'environnement GitHub `production` : ajoute-y des relecteurs obligatoires
  pour que chaque déploiement attende ton accord.
- **La sécurité d'abord.** Avant même d'écrire la clé sur le runner, le job vérifie que
  *BCWEB security* (Gitleaks, Semgrep, Trivy) **est passé pour le commit exact** qu'il déploie :
  `gh api` liste les runs de ce commit avec le jeton du job, en lecture seule (`actions: read`,
  `checks: read`, sur ce seul job), et `.github/scripts/security-verdict.mjs` décide. Pas
  encore lancé ou en cours : il redemande toutes les 30 s pendant 20 minutes au plus, puis
  échoue (« no successful BCWEB security run for it after 20 minutes » : lance ce workflow à la
  main sur `master`, puis redéploie). Échoué ou annulé : il échoue tout de suite. Un run de pull
  request ne compte pas (il a testé une fusion, pas ce commit). *BCWEB DAST* n'est **pas**
  attendu : il ne tourne pas sur le push vers `master`, il lui faut toute une instance en marche
  et dix minutes, et il juge les en-têtes du site plutôt qu'un commit ; il reste donc
  consultatif, à lire sur la PR et dans le run hebdomadaire. Détails :
  [CI_CD_FR.md](CI_CD_FR.md#bcweb-deploy-deployyml--le-cd).
- **Configuration** (Settings > Secrets and variables > Actions) : secret `DEPLOY_SSH_KEY` (la
  clé privée) ; variables `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS` (la
  ligne de clé d'hôte du serveur, obligatoire : pas de confiance au premier contact) et, au
  choix, `CD_AUTO_DEPLOY`.

**Les modifications locales du serveur** ne doivent pas vivre dans des fichiers suivis, sinon
la porte (et `deploy.sh`) refuse de déployer : les ajouts compose vont dans
`infra/compose/docker-compose.override.yml` (ignoré par git ; `deploy.sh` et un simple
`docker compose` le lisent), les autres sites dans `infra/caddy/sites.d/<nom>.caddy` (ignoré,
importé par le Caddyfile).

**Tester sans déployer** : `ssh -i <clé de déploiement> -p <port> <user>@<hôte> status`, ou
lancer le workflow avec *dry run* coché (la porte vérifie quand même le sha et le dépôt, puis
`deploy.sh --dry-run` affiche chaque étape sans rien changer).

**Le premier déploiement après septembre 2026** est une migration et se fait à la main,
interrupteur en place : déplacer les modifications locales du serveur (le bloc du site
`bettervault` dans `caddy/sites.d/` ; `extra_hosts` est dans le compose suivi depuis octobre 2026) puis
`git checkout` des deux fichiers suivis ; mettre `.env` à jour (`BOT_SHARED_SECRET`, un
`S3_SECRET_KEY` d'au moins 24 caractères, `S3_CORS_ALLOW_ORIGIN` à la place de
`MINIO_API_CORS_ALLOW_ORIGIN`, `DOMAIN_ASK_KEY`, `LINK_LOOKUP_SECRET` différent de `JWT_SECRET`, un `SITE_URL` en `https://` ;
`node infra/check-env-spec.mjs` vérifie la spec de l'assistant, PAS ton `.env`) ; suivre *Quitter MinIO* pour le stockage ; puis `infra/deploy.sh`. Ne retirer
l'interrupteur qu'une fois ce déploiement vert.

## 10. Sauvegardes

Utilise le script fourni — il fait un `pg_dump` cohérent, archive les volumes stockage objet +
audit-anchor, purge les vieilles copies, et peut envoyer hors-site avec rclone :
```bash
infra/backup/backup.sh                                       # → /var/backups/bcweb
BACKUP_DIR=/mnt/backups BACKUP_REMOTE=b2:bucket/bcweb infra/backup/backup.sh   # + hors-site
```
Automatise-le chaque jour (03:30) avec `crontab -e` :
```
30 3 * * * BACKUP_DIR=/mnt/backups /chemin/vers/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```
**Restauration :**
```bash
# Postgres :
gunzip -c pg-bcweb-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U bcweb bcweb
# Stockage objet (arrête-le d'abord : docker compose stop storage) :
docker run --rm -v bcweb_s3-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/s3-YYYYMMDD-HHMMSS.tar.gz'
```
> **Ne fais jamais** `docker compose down -v` en prod — `-v` supprime les volumes
> (base de données + stockage objet). Et **teste une restauration au moins une fois** — une
> sauvegarde jamais testée n'en est pas une.

## 11. Santé & supervision

L'API expose trois sondes (toutes exemptées du rate limiter, sans logs de requête) :

- **Liveness — `GET /live`** : légère, **sans dépendance**, 200 tant que le process tourne.
  Elle ne touche jamais la DB : une panne de base ne peut donc pas provoquer de boucle de
  redémarrage.
- **Readiness — `GET /ready`** : 200 quand la DB est joignable, **503** sinon — un load
  balancer / orchestrateur sort alors l'instance de la rotation *sans la tuer*.
- **`GET /health`** : la sonde combinée (toujours 200 avec un drapeau `db: true/false`) ;
  c'est celle qu'utilisent le healthcheck Docker et le `depends_on` de Caddy.
- L'onglet admin **Server perf** montre CPU/RAM/disque, la santé des dépendances,
  l'historique de downtime et les alertes récentes (dédupliquées, copiables). Chaque alerte
  porte une **gravité** décidée là où elle est levée — `critical` (un service est tombé, une
  capacité survendue), `warning` (un seuil franchi), `info` — et une **clé de condition**
  (`cpu`, `disk`, `service_down:db`…). À chaque tick le moniteur **clôt** les alertes ouvertes
  dont il ne voit plus la condition : « c'est toujours en cours ? » devient une question à
  laquelle la liste répond, ce qui n'est pas la même chose qu'accuser réception (qui dit
  seulement qu'un humain a regardé). Seule une vérification qui a vraiment rendu sa réponse
  peut clore ses propres alertes : celle qui a échoué n'a pas d'avis, et n'a pas le droit de
  déclarer une panne terminée.
- Test de charge : `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## 12. Verrouille — pare-feu (juste après le premier déploiement)

Seul Caddy doit être exposé à Internet. Le compose publie aussi `5432` (db), `3000-3009` (api),
`9000` (stockage objet) et le `5176` du site local de Caddy — sur `127.0.0.1` seulement : ils
répondent sur le serveur lui-même (la sonde `/ready` des scripts de déploiement, un tunnel SSH) et
nulle part ailleurs. Seuls le `80` et le `443` de Caddy sont publiés vers le réseau, et la CI échoue
sur tout autre (`node BCWEB/infra/check-published-ports.mjs`, sur chaque fichier compose du dépôt).

**C'est l'adresse de liaison qui protège, pas le pare-feu.** Docker écrit ses propres règles
iptables pour les ports publiés, avant celles d'ufw : `ufw deny 3000` ne fait rien pour un conteneur
publié sur `0.0.0.0:3000`. Un hôte ou LXC Alpine (le serveur de production en est un, sur Proxmox)
n'a pas d'ufw du tout. Vérifie ce que le serveur publie vraiment — après chaque déploiement, pas
seulement le premier :
```bash
docker ps --format '{{.Names}} {{.Ports}}'
# attendu : 0.0.0.0/[::] UNIQUEMENT sur 80 et 443 (caddy) ; tout le reste en 127.0.0.1:...
```
et depuis une machine **extérieure** (pas le serveur), `nc -zv <ip-serveur> 3000 9000 9001 5176`
doit échouer pour chaque port. Ferme quand même tout sauf SSH + HTTP(S) en bordure — le pare-feu
de l'hébergeur/Proxmox, ou ufw sur un hôte Debian/Ubuntu :
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```
Le stockage objet n'a pas de console à atteindre ; versitygw ne sert que le S3. Pour atteindre un
port en boucle locale depuis ta machine, passe par un tunnel SSH :
`ssh -L 9000:127.0.0.1:9000 -p <port-ssh> <user>@<serveur>`. Procédure de correction du serveur de
production (ports publiés sur toutes les interfaces, octobre 2026) :
[SECURITY_PORTS_FIX_FR.md](SECURITY_PORTS_FIX_FR.md).
Postgres, Redis et le stockage objet restent sur le réseau Docker interne — ne les expose
jamais. (Le `9000` du stockage doit être joignable publiquement, parce que le navigateur
utilise les URLs d'upload pré-signées en direct : mets-le derrière le sous-domaine Caddy
`S3_DOMAIN` plutôt que d'ouvrir le port brut.) Le **CDN** est l'étape juste après — voir *Performance & montée en
charge → mettre un CDN devant* ci-dessous.

## Performance & montée en charge

**Déjà en place** (voir `loadtest/BENCHMARK.md`) :
- Les lectures publiques chaudes (`/kofi/stats`, `/showcase`) sont cachées dans **Redis**
  (partagé entre les réplicas d'API) avec coalescing des requêtes.
- Le rate limiter par IP est **adossé à Redis** quand `REDIS_URL` est défini — le budget
  600/min est donc partagé entre les réplicas.
- **En-têtes prêts pour un CDN** : Caddy met `Cache-Control: immutable` sur `/assets/*`
  (bundles hashés de Vite), et les téléchargements de fichiers hébergés ont `max-age=300`
  + un ETag.

**La seule étape externe — mettre un CDN (Cloudflare) devant :**
1. Ajoute ton domaine à Cloudflare, mets les enregistrements DNS en **proxied** (nuage orange).
2. Mode SSL/TLS **Full (strict)** — Caddy termine quand même le vrai TLS à l'origine.
3. C'est tout : les `/assets/*` hashés et les téléchargements répétés sont servis depuis
   l'edge avec ~0 hit à l'origine ; le shell HTML reste non caché donc les déploiements
   sont instantanés.

**Quand un seul conteneur API ne suffit plus :**
- Lance 2–4 réplicas `api` derrière Caddy — mets `API_REPLICAS=3` dans `.env` et lance le
  `docker compose up -d` habituel. Rien d'autre : le port hôte est une plage et Caddy résout
  `api` dynamiquement, donc la répartition suit toute seule. Le cache/limiter Redis rendent
  déjà ça sûr. (Le réglage, pas `--scale` : un flag ne survit pas au prochain déploiement.)
- Active le pooler **PgBouncer** dans `.env` : `COMPOSE_PROFILES=pgbouncer` plus
  `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true` (dans `.env`, pas en flag
  `--profile` — le flag ne dure qu'une commande et `deploy.sh` arrêterait le pooler)
  (`DIRECT_DATABASE_URL` reste sur `db:5432` pour les migrations, géré automatiquement).

**Mettre Postgres sur son propre serveur (managé — c'est ton objectif « DB sur un serveur
séparé », sans K8s).** Simple changement de `.env` — les URLs complètes écrasent les
valeurs locales :
```
DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require        # endpoint poolé
DIRECT_DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require # direct (migrations)
```
Puis `docker compose up -d api provisioner` ; une fois vérifié, `docker compose stop db`
(son volume est conservé comme backup). Neon / Supabase / RDS te donnent backups +
réplicas de lecture gratuitement. Pour garder un pooler devant, mets
`PGBOUNCER_UPSTREAM_HOST` sur le host managé.

**Variante auto-hébergée — ton propre 2ᵉ VPS pour la DB (même bascule, toujours gratuit,
sans K8s).** Le même changement de `.env` fait pointer le VPS applicatif vers un Postgres que
tu fais tourner sur un 2ᵉ serveur à toi. 4 points à faire correctement :
- **Réseau privé :** relie les 2 VPS via le réseau privé du provider (Hetzner / DO / …) ou un
  tunnel WireGuard, et **n'expose JAMAIS le port `5432` sur Internet** — filtre-le au pare-feu
  vers la seule IP du VPS applicatif.
- **Même région / datacenter :** garde les 2 machines au même endroit. Chaque requête fait un
  aller-retour vers la DB → la latence inter-région tue les perfs ; même-DC = < 1 ms.
- **TLS :** ajoute `?sslmode=require` (ou `verify-full` avec une CA) sauf si le lien est un LAN
  privé de confiance.
- **Répartition :** le VPS DB ne fait tourner que Postgres (+ éventuellement PgBouncer et ses
  propres backups) ; le VPS applicatif fait tout le reste (api / web / redis / storage / caddy / bot).
Fais-le quand une seule machine ne peut plus tenir les deux confortablement — avant ça,
agrandir verticalement le VPS unique est plus simple et moins cher.

**Aller plus loin — scale vertical d'abord, orchestrer seulement si nécessaire :**
- **Agrandis le VPS verticalement d'abord** — plus de CPU/RAM/disque sur la même machine,
  c'est le gain le plus simple et le moins cher, et ça t'emmène très loin. Une machine
  2 vCPU / 4 Go sert déjà des milliers d'utilisateurs simultanés (`loadtest/BENCHMARK.md`) ;
  le vrai plafond, ce sont les connexions Postgres, réglées par PgBouncer / DB managée
  ci-dessus, pas par un orchestrateur.
- **Besoin de plusieurs nœuds applicatifs ?** Une plateforme conteneurs managée (**Fly.io /
  Railway / Render**) fait tourner ces mêmes images avec autoscaling + rollouts, pour bien
  moins d'ops que n'importe quel orchestrateur.
- **Vraiment multi-nœuds auto-hébergé ?** Prends **Nomad** (bien plus simple que Kubernetes),
  ou — seulement si tu deviens une grosse plateforme multi-locataires — du Kubernetes
  **managé**, jamais un control plane fait main. Tu es très loin d'en avoir besoin.
  (Kubernetes n'est *pas* l'outil pour l'hébergement des conteneurs de projets utilisateurs
  décrit dans [USER_PROJECT_HOSTING.md](../reference/USER_PROJECT_HOSTING_FR.md) — voir ce doc.)

## Stockage objet — fourni maintenant, R2 plus tard

**Ne confonds pas les deux produits Cloudflare :** le **CDN est gratuit** (section
précédente — active-le quand tu veux) ; **R2** est leur *stockage objet payant à
l'usage* qui remplacerait le stockage fourni. Tu n'as **pas besoin de R2** pour profiter
du CDN.

**Démarre (et reste longtemps) sur le stockage fourni** (`storage`, versitygw) — gratuit,
les fichiers sont des fichiers ordinaires sur le disque de ton serveur, et il sert
confortablement une petite/moyenne communauté (voir `loadtest/BENCHMARK_FR.md`, mesuré quand
le stockage était encore MinIO).

**Passe à R2 quand** l'une de ces choses devient vraie :
- le stockage des dépôts hébergés déborde du disque du serveur (ou plombe tes sauvegardes),
- l'egress des téléchargements sature ton lien / ton hébergeur facture le trafic,
- tu veux que les fichiers survivent indépendamment du VPS.

**Comment (env uniquement, zéro code — l'app parle l'API S3) :**
1. Crée un bucket R2 + un token API (Access Key ID / Secret) dans le dash Cloudflare.
2. Dans `infra/compose/.env` :
   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<ton-domaine-public-R2-ou-custom>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<clé>  S3_SECRET_KEY=<secret>
   ```
3. Copie une fois les objets existants :
   `rclone copy` puis `rclone check`, les mêmes commandes qu’aux étapes 5 et 6 de
   [Quitter MinIO](#quitter-minio) avec R2 comme remote `new`.
4. `docker compose up -d api provisioner`, vérifie upload/download, puis retire le
   service `storage` + son volume.

### Quitter MinIO

Pour une installation qui tournait avec le service `minio` (avant le 2026-09-24). Le code lance
maintenant `storage` (versitygw, voir [ADR_S3_STORAGE_FR.md](../reference/ADR_S3_STORAGE_FR.md)) ;
les objets doivent être copiés une fois de l’ancien volume MinIO vers le nouveau. Le format
disque de MinIO n’est pas fait de fichiers ordinaires : c’est donc une copie S3 vers S3 avec
**rclone**, qui garde le Content-Type de chaque objet. Le volume MinIO n’est jamais que LU : si
quelque chose rate, l’ancienne stack a toujours toutes ses données.

Tout ce qui suit se lance sur le serveur, dans `infra/compose/`, avec le projet compose `bcweb`
(volumes `bcweb_*`, réseau `bcweb_default`). L’image MinIO doit encore être sur cette machine —
elle y est si MinIO tournait ici. Prends l'image que l'ancien conteneur fait vraiment tourner, pas
une étiquette d'un guide (un compose d'avant le 2026-09-24 lançait `minio/minio:latest`) :
`docker inspect -f '{{.Config.Image}}' bcweb-minio-1`.

1. **Sauvegarde d’abord, avec l’ANCIEN code** (le nouveau `backup.sh` archive `s3-data`, plus
   `minio-data`), ou à la main :
   ```bash
   docker run --rm -v bcweb_minio-data:/data:ro -v /var/backups/bcweb:/backup alpine \
     tar czf /backup/minio-before-move.tar.gz -C /data .
   ```
2. **Récupère le nouveau code**, puis arrête ce qui écrit dans le stockage (le site est coupé
   d’ici à l’étape 7 ; une URL d’envoi présignée vit 10 minutes, attends donc ce temps si des
   envois étaient en cours) :
   ```bash
   docker compose stop api provisioner
   ```
3. **Mets MinIO de côté.** Son service compose n’existe plus : son conteneur est orphelin et
   tient le port 9000. Arrête-le et relance la même image en conteneur temporaire, sans port
   publié, sur le réseau de la stack (si cette mise à jour a changé `S3_ACCESS_KEY` /
   `S3_SECRET_KEY`, MinIO attend toujours l'ANCIENNE paire : prends `S3K`/`S3S` dans ta copie
   de `.env`, et donne la nouvelle paire au remote `NEW` de l'étape 5) :
   ```bash
   MINIO_IMG="$(docker inspect -f '{{.Config.Image}}' bcweb-minio-1)"
   docker stop bcweb-minio-1
   S3K="$(grep '^S3_ACCESS_KEY=' .env | cut -d= -f2-)"; S3S="$(grep '^S3_SECRET_KEY=' .env | cut -d= -f2-)"
   docker run -d --name bcweb-minio-old --network bcweb_default \
     -v bcweb_minio-data:/data -e MINIO_ROOT_USER="$S3K" -e MINIO_ROOT_PASSWORD="$S3S" \
     "$MINIO_IMG" server /data
   ```
4. **Démarre le nouveau stockage** (volume-perms passe d’abord et prépare le volume `s3-data` neuf) :
   ```bash
   docker compose up -d storage && docker compose ps storage     # attendre (healthy)
   ```
5. **Copie.** rclone lit les deux remotes dans des variables d’environnement, rien n’est écrit
   sur le disque :
   ```bash
   RC="docker run --rm --network bcweb_default \
     -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio \
     -e RCLONE_CONFIG_OLD_ENDPOINT=http://bcweb-minio-old:9000 \
     -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID=$S3K -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY=$S3S \
     -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other \
     -e RCLONE_CONFIG_NEW_ENDPOINT=http://storage:9000 \
     -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID=$S3K -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=$S3S \
     rclone/rclone:1.75.1"
   $RC copy old:bcweb new:bcweb --metadata -v
   ```
   Mets ton `S3_BUCKET` s’il ne vaut pas `bcweb`. Une ligne `ERROR ... 409` nomme une clé qui
   est aussi le « dossier » d’une autre (`a` et `a/b`) : MinIO gardait les deux, un stockage
   POSIX ne peut pas. Garde celle que le site utilise (regarde dans la base) et copie-la seule.
6. **Vérifie — ne saute pas cette étape.** Mêmes objets, mêmes tailles, mêmes octets, mêmes types :
   ```bash
   $RC check old:bcweb new:bcweb                   # tailles + sommes : "0 differences found"
   $RC check --download old:bcweb new:bcweb        # facultatif : compare chaque octet (plus lent)
   $RC lsf -R --files-only --format psm old:bcweb > /tmp/old.txt
   $RC lsf -R --files-only --format psm new:bcweb > /tmp/new.txt
   diff /tmp/old.txt /tmp/new.txt && echo "types et tailles identiques"
   ```
7. **Bascule :** `docker compose up -d`. Puis dans le navigateur : ouvre une image du blog,
   télécharge un fichier de catalogue, envoie un nouveau fichier ; **Admin → Server perf**
   montre le stockage objet en service.
8. **Nettoie :** `docker rm -f bcweb-minio-old && docker rm bcweb-minio-1`. Garde le volume
   `bcweb_minio-data` et `minio-before-move.tar.gz` jusqu’à être sûr ; les supprimer
   (`docker volume rm bcweb_minio-data`) est une décision à part, que rien ici ne prend pour toi.

Si un proxy **autre que le Caddy fourni** route ton nom `s3.` (par exemple un Traefik devant la
stack), il doit maintenant joindre `storage:9000` (conteneur `bcweb-storage-1`) au lieu de
`minio:9000`. Le port de l’hôte reste `127.0.0.1:9000`.

**Revenir en arrière** avant l’étape 8 : `docker compose stop storage`, redéploie le commit
précédent, et `docker start bcweb-minio-1` (après `docker rm -f bcweb-minio-old`). Le volume
MinIO n’a jamais été modifié.
