# Résumé de sécurité : BCWEB, BMM et BetterInstaller

🇬🇧 [English version](SECURITY_SUMMARY_EN.md)

**Rédigé le 2026-09-24.** Point H1 du plan. Lu contre le code à ces commits :

| Produit | Dépôt | Commit (plus l'arbre de travail du jour) |
|---|---|---|
| BCWEB (plateforme web BetterCommunity) | `BCW` | `055cbbc6` |
| BMM (BetterModsManager, application de bureau) | `BetterModsManager`, branche `Tdev` | `32046d75` |
| BetterInstaller | `BetterInstaller` | `a52ce16` |

C'est le document à lire en premier. Ce n'est ni un rapport de pentest ni une certification. Il
dit ce que chaque produit protège, où chaque protection se trouve dans le code, quelles données
personnelles sont conservées et combien de temps, où sont les secrets, comment les dépendances et
les versions publiées sont rendues fiables, ce que promettent les pages légales, ce qui a été
trouvé et corrigé en septembre 2026, et ce qui attend encore une décision.

**Comment les affirmations ont été vérifiées.** Chaque « le code fait X » ci-dessous porte un
fichier et une ligne. Chacun a été ouvert et relu le 2026-09-24, et non recopié d'un audit
précédent. Quand une affirmation ne pouvait pas être vérifiée depuis le dépôt (état de la
production, rotation d'un secret, vrai certificat), elle est marquée **non vérifié** et listée au
[§10](#10-ce-que-ce-document-ne-vérifie-pas).

**Chemins.** Un chemin BCWEB est relatif à `BCW/BCWEB/`. Un chemin BMM est relatif à la racine du
dépôt BetterModsManager. Un chemin BetterInstaller est relatif à `BetterInstaller/`.

**Sources.** Les rapports détaillés que ce résumé condense :

- BCWEB, bot, B.MD : [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.md) (chaque passe datée depuis
  juillet), [audit du code de l'API](audits/CODE_AUDIT_2026-09-24_API_EN.md),
  [audit du code web](audits/CODE_AUDIT_2026-09-24_WEB_EN.md),
  [audit CVE/CWE du 2026-08-29](audits/SECURITY_AUDIT_2026-08-29_EN.md) (en anglais).
- BMM et BetterInstaller, dans le dépôt BMM : `.Assets/.md/CWE_REMEDIATION_PLAN.md`,
  `.Assets/.md/AUDIT-SEPT24-BMM-RUST.md`, `.Assets/.md/AUDIT-SEPT24-BMM-FRONT.md`,
  `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, `.Assets/.md/PLAN-PENTEST-SEPT9-2026.md`.
- BetterInstaller : `docs/AUDIT-SEPT24.md`, `SECURITY_FR.md`, `docs/SIGNING.fr.md`,
  `docs/UPDATES.fr.md`.

---

## Sommaire

1. [En bref](#1-en-bref)
2. [Périmètre et modèle de menace](#2-périmètre-et-modèle-de-menace)
3. [Où chaque frontière de confiance est appliquée](#3-où-chaque-frontière-de-confiance-est-appliquée)
4. [Données personnelles](#4-données-personnelles)
5. [Secrets](#5-secrets)
6. [Chaîne logicielle et dépendances](#6-chaîne-logicielle-et-dépendances)
7. [Conformité](#7-conformité)
8. [Historique des failles, septembre 2026](#8-historique-des-failles-septembre-2026)
9. [Risques ouverts et décisions du propriétaire, par priorité](#9-risques-ouverts-et-décisions-du-propriétaire-par-priorité)
10. [Ce que ce document ne vérifie pas](#10-ce-que-ce-document-ne-vérifie-pas)
11. [Comment garder ce document vrai](#11-comment-garder-ce-document-vrai)

---

## 1. En bref

| | BCWEB | BMM | BetterInstaller |
|---|---|---|---|
| Ce que veut un attaquant | un compte (surtout un compte du staff), des valeurs qui valent de l'argent (points, achats), les dépôts et conversations privés, faire exécuter du script sur le site | exécuter du code sur le PC de l'utilisateur, écrire un fichier hors d'un dossier, les jetons de l'utilisateur | un setup qui installe ou lance autre chose que ce que l'éditeur a publié, ou qui supprime plus que ce qu'il a installé |
| Contrôles les plus solides | une seule vérification de session pour toutes les portes, 2FA sur chaque porte du staff, matrice des capacités prouvée en HTTP sur les 1205 routes, garde SSRF avec épinglage DNS, listes blanches zod, journal d'audit chaîné par hachage | API locale sur 127.0.0.1 avec jeton, CSP stricte pour les scripts, une seule porte des liens profonds partagée par TS et Rust, tâches importées privées de toute permission, gardes de chemin sur chaque écriture | paquets signés Ed25519, en-tête signé (format v2), contrôle de version et d'identifiant d'app sur les mises à jour, désinstallation limitée à ce qui a été installé, recherche des DLL durcie |
| Point le plus faible aujourd'hui | la CSP du site autorise encore le script inline, donc tout échappement oublié devient du script | le binaire MCP du dépôt est antérieur à trois correctifs ; la mise à jour intégrée fait confiance à un manifeste non signé | `update.json` et `installer.toml` ne sont pas signés ; seule une signature Authenticode du setup fini couvre la configuration |
| Trouvé et corrigé en septembre 2026 | environ 70 failles, dont une vingtaine notées élevées | environ 25 failles, 1 critique et 8 élevées | 13 failles dans l'audit du 24 septembre, plus 5 dans la passe de la carte 9 |
| Ouvert, chacun avec une décision recommandée | §9 points 1, 2, 4, 5, 8, 10 à 13, 17, et la liste qui suit | §9 points 3, 6, 7, 9, 14 à 16, et la liste qui suit | §9 point 6, et cinq fiches plus petites |

Le point ouvert le plus important n'est pas du code : **un vrai jeton de bot Discord a été commité
dans `infra/compose/.env.example`, et rien ne confirme qu'il a été changé** (§5.4).

---

## 2. Périmètre et modèle de menace

### 2.1 BCWEB

**Ce que c'est.** Une API Fastify avec Prisma sur Postgres (`apps/api`), une application React
d'une seule page (`apps/web`), un bot discord.js (`apps/bot`), le kit markdown B.MD et le studio
(`packages/`), MinIO pour le stockage d'objets, Redis pour le cache et les compteurs de limite de
débit, Caddy comme seul point d'entrée public, le tout dans un seul fichier Docker Compose
(`infra/compose/docker-compose.yml`). Un service de télémétrie Rust séparé pour BMM
(`bmm/telemetry-dashboard`) se trouve derrière le même Caddy.

**Biens à protéger.** Les comptes et leurs sessions, les pouvoirs du staff (rôles, 32 capacités,
droits par projet), l'argent et ce qui en tient lieu (abonnements Stripe, ventes de la
marketplace, points de l'économie, codes de la boutique), les dépôts et catalogues hébergés (les
privés derrière des clés de partage, des mots de passe et des clés signées), les conversations
(membres, équipes et anonymes), le journal d'audit, et les secrets du `.env`.

**Acteurs.** Visiteurs anonymes ; membres (tout compte peut publier du contenu B.MD, créer des
dépôts, ouvrir des conversations) ; titulaires de droits par projet et traducteurs (pouvoirs
limités) ; staff MOD, ADMIN et SUPERADMIN ; le bot Discord (un processus serveur de confiance qui
détient un secret partagé) ; les clients BMM (identifiés par un Creator ID et parfois une preuve de
clé signée) ; les webhooks Stripe et Ko-fi ; les serveurs tiers que BCWEB interroge (téléchargement
de plugins, webhooks, moniteurs).

**Frontières de confiance.**

1. Internet vers Caddy : TLS, en-têtes de sécurité, seuls ports publiés sur un hôte correctement
   protégé par pare-feu (voir §9, point 2, pour savoir pourquoi ce n'est pas automatique).
2. Caddy vers l'API : l'API se fie à la DERNIÈRE entrée de `X-Forwarded-For`, celle qu'ajoute Caddy.
3. Navigateur vers l'API : un cookie de session, puis un contrôle de rôle, de capacité, de droit
   par projet ou de propriété.
4. Auteur vers lecteur : tout ce qu'un membre écrit (B.MD, pages du studio, CSS, SVG, liens) est
   affiché à d'autres personnes, staff compris.
5. API vers l'extérieur : toute requête sortante influencée par un utilisateur passe par la garde
   SSRF.
6. Bot vers l'API : un secret partagé, sans portée plus étroite.
7. Émetteurs de webhooks vers l'API : signatures HMAC (Stripe, webhooks de code) ou jeton partagé
   (Ko-fi).

### 2.2 BMM

**Ce que c'est.** Une application de bureau Tauri v2 (Rust dans `src-tauri/`, TypeScript dans
`frontend/src/`) qui gère des mods de jeux. Autour du cœur : une API HTTP locale pour les plugins et
la CLI, un serveur MCP (un binaire séparé livré en « sidecar »), les liens profonds `bmm://`, un
planificateur de tâches qui peut recopier des tâches dans le Planificateur de tâches Windows, un
serveur de dépôt intégré qui peut être ouvert au réseau local ou à Internet, des pages
personnalisées isolées (`bmmpage://`), et un lien optionnel avec BetterCommunity.

**Biens à protéger.** Les fichiers de l'utilisateur et la possibilité de lancer des programmes en
son nom, le jeton de l'API locale, les jetons de plugins, la clé du planificateur, les mots de passe
de dépôts, un jeton GitHub s'il en a saisi un, la clé créateur (une identité Ed25519 dont la moitié
privée est scellée par DPAPI sous Windows).

**Acteurs.** L'utilisateur ; n'importe quelle page web (elle peut déclencher un lien `bmm://`) ; les
auteurs de mods, dépôts, catalogues, thèmes, plugins, modpacks, tâches et launch packs que
l'utilisateur importe ; quiconque atteint le serveur de dépôt ; les processus locaux (ils atteignent
127.0.0.1) ; un agent IA via MCP.

**Frontières de confiance.**

1. Contenu importé vers la webview : tout script dans la webview principale atteint
   `window.__TAURI__` (`src-tauri/tauri.conf.json:12`, `withGlobalTauri: true`) et, par là, toutes
   les commandes. Ici, une XSS est une exécution de code, d'où l'importance de la CSP.
2. Page web vers le gestionnaire de liens profonds : la porte décide de demander, refuser ou
   exécuter.
3. Tâche ou plugin importé vers le planificateur : les permissions sont remises à zéro à l'import.
4. Processus local vers l'API locale : jeton, permissions par plugin.
5. Dépôt distant vers le disque : chaque chemin d'un manifeste est contrôlé avant toute écriture.
6. Réseau local ou Internet vers le serveur de dépôt : lecture seule, liste blanche de fichiers à
   la racine.

### 2.3 BetterInstaller

**Ce que c'est.** Un espace de travail Rust : `bpkg-core` (format de paquet, signature, mises à
jour), `bpkg-cli`, et une interface Slint `installer`. Un setup, c'est le moteur exécutable, puis le
paquet `.bpkg`, puis `installer.toml`, puis un trailer de 24 octets.

**Biens à protéger.** La clé privée Ed25519 de l'éditeur (elle signe chaque mise à jour de BMM), le
dossier d'installation et le registre de l'utilisateur, et le verdict de confiance affiché sur la
page d'accueil.

**Acteurs.** L'éditeur ; quiconque ré-estampille un setup avec un autre `installer.toml` ; un
miroir ou l'hébergeur de `update.json` ; des fichiers déposés à côté d'un setup dans Téléchargements ;
les autres processus du même utilisateur.

**Frontières de confiance.** La signature couvre les octets `0 .. 24+N+M` du `.bpkg` (en-tête,
manifeste, contenu). Elle ne couvre **pas** `installer.toml`, qui porte la clé publique, les chemins
et les prérequis. Seule une signature Authenticode posée après `bpkg build` couvre le setup entier
(`docs/AUDIT-SEPT24.md`, BI-06).

---

## 3. Où chaque frontière de confiance est appliquée

### 3.1 BCWEB

**Authentification.**
- Les mots de passe sont hachés en argon2id : `apps/api/src/routes/auth.mjs:189`.
- Force brute sur la connexion : après 3 échecs en 15 minutes pour une adresse, une preuve de
  travail est exigée, comptée par adresse sur toutes les IP, et ce n'est volontairement pas un
  verrouillage (`auth.mjs:159-175`).
- Le second facteur a son propre plafond : 10 codes faux en 15 minutes pour un compte répondent
  `429 2fa_locked` sans rien vérifier (`auth.mjs:21`, faille S-3).
- La connexion OAuth et la liaison de compte lient le flux au navigateur par un cookie à usage
  unique (`apps/api/src/routes/oauth.mjs:173`, correctif de la prise de compte du 7 septembre).
- Le serveur refuse de démarrer en production avec un secret présent dans le dépôt (secrets JWT, du
  bot et des liens) : `apps/api/src/lib/boot-guard.mjs:25-40`, appelé dans
  `apps/api/src/server.mjs:113-129`.

**Sessions et 2FA.**
- La session est un cookie httpOnly, `SameSite=Lax`, `Secure` quand `SITE_URL` est en https :
  `apps/api/src/lib/lib.mjs:85-86`.
- Une seule question décide qui est l'auteur d'une requête : un jeton vérifié qui porte un
  identifiant de session (`sid`), une ligne `Session` vivante, un compte non verrouillé, et le rôle
  que la base contient maintenant. `authenticated()` (`lib.mjs:820`) sert les gardes,
  `sessionUser()` (`lib.mjs:843`) sert toutes les autres portes. `tokenAcceptable()`
  (`lib.mjs:806`) refuse tout jeton sans `sid`, ce qui empêche les cinq autres types de JWT signés
  avec le même secret (2FA en attente, élévation, consentement, tableau de bord de dépôt,
  télémétrie) de servir de session. Deux routes qui contournaient cette règle étaient la faille
  élevée S-1 (24 septembre), et un test échoue désormais si une troisième apparaît
  (`apps/api/test/session-side-doors.test.mjs`).
- Chaque porte du staff exige le TOTP : `requireRole(...)` avec une liste de rôles et
  `requireCap(...)` appellent `ensure2fa()` (`lib.mjs:780`, `873-890`, `936-950`), de même que
  `requireEditor()` pour les titulaires de droits par projet (`lib.mjs:955`).
- Un compte suspendu garde la connexion (pour lire pourquoi et faire appel) et perd tout pouvoir de
  staff : `staffLocked()` (`lib.mjs:866`).
- L'administration du serveur (visionneuse de base, gestionnaire de fichiers, sauvegardes) exige
  ADMIN, l'indicateur `canControlServer` relu en base, et un cookie d'élévation de courte durée lié
  au même utilisateur : `requireElevated()` (`lib.mjs:212-219`).
- Changer le mot de passe révoque toutes les autres sessions ; le réinitialiser les révoque toutes
  (correctif du 7 septembre).

**Capacités et RBAC.** Les rôles sont USER, MOD, ADMIN, SUPERADMIN ; les rôles personnalisés
regroupent des capacités sans changer le rôle ; les droits par projet couvrent un seul projet. Le
test de matrice `apps/api/test/capability-route-matrix.test.mjs` enregistre toutes les routes avec
un gestionnaire factice et prouve, pour 1205 routes, que chaque capacité n'ouvre que ses propres
portes, qu'aucune combinaison n'ouvre une porte réservée à un rôle, qu'un anonyme reçoit 401 partout
et qu'une 2FA absente est refusée partout. `apps/web/scripts/check-capabilities.mjs` tient un cliquet
sur la portée de chaque capacité.

**CSRF.** Il n'y a **pas de jeton CSRF** sur les routes authentifiées par cookie. La défense, c'est
`SameSite=Lax` (une requête POST venue d'un autre site n'emporte pas le cookie) et la suppression de
toute primitive de requête de même origine dans le contenu écrit par les membres : les blocs vivants
de B.MD et le bouton `:action` font leurs requêtes avec `credentials: 'omit'` (failles 7-7, F6-5,
B-1, W3). Le risque résiduel et la recommandation sont au §9 (autres points ouverts).

**CSP et en-têtes.** Caddy envoie HSTS (`infra/caddy/Caddyfile:104`), `X-Frame-Options` et
`frame-ancestors 'self'`, `nosniff`, et cette CSP (`Caddyfile:109`) :
`script-src 'self' 'unsafe-inline'` plus les hôtes de Google Tag Manager,
`connect-src 'self' https: …`. La CSP bloque donc les hôtes de script tiers et l'encadrement, mais
**elle n'arrête pas un script inline injecté et n'arrête pas une exfiltration vers n'importe quel
hôte https** (F10-9, ouvert). L'origine du tableau de bord de télémétrie a ses propres en-têtes et une
CSP écrite mais commentée (`Caddyfile:298-304`).

**Limites de débit et abus.** Une limite globale par IP cliente (600 par minute par défaut, via
Redis quand il est là) avec une étape de bannissement : `server.mjs:299-310`. Des limites par route
sur les routes sensibles. Des bannissements de site par IP, CIDR, fragment de User-Agent et Creator
ID, plus un bouclier automatique après des dépassements répétés (`apps/api/src/lib/siteban.mjs`,
`apps/api/src/lib/abuse.mjs`). L'IP du client est lue à un seul endroit, la DERNIÈRE entrée de
`X-Forwarded-For` (`apps/api/src/lib/client-ip.mjs:8-14`, regroupée depuis douze copies dans
`2a472ccd`). Cette règle n'est sûre que si toutes les requêtes passent par Caddy (§9, point 2).

**Garde SSRF.** `safeFetch()` (`apps/api/src/lib/net.mjs:145`) n'autorise que http et https, résout
le nom et refuse les plages privées, de bouclage, de lien local (adresse de métadonnées cloud
comprise), CGNAT et réservées, épingle l'adresse vérifiée dans la connexion pour qu'un rebond DNS ne
puisse pas la changer (`net.mjs:133`), et revérifie à la main chaque redirection. Les formes IPv6
qui portent une IPv4 (mappée, compatible, NAT64, 6to4) sont jugées sur l'IPv4 qu'elles contiennent
(`net.mjs:44-70`, faille B-5). Utilisée pour les téléchargements de plugins, les webhooks et les
moniteurs de la page de statut.

**Téléversements.**
- Les téléversements présignés signent un `ContentType` explicite
  (`apps/api/src/lib/storage.mjs:40`), donc le type stocké est celui qu'a choisi l'API.
- La clé de stockage d'un fichier de dépôt est calculée par le serveur, jamais reprise du client
  (`apps/api/src/routes/hosting-content.mjs:262-271`, faille S-2).
- Les archives de plugins téléchargées sont plafonnées à 256 Mo pendant la lecture, et une archive
  est refusée avant décompression quand sa taille déclarée dépasse 1 Gio (F10-1).
- Les fichiers de dépôts hébergés ne sont servis qu'en JSON, texte ou octet-stream, avec
  `nosniff` ; les pièces jointes sont servies en `Content-Disposition: attachment` ; le SVG est
  refusé dans les conversations.
- Les icônes du bot sont redessinées pixel par pixel dans un PNG neuf de 128x128, et une image dont
  l'en-tête annonce plus de 4096 px de côté est refusée avant décodage (F5-2).

**Webhooks.** Les événements Stripe sont vérifiés sur le corps brut avec `constructEvent`
(`apps/api/src/routes/stripe-webhook.mjs:920`) ; sans secret configuré, tout événement est refusé.
Les webhooks de code utilisent un HMAC comparé en temps constant et refusent un projet sans secret.
Les webhooks sortants passent par `safeFetch` et sont signés.

**Journal d'audit chaîné.** Chaque action privilégiée du staff est écrite dans `AuditLogEntry` avec
un HMAC chaîné à l'entrée précédente (`auditHash`, `lib.mjs:234`), avec la clé `AUDIT_SECRET` (à
défaut `JWT_SECRET`). `GET /admin/security/audit/verify` recalcule la chaîne
(`apps/api/src/routes/server-control.mjs:248`). Les tables d'audit sont en lecture seule dans la
visionneuse de base.

