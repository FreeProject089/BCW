# BCWEB — IA optionnelle pour la modération (Laya) (FR)

🇬🇧 [English version](AI_LAYA_EN.md)

BCWEB peut demander un second avis à un classifieur sur ce qu’on lui envoie : un message de
contact, un commentaire, un rapport de plantage, un message Discord. **C’est éteint par défaut,
et tout fonctionne sans** : le moteur de règles décide seul, et l’IA ne fait qu’y ajouter un signal.

Ce guide couvre ce qu’est l’IA et ce qu’elle n’est pas, ce qu’elle coûte au serveur, comment
l’allumer et l’éteindre (coupure d’urgence comprise), quel texte sort de l’API, et ce qui a été
vérifié ou non.

---

## 1. Ce que c’est, et ce que ce n’est pas

Le fournisseur par défaut est **Laya** (`convaiinnovations/laya-multilingual`, Apache-2.0) : un
classifieur de 322 millions de paramètres (mmBERT-base) qui lit un texte dans plus de 100 langues
et répond à des questions fixes :

- **oui / non avec une probabilité** : « est-ce du spam ? », « de l’hameçonnage ? », « est-ce
  insultant ? », « est-ce écrit pour provoquer ? », « hors sujet ? », « une menace juridique ? » ;
- **un choix dans une liste** : « quelle catégorie de plantage ? », « laquelle de ces étiquettes ? ».

Il **n’écrit jamais de texte**. Il ne peut pas rédiger une réponse ou une description ; il note
et il choisit, c’est tout.

**Sa précision est modeste.** La fiche du modèle indique elle-même qu’il est trop sûr de lui
(confiance moyenne de 0,75 à 0,83 pour une précision bien plus basse), moins bon en anglais que
le modèle anglais seul, et faible sur les langues peu dotées. Donc, dans BCWEB :

- un score d’IA peut **ouvrir un cas** à signaler ou à revoir ; il n’est **jamais la seule raison
  d’un blocage**, d’un bannissement ou d’une décision finale ;
- **les signalements et les avis juridiques finissent toujours devant un humain** (l’IA n’en
  ferme jamais un) ;
- sur Discord, un verdict de l’IA peut au plus **supprimer un message ou avertir**, jamais
  exclure temporairement, expulser ou bannir.

## 2. Les trois fournisseurs

| Fournisseur | Ce qui se passe | Qui voit le texte |
|---|---|---|
| **Règles seules** (`off`, par défaut) | Aucun appel d’IA. | Personne de plus. |
| **Laya, sur ce serveur** (`laya`) | L’API appelle un conteneur annexe (`laya`) sur le réseau Docker interne. | Ton serveur seulement. |
| **API d’IA externe** (`external`) | L’API appelle un point d’accès compatible OpenAI : `/moderations` (ne mesure que toxique et automutilation) ou `/chat/completions` en mode « chat » (toutes les étiquettes). | **Un tiers.** Voir la section 8. |

Le modèle n’est **jamais** chargé dans le processus de l’API : un modèle de 322M emporterait la
mémoire et le CPU de l’API avec lui. L’API ne fait que des appels HTTP, avec les garde-fous de
la section 4.

## 3. Où elle est consultée

Chaque endroit a son propre interrupteur dans **Admin → Modération → Fournisseur d’IA**, tous
éteints tant qu’ils ne sont pas cochés, et ils ne comptent que si l’interrupteur général est actif :

| Endroit | Questions posées (une requête par élément) |
|---|---|
| Formulaire de contact | spam, hameçonnage, toxique, troll, menace juridique |
| Signalements | spam, toxique, menace juridique, automutilation (toujours en revue humaine) |
| Avis juridiques et de droits | spam, menace juridique (toujours en revue humaine) |
| Rapports de plantage | spam, hors sujet, + catégorie de plantage |
| Rapports de bug, suggestions | spam, toxique (, troll), hors sujet, + catégorie |
| Messages entre membres et d’équipe | spam, hameçonnage, toxique (, troll) |
| Commentaires, avis, vitrine | spam, hameçonnage, toxique, troll, hors sujet |
| Automod Discord | hameçonnage, spam, troll, toxique (serveurs payants seulement, section 6) |
| Liens d’hameçonnage partout | hameçonnage, spam |

