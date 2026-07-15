# BCWEB — Audit technique (juillet 2026)

*Une évaluation franche et complète de la plateforme BetterCommunity Web : architecture,
points forts, points faibles, risques, et un plan d'action priorisé. Complète l'analyse
fonctionnelle [Technical_Analysis_FR.md](Technical_Analysis_FR.md). 🇬🇧 [English version](TECH_AUDIT_EN.md).*

---

## 1. Ce qu'est BCWEB, techniquement

Un **monorepo npm workspaces** :

| Partie | Stack | Rôle |
|---|---|---|
| `apps/api` | Node 20+, **Fastify**, **Prisma** → PostgreSQL, Redis, stockage objet S3 (MinIO) | Toute la logique métier : comptes, catalogues, hébergement Server-Repo, facturation (Stripe), modération, statistiques, config du bot Discord, fournisseur OIDC |
| `apps/web` | **React 18 + Vite**, react-router, kit UI maison (`ui/ui.jsx`) | SPA frontend, i18n FR/EN, thèmes + surfaces translucides |
| `apps/bot` | discord.js | Bot Discord communautaire (gating, bienvenue, paiements, giveaways…) |
| `packages/db` | Un seul schéma Prisma | Source de vérité unique pour ~60 modèles |
| `infra/` | Docker Compose + edge **Caddy** (TLS, anti-bot, CSP), scripts de backup, manifestes k8s inertes | Déploiement production mono-VPS |
| `bmm/telemetry-dashboard` | Rust/Axum + React | Collecteur de télémétrie opt-in séparé |

Le déploiement est **Docker Compose sur un VPS** — un choix délibéré (k8s évalué puis
différé) ; l'échelle de montée en charge est documentée (CDN → DB managée → réplicas).

## 2. Points forts

### 2.1 Posture de sécurité (bien au-dessus du niveau « projet perso »)
- Mots de passe argon2id, 2FA TOTP optionnelle, cookies de session httpOnly/SameSite, cookie
  **élevé** de courte durée pour les actions de contrôle serveur.