**Journaux.** Les URL des requêtes sont journalisées sans leur partie requête (seuls les noms des
paramètres restent), et les segments de chemin qui sont des secrets (`/threads/t/…`, `/f/…`,
`/auth/oauth/link/…`) sont remplacés par des points de suspension (`server.mjs:172-182`,
`redactPath` dans `apps/api/src/lib/errorlog.mjs` ; failles du 22 août et F4).

**Contenu écrit par les membres (B.MD, studio, thèmes).** L'affichage repose sur des listes blanches
(schéma rehype-sanitize, `safeUrl`, `safeStyle` qui juge le CSS décodé, `scopeCss` avec un lecteur
de parenthèses équilibrées, `sanitizeSvg` qui reconstruit le balisage). Les chaînes traduites qui
contiennent du balisage passent par `RichText`, jamais par `innerHTML` (W2). Les liens stockés dans
les configurations de projet sont refusés à l'écriture si leur schéma est `javascript:` ou
`vbscript:` (`apps/api/src/lib/config-links.mjs`, A-4). 42 documents hostiles sont rendus à chaque
lint par `apps/web/scripts/check-md-security.mjs`.

**Bot.** Toutes les routes `/bot/*` sauf l'invitation publique vérifient `x-bot-secret` en temps
constant (`botAuth`, `lib.mjs:204-210`). Le secret est `BOT_SHARED_SECRET`, à défaut
`LINK_LOOKUP_SECRET` (`lib.mjs:195`). C'est tout le modèle d'autorisation d'environ 60 routes, dont
l'une renvoie le jeton du bot Discord (`apps/api/src/routes/bot.mjs:1354`). Voir §9.