Le moteur de modération (`apps/api/src/lib/moderation/`) décide quand demander : les règles
d’abord, l’IA seulement dans la zone grise, et après la réponse sauf si la politique d’un endroit
dit autrement.

**L’aide BMM** (`POST /api/ai/bmm/suggest`, éteinte tant que « Aide BMM » n’est pas cochée)
permet à un membre connecté (session, ou clé d’API avec la portée `ai:suggest`) de demander une
étiquette, une catégorie, la langue, un contrôle de contenu adulte ou la cause d’un plantage pour
un texte de 4000 caractères au plus. Réponse : `{ ok: true, provider, result: { choice, probs, p } }`,
ou `{ ok: false, reason }` avec `disabled`, `busy`, `unavailable` ou `rate_limited`.

**Quelle clé BMM utilise.** BMM l’appelle avec la clé d’API qu’il garde déjà : celle que le site
crée quand un compte est lié dans BMM (ou depuis « obtenir une clé de notifications »). Les clés
créées à partir de maintenant portent `notifications:read` **et** `ai:suggest`. Une clé émise
avant garde exactement ses portées, et reçoit `403 insufficient_scope` : son propriétaire obtient
la nouvelle portée en demandant une nouvelle clé, jamais parce qu’une ancienne aurait été élargie.
Un appel par clé n’est pas soumis à la règle « confirme ton e-mail », et il est limité comme un
appel par session (30 par minute, puis le budget par utilisateur de la couche).

**Qui la configure.** Le panneau du fournisseur d’IA et chaque porte `/api/admin/ai/*` demandent
la capacité **Configurer la modération** (`manage_moderation`), comme le moteur de modération
dont elle fait partie. Tirer le coupe-circuit est ouvert à cette capacité ; rallumer l’IA reste
une décision d’admin.

## 4. Ce qu’elle coûte, et pourquoi elle ne peut pas dévorer le serveur

**Ressources du conteneur Laya** (d’après la liste Hugging Face, 29/09/2026) :

| | Taille |
|---|---|
| Modèle sur disque (volume `laya-models`) | environ **0,7 Go** (644 Mo de poids + 34 Mo de tokenizer) |
| Image (Python slim, torch CPU seul) | environ 1 à 1,5 Go |
| RAM une fois chargé | environ 1,5 Go ; le conteneur est plafonné à **2 Go** |
| CPU | plafonné à **1,5 CPU**, 2 threads torch |
| Latence | 33 ms par question sur un GPU T4 ; sur CPU, compter 150 à 400 ms par élément |

**Garde-fous dans l’API** (`apps/api/src/lib/moderation/ai.mjs`), tous réglables depuis l’écran
admin dans des bornes fixes, plusieurs aussi depuis l’environnement :

- **Délai** par appel (1,5 s par défaut) : au-delà, la réponse est « pas d’IA », jamais une attente.
- **Appels simultanés** (1 par défaut) et une **file bornée** (16 en attente par défaut) ; un
  appelant qui ne peut pas entrer reçoit « occupé » tout de suite.
- **Plafond d’entrée** : le texte est ramené à du texte brut (balises et caractères de contrôle
  retirés, URL des liens gardées visibles) et coupé à 2000 caractères avant de partir.
- **Disjoncteur** : après 5 échecs de suite, l’IA se met en pause 60 s, puis un essai décide.
- **Limites de débit** par personne et pour tout le site, par minute (partagées via Redis quand
  `REDIS_URL` est défini, en mémoire sinon).