- **Admin par capacités** (`requireCap`) + hiérarchie stricte des rôles (USER→MOD→ADMIN→
  SUPERADMIN, on n'agit que vers le bas), permissions blog granulaires.
- **Journal d'audit inviolable** (chaîne de hash HMAC + endpoint de vérification), alertes
  d'actions sensibles, tables d'audit protégées dans le DB viewer.
- Patrons défensifs systématiques : comparaisons en temps constant, allow-lists SSRF, gardes
  anti-traversal sur chaque clé de stockage, uploads présignés (les octets ne transitent
  jamais par l'API), médias servis en `attachment`+`nosniff` (tue le XSS stocké), gardes
  anti-open-redirect, rate limits + PoW anti-bot à l'edge, validation zod stricte partout.
- Les revues de sécurité répétées en session n'ont trouvé aucun nouveau problème HIGH/MEDIUM.

### 2.2 Vie privée & conformité
- Statistiques internes, anonymes, soumises au consentement (hash visiteur tournant chaque
  jour, aucun tiers).
- Pages légales conscientes du RGPD (bases Art. 6, transferts, sous-traitants, rétractation)
  maintenues **exactes** vis-à-vis de ce qui est collecté ; consentement cookies avec Refuser
  aussi visible qu'Accepter + catégories granulaires.

### 2.3 Conception produit/métier
- **Facturation par pools de stockage** avec une source de vérité unique (`recomputePoolBytes`) :
  dépôts + catalogues partagent les octets d'un pool ; fusion/défusion/consolidation se
  réduisent toutes à cet invariant. Webhooks Stripe idempotents ; prépayé + récurrent + délais
  de grâce + free-tier résistant aux unlink/relink.
- Des primitives réutilisées plutôt que des cas uniques : le patron de clé de partage `?k=`
  (catalogues → dépôts), le toast-undo, le contrat de surface `.card`/glass, le feed d'update
  compatible GitHub Releases, les snapshots de version.
- Feeds natifs BMM + deeplinks rendent la plateforme réellement utile aux apps desktop, avec
  des chaînes de fallback BCWEB → GitHub → local : aucune panne unique ne brique les clients.

### 2.4 Exploitation & documentation
- Déploiement en une commande, probes `/live` + `/ready`, arrêt gracieux, backup/restore
  documentés, suites de load-test + benchmarks, tarification consciente de la capacité.
- Documentation bilingue inhabituellement complète : deploy, env, Docker, backups, features,
  guides utilisateur/modérateur/hébergeur, auto-update — le tout à jour.

### 2.5 Cohérence frontend
- Un kit UI, une convention i18n (`t(clé, fallback)`), un contrat de thème ; les features se
  ressemblent et se comportent pareil. Bundle-splitting et cache là où ça faisait mal.

## 3. Points faibles & risques

### 3.1 🔴 Aucun test automatisé (le risque n°1)
Il n'existe **aucun test** unitaire, d'intégration ou E2E. La vérification = `node --check`,
`vite build`, `prisma validate`, et des tests manuels. La surface la plus dangereuse est la
facturation (webhooks, recompute des pools, consolidation — l'aller-retour Stripe de la
consolidation est parti relu mais **non testé au runtime**). Une régression ici facture mal
de vrais utilisateurs.

### 3.2 🔴 Pas de CI/CD
Rien n'empêche de committer un build cassé ou un secret. (Deux incidents réels : un token
Discord vivant dans l'historique de `.env.example` ; un secret webhook collé en clair dans le
chat.) Une pipeline minimale (build + checks + scan de secrets) attraperait les deux classes.

### 3.3 🟠 Fichiers monolithiques
`apps/web/src/pages/pages.jsx` **faisait** ~10k lignes (des dizaines de composants admin) — il
a depuis été découpé en modules par route et n'est plus qu'un module de helpers partagés de
210 lignes (voir P2). `repos.jsx` (~2k) et `i18n.jsx` restent gros. Les conséquences qui ont
motivé le découpage : éditeurs lents, conflits pénibles, onboarding difficile, et les crashes
« import manquant » récurrents (X, Calendar) — un identifiant JSX nu passe le build et explose
au rendu. Cette dernière classe est désormais attrapée structurellement par le garde ESLint
`no-undef` dans la CI.

### 3.4 🟠 Hypothèses mono-processus
Le feed SSE (`feedBus`), divers caches mémoire et l'état de rate-limit sont in-process. Les
sweepers/planificateurs supposent une seule instance (pas de verrous distribués). Correct
pour le déploiement mono-conteneur actuel — mais passer en réplicas exige un chantier Redis
pub/sub (documenté dans le code, pas implémenté).

### 3.5 🟠 Gestion de schéma : `prisma db push` au boot avec `--accept-data-loss`
Pas d'historique de migrations. Une modification de schéma qui renomme/rétrécit une colonne
peut silencieusement détruire des données en production. Passer à `prisma migrate` (avec
migrations commitées) est la voie sûre.

### 3.6 🟡 Croissance de tables non bornée — largement traité
`AnalyticsEvent`, `InteractionEvent`, `WebVital`, `LoginAttempt` grossissaient sans fin. Une
purge de rétention (`sweepAnalyticsRetention`, config dans `lib/retention.mjs`) supprime
désormais les lignes au-delà d'une fenêtre d'âge par table (défauts 365/120/120/180 jours ;
0 = garder pour toujours ; réglable par l'admin via `GET/PUT /admin/analytics/retention`),
par lots de 5k lignes/table/passe. Les très grosses tables voudront peut-être du
partitionnement, mais la croissance est maintenant bornée par défaut.

### 3.7 🟡 i18n par convention seulement — désormais outillé
La parité FR/EN tenait à la discipline, pas à l'outillage — une clé manquante retombait en anglais
en silence, et une clé de dico dupliquée en écrasait une autre en silence (ce qui laissait deux
features entrer en collision sur la même clé). **FAIT** — `scripts/i18n-check.mjs` (CI
`npm run i18n:check --strict`) échoue sur les clés dupliquées et sur toute clé `t()` sans entrée
`DICT.fr`. Il a attrapé 8 bugs de clés dupliquées (dont l'en-tête « Clients OAuth » qui affichait
« Mes catalogues ») et 26 retombées en anglais, tous corrigés.

### 3.7b ✅ Vulnérabilités de dépendances — résolues
`npm audit` pour `apps/api` rapporte maintenant **0 vulnérabilité** (web = 0, bot = 0 tout du long).
Les trois racines, toutes éliminées cette passe :
- **`ip-address`** (via `geoip-lite`) — XSS dans les méthodes HTML de `Address6`. **FAIT** —
  montée **geoip-lite 1.4.10 → 2.0.3** (qui tire `ip-address@10`) ; l'avis n'apparaît plus. De
  toute façon jamais atteignable (`geoip-lite` ne fait que parser des adresses). 2.0.3 embarque ses
  données dans le tarball sans postinstall, donc `npm ci` n'a besoin d'aucun téléchargement ni clé
  MaxMind ; la forme de `lookup()` est inchangée, aucun changement de code.
- **`fast-uri`** (via Fastify 4) — avis path-traversal / host-confusion. **FAIT** — montée
  **Fastify 4.29 → 5.10** + les trois plugins `@fastify` (cookie/cors/rate-limit) vers leurs majors
  v5. Faible empreinte donc sans risque (pas de `reply.res`/`request.req`/`routerPath`/
  `getResponseTime` ; les API touchées — `setErrorHandler`, `addContentTypeParser` raw-body — sont
  inchangées en v5), aucun changement de code. Vérifié : suite 30/30 verte sur v5, le serveur boote
  avec tous les plugins + 40 routes et `/ready`+`/live` à 200.
- **`nodemailer`** (dép directe) — un lot d'avis publiés depuis le premier audit (injection de
  commande SMTP via CRLF, DoS de l'addressparser, lecture de fichier & SSRF via jsonTransport/raw,
  validation TLS OAuth2). **FAIT** — montée **6.9.14 → 9.0.3** ; les avis n'apparaissent plus. Notre
  usage est le cœur stable (`createTransport` host/port/secure/auth + `sendMail`), inchangé de 6 à 9,
  donc aucun changement de code ; les correctifs sont du durcissement interne.

Les trois sont faits ; l'arbre de dépendances de l'API est propre. Lancer `npm audit`
périodiquement pour que les avis fraîchement publiés (comme le lot nodemailer apparu en cours
d'audit) remontent tôt — un gate CI dur est volontairement évité, car il ferait échouer des PR sans
rapport dès qu'un avis est publié.

### 3.8 🟡 Divers
- Pièges DX côté hôte : les scripts exigent l'env/le client généré du conteneur (désormais
  gardés par des messages clairs, mais le patron demeure).
- Accessibilité partielle (des attributs aria par endroits ; pas d'audit systématique).
- SEO limité par la SPA (quelques routes OG/meta ; pas de SSR/prérendu).
- Bus factor ≈ 1 ; les cas limites de facturation vivent dans les commentaires du code et
  dans une seule tête.

## 4. Plan d'action priorisé

| P | Action | Pourquoi |
|---|---|---|
| **P1** | CI minimale : build web, `node --check` API, `prisma validate`, scan de secrets | Attrape builds cassés + secrets au commit |
| **P1** | Tests de facturation : **FAIT** — math de prix (`pricing.test.mjs`) **et** l'invariant de pool (`pool-billing.test.mjs` : `recomputePoolBytes` somme-des-abos-actifs, défaut→suspend+masque+grâce 72h, renouvellement→restaure, défaut-partiel-garde-le-contenu, no-op idempotent) plus **des tests webhook de bout en bout** (`webhook.test.mjs` : un événement réellement signé à travers le vrai handler — mauvaise-signature→400, `customer.subscription.deleted`→défaut-suspend, `checkout.session.completed{pool_renew}`→restaure) — le tout dans la CI contre un Postgres jetable (**25 tests**). Le risque de facturation §1 est maintenant couvert de bout en bout pour le cycle de vie piloté par la BD | Le code au plus gros rayon d'explosion |
| **P1** | Passer `db push` → `prisma migrate` **FAIT** — une baseline `0_init` + `src/boot-migrate.mjs` (adopte sans risque les BD fraîches / db-push / déjà migrées, vérifié zéro perte de données) ; le Dockerfile boote via `migrate deploy` ; la CI applique les migrations + un contrôle de dérive (un schéma sans migration échoue) | Supprime le risque de perte de données silencieuse |
| **P2** | Découper `pages.jsx` en modules **FAIT** — le monolithe de ~10k lignes est devenu un module de helpers partagés de 210 lignes ; chaque route est passée dans son propre fichier (`home`, `catalog`, `signin`, `hosting`, `dashboard`, `account-pages`, `legal`, `contact`, et tout le back-office admin de ~7,3k lignes → `admin.jsx`). Deux pages mortes retirées. Chaque extraction gardée par **ESLint `no-undef`** (apps/web `eslint.config.js`, câblé dans la CI — il a attrapé chaque import manquant que `vite build` acceptait en silence) + un smoke-test de démarrage navigateur. `repos.jsx` (~2k) est le gros fichier restant à découper | Maintenabilité + prévient les crashes d'import récurrents |
| **P2** | Purges de rétention analytics (par âge/nb de lignes) **FAIT** — `sweepAnalyticsRetention` purge AnalyticsEvent/InteractionEvent/WebVital/LoginAttempt au-delà de fenêtres par table (défauts 365/120/120/180j, 0 = garder toujours), par lots de 5k/table/passe, réglable par l'admin via `/admin/analytics/retention` ; 5 tests (résolveur pur + purge/garde en DB), suite complète 30/30 verte | Garde la DB saine à long terme |
| **P2** | Redis pub/sub pour le SSE + rate limits partagés (quand les réplicas deviendront réels) | Débloque la montée en charge horizontale |
| **P3** | Lint de parité i18n **FAIT** (`scripts/i18n-check.mjs`, câblé CI, `--strict` ; 8 bugs de clés dupliquées + 26 retombées EN corrigés). Reste : passe accessibilité ; monitoring d'erreurs ; OG/prérendu des pages publiques | Finition & portée |

## 5. Verdict

BCWEB est une plateforme inhabituellement bien sécurisée, bien documentée et dense en
fonctionnalités pour sa taille d'équipe, avec un modèle métier cohérent (pools, capacités,
clés de partage) qui compose au lieu de s'étaler. Sa faiblesse centrale est la
**vérification** : tout repose sur la relecture attentive et les tests manuels — aucun filet
automatisé sous le système de facturation ni sous le schéma de 60 modèles. Les items P1
(CI, tests de facturation, migrations) coûtent peu par rapport au risque qu'ils éliminent et
devraient passer avant la prochaine vague de features.