### 3.2 BMM

**API locale.** Écoute sur `127.0.0.1` uniquement (`src-tauri/src/api/mod.rs:5129`). Chaque route
protégée exige `Authorization: Bearer` ; le jeton est relu à chaque requête et comparé en temps
constant, et un jeton configuré vide n'admet personne (`ct_eq`, `api/mod.rs:797-803`, faille F1 de
l'audit Rust). Le jeton propre d'un plugin ne porte que les permissions de ce plugin ; l'identité
vient du jeton, pas d'un en-tête. Le CORS ne répond qu'aux origines Tauri, à
`https://bettercommunity.ch` et aux origines ajoutées par l'utilisateur ; une version de debug
accepte toutes les origines (`api/mod.rs:4405-4449`). Cinq routes n'exigent pas de jeton
(`/api/health`, `/api/status`, `/api/creator-id`, `/api/check-update`, `/api/language/template`) ;
une page qui fait du « DNS rebinding » pourrait les lire (pas de contrôle de `Host`, fiche ouverte).

**CSP de la webview.** La politique du `<meta>` dans `frontend/index.html:6-7` n'a **ni
`'unsafe-inline'` ni `'unsafe-eval'` dans `script-src`** depuis `ed120fd7` et `623ffa06` (tous deux du
2026-08-22). `scripts/security-guard.mjs` fait échouer le build sur tout gestionnaire d'événement
inline, tout gestionnaire construit à l'exécution, tout `eval(` ou `new Function(` (références à 0,
lignes 76-77). Restent larges : `img-src https://*` et `connect-src https://*` (les dépôts et images
de mods sont à des URL arbitraires), et `blob:` dans `script-src`. La CSP au niveau Tauri vaut `null`
(`src-tauri/tauri.conf.json:31`) : c'est la balise `<meta>` qui fait foi.

**Liens profonds.** Une seule porte pour chaque lien `bmm://` : `decideLink()` et `admitLink()` dans
`frontend/src/core/deeplink-guard.ts:203`, `495`. Les liens venus du système arrivent avec l'origine
`external` et sont demandés ou refusés (`frontend/src/core/deep_link_manager.ts:103-105`). La
fonction exposée sur `window` ne peut pas revendiquer une origine de confiance (`windowOrigin()`,
`deeplink-guard.ts:55`) ; les appelants de confiance (planificateur, API locale) passent par un
répartiteur qui n'est pas sur `window`. Les actions de catalogue sont analysées par la même fonction
des deux côtés (`catalogRoute()`, `deeplink-guard.ts:121`), ce qui a fermé la faille critique de la
carte 7. Rust réapplique les limites dures pour l'installation d'apps et de plugins
(`src-tauri/src/commands/link_guard.rs:31` `path_refusal`, `:102` `redirect_refusal`, `:168`,
`:213`) ; les thèmes n'ont pas cette seconde couche Rust (ouvert). Les URL de liens profonds sont
masquées avant journalisation (`linkForLog()`, `deeplink-guard.ts:466`). Les liens profonds peuvent
être entièrement désactivés (`deep_link_manager.ts:178`).

**Permissions des tâches.** Une tâche importée (`.bmmpa`, automatisation de plugin, `.bmmscript`)
est enregistrée désactivée, toutes ses permissions à faux, et l'utilisateur voit ce qu'elle demandait
(`sanitiseImportedTask()`, `frontend/src/features/settings/scheduler.ts:952`). Les écrans de revue et
l'exécution lisent les droits par une seule fonction et un seul vocabulaire (`grantedPermissions()`
et `RISK_KEYS`, `frontend/src/features/settings/bmmpa-inspect.ts:22`, `35` ; test
`tests/task-perms-parity.test.mjs`). Une tâche créée via MCP reçoit un `perms` explicite, tout à faux
(`creation_defaults`, `src-tauri/src/mcp/state_bridge.rs:1424`).

**Confinement des chemins.** `safe_relative_path()` refuse les chemins absolus, les lettres de
lecteur, UNC, `:` (y compris les flux NTFS), NUL, `..` et les segments faits seulement de points ou
d'espaces ; `safe_folder_name()` n'accepte qu'un composant simple (`src-tauri/src/fs_utils.rs:655`,
`681`). La synchronisation d'un dépôt refuse tout le manifeste avant la moindre écriture si un seul
chemin est dangereux ; l'installation d'apps et les launch packs appliquent la règle de dossier.
L'extraction d'archives refuse toute l'archive si une entrée, dossiers compris, sortirait de la
destination (`src-tauri/src/archive.rs`, C10-A). Exception : `read_file_base64` lit n'importe quel
chemin (`src-tauri/src/commands/disk.rs:496-500`) ; aujourd'hui seules les boîtes de dialogue de BMM
l'appellent (fiche ouverte).

**Serveur de dépôt.** Écoute sur `0.0.0.0` quand l'utilisateur choisit d'héberger
(`src-tauri/src/commands/repo_server.rs:803`). Lecture seule. À la racine, il ne sert que
`repo.json`, `Info.json` et `monitoring.json` (`builtin_may_serve`, `repo_server.rs:1028`), donc le
`server.js` du serveur autonome et ses listes d'accès et de bannis ne sont plus servis (faille F3).
`monitoring.json` est public par conception et liste l'IP et le Creator ID de chaque téléchargement
en cours (`repo_server.rs:483-497`, §9).

**Pont MCP.** Le serveur MCP appelle l'API locale avec le jeton administrateur, mais son `api_call`
générique n'autorise que GET et POST (`src-tauri/src/mcp/state_bridge.rs:1244-1246`). Ce n'est pas la
vraie frontière (MCP a ses propres outils de suppression) ; ce sont les permissions par route de
l'API qui le sont. Le binaire sidecar livré est plus ancien que le code (§9, point 7).

**Mises à jour.** La mise à jour incrémentale intégrée lit un manifeste de version depuis GitHub ou
le flux BCWEB en https, exige https pour chaque fichier et vérifie le SHA-256 de chaque fichier
avant de l'écrire (`src-tauri/src/commands/autoupdate.rs:64`, `433`, `512`). Le manifeste lui-même
n'est pas signé. Les installations et mises à jour complètes par BetterInstaller sont signées
Ed25519, et le setup de BMM épingle la clé publique avec `require_signature = true`
(`BetterInstaller/examples/bmm/installer.toml:63-64`).

**Commandes et processus.** Chaque lancement passe par les fonctions de `crate::commands::proc`
avec des tableaux d'arguments ; les valeurs destinées à PowerShell sont passées en variables
d'environnement, jamais collées dans le script (`proc::hidden_powershell`, faille F4 de l'audit
Rust).

### 3.3 BetterInstaller

- **Signatures.** Le format v2 signe l'en-tête, le manifeste et le contenu (`17240a4`). Une
  signature présente mais invalide est toujours refusée. Une `public_key` illisible, ou
  `require_signature` sans clé, empêche la configuration de se charger
  (`crates/bpkg-core/src/config.rs:424`, BI-03). La vérification et l'extraction lisent les mêmes
  octets (`crates/bpkg-core/src/package/reader.rs:178`, BI-08). Une entrée absente du manifeste
  n'est jamais installée (C9-D). Seule une signature vérifiée affiche le badge vert (BI-11), et le
  catalogue de traduction d'un produit ne peut pas reformuler le verdict (C9-A).
- **Retour arrière et rétrogradation.** Une mise à jour doit porter l'identifiant d'app attendu et
  exactement la version proposée, plus récente que celle installée (`check_offered`,
  `crates/bpkg-core/src/update.rs:194`, BI-05). Une mise à jour ratée garde l'instantané si la
  restauration est incomplète, et refuse de repartir sur un instantané inachevé (BI-04).
  `update.json` lui-même n'est pas signé (§9).
- **Authenticode.** Le lecteur retrouve son trailer avant une table de certificats, donc un setup
  signé après `bpkg build` fonctionne encore (BI-06). La signature avec un vrai certificat n'a pas
  été testée.
- **Chargement de DLL piégées.** Les imports statiques ne se résolvent que depuis System32
  (`crates/installer/build.rs:21`, `/DEPENDENTLOADFLAG:0x800`) et les chargements suivants sont
  restreints par `SetDefaultDllDirectories` (`crates/installer/src/main.rs:162-170`). Un test relit
  l'indicateur dans le binaire construit (`crates/installer/tests/pe_hardening.rs`).
- **Confinement de la désinstallation.** Un dossier n'est supprimé en entier que si l'installation
  l'a créé ou l'a trouvé vide (`owns_dir`, `crates/installer/src/uninstall.rs:42`) ; sinon seuls les
  fichiers enregistrés partent. Les racines de lecteur, les dossiers juste en dessous et le dossier
  personnel ne sont jamais supprimés en entier. Les noms de registre, l'identifiant d'app et le
  protocole sont validés au chargement (`crates/bpkg-core/src/config.rs:390`, BI-02). Les chemins de
  la configuration sont relatifs et confinés (`config.rs:458`, C9-C). Seuls les exécutables du
  paquet lui-même sont fermés (BI-09).
- **Fichiers temporaires.** Un dossier privé par processus, nom aléatoire, `0700` sous Unix,
  fichiers ouverts avec `create_new` (`crates/bpkg-core/src/tmp.rs:38`, `63`, C9-B).
- **Gestion des clés.** `bpkg keygen` refuse d'écraser une clé et l'écrit en `0600` sous Unix
  (`crates/bpkg-core/src/sign.rs:30-34`, BI-10).

---

## 4. Données personnelles

### 4.1 BCWEB

| Données | Où | Conservation (appliquée ou annoncée) | Qui les lit |
|---|---|---|---|
| Compte : e-mail, nom affiché, hachage argon2id, secret TOTP, codes de secours, avatar, bio | Postgres `User` | tant que le compte est ouvert | le membre ; le staff selon ses capacités |
| Sessions : IP, localisation approximative, navigateur et système, heures | `Session` | jusqu'à expiration ou déconnexion ; lignes révoquées supprimées 30 jours après | le membre ; un SUPERADMIN pour une récupération |
| Tentatives et alertes de connexion | `LoginAttempt`, alertes | 180 jours par défaut | staff |
| Statistiques (soumises au consentement dans le navigateur) | tables d'analytics | pages vues 365 jours, clics et mesures de performance 120, erreurs 90, replays 30 (valeurs par défaut, modifiables par un admin) | admins |
| Accès aux dépôts et catalogues (IP comprise ; la clé de bac à sable du dépôt en clair pour le propriétaire) | tables d'accès | 30 jours, au plus 5000 par élément | le propriétaire |
| Journal des e-mails envoyés | `MailLog` | 90 jours, au plus 20 000 | `manage_users`, adresses masquées dans la liste |
| Hachages d'empreinte d'appareil BMM | `CreatorFingerprint` | 180 jours après la dernière apparition | `manage_users` |
| Retours et rapports de plantage | Postgres + S3 | pièces jointes 90 jours, rapports fermés 365 jours | staff |
| Conversations et pièces jointes | Postgres + S3 | tant que la conversation existe ; les liens anonymes n'expirent jamais (§9) | les participants ; le staff avec 2FA |
| Paiements et factures | Stripe + lignes `Payment` | 10 ans (droit comptable suisse) | staff de facturation |
| Sauvegardes de la base | hôte de sauvegarde | 14 jours (`infra/backup/backup.sh:29`) | exploitant |