- **Cache** : le même texte avec les mêmes questions dans les 2 minutes est servi de mémoire.
- **Mesures** : file, appels en cours, latence p50/p95, compteurs, dernière erreur, sur l’écran admin.

Quoi qu’il arrive (éteint, coupé, en panne, occupé, lent, réponse illisible), la couche IA
répond « rien » et les règles décident seules. Elle ne lève jamais d’erreur dans une requête.

## 5. L’allumer, l’éteindre

### Laya sur ce serveur

1. Dans `infra/compose/.env` :
   ```
   COMPOSE_PROFILES=ai              # avec PgBouncer aussi : COMPOSE_PROFILES=pgbouncer,ai
   LAYA_API_KEY=<openssl rand -hex 32>
   ```
   Mets le profil dans `.env`, pas sur la ligne de commande : `infra/deploy.sh` lance un simple
   `docker compose up -d`, qui lit `.env` et arrêterait sinon le conteneur annexe.
   **La clé est obligatoire.** Sans elle (ou avec la valeur d’exemple de `.env.example`, ou
   plus courte que 16 caractères), le point d’entrée de l’image (`infra/laya/entrypoint.py`)
   refuse de démarrer : `laya-fetch` s’arrête avec le code 64 et une ligne dans
   `docker compose logs laya-fetch` qui dit pourquoi, et `laya`, qui l’attend, ne démarre
   jamais. L’API affiche alors Laya **« Non configuré »** et ne l’appelle jamais. Compose
   lui-même ne refuse pas (`${LAYA_API_KEY:?}` ferait échouer toute commande `docker compose`
   sur un serveur qui n’a jamais activé le profil `ai` : Compose résout les variables de tous
   les services avant d’appliquer les profils), donc la vérification est dans l’image.
2. Construire et démarrer : `docker compose --profile ai build laya` puis `docker compose up -d`.
   Le premier démarrage lance une fois `laya-fetch`, qui télécharge le modèle (~0,7 Go) dans le
   volume `laya-models` ; ensuite `laya` le sert **hors ligne** sur le réseau interne `ai` (aucun
   port publié, aucune route vers Internet). `LAYA_REVISION=reviewed` épingle le modèle au commit
   revu par laya 0.3.21.
3. Dans **Admin → Modération → Fournisseur d’IA** : choisis « Laya », active l’IA, coche les
   endroits, et utilise la case **Essayer** pour voir une vraie réponse et sa latence.

### Une API externe

Renseigne `AI_EXTERNAL_URL` (la base, par exemple `https://api.example.com/v1`) et
`AI_EXTERNAL_KEY` dans `.env`, redémarre l’API, puis choisis « API d’IA externe » sur l’écran
admin. L’URL doit être **en https et publique** : http, adresses privées ou de bouclage, noms
internes, identifiants dans l’URL et paramètres de requête sont refusés, et chaque réponse DNS est
revérifiée au moment de l’appel. Seulement pour un modèle hébergé sur ton propre réseau,
`AI_EXTERNAL_ALLOW_PRIVATE=1` lève les règles d’adresse. L’URL et la clé ne sont lues que dans
l’environnement : jamais stockées en base, jamais journalisées, jamais affichées sur l’écran admin
(il dit « configurée » ou « refusée »).

### L’éteindre : quatre niveaux

| Du plus léger au plus fort | Effet |
|---|---|
| Décocher un endroit | Cet endroit repasse aux règles seules. |
| Interrupteur général éteint, ou fournisseur « Règles seules » | Plus d’IA nulle part ; le conteneur annexe tourne à vide. |
| **Coupure d’urgence** (écran admin, « Couper l’IA maintenant ») | Tout appel d’IA est coupé d’un coup (ce processus d’API immédiatement, chaque autre réplica en 3 s). Les règles continuent. Reste coupé jusqu’à ce qu’un admin la lève. |
| **`AI_KILL_SWITCH=1`** dans `.env` + redémarrer l’API | Pareil, mais **un admin ne peut pas la lever** depuis le site : seul l’opérateur le peut. |

Pour récupérer aussi la mémoire et le CPU du conteneur annexe : `docker compose --profile ai stop laya`,
et retire `ai` de `COMPOSE_PROFILES` pour que le prochain déploiement ne le relance pas.

## 6. Discord : l’automod assistée par IA (une option payante)

Les propriétaires de serveur la trouvent dans leur tableau de bord, **Automod → Vérification
assistée par IA**. C’est la fonction d’offre **`aiAutomod`**, **payante par défaut** : un serveur
sans offre qui l’inclut ne peut pas l’activer (l’API refuse l’enregistrement avec « nécessite une
offre du bot Discord »), et le bot la reçoit éteinte. Un admin peut la rendre gratuite en la
cochant dans le palier gratuit du bot (Admin → Offres d’hébergement), ou la vendre dans une offre.

Le parcours d’un message :

1. **D’abord les contrôles fixes**, dans le bot, gratuits et instantanés : un lien qui imite
   Discord, Steam, PayPal, GitHub ou d’autres pages de connexion (d1scord, st3am, dlscord,
   steamcommunlty…), une adresse en punycode ou en IP brute, un identifiant caché dans le lien, un
   appât « Nitro gratuit » sur un raccourcisseur de liens. Quand ils sont sûrs, ils agissent seuls
   avec l’action choisie par le propriétaire.
2. **Seul un message qu’aucune règle n’a arrêté** est envoyé à l’API du site
   (`POST /bot/ai/automod`), qui revérifie l’offre (le bot n’en est pas cru), applique un budget par
   serveur, et interroge l’IA. Le bot attend 2,5 s au plus ; au moindre échec, il ne se passe rien.
3. Un verdict de l’IA coûte au plus **supprimer** ou **avertir**.

## 7. Référence de configuration

Sur l’écran admin (stocké dans les réglages `ai.config` et `ai.killed` ; les deux passent aussi
par la porte générique des réglages et par l’import de configuration, avec la même validation) :
fournisseur, interrupteur général, interrupteurs par endroit, aide BMM, seuils de signalement et de
revue (pour le moteur de modération), délai, appels simultanés, file, attente dans la file,
caractères envoyés, disjoncteur, limites de débit, durée du cache, mode externe et nom du modèle.

Dans `.env` (une valeur fixée ici **l’emporte** sur l’écran admin, qui grise le champ) :

| Variable | Rôle |
|---|---|
| `COMPOSE_PROFILES` | ajouter `ai` pour démarrer le conteneur annexe (`laya-fetch` puis `laya`). |
| `LAYA_API_KEY` | clé partagée par l’API et le conteneur annexe. **Obligatoire avec le profil `ai`** : sans elle le conteneur annexe refuse de démarrer et l’API affiche Laya « Non configuré » (il n’est jamais appelé). |
| `LAYA_URL` | l’adresse du conteneur annexe, `http://laya:8000` par défaut. |
| `LAYA_REVISION` | épinglage du modèle : `reviewed` (par défaut) ou un SHA de commit. |
| `LAYA_CPUS` / `LAYA_MEM_LIMIT` / `LAYA_THREADS` | le plafond du conteneur annexe (1,5 CPU, 2g, 2 threads par défaut). |
| `AI_KILL_SWITCH` | `1` = IA coupée, et un admin ne peut pas la lever. |
| `AI_PROVIDER` | forcer `off`, `laya` ou `external`. |
| `AI_TIMEOUT_MS` / `AI_CONCURRENCY` | forcer le délai et les appels simultanés. |
| `AI_EXTERNAL_URL` / `AI_EXTERNAL_KEY` | l’API externe (https, publique). **Clé secrète.** |
| `AI_EXTERNAL_ALLOW_PRIVATE` | `1` = autoriser http et les adresses privées, pour ton propre modèle seulement. |