Ces durées sont celles qu'annonce la politique de confidentialité
(`apps/web/src/pages/legal.jsx:33`) ; les tâches de nettoyage qui les appliquent n'ont pas toutes été
relues pour ce résumé.

**Fermeture de compte.** Un membre qui ferme son compte dispose de 30 jours pour annuler
(`apps/api/src/routes/closure.mjs:33`). À la date prévue, le compte est anonymisé sur place
(`anonymiseAccount`, `closure.mjs:503`) : adresse remplacée, nom, hachage, TOTP, avatar et client
Stripe effacés, toutes les sessions, jetons de rafraîchissement et clés d'API révoqués,
consentements, liaisons aux fournisseurs, liens créateur et avis supprimés. La ligne elle-même reste,
parce que la chaîne d'audit y fait référence. Un compte fermé par le staff perd aussi ses dépôts,
catalogues et éléments, avec leurs objets S3 (`closure.mjs:463-478`). Lacunes connues : les lignes
`PasswordReset` ne sont pas supprimées (les deux routes qui les lisent les refusent désormais,
F23-2), et les objets S3 des avatars et des retours ne sont pas recherchés pour suppression.

**Sauvegardes et effacement.** Les sauvegardes de l'historique des lignes sont chiffrées par
utilisateur et la clé est détruite à l'effacement (« crypto-shredding »,
`apps/api/src/lib/shred.mjs`). Les dumps complets de la base sont gardés 14 jours. Après une
restauration, `apps/api/src/replay-erasures.mjs` réapplique les effacements enregistrés hors de la
base (`apps/api/src/lib/erasure-log.mjs`). Cette étape est manuelle et la
[procédure de restauration](run/BACKUP_FR.md#restauration) ne la nomme pas (§9).

**Export des données.** `GET /me/export` (`apps/api/src/routes/my-backup.mjs:91`) renvoie les
propres lignes du membre, identifiants masqués.

**Ce qui sort du serveur.** Stripe (paiements), Discord (bot, OAuth), GitHub, Google, Twitch et
Steam (connexion et comptes liés), le fournisseur d'e-mail, Google Tag Manager et Analytics dans le
navigateur seulement après consentement (`apps/web/src/lib/consent.js`), et Ko-fi. La politique de
confidentialité les liste comme sous-traitants.

### 4.2 BMM

- **Sur la machine.** `data.json` et les réglages (jeton de l'API, jetons de plugins, clé du
  planificateur, mots de passe de dépôts, jeton GitHub), la clé créateur scellée (DPAPI plus une
  copie dans le registre), les journaux de session, les rapports de plantage, les replays de
  session facultatifs.
- **La télémétrie est facultative (opt-in).** Rien n'est collecté avant que l'utilisateur accepte
  l'écran de consentement de BMM (`frontend/src/core/analytics.ts:3`, `78-83`). La case télémétrie de
  l'installeur est décochée et ne fait que proposer la question
  (`BetterInstaller/examples/bmm/installer.toml:241-257`) ; le rapport matériel hebdomadaire est une
  case séparée, décochée (`:287-295`). Discord Rich Presence est désactivé par défaut
  (`src-tauri/src/state.rs:215`). La case de l'enregistreur de session est cochée par défaut mais ne
  compte que sous consentement télémétrie (`installer.toml:269-278`, fiche C-8 de BI).
- **Sur le serveur de télémétrie.** Les IP sont tronquées en /24 ou /48 avant stockage, y compris
  l'IP publique déclarée par le client, et les positions sont arrondies
  (`bmm/telemetry-dashboard/server/src/anon.rs:59`, utilisé dans `main.rs:378` et `db.rs:256`).
  Conservation 180 jours par défaut (`server/src/config.rs:36`), étendue aux tables annexes
  (`db.rs:573`).
- **Ce qui sort aussi de la machine.** Le Creator ID ne part que vers les hôtes de BetterCommunity
  (`src-tauri/src/commands/net.rs:51-57`) ; une preuve de clé n'est envoyée qu'à une source pour
  laquelle l'utilisateur a configuré une clé. Les rapports de plantage et de bug sont caviardés avant
  de partir (`src-tauri/src/commands/crash.rs`, `report_redact.rs`) ; les audits de septembre n'ont
  pas relu ce caviardage de bout en bout. Une preuve créateur v5 porte quatre hachages matériels
  salés et à sens unique quand l'utilisateur lie un compte ou envoie un rapport ; le sel est public
  par site, donc ces hachages sont des hachages lents, pas un MAC (C8-B).
- **Le serveur de dépôt expose les données d'autres personnes.** Quand un utilisateur héberge un
  dépôt, `monitoring.json` publie l'IP et le Creator ID de chaque personne en train de télécharger.
  Le `PRIVACY.md` de BMM ne le mentionne pas (§9).

### 4.3 BetterInstaller

L'installeur garde localement un reçu et `uninstall-info.json`, et n'envoie rien lui-même. Les
options du setup qui font envoyer des données par BMM sont décochées (vérifié par le test des
valeurs par défaut cité dans `docs/AUDIT-SEPT24.md`), sauf l'enregistreur de session signalé plus
haut.

---

## 5. Secrets

### 5.1 Où ils se trouvent

| Secret | Où | Remarques |
|---|---|---|
| `JWT_SECRET` (sessions et cinq autres types de jetons), `AUDIT_SECRET` | `infra/compose/.env` | un seul module le lit (`apps/api/src/lib/jwt-secret.mjs`, `4457cc77`) ; le démarrage refuse la valeur du dépôt en production |
| `BOT_SHARED_SECRET`, `LINK_LOOKUP_SECRET`, `BC_LINK_SECRET` | `.env` | couverts par la garde de démarrage ; le secret du bot se rabat sur le secret de liaison |
| Identifiants de la base, de MinIO, de Redis | `.env` | Redis n'a pas de mot de passe et ne publie aucun port |
| Clés Stripe et secret de webhook, secrets des clients OAuth, identifiants d'e-mail | `.env` | |
| Jeton du bot Discord | `.env` (l'environnement l'emporte) ou le réglage admin `bot.token` | servi au bot par `GET /bot/token` |
| Jeton Ko-fi, clé de signature des sauvegardes, clé d'attestation OIDC | réglages admin | exclus des exports et imports par leur nom (`SECRET_SETTING_KEYS`) |
| Clés de sauvegarde par utilisateur | base | détruites à l'effacement |
| Jeton de l'API BMM, jetons de plugins, clé du planificateur, mots de passe de dépôts, jeton GitHub | `data.json` de BMM | retirés des exports ; jamais restaurés par-dessus ceux de la machine (faille F1 de l'audit Rust) |
| Graines de la clé créateur BMM | magasin DPAPI plus copie dans le registre ; copie décodée gardée en mémoire du processus | §9, point 14 |
| Clé Ed25519 qui signe les mises à jour de BMM | secret GitHub `BMM_PRIVATE_KEY`, écrit sur disque dans le job de publication | passé en variable d'environnement, pas collé dans le script (`.github/workflows/release.yml:79-83`) |
| Clés d'éditeur BetterInstaller | disque de l'éditeur | `create_new`, `0600` |

### 5.2 Rotation

- Sessions : révoquer un appareil depuis le panneau des sessions ; changer de mot de passe révoque
  les autres.
- Le jeton de l'API BMM se change depuis Plugins & API et vaut dès la requête suivante.
- Changer le mot de passe du tableau de bord d'un dépôt invalide tous les cookies émis pour
  l'ancien (S-4).
- Changer `JWT_SECRET` déconnecte tout le monde et change les identifiants de support BC qui en
  dérivent ; `apps/api/src/lib/jwt-secret.mjs` ne tient qu'une clé, sans seconde clé pour une
  transition.
- La clé de mise à jour de BMM ne peut pas être changée sans d'abord livrer une nouvelle clé
  publique épinglée à chaque installation ; c'est pour cela que `bpkg keygen` refuse de l'écraser.

### 5.3 Ce qui n'est jamais journalisé (CWE-532)

- Les journaux de requêtes de BCWEB ne gardent que les chemins, avec les segments qui sont des
  secrets remplacés (§3.1, Journaux).
- Les lignes d'erreur passent par le même `redactPath` ; les propositions de tâches construites à
  partir des erreurs retirent key=value, key: value, les jetons, les e-mails, les IPv4 et IPv6
  (B-4).
- Les exports et sauvegardes passent `stripSecrets` sur les valeurs, pas seulement sur les noms
  (F23-4). La seule exception est `GET /admin/settings`, qui ne filtre que par nom (O2, ouvert).