## 8. Vie privée : quel texte sort de l’API

- **Règles seules** : rien ne sort.
- **Laya** : le texte vérifié, nettoyé et coupé à 2000 caractères, va de l’API au conteneur `laya`
  sur la même machine, par un réseau interne. Aucun identifiant, e-mail, IP ou donnée de compte
  n’est envoyé : seulement le texte et, pour la question « hors sujet », une courte description
  de l’endroit. L’API n’écrit rien sur disque ; la réponse (des scores, pas le texte) reste en
  mémoire 2 minutes sous un hash du texte. Le conteneur annexe tourne au niveau de journal
  `warning`, il n’écrit donc pas une ligne par requête.
- **Automod Discord** : le texte des messages vérifiés va du bot à l’API, puis comme ci-dessus.
  Il est noté, pas conservé.
- **API externe** : le texte vérifié part chez **un tiers**, selon ses conditions et dans son pays.
  **Avant de l’activer**, la politique de confidentialité doit nommer ce fournisseur, ce qui est
  envoyé et pourquoi (intérêt légitime de modération), et l’accord de traitement des données avec
  lui doit exister. La liste des sous-traitants de la politique de confidentialité dit « un
  fournisseur d’IA, seulement si nous en activons un » ; quand tu l’actives, ajoute son nom dans
  le même changement, car une fonction qui arrive sans bruit rend les pages légales fausses.

## 9. Quand quelque chose cloche

| Symptôme sur l’écran admin | Cause probable |
|---|---|
| « Non configuré » | `LAYA_API_KEY` n’est pas définie pour l’API. Mets-la dans `.env` (la même valeur que le conteneur annexe) et redémarre l’API. |
| « Injoignable » | Le conteneur annexe ne tourne pas (profil absent, ou il a refusé de démarrer sans sa clé : `docker compose logs laya-fetch`), charge encore, ou `LAYA_API_KEY` diffère entre les deux côtés. `docker compose ps laya`, `docker compose logs laya`. |
| Beaucoup d’« expirés » | CPU trop petit pour la charge : augmente `LAYA_CPUS`, ou envoie moins (moins d’endroits, moins de caractères), ou augmente un peu le délai. |
| « En pause après des échecs répétés » | Le disjoncteur s’est ouvert ; il réessaie seul après la pause. |
| « Occupé » dans la case d’essai | La file est pleine : 1 appel simultané avec un CPU lent. C’est le garde-fou qui fonctionne. |
| `laya-fetch` se termine en erreur | Pas d’Internet au premier démarrage, ou Hugging Face injoignable. Il n’a besoin de réussir qu’une fois. |

## 10. Ce qui a été vérifié, et ce qui ne l’a pas été

Vérifié (29/09/2026) : la couche IA contre un faux conteneur annexe (délai, disjoncteur, file
pleine, coupure par réglage et par env, cache, troncature, réponses illisibles, limites de débit,
règles d’URL externe, ni clé ni URL dans l’état), les routes (authentification, validation,
réponse « désactivé », aller-retour de la coupure, secret du bot et offre), les contrôles fixes
anti-hameçonnage du bot et sa suite par l’IA, l’accord du tableau de bord et du bot sur la forme
enregistrée, `docker compose config` avec et sans le profil `ai`.

Vérifié aussi (29/09/2026, durcissement sécurité de l’image) : `docker build --pull` de
`infra/laya/Dockerfile` (Debian 13, deux étapes, pas de pip à l’exécution, paquets Debian
inutiles purgés ; environ **1,35 Go**), le scan Trivy de l’image jugé par la porte de la CI
(0 CRITICAL, 0 HIGH hors les quatre entrées revues de `.github/security/trivyignore.yaml`),
le refus de démarrer sans `LAYA_API_KEY` (code 64), les imports de laya, torch 2.9.1+cpu et
transformers, et `laya-serve` démarré en uid 10001 avec `--cap-drop ALL`, sans réseau et sans
modèle préchargé, son HEALTHCHECK répondant.