- BMM masque les paramètres de requête au nom de secret avant de journaliser un lien profond
  (faille F2 de l'audit frontend).
- Les rapports de plantage de BMM et les exports déclenchés par un lien passent par le même
  caviardage, y compris les secrets rangés dans leur propre fichier.
- CI : la clé de signature de BMM passe par `env:`, jamais dans le texte du script (C10-H).

### 5.4 L'incident connu : un jeton Discord dans `.env.example`

En juillet 2026, un vrai jeton de bot Discord a été trouvé en dur dans `infra/compose/.env.example`,
commité depuis le premier commit du dépôt. C'était le même jeton que celui en service dans le vrai
`.env`. La valeur du fichier d'exemple a été vidée, et l'historique local non poussé a été écrasé en
un seul commit pour qu'aucun commit à pousser ne le porte.

État au 2026-09-24 :
- `infra/compose/.env.example:164` vaut `DISCORD_TOKEN=`, sans valeur.
- Un balayage des 2018 commits atteignables depuis toutes les références de ce clone, avec le motif
  de secret de la CI, ne trouve **aucune** valeur en forme de jeton Discord (la seule correspondance
  est un faux jeton de test sur une branche de sauvegarde).
- **Non vérifié :** si le jeton a été changé dans le portail développeur Discord. Chaque audit depuis
  juillet note ce changement comme restant à faire. Un jeton qui a été dans un dépôt public doit être
  considéré comme connu d'autres personnes, quoi que montre l'historique aujourd'hui.
- **Non vérifié :** si GitHub sert encore un ancien objet à partir de son hachage.
- Le balayage de secrets de la CI exclut `*.example`, `*.md` et `guides/`, il n'aurait donc pas pu
  le détecter et ne détecterait pas une récidive. Recommandation au §9, point 1.

---

## 6. Chaîne logicielle et dépendances

| Contrôle | BCWEB | BMM | BetterInstaller |
|---|---|---|---|
| Audit des dépendances | `npm audit --omit=dev` : 0 dans `apps/api` et `apps/bot` ; `apps/web` a `maplibre-gl` (critique, jugé inatteignable, F10-14). Lancé à la main pendant les audits, **pas en CI** | `npm audit` : 0 ; `cargo audit` : `sevenz-rust` (neutralisé par la garde propre à BMM), `h2` 0.3 (déni de service local, demande de passer de warp à axum), `rsa` Marvin (signature seulement). Pas en CI | `cargo audit` : 0 vulnérabilité après BI-13 ; restent des crates non maintenues de la pile Slint |
| Fichiers de verrouillage | v3, chaque entrée vient de registry.npmjs.org avec un hachage d'intégrité ; `apps/api`, `apps/bot` et le build web de la télémétrie utilisent `npm ci` ; `apps/web/Dockerfile:7` et `apps/provisioner/Dockerfile:11` font encore `npm install`, et le provisioner n'a pas de lockfile | v3, mêmes contrôles | `Cargo.lock` commité |
| Jeton de la CI | `permissions: contents: read` (`BCW/.github/workflows/ci.yml`) | idem, le job de `release.yml` a `contents: write` | idem |
| Épinglage des actions | étiquettes (`actions/checkout@v5`) | étiquettes, et `dtolnay/rust-toolchain@stable` est une branche, dans le job qui détient la clé de signature des mises à jour (F10-5, ouvert) | étiquettes et une branche |
| Recherche de secrets | grep en CI sur les formes Stripe, Discord et clé privée, hors exemples et docs ; la protection de push de GitHub a bloqué un push une fois (GH013) | protection de push GitHub | protection de push GitHub |
| Commits signés | la plupart des commits montrent une signature valide (`%G?` = G) ; quelques-uns non | commits récents signés | commits récents signés, deux non |
| Signature des versions | sans objet (serveur) | mises à jour signées Ed25519 via BetterInstaller ; le manifeste incrémental n'est pas signé | paquets signés Ed25519 ; setups non signés Authenticode aujourd'hui |
| Images de base | épinglées par étiquette, `apk upgrade` dans trois Dockerfiles sur quatre ; `minio:latest` et `pgbouncer:latest` flottent | sans objet | image de dev Docker |
| Conteneurs | chaque service tourne en root (F10-12, ouvert) | sans objet | sans objet |

Un artefact non épinglé partout où Prisma est installé : `@prisma/engines` télécharge des binaires
à l'installation, hors de tout hachage de lockfile.

---

## 7. Conformité

**Textes légaux.** BCWEB publie des Conditions, une politique de Confidentialité, une page Paiements
et remboursements, une page de signalement (article 16 du DSA, LCEN, loi suisse sur le droit
d'auteur), et un Avenant de traitement des données (DPA) pour les clients qui utilisent le bot ou la
marketplace comme responsables de traitement (`apps/web/src/pages/legal.jsx`, EN et FR, mis à jour
le 2026-09-24 ; la porte `legal:check` garde cette date honnête). BMM livre `PRIVACY.md`, `TOS.md` et
leurs versions françaises. Le service est exploité depuis la Suisse et hébergé en France ; les textes
citent le RGPD et la nLPD suisse.

**Consentement.** BCWEB ne charge Tag Manager et Analytics qu'après consentement. BMM ne collecte
rien avant son propre écran de consentement ; les options de données de l'installeur sont décochées
et ne remplacent pas ce consentement.

**Demandes des personnes concernées.** Accès et portabilité : `GET /me/export`. Effacement :
fermeture de compte avec 30 jours pour annuler, puis anonymisation. Opposition et tout le reste : la
page Contact, lue par une personne. La section sur l'empreinte nomme l'empreinte canvas comme
technique de pistage, donne la base légale (intérêt légitime contre l'abus de l'offre gratuite et le
contournement des bannissements) et la conservation de 180 jours.

**Notification des violations.** La politique de confidentialité promet une notification sous
72 heures quand la loi l'exige ; le DPA promet 48 heures aux clients.

**Ce qui n'est PAS revendiqué, et ne doit pas l'être.**
- Aucune certification (ISO 27001, SOC 2) et aucun test d'intrusion externe. Chaque audit cité ici a
  été mené par le projet lui-même, avec des agents IA, sur des piles locales.
- Aucune procédure DMCA américaine et aucune revendication de « safe harbour ».
- Aucun chiffrement au repos de la base en service ; le crypto-shredding ne couvre que les
  sauvegardes.
- Aucune garantie de disponibilité au-delà d'une période payée.

**Là où les pages légales en disent plus que le code aujourd'hui** (vérifié le 2026-09-24) :
- « A Content-Security-Policy constrains what can run in your browser » (`legal.jsx:36`) : vrai pour
  l'origine des scripts, faux pour le script inline (F10-9).
- « We take a daily backup » : dépend de l'exploitant qui installe le cron ; `infra/bootstrap.sh`
  se contente de le rappeler.
- « The erasures made since it was taken are re-applied before the site serves anyone again »
  (`legal.jsx:33`) : une étape manuelle, absente de la procédure de restauration (§9, point 13).
- « We tell you in advance » si le service s'arrête (`legal.jsx:79`) : aucun préavis chiffré en jours
  (§9, point 17).

---

## 8. Historique des failles, septembre 2026

Chaque faille ci-dessous a été reproduite avant le correctif et remesurée après, la plupart avec un
test d'abord vu rouge. Gravité telle que notée dans le rapport source (CVSS 3.1 quand il est donné ;
« n/n » = non notée). Les commits sont dans le dépôt du produit concerné.

| Id | Produit | Grav. | Ce qui n'allait pas, en une ligne | Commit |
|---|---|---|---|---|
| **Pentest du 7 septembre** | | | | |
| 7-1 | BCWEB | Élevée | Le retour OAuth « ajouter une méthode de connexion » ne liait rien au navigateur : prise de compte | `6b478583` |
| 7-2 | BCWEB | Élevée | Solde de l'économie lu puis réécrit en absolu : points créés de rien, articles payés deux fois | `6b478583` |
| 7-3 | BCWEB | Élevée | `/v1/polls` listait les sondages privés et les résultats réservés au staff | `6b478583` |
| 7-4 | BCWEB | Élevée | Les dépôts suspendus ou retirés servaient encore tous leurs fichiers | `6b478583` |
| 7-5 | BCWEB | Élevée | XSS stockée via B.MD `doc-comment data-link="javascript:…"` | `6b478583` |
| 7-6 | BCWEB | Moy. | Injection CSS via n'importe quelle directive `color=` | `6b478583` |
| 7-7 | BCWEB | Moy. | Les blocs vivants B.MD envoyaient les cookies du lecteur ; `:action` était un CSRF en un clic | `6b478583` |
| 7-8 | BCWEB | Moy. | Les sessions survivaient à un changement ou une réinitialisation de mot de passe | `6b478583` |
| 7-9 | BCWEB | Moy. | Codes de la boutique tirés de `Math.random()` | `6b478583` |
| 7-10 | BCWEB | Faible | Durcissement : comparaison TOTP, échappement du sitemap, durée des preuves de clé, un décalage d'argument | `6b478583` |
| 7-11 | BMM | n/n | Le rendu Community gardait les styles de superposition et s'ouvrait sans DOMPurify | `3c686f19` |
| 7b-1 | BCWEB | Moy. | La porte des couleurs du thème laissait passer `url()` : chaque visiteur appelait un tiers | `86ecfc66` |
| 7b-2 | BCWEB | Faible | La mesure des objectifs se fiait à une clé du prototype devant une colonne interpolée | `86ecfc66` |
| **Pentest du 9 septembre** | | | | |
| P-1 | BCWEB | Élevée | `manage_bot` pouvait créer de la monnaie et changer le jeton du bot | `dcd82ce3` |
| P-2 | BCWEB | Faible | `manage_announcements` donnait un onglet et aucune route | `dcd82ce3` |
| A-1 | BCWEB | Moy. | Un événement Stripe livré deux fois faisait deux achats | `69d75e87` |
| A-2 | BCWEB | Moy. | « Il n'en existe que 3 » en vendait 12 en concurrence | `69d75e87` |
| A-3 | BCWEB | n/n | Un achat impossible à livrer annonçait à l'acheteur qu'il était prêt | `607021ea` |
| C-1 | BCWEB | Élevée | Un droit sur une page posait un produit dans la boutique d'une autre page | `af1e001c` |
| E-1 | BCWEB | Élevée | `z.string().url()` acceptait `javascript:` sur un lien de la marketplace | `17d3ca41` |
| E-2 | BCWEB | Élevée | URL de script sur l'écran de consentement OAuth, posée par n'importe quel compte | `dcabad8c` |
| E-3 | BCWEB | n/n | Les routes admin des clients OAuth sautaient le contrôle des URI de redirection | `dcabad8c` |
| E-4 | BCWEB | n/n | Les boutons de liens d'un dépôt étaient des chaînes non validées | `218c05c2` |
| G-1 | BMM | Élevée | `open_external` passait les URL à `cmd /C start` : exécution de code depuis un commentaire de blog | `373b1510` |
| D-1 | BCWEB | décision | Un achat impossible à livrer se rembourse tout seul | `dad5296d` |
| D-2 | BI | décision | Format v2 : la signature couvre l'en-tête | `17240a4` |
| D-3 | BMM | décision | L'invitation du bot ne demande plus le droit Administrateur | `3247ea0b` |
| **Pentest des 22 et 23 septembre, tour 1** | | | | |
| K-1 | BMM | Critique | La porte et le gestionnaire lisaient les liens de catalogue différemment : exécution de code depuis n'importe quelle page web | `588cb8e0` |
| K-2 | BMM | Élevée | Une automatisation importée gardait la capacité « lien profond » qu'on venait de lui retirer | `588cb8e0` |
| K-3 | BMM | Moy. | Un téléchargement de plugin sans somme de contrôle pouvait être redirigé vers un autre hôte | `588cb8e0` |
| K-4 | BMM | Moy. | L'export déclenché par un lien ignorait les secrets rangés dans leur propre fichier | `588cb8e0` |
| F10-1 | BCWEB | Élevée | Zip de plugin téléchargé et décompressé sans limite (bombe 1014:1) | `2138af12` |
| F10-2 | BCWEB | Élevée | Avis de sécurité `adm-zip` 0.6.0 | `2138af12` |
| F10-3 | BCWEB | Faible | `.dockerignore` jamais lu : contexte de build de 471 Mo, `.env` compris | `2138af12` |
| F10-4 | tous | Moy. | Pas de bloc `permissions:` en CI | `2138af12`, `f6b64926`, `680531a` |
| F10-6/7/8 | BCWEB | Moy. | En-têtes absents sur la télémétrie, S3 et les domaines clients ; pas de HSTS | `2138af12` |
| F10-11 | BCWEB | Moy. | Image de l'API construite sans son lockfile (API corrigée, web et provisioner ouverts) | `2138af12` |
| C10-A | BMM | Faible | Une entrée dossier d'un 7z pouvait sortir de la destination | `f6b64926` |
| C10-B/C | BMM, BI, télémétrie | Moy./Élevée | Avis `rustls` et `quinn-proto` (montées de version du lockfile) | `f6b64926`, `680531a`, `2138af12` |
| C10-H | BMM | Info | Clé de signature collée dans un script PowerShell en CI | `f6b64926` |
| F23-1 | BCWEB | Moy. | L'import d'une sauvegarde de contenu écrivait n'importe quel réglage admin sans contrôle | `5dfde1b3` |
| F23-2 | BCWEB | Moy. | Un jeton de réinitialisation resté en base rouvrait un compte fermé | `5dfde1b3` |
| F23-3 | BCWEB | Moy. | Une session de démo plantée n'expirait jamais | `5dfde1b3` |
| F23-4 | BCWEB | Moy. | L'export de sauvegarde emportait un champ secret de webhook | `5dfde1b3` |
| F23-5 | BCWEB | Faible | Une identité créateur, deux comptes, en changeant la casse | `5dfde1b3` |
| F1 | BCWEB | Moy. | Fermer puis rouvrir une conversation en boucle envoyait des e-mails sans limite à une adresse choisie | `1d092c04` |
| F2 | BCWEB | Moy. | Un admin sans 2FA lisait n'importe quelle conversation par la route membre | `1d092c04` |
| F3 | BCWEB | Moy. | Un MOD recevait la clé de partage, le hachage du mot de passe et les clés de bac à sable de chaque dépôt | `1d092c04` |
| F4 | BCWEB | Moy. | Des secrets dans le chemin des URL arrivaient dans les journaux | `1d092c04` |
| F5, F6, F7 | BCWEB | Faible/Moy. | Un expéditeur bloqué déclenchait encore des e-mails ; le vérificateur de copie cachait le texte signé ; curseurs orphelins | `1d092c04` |
| F5-1 | BCWEB | Moy. | Course sur l'échelle d'avertissements : le spammeur le plus rapide sautait l'exclusion temporaire et le bannissement | `261b6ecb` |
| F6-1..F6-5 | BCWEB | Moy. | Échappements CSS et `var()` passant `scopeCss`, le style inline et `style=` de B.MD ; plantage sur `constructor` ; `:::roadmap` avec cookies | `261b6ecb` |
| F5-2, F5-3, F5-4 | BCWEB | Moy./Faible | Bombe de pixels dans une icône du bot ; gagnant dupliqué payé deux fois ; octets de contrôle bruts dans `url.js` | `261b6ecb` |
| F8-1, F8-2 | BCWEB | Moy./Faible | Le classement des empreintes pouvait être noyé ; une entrée de bannissement ratait une autre graphie | `49d41460` |
| C8-A | BMM | Moy. | Un micrologiciel d'usine faisait partager une empreinte à des machines sans rapport | `c9edec3c` |
| C9-A..C9-E | BI | Moy./Faible | Le catalogue pouvait reformuler le verdict de signature ; fichiers temporaires prévisibles ; chemins de config non validés ; entrées d'archive hors manifeste ; surcharges bidi | `040eada` |
| S1-S5 | BCWEB | n/n | Studio phase 0 : XSS stockée via un lien de bouton, l'action `api`, les valeurs CSS, les superpositions ; lecture du studio d'un autre projet | `8e446823` |
| **24 septembre, tour 2** | | | | |
| B-1 | BCWEB | Élevée | `:action` de B.MD pressé avec la session du lecteur, depuis un message de contact anonyme | `7210e7aa` |
| B-2..B-5 | BCWEB | Moy./Faible | `/\hôte` lu comme un chemin ; composants stockés non validés ; IPv6 et `clé: valeur` dans le texte des tâches ; SSRF par les formes IPv6 d'une IPv4 privée | `7210e7aa` |
| C-1 (t2) | BCWEB | Moy. | Un « égal » insensible à la casse était un ILIKE : `%` et `_` servaient de jokers (15 endroits) | `7e9fc512` |
| R8-1 | BCWEB | Moy. | N'importe quel ADMIN pouvait écrire la liste de suppression que lance `clear-demo` | `7e9fc512` |
| C-2, M11, M21 | BCWEB | Moy./Faible | Casse des bannissements de Creator ID dans l'hébergement ; course sur l'approbation des avis ; lacunes des plans du bot et panneau posté sur un autre serveur | `7e9fc512` |
| A-1 (t2) | BCWEB | Moy. | Un compte suspendu gardait tous ses pouvoirs de staff (1018 portes) | `75da20e0` |
| A-2, A-3 | BCWEB | Moy. | Les routes du graphe de code n'avaient aucun contrôle de projet ; l'historique livrait les brouillons du studio | `75da20e0` |
| A-4 | BCWEB | Élevée | Un titulaire de droits sur un projet pouvait stocker un lien `javascript:` sur la page publique du projet | `75da20e0` |
| A-5 | BCWEB | outillage | La carte RBAC disait protégées sept routes ouvertes | `75da20e0` |
| **24 septembre, audits complets** | | | | |
| S-1 | BCWEB | Élevée | Le tableau de bord de dépôt et la porte de télémétrie acceptaient le jeton « 2FA en attente » comme session | `cb56bdf3` |
| S-2 | BCWEB | Moy. | La clé de stockage d'un fichier de dépôt venait du client : n'importe quel objet du bucket pouvait être servi | `cb56bdf3` |
| S-3 | BCWEB | Élevée | Pas de plafond par compte sur l'étape 2FA | `cb56bdf3` |
| S-4, S-5 | BCWEB | Moy./Faible | Le cookie du mot de passe du tableau de bord survivait au mot de passe ; adresse de collaborateur non confirmée ; l'authentification souple lisait le rôle périmé du jeton | `cb56bdf3` |
| W1 | BCWEB | Élevée | Le nettoyeur SVG du studio reconstituait `<img onerror>` en retirant une balise | `cb56bdf3` |
| W2 | BCWEB | Élevée | Les textes d'un traducteur arrivaient dans `innerHTML` sur le paiement et des écrans admin | `cb56bdf3` |
| W3, W4, W5 | BCWEB | Faible/Moy. | `::replay` avec cookies ; redirection ouverte `?next=` via `/api/avatar` ; KaTeX qui dessinait par-dessus la page | `cb56bdf3` |
| Rust F1 | BMM | Élevée | Une sauvegarde restaurée imposait le jeton de l'API, la clé du planificateur et la liste CORS de cette machine | `db9ba5fa` |
| Rust F2 | BMM | Élevée | La synchronisation de dépôt écrivait là où le manifeste le disait (écriture de fichier, code au démarrage de session) | `db9ba5fa` |
| Rust F3 | BMM | Élevée | Le serveur de dépôt intégré servait le mot de passe admin du serveur autonome | `db9ba5fa` |
| Rust F4 | BMM | Élevée | Injection PowerShell par des apostrophes Unicode | `db9ba5fa` |
| Rust F5 | BMM | Élevée | L'identifiant d'une app du catalogue nommait le dossier d'installation supprimé plus tard | `db9ba5fa` |
| Rust F6 | BMM | Moy. | Le courtier des pages isolées suivait les redirections partout et collait des origines dans la CSP | `db9ba5fa` |
| Front F1 | BMM | Élevée | Un balisage étranger pouvait déclencher un lien profond de confiance via `data-act` | `648bf22a` |
| Front F2, F3 | BMM | Moy. | Mots de passe des liens profonds dans les journaux et la télémétrie ; XSS stockée dans le créateur de modpacks | `648bf22a` |
| R13-1, R13-2 | BMM | Moy./Faible | Un `.bmmscript` qui s'accordait `resources` était présenté comme sûr ; une tâche MCP sans `perms` pouvait lancer n'importe quel lien profond | `12dd045f` |
| R12-1, R12-2 | BMM | Faible | Graines laissées dans des blocs de tas libérés ; contrôle d'audience plus faible dans la preuve v1 | `12dd045f` |
| R13-3 | BMM | Faible | Les attentes du gouverneur bloquaient les workers asynchrones et contournaient les créneaux | `32046d75` |
| BI-01 | BI | Élevée | La désinstallation supprimait tout le dossier choisi par l'utilisateur | `a52ce16` |
| BI-02 | BI | Élevée | Des noms vides faisaient supprimer `HKCU\Software\Classes` à la désinstallation | `a52ce16` |
| BI-03 | BI | Élevée | La mise à jour appliquait un téléchargement non vérifié quand la clé était mal écrite | `a52ce16` |
| BI-04..BI-13 | BI | Moy./Faible | Le retour arrière perdait la bonne copie ; rétrogradation et rejeu d'une autre app ; Authenticode cassait le setup ; DLL piégées ; TOCTOU ; `taskkill` par nom ; écrasement de clé ; badge ; bornes des analyseurs ; `quick-xml` | `a52ce16` |

---

## 9. Risques ouverts et décisions du propriétaire, par priorité

Le propriétaire a délégué toutes les décisions ouvertes (2026-09-24). Chaque fiche ci-dessous porte
donc **une décision recommandée**, pas une liste d'options : c'est ce qu'il faut appliquer. Classement
selon ce que coûterait un échec multiplié par sa facilité d'atteinte aujourd'hui.

| # | Point | Produit | Pourquoi c'est important | Décision recommandée |
|---|---|---|---|---|
| 1 | **Changement du jeton Discord non confirmé** | BCWEB | Un jeton qui a été public contrôle le bot sur chaque serveur | Réinitialiser le jeton aujourd'hui dans le portail développeur Discord, mettre le nouveau dans `.env` seulement, et noter la date dans `SECURITY_AUDIT.md`. Étendre la recherche de secrets de la CI aux fichiers `*.example` pour les formes Discord, Stripe et clé privée (les valeurs d'exemple restent permises puisqu'elles sont vides). |
| 2 | **Ports de l'API et de MinIO publiés sur toutes les interfaces** (nouveau) | BCWEB | `infra/compose/docker-compose.yml:77` et `:101` publient MinIO `9000`/`9001` et l'API `3000-3009` sur toutes les interfaces. Les guides comptent sur `ufw`, que les ports publiés par Docker contournent sur une installation standard. Atteinte directement, l'API se fie à un `X-Forwarded-For` écrit par le client (limites de débit, bannissements, IP de l'audit), échappe au blocage de `/api/domains/ask` et à tous les en-têtes ; la console MinIO est exposée aux essais de mots de passe | Publier ces ports sur `127.0.0.1` seulement (`"127.0.0.1:3000-3009:3000"`, `"127.0.0.1:9000:9000"`, `"127.0.0.1:9001:9001"`) ; les navigateurs atteignent S3 par Caddy (`S3_DOMAIN`). Puis scanner l'hôte de production depuis l'extérieur. Le fichier compose porte une modification non commitée du propriétaire : appliquer le changement par-dessus, sans jamais indexer cette modification. |
| 3 | **Actions de CI sur des références mouvantes dans le job qui détient la clé de signature des mises à jour** (F10-5) | BMM, tous | Une version compromise d'une action pourrait voler la clé à laquelle chaque BMM installé fait confiance | Épingler chaque action tierce sur un SHA complet dans les trois dépôts (SHA listés dans F10-5, à résoudre à nouveau le jour même), avec `with: { toolchain: stable }` sur `dtolnay/rust-toolchain`. |
| 4 | **Secret partagé du bot** | BCWEB | Un seul secret sans portée autorise environ 60 routes, dont `GET /bot/token`, la création de points, les avertissements et la propriété des serveurs ; il se rabat sur `LINK_LOOKUP_SECRET`, partagé avec la recherche de liens de la télémétrie | Supprimer le repli : les routes du bot n'acceptent que `BOT_SHARED_SECRET`, et la garde de démarrage l'exige. Supprimer `GET /bot/token` : le bot lit `DISCORD_TOKEN` dans son propre environnement. Tirer le résultat du casino dans l'API, pour que le bot n'envoie plus de `multiplier`. |
| 5 | **CSP `'unsafe-inline'`** (F10-9) | BCWEB | W1, W2 et A-4 n'étaient du script qu'à cause d'elle ; elle autorise aussi `connect-src https:` | Retirer `'unsafe-inline'` de `script-src` : déplacer l'amorçage du thème dans un fichier statique et charger GTM par un extrait haché. Restreindre `connect-src` à `'self'` et aux hôtes que le site appelle vraiment. Ajouter une porte qui échoue si `'unsafe-inline'` revient dans `script-src`. |
| 6 | **`update.json` non signé** (C-1) | BI, BMM | L'hébergeur des mises à jour peut les retenir, ou proposer une ancienne version authentique plus récente que celle installée ; le manifeste incrémental de BMM n'est pas signé non plus | Signer les métadonnées de mise à jour avec la clé de l'éditeur, avec une date d'expiration (7 jours) vérifiée par le client ; appliquer la même signature au manifeste incrémental de BMM. À livrer avec le prochain changement de format de BetterInstaller. |
| 7 | **Reconstruire le sidecar MCP** | BMM | `src-tauri/binaries/bmm-mcp-server-x86_64-pc-windows-msvc.exe` date du 2026-08-29 ; les sources MCP ont changé depuis (R13-2, F4 et F5 des launch packs). Une version construite maintenant livrerait l'ancien comportement | Le reconstruire maintenant (`cargo build --release --example bmm-mcp-server`), puis le construire dans `release.yml` à chaque version, pour que le binaire commité ne soit jamais celui qui est livré. |
| 8 | **Requête SQL de S-2 en production** et le balayage de A-4 | BCWEB | Les lignes écrites avant S-2 gardent une clé choisie par le client ; les configurations stockées avant A-4 peuvent encore contenir un lien de script | Lancer les deux une fois en production, en lecture seule : `SELECT id, "serverRepoId", key FROM "RepoFile" WHERE key NOT LIKE 'hosting/' \|\| "serverRepoId" \|\| '/%';` et le balayage `configLinkProblems`. Pour toute ligne trouvée : recalculer la clé, ou retirer le lien, et écrire une ligne d'audit. Les deux donnaient 0 en dev. |
| 9 | **`monitoring.json` publie les IP des personnes qui téléchargent** | BMM | Données personnelles de tiers, publiques sur le serveur de dépôt d'un utilisateur, absentes de `PRIVACY.md` | Ne publier que des agrégats (nombre de téléchargements en cours, octets, progression par fichier), sans IP ni Creator ID ; garder le détail dans l'écran BMM de l'hébergeur. Le dire dans `PRIVACY.md` et `PRIVACY_FR.md`. |
| 10 | **Conteneurs en root** (F10-12) | BCWEB | Multiplie les dégâts de toute exécution de code | Faire tourner l'API, le bot et le provisioner en `USER node` avec un `chown` du volume de sauvegarde, et la télémétrie sur `gcr.io/distroless/cc-debian12:nonroot`. Vérifier par un essai de la pile avant le déploiement. |
| 11 | **Le lien de conversation anonyme n'expire jamais** (O5) | BCWEB | `ContactThread.accessToken` (`packages/db/schema.prisma:4569`) : un e-mail transféré ouvre la conversation pour toujours | Faire expirer le lien 12 mois après la dernière activité (l'expéditeur peut en redemander un par e-mail), et donner au côté qui répond un bouton « révoquer le lien » qui émet un nouveau jeton. |
| 12 | **R1 : configuration de Caddy depuis l'admin** | BCWEB | Aujourd'hui, on ajoute un site Caddy avec `infra/caddy/site.mjs` sur le serveur, validé avant tout rechargement ; aucune API n'écrit la configuration de Caddy | Ne pas le construire. Caddy reste géré depuis le serveur avec `site.mjs` ; l'admin peut seulement afficher la liste des sites, en lecture seule. |
| 13 | **La restauration ne rejoue pas les effacements** (nouveau) | BCWEB | La politique de confidentialité le promet ; `apps/api/src/replay-erasures.mjs` existe, mais les étapes de restauration ne le lancent pas et redémarrent l'API avant | Ajouter le rejeu à la procédure de restauration (guides EN et FR), entre la restauration de la base et le démarrage de l'API : `docker compose exec api node src/replay-erasures.mjs --write`, avec `web` arrêté. |
| 14 | **Graines de la clé créateur gardées en mémoire** (fiche R12 n°1) | BMM | `STORE` (`src-tauri/src/commands/creator_v5.rs:234`) et `DECODED` (`creator_v5/keystore.rs:857`) gardent les graines décodées pendant toute la vie du processus ; un dump les emporte | Accepter et documenter. Un processus capable de lire la mémoire de BMM tourne sous le même utilisateur et peut appeler DPAPI lui-même ; le cache existe pour la vitesse des preuves. Écrire le risque accepté dans `creator_v5.rs` et dans ce document. |
| 15 | **Action de lien profond morte** (fiche R13 n°5, fiche front C4) | BMM | L'étape `deeplink` du planificateur émet des événements que personne n'écoute (`frontend/src/features/settings/scheduler.ts:3371-3376`) ; les liens profonds de la doc appellent une fonction non exportée (`frontend/src/docs/docs-hub.ts:3203`) | Supprimer l'étape générique `deeplink` (les actions typées couvrent les vrais usages ; une tâche existante se charge toujours et affiche l'étape comme retirée). Faire passer les liens de la doc par `window.__bmmDeeplink(url)`, dont l'origine est non fiable, donc l'utilisateur est consulté. |
| 16 | **`read_file_base64` non confinée** | BMM | Lecture de fichier arbitraire le jour où un plugin ou un outil MCP l'atteindra | La confiner aux racines de profils configurées et aux dossiers de journaux et de plantages de BMM, avec la même garde que les autres commandes disque. |
| 17 | **Préavis en cas d'arrêt du service** | BCWEB juridique | Les Conditions promettent de prévenir « à l'avance » si le service s'arrête, sans nombre de jours | 60 jours de préavis par e-mail et dans le compte, contenu téléchargeable jusqu'à la fin, remboursement au prorata (déjà écrit). Écrire « 60 jours » dans les Conditions et la page Paiements, EN et FR, et avancer la date légale. |