**Non vérifié : le modèle n’a jamais été téléchargé ni utilisé pour classer quoi que ce soit.**
Le chiffre de RAM et la latence sur ton CPU sont des estimations tant que tu n’as pas lancé
`docker compose --profile ai up -d` et observé un premier démarrage. Le format de réponse de
Laya a été lu dans le code source du paquet (laya 0.3.21, `laya/serve.py`), pas observé en direct.

## 11. Statistiques d’usage, et ce qui est construit sur cette couche (aios)

Chaque appel qui passe par cette couche est désormais compté, par jour, surface et fournisseur :
appels, échecs, délais dépassés, un histogramme de latence (p50 / p95), réponses en cache, appels
limités et abandonnés, ouvertures du disjoncteur et appels qu’il a refusés, jetons et coût estimé
pour le fournisseur externe. Sont aussi comptées : les décisions que l’IA a placées au-dessus des
règles, et combien de fois le verdict d’un modérateur lui a donné raison (cas signalé retiré ou
sanctionné) ou tort (clos comme faux positif ou écarté). **Des compteurs seulement** : aucun texte,
extrait ni empreinte de texte n’est stocké. L’encadré d’état ci-dessus montre toujours les chiffres
en mémoire de ce processus ; le tableau montre l’historique stocké.

Le tableau, les aides aux membres (suggestions de tags et de langue, vérification avant
publication, brouillons de description), les clés des membres, la clé du site et les outils du
staff sont décrits dans [AI_FEATURES_FR.md](AI_FEATURES_FR.md) : **Admin → Modération → Aides IA**.

## 12. Erreurs BMM en direct dans le tableau de télémétrie (telemetry-live)

Le service de télémétrie (`bmm/telemetry-dashboard`) reçoit sur `/issues` les rapports d’erreurs
envoyés en direct par BMM et les regroupe dans son écran **Issues**. Chaque NOUVEAU groupe est
envoyé à cette couche pour quatre étiquettes : catégorie, gravité, « environnement de l’utilisateur
ou bug de BMM », et si un groupe antérieur semblable est le même problème. L’appel est de serveur à
serveur, `POST /internal/telemetry/classify-issue` avec le `x-link-secret` partagé (le même que pour
les appels d’identité RGPD), et passe par le pipeline ci-dessus : interrupteur d’arrêt, l’unique
créneau de concurrence, disjoncteur, cache, statistiques d’usage sous la fonction
`telemetry_issues` (Admin → Modération → Aides IA, fonctions staff, activée par défaut).

- **Pourquoi par l’API et pas directement le sidecar :** une seule clé (`LAYA_API_KEY` reste ici),
  une seule file (un second client contournerait le budget de concurrence dont dépend la
  modération), un seul interrupteur, un seul jeu de compteurs. Le conteneur de télémétrie n’a pas
  besoin du réseau `ai`.
- **Laya seulement.** La route refuse avec `not_laya` quand le fournisseur est l’externe : le texte
  des erreurs n’est pas envoyé à un tiers.
- **Jamais sur le chemin d’ingestion.** Le service de télémétrie met le groupe en file et continue ;
  son worker a son propre délai (10 s), son disjoncteur (5 échecs, 2 min), son cache (1 h), et se
  met en pause 5 minutes quand la réponse est `disabled`, `unconfigured`, `feature_off` ou
  `not_laya`.
- **Éteindre :** l’un des quatre niveaux du §5, l’interrupteur de la fonction, celui du tableau
  (Issues → Laya), ou `ISSUES_AI=0` sur le service `telemetry` (`TELEMETRY_ISSUES_AI` dans `.env`).
- Les corrections du staff sont stockées à côté des étiquettes de Laya, jamais par-dessus ; l’écran
  Issues montre à quelle fréquence le staff a gardé la catégorie de Laya.