**Autres points ouverts, chacun avec sa décision.**

| Point | Produit | Décision recommandée |
|---|---|---|
| Pas de jeton CSRF sur les routes authentifiées par cookie | BCWEB | Refuser les requêtes qui modifient l'état, authentifiées par cookie, quand `Sec-Fetch-Site` vaut `cross-site` (ou, sans cet en-tête, quand `Origin` n'est pas le site) ; les requêtes Bearer, clé d'API et secret du bot sont exemptées. |
| Lignes `PasswordReset` gardées après une fermeture (reste de F23-2) | BCWEB | Supprimer les lignes `PasswordReset` et `EmailVerification` dans `anonymiseAccount`. |
| Objets S3 des avatars et des retours laissés à l'effacement | BCWEB | Supprimer l'avatar et les pièces jointes des retours de la personne pendant l'effacement. |
| O1 : clé de partage d'un catalogue privé renvoyée aux lecteurs sur liste blanche | BCWEB | Retirer `shareKey` du sérialiseur commun ; ne la renvoyer que sur les routes du propriétaire. |
| O2 : `GET /admin/settings` ne filtre les secrets que par nom | BCWEB | Passer `stripSecrets` sur chaque valeur avant de répondre. |
| O3 : texte brut d'exception dans les réponses | BCWEB | Renvoyer des codes d'erreur fixes sur les routes publiques et journaliser le détail côté serveur ; garder le détail pour les outils SUPERADMIN seulement. |
| O4 : `fileSer` recopie la clé de stockage | BCWEB | Remplacer la recopie par une liste explicite de champs, sans `key`. |
| `DOMAIN_ASK_KEY`, `CUSTOM_DOMAIN_MATCHER` n'atteignent aucun conteneur (F10-10) | BCWEB | Passer `DOMAIN_ASK_KEY` à l'API et à Caddy, et `CUSTOM_DOMAIN_MATCHER` à Caddy dans le compose, et fixer une clé aléatoire en production. |
| Image web construite avec `npm install` ; provisioner sans lockfile | BCWEB | Appliquer le correctif `npm ci` déjà écrit à `apps/web/Dockerfile` ; générer et commiter un lockfile pour le provisioner et le passer à `npm ci`. |
| `minio:latest`, `pgbouncer:latest` | BCWEB | Épingler les deux sur une version et les monter volontairement. |
| Pas d'audit des dépendances en CI | tous | Ajouter des jobs `npm audit --omit=dev --audit-level=high` et `cargo audit` aux trois CI, bloquants, avec une petite liste commitée des avis déjà jugés inatteignables (maplibre F10-14, `rsa`, `quick-xml`). |
| Chemin zip natif sans borne `take()` | BCWEB | Ajouter `.take(limite)` sur le lecteur d'entrée dans `native/core/src/lib.rs` et reconstruire l'addon. |
| Environ 70 `href` se fient au contrôle fait à l'écriture | BCWEB | Ajouter un `safeHref()` dans les composants de lien communs maintenant ; passer à React 19 quand les dépendances le permettront. |
| `apiUrl()` sans liste d'hôtes | BCWEB | Les blocs vivants de B.MD ne vont chercher que sur l'origine du site et sur une liste d'hôtes réglée par l'admin, vide par défaut. |
| Le staff a les droits de propriétaire sur chaque tableau de bord de dépôt | BCWEB | MOD en lecture seule ; écrire (téléverser, publier, liste d'accès) demande ADMIN. |
| La lecture d'une conversation par le staff n'écrit pas de ligne d'audit (reste de F2) | BCWEB | Écrire une ligne d'audit chaque fois qu'un membre du staff ouvre une conversation dont il ne fait pas partie. |
| `@page` survit à `scopeCss` | BCWEB | Refuser `@page` dans le CSS écrit par les membres. |
| Prise d'épinglage par anticipation non signalée dans BMM (C8-C) | BMM | Afficher `key_fork`, `key_retired` et `upgraded_key_required` sur la carte d'identité des Réglages, avec le lien pour réinitialiser l'épinglage. |
| `FP_ROUNDS` à 20 000 contre 200 000 en v4 | BMM | Accepter : l'augmenter invaliderait tous les hachages stockés, et le coût qui compte (confirmer une hypothèse) reste un seul hachage dans les deux cas. |
| Appairage `/link/request` pour les Creator ID non épinglés ; lignes d'empreinte pour des identifiants sans propriétaire | BCWEB | Accepter les deux, compromis documentés de compatibilité et de lutte contre le contournement. |
| Installation de thème par lien sans second contrôle en Rust | BMM | Ajouter une commande `link_install_theme` avec les mêmes règles https, d'hôte et de taille que pour les plugins. |
| Catalogues de plugins sans somme de contrôle | BMM | Rendre `sha256` obligatoire dans le format des catalogues de plugins ; pendant une version, une entrée sans somme ne s'installe qu'après un avertissement. |
| API locale sans contrôle de `Host` | BMM | N'accepter comme `Host` que `127.0.0.1:<port>` et `localhost:<port>`, plus les hôtes que l'utilisateur ajoute pour un tunnel. |
| `h2` 0.3 via warp | BMM | Accepter pour l'instant (déni de service local seulement) ; prévoir la migration de warp vers axum avec la prochaine refonte de l'API. |
| Pas de plafond de taille à l'extraction et au téléchargement | BMM | Plafonner un téléchargement à 4 Gio en flux et refuser, avant extraction, une archive dont le total déclaré dépasse 16 Gio ou un ratio de 1000:1. |
| Restauration `.DATABMM` des droits des pages et des tâches venant de quelqu'un d'autre | BMM | Avertir avant de restaurer ces deux sections quand l'`author_id` du paquet n'est pas celui de l'utilisateur, et importer les tâches désactivées. |
| Les exports emportent `github_token` ; l'export automatique copie `data.json` brut | BMM | Retirer `github_token` de tout export (celui de la machine est gardé à la restauration) et faire passer l'export automatique par `build_export_json`. |
| `pause_all` sans fin ni bandeau | BMM | Afficher `paused_all` dans l'état des ressources avec un bandeau, et reprendre automatiquement à la fin de la tâche qui a mis en pause. |
| `requirePerm` accepte toute valeur vraie | BMM | N'accorder que sur `=== true`. |
| `install_dir` du handoff non validé (C9-F) | BMM | Ne l'accepter que s'il est égal au dossier d'installation de BMM ; valider `settings.language` comme les autres champs. |
| Écart de somme de contrôle accepté depuis l'app | BMM | Garder ce choix dans l'app (c'est la décision de l'utilisateur, après avertissement) et garder le refus dur pour les installations par lien ; corriger la phrase de BMM Docs qui dit « vérifié avant de pouvoir s'exécuter ». |
| Tâche armée qui exporte vers un chemin UNC sans dialogue | BMM | Garder (la sauvegarde nocturne vers un NAS est voulue) ; le chemin est confirmé une fois à l'enregistrement de la tâche. |
| `installer.toml` authentifié seulement par Authenticode | BI | Acheter un certificat de signature de code et signer chaque setup de BMM après `bpkg build` ; mettre un hachage de la configuration dans le manifeste signé, dans le même changement de format que le point 6. |
| C-2 : app laissée ouverte pendant une mise à jour à distance | BI | Fermer l'app après le téléchargement et avant l'application, comme le fait le chemin local. |
| C-3 : fichiers ajoutés par les mises à jour non enregistrés | BI | Les enregistrer dans `uninstall-info.json`. |
| C-5 : trois comparateurs de versions | BI | En garder un (`crate::version`) et supprimer les deux autres. |
| C-6 : processus fermés par nom | BI | Fermer par chemin complet de l'image. |
| C-8 : enregistreur de session coché par défaut | BI | Le décocher par défaut, comme toute autre option qui envoie des données. |

**Appliqué le 2026-09-24 (agent-sec-api).** Les n° 4, 11, 13 et 17 ci-dessus, et dans la liste : CSRF, lignes `PasswordReset`/`EmailVerification`, objets d'avatar et de retours à l'effacement, O1, O2, O3, O4, staff sur les tableaux de bord de dépôt (MOD en lecture seule), ligne d'audit quand le staff lit une conversation, et `@page`. Correctifs et tests nés rouges : `SECURITY_AUDIT.md`, « §9 decisions applied ». Reste pour le responsable de compose : `BOT_SHARED_SECRET` retombe encore sur `LINK_LOOKUP_SECRET` dans `infra/compose/docker-compose.yml`.

---

## 10. Ce que ce document ne vérifie pas

- Si le jeton Discord divulgué a été changé, et si GitHub sert encore un ancien objet.
- Tout ce qui est sur le serveur de production : ports ouverts et règles de pare-feu, les balayages
  de S-2 et A-4, le cron de sauvegarde, le passage effectif des nettoyages de télémétrie et
  d'analytics, un texte légal peut-être remplacé par une copie enregistrée depuis l'éditeur légal de
  l'admin.
- Que les ports publiés par Docker contournent `ufw` sur l'hôte de production précisément (c'est le
  comportement documenté de Docker ; il n'a pas été mesuré là-bas).
- La CSP dans un navigateur, une vraie signature Authenticode, les chemins macOS, un BMM lancé, et
  le bot Discord face à une vraie passerelle. Les audits derrière ce résumé posent les mêmes limites.
- Les durées de conservation du §4.1 ont été lues dans la politique de confidentialité ; toutes les
  tâches de nettoyage n'ont pas été relues.

---

## 11. Comment garder ce document vrai

**Ce qu'une porte (gate) impose aujourd'hui.**

| Propriété | Porte | Où elle tourne |
|---|---|---|
| Aucune route ne perd sa garde ; une capacité n'ouvre que ses portes | `apps/api/test/capability-route-matrix.test.mjs`, `apps/web/scripts/check-capabilities.mjs` | CI de BCW (`npm test`, lint web) |
| Aucune troisième porte ne lit le cookie de session seule | `apps/api/test/session-side-doors.test.mjs` | CI de BCW |
| Pas de `javascript:` dans les champs d'URL stockés | `apps/web/scripts/check-url-schemas.mjs`, `apps/api/test/config-links.test.mjs` | CI de BCW |
| Le contenu écrit par les membres reste inerte | `apps/web/scripts/check-md-security.mjs` (42 documents hostiles), `check-site-theme.mjs`, le balayage `innerHTML` du test `rich-text`, les tests `bmd-action` et `svg-safe-reparse` | CI de BCW |
| Plages SSRF | tests `ssrf-ranges`, `ssrf-rebind`, `ssrf-embedded-v4` | CI de BCW |
| Secrets commités | `.github/scripts/secret-scan.mjs` (Discord, Stripe, `whsec_`, clés privées ; `*.example` compris, `*.md` et `guides/` exclus ; un autotest plante 8 secrets à chaque exécution) | CI de BCW |
| Avis de sécurité des dépendances | `.github/scripts/dep-audit.mjs` (`npm audit --omit=dev --audit-level=high`, `cargo audit`), bloquant, avec une liste d'exceptions motivées par dossier, `.github/audit-ignore.json` | CI des trois dépôts |
| Actions tierces | chaque `uses:` épinglé sur un SHA complet, le tag en commentaire | CI des trois dépôts |
| Fraîcheur du sidecar MCP | `release.yml` construit `bmm-mcp-server` et vérifie son `--version` avant l'empaquetage | release de BMM |
| Date légale pas plus ancienne que le texte légal | `apps/web/scripts/check-legal-fresh.mjs` | CI de BCW |
| Les guides décrivent la vraie pile | `guides/check-claims.mjs`, `guides/check-links.mjs` | CI de BCW (claims), à la main (liens) |
| Caddyfile valide pour le Caddy en service | job `caddy validate` | CI de BCW |
| Aucun gestionnaire inline, aucun `eval` dans BMM | `scripts/security-guard.mjs` | script `ci` de BMM et build |
| Toutes les routes de liens profonds ont une décision | `scripts/deeplink-map.mjs --check`, `tests/deeplink-guard.test.mjs` | CI de BMM |
| Le vocabulaire des permissions de tâches est une seule liste | `tests/task-perms-parity.test.mjs`, `check-condition-perms.mjs` | CI de BMM |
| Permissions et secrets de l'API | `check-api-perms.mjs`, `check-api-secrets.mjs`, `check-dev-toggles.mjs` | CI de BMM |
| Gardes de chemin Rust, comparaison de jeton, caviardage | `cargo test` (608 tests) | CI de BMM |
| Signature, retour arrière, désinstallation, indicateur DLL, docs conformes au format de l'installeur | `cargo test --workspace`, `pe_hardening.rs`, `docs_match_format.rs`, clippy `-D warnings` | CI de BI (Windows et Linux) |

**Ce qui n'a pas de porte.**
- Pas de Dependabot (le job d'audit échoue sur un avis connu, il ne propose pas de mise à jour).
- L'utilisateur des conteneurs, les empreintes des images de base, les ports
  publiés.
- Le texte de la CSP lui-même (un retour à `'unsafe-inline'` côté BCWEB passerait la CI ; côté BMM,
  `security-guard.mjs` compte les gestionnaires, il ne lit pas la balise `<meta>`).
- Le fait que les pages légales disent ce que fait le code (seule la date est contrôlée). Relire le
  §7 quand une fonction qui touche des données personnelles est livrée.
- La rotation des secrets et la procédure de restauration.

**Quand mettre ce document à jour.** Après chaque tour de pentest ou d'audit, quand un point du §9
est fermé ou tranché, et quand un nouveau flux de données ou une nouvelle frontière de confiance est
livré. Garder chaque affirmation liée à un fichier et une ligne, et relire la ligne plutôt que
l'audit précédent.
