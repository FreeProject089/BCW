# BCWEB — Référence de l'API

*🇬🇧 [English version](API_Reference_EN.md).*

Liste complète de l'API HTTP de BetterCommunity Web. Toutes les routes sont servies sous le
préfixe **`/api`** à l'URL de base du site (dev : `http://localhost:5176/api/...`). Générée depuis
les modules de routes Fastify dans `apps/api/src/routes/`.

> Les chemins, méthodes et paramètres restent en anglais (ce sont des identifiants de code) —
> seules les descriptions sont traduites.

## Conventions

- **Base :** `<SITE_URL>/api` — ex. `http://localhost:5176/api/health`.
- **Format :** JSON en entrée / JSON en sortie. L'auth est un **cookie de session** (posé par le
  login), sauf indication contraire (secret du bot / signature de webhook).
- **Santé :** `GET /api/health` → `{ ok, db, ts }` (sans auth).
- **Barre oblique finale :** l'API répond aux deux écritures — `/api/health` et `/api/health/`
  atteignent la même route (`ignoreTrailingSlash`). L'edge redirige les chemins *du site* vers
  la forme sans barre oblique par un 308 (qui conserve la méthode et le corps), mais `/api` et
  `/hosting` en sont exemptés : un client programmatique obtient sa réponse plutôt qu'une
  redirection qu'il ne suivra peut-être pas, et sous `/hosting` une barre oblique finale
  désigne un listage de répertoire, pas le fichier d'à côté.

### Niveaux d'auth (la colonne « Auth »)
| Tag | Signification |
|---|---|
| **—** | Public, sans auth. |
| **user** | Cookie de session connecté. |
| **mod** / **admin** | La *surface* modérateur ou admin, derrière un **compte avec 2FA**. À lire comme « au moins jusque-là », pas comme un rôle exact : la plupart des lignes sont des `requireCap('manage_x')`, qui admettent ADMIN et SUPERADMIN, tout rôle nommé par la capacité, **et** tout compte dont le rôle personnalisé la porte. Une ligne « admin » est donc souvent ouverte aussi à un MOD ou à un porteur de capacité. Quand une ligne est vraiment un `requireRole('ADMIN')` et rien d'autre, la colonne But le dit. |
| **superadmin** | `requireRole('SUPERADMIN')` seulement. |
| **server-control** | Octroi `canControlServer` **+ cookie d'élévation 2FA renforcée**. |
| **bot** | Secret partagé du bot Discord (en-tête `x-bot-secret`), vérifié en temps constant. |
| **webhook** | Signature/token externe (Stripe / Ko-fi), vérifié en temps constant. |
| **pow** | Public mais exige un token de preuve de travail (anti-spam). |

> Conventions de pagination/liste : la plupart des endpoints de liste acceptent `?q=` (recherche),
> `?skip=`/`?take=` (pagination), et renvoient des payloads en forme `{ items, hasMore }`.

---

## 1. Auth & compte (`auth.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| POST | `/auth/register` | pow | Créer un compte (argon2id) → route vers la 2FA optionnelle. |
| POST | `/auth/login` | — | Login par mot de passe ; renvoie `{ twoFactorRequired, tempToken }` si 2FA. |
| POST | `/auth/login/2fa` | — | Compléter le login avec un code TOTP/récupération. |
| POST | `/auth/logout` | user | Effacer la session. |
| GET | `/auth/pow` | — | Récupérer un défi de preuve de travail (pour register/contact). |
| POST | `/auth/reset/request` | — | Demander un token de réinitialisation de mot de passe. |
| POST | `/auth/reset/confirm` | — | Définir un nouveau mot de passe avec le token. |
| GET | `/me` | user | Compte courant. |
| PATCH | `/me` | user | Mettre à jour le profil (displayName, bio, avatar…). |
| POST | `/me/password` | user | Changer le mot de passe. |
| GET | `/me/2fa` | user | Statut 2FA. |
| POST | `/me/2fa/setup` | user | Démarrer la 2FA (renvoie QR + secret). |
| POST | `/me/2fa/enable` | user | Confirmer + activer la 2FA (renvoie les codes de récupération). |
| POST | `/me/2fa/disable` | user | Désactiver la 2FA (mot de passe + code). |
| GET | `/me/sessions` | user | Appareils connectés à ce compte. Renvoie `{ sessions[], currentTracked }` ; chaque entrée porte `current`, `ip`, `device`, `browser`, `os`, `country`, `region`, `city`, `createdAt`, `lastSeenAt`. Sessions vivantes uniquement, activité la plus récente d'abord, plafonné à 100. `currentTracked:false` signifie que le jeton de l'appelant est antérieur au suivi des sessions et n'apparaît donc pas dans la liste. |
| DELETE | `/me/sessions/:id` | user + ré-auth | Révoquer un appareil. **Corps : `{ password, code }`** — le mot de passe est requis, et `code` est un TOTP si le compte a la 2FA ; un compte OAuth sans mot de passe ni 2FA passe sur la seule session. Filtré par compte autant que par id : un id appartenant à autrui renvoie 404 au lieu d'agir. Idempotent. Révoquer sa propre session efface aussi le cookie et répond `{ ok, self:true }`. Refus : `403 wrong_password` / `403 bad_code`. |
| DELETE | `/me/sessions` | user + ré-auth | Révoquer tous les AUTRES appareils, en gardant celui de l'appelant. Même corps `{ password, code }` et mêmes refus que ci-dessus. Renvoie `{ ok, revoked }`. |

## 2. Connexion OAuth (`oauth.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/auth/oauth/providers` | — | Quels providers sont configurés (sonde de fonctionnalité). |
| GET | `/auth/oauth/:provider/start` | — | Démarrer l'OAuth GitHub/Discord (state signé HMAC). |
| GET | `/auth/oauth/:provider/callback` | — | Callback OAuth → crée/lie le compte. |
| GET | `/me/oauth` | user | Identités OAuth liées. |

## 3. Catalogue & modération (`catalog.mjs`, `uploads.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/catalog` | — | Parcourir les items **publiés** seulement (filtre par projet/type/recherche). |
| GET | `/catalog/:slug` | — / owner / `?k=` | Détail d'un item. Un item non publié reste **privé** : joignable uniquement via son lien de partage (`?k=<shareKey>`) ou par son propriétaire/un admin — renvoie `private:true` et n'est jamais dans la liste/feed public. Miroir des Server-Repos. |
| GET | `/catalog/:slug/download` · `/dl` | — / owner / `?k=` | Téléchargement présigné d'un payload — même garde de lien privé ; les téléchargements ne comptent que sur un vrai hit public. |
| GET | `/catalog.json` · `/catalog/:slug/catalog.json` | — / `?k=` | Feed de catalogue consommable par BMM. Le feed public est publié-seulement ; le feed par item honore `?k=` pour qu'un propriétaire importe un item non listé dans BMM. |
| GET | `/catalog/hosting-quote` | user | Aperçu du prix pour héberger un item. |
| POST | `/catalog` | user | Soumettre un nouvel item (→ modération). |
| POST | `/catalog/:id/update` | user | Proposer une mise à jour. |
| POST | `/catalog/:id/delete` · `/delete/cancel` | user | Planifier/annuler la suppression (grâce 72h). |
| POST | `/catalog/:id/hosting/cancel` | user | Annuler l'hébergement payant d'un item. |
| POST | `/catalog/downloads` | — | Enregistrer les événements de téléchargement. |
| GET | `/me/items` · `/me/items/:id/payload` | user | Mes items + accès payload. |
| GET | `/mod/submissions` | mod | File de modération. `?status=PENDING\|REJECTED\|SUSPENDED\|PUBLISHED` (défaut PENDING) + `?q/kind/type/sort`. |
| POST | `/mod/submissions/:id/approve` · `/reject` | mod | Approuver → publié, ou rejeter (raison → propriétaire ; il peut ensuite éditer & resoumettre). |
| POST | `/mod/submissions/:id/suspend` | admin | **Suspendre** un item (raison). Plus dur qu'un rejet : le propriétaire **ne peut pas** resoumettre (`/catalog/:id/update` renvoie `item_suspended`). Réversible via approve/reject. |
| PUT | `/mod/submissions/:id/tags` | mod | Tagger une soumission. |
| POST/DELETE | `/mod/submissions/:id/comments[/:cid]` | mod | Commentaires de modération. |
| GET | `/admin/catalog` · `/admin/catalog/:id/file` | admin | Vue catalogue admin + fichier brut. |
| POST | `/admin/catalog` · `/admin/catalog/:id/validate` | admin | Création admin / vérif d'intégrité de plugin. |
| GET | `/admin/catalog/:id/plugin-content` · `/plugin-file` | admin | Inspecter un package de plugin. |
| POST | `/uploads/presign` | user | PUT S3 présigné (taille/type plafonnés). |
| GET | `/media/*` | — | Assets média servis. |

## 4. Blog (`blog.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/blog` · `/blog/:slug` | — | Liste + article de blog publics (`?home=1` pour Dernières news). |
| POST | `/blog` · PATCH `/blog/:id` · DELETE `/blog/:id` | mod/octroi | Créer/éditer/supprimer un article. |
| GET | `/blog/my-scopes` | user | Les blogs où je peux écrire. |
| GET/POST/DELETE | `/admin/blog-permissions[/:id]` | admin | Octrois de permission blog granulaires. |

## 4b. Newsletter (`newsletter.mjs`)
Conforme RGPD : double opt-in à l'inscription, désabonnement sans login en un clic dans chaque
e-mail, et les envois sont déclenchés par admin uniquement (pas d'auto-envoi à la publication).
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| POST | `/newsletter/subscribe` | — | S'abonner (double opt-in) : crée une ligne `pending` + envoie un lien de confirmation. Body `{ email, locale? }`. Idempotent ; ne divulgue jamais si une adresse existe. |
| GET | `/newsletter/confirm?token=` | — | Confirmer depuis le lien e-mail → `active`. Renvoie une page HTML. |
| GET | `/newsletter/unsubscribe?token=` | — | Désabonnement en un clic, sans login (RGPD). Renvoie une page HTML. |
| GET | `/admin/newsletter` | admin | Lister les abonnés + compteurs (actif / en attente / désabonné). |
| POST | `/admin/newsletter/broadcast` | admin | Envoi manuel aux abonnés ACTIFS. Body `{ subject, title, body, url? }`. Chaque e-mail porte le pied de désabonnement. |

## 5. Projets & vitrine « Autres projets » (`projects.mjs`, `showcase.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET/POST/DELETE | `/admin/projects/:key/activity-import` | admin (`manage_projects`) | La source des commits de l'onglet Activité quand les stats GitHub ne suffisent pas : POST `{ log, label? }` avec la sortie de `git log --all --format="%H|%aI|%an|%s"` (le texte brut de `git log` est accepté aussi). Stocké en COMPTES par jour / par auteur (quelques Ko, jamais les messages) ; GET renvoie le résumé ; DELETE revient aux statistiques GitHub. Tant qu'un import existe, `/projects/:key/activity` le lit (`source.imported:true`) et GitHub ne fournit que les marqueurs de release. |
| GET | `/projects` · `/projects/:key` | — | Pages de config des projets (BMM/BSM/…). |
| GET | `/projects/:key/community` · `/progress` · `/releases` | — | Données des sous-onglets de projet. |
| PUT | `/projects/:key` | admin | Éditer la config du projet. |
| GET | `/admin/projects` | admin | Liste des projets admin. |
| PUT | `/admin/projects/:key/blog-tab` · `/home-news` · `/visibility` · `/schedule` | admin | Toggles par projet + màj planifiée. |
| POST | `/admin/projects/flush-cache` | admin | Vider le cache GitHub/vitrine. |
| GET | `/showcase` · `/showcase/:slug` (+ `/community` `/progress` `/releases`) | — | Pages « Autres projets ». |
| GET/POST/PUT/DELETE | `/admin/showcase[/:id]` (+ `/schedule`) | admin | Gérer les projets vitrine + échange planifié. |

## 6. Server-Repos (`repos.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/repos` · `/repos.json` | — | Liste de repos publics + feed agrégé (avec empreinte). |
| POST | `/repos` · DELETE `/repos/:id` · PATCH `/repos/:id` | user | Créer / supprimer / éditer son propre repo. `contactEmail` obligatoire quand `repoUrl` est donné (un dépôt servi ailleurs nomme quelqu’un à joindre), `contactPhone` optionnel ; PATCH ouvert aux membres de l’équipe du dépôt, DELETE au propriétaire. |
| POST | `/repos/:id/check` · `/list` · `/favorite` · `/push` | user | Vérifier / lister / mettre en favori / mettre à jour un repo (push SHA-seulement). |
| GET | `/me/repos` · `/me/hosting/groups` | user | Mes repos + pools d'hébergement. |
| POST | `/me/repos/:id/renew` · `/upgrade` · `/to-multi` · `/to-single` | user | Changements de cycle de vie/plan. |
| PUT | `/me/repos/:id/quota` · `/settings` | user | Quota + réglages. |
| POST | `/me/hosting/groups/:id/repos` | user | Ajouter un repo à un pool. |
| GET | `/admin/repos` · `/admin/repos/identify?fp=` | admin | Liste admin + **lookup par BC-id**. |
| POST | `/admin/repos/host` · `/:id/verify` · `/reject` · `/revalidate` · `/delete/cancel` · `/check-all` | admin | Provisioning/modération admin. |
| PATCH | `/admin/repos/:id` | admin | Édition admin — incl. `status` et `category` (**niveau de confiance** : community / partner / official ; official+partner remontent en tête de la liste publique et obtiennent un badge). |
| POST | `/admin/repos/:id/feature` | admin | Booster (mettre en avant) un repo pour N jours (gratuit). |

> **Les repos SUSPENDED sont gelés pour le propriétaire.** Quand le statut d'un repo est
> `SUSPENDED`, les mutations de config du propriétaire (rôle USER) — `PATCH /repos/:id`,
> `PUT /me/repos/:id/settings` · `/quota`, `POST /me/repos/:id/upgrade` · `/to-multi` ·
> `/to-single` — renvoient `403 { error: 'repo_suspended' }`. Seule la récupération (`/renew`,
> `/delete/cancel`) reste ouverte au propriétaire ; le staff gère tout via `/admin/repos`
> quel que soit le statut.

## 7. Dashboard propriétaire de repo (`repo-dashboard.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/repos/:id/dashboard` · `/activity` · `/traffic` | user (owner) | Dashboard (incl. statut + niveau de confiance), journal d'activité, graphe de trafic — reste consultable même suspendu. |
| POST | `/repos/:id/dashboard/files` · `/files/presign` · `/files/download-zip` · DELETE `/files/:fid` | owner | Gestionnaire de fichiers + zip groupé. |
| POST | `/repos/:id/dashboard/publish` · `/unpublish` · `/ban` · `/unban` | owner | Contrôles publish/ban. |
| POST | `/repos/:id/dashboard/unlock` · `/lock` | — | Publiques délibérément : `unlock` EST la porte du mot de passe (argon2, limité à 10/min, pose le cookie `bcw_rd_<id>` en cas de succès) et `lock` ne fait que l’effacer. Les annoncer réservées au propriétaire décrivait une porte qui doit être ouverte pour qu’on y frappe. |
| PUT | `/repos/:id/dashboard/access` · `/settings` | owner | Contrôle d'accès + réglages. |

> **Les repos suspendus sont totalement gelés** : un repo `SUSPENDED` refuse **chaque** non-GET
> ici (ajout/suppression de fichiers, publish/list, réglages, accès, état) avec
> `403 repo_suspended` — le dashboard reste en lecture seule jusqu'à ce qu'un admin le lève.

## 8. Contenu & fichiers de repo hébergé (`hosting-content.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/hosting/:owner/:repo/repo.json` · `/files/*` | — | Contenu de repo servi publiquement (sandboxé, download-only). C'est ce que BMM récupère **et** ce que visent les boutons de download de la page du dépôt — une seule porte, les mêmes plafonds/compteurs. La session d'un navigateur y compte comme identité (mêmes entrées whitelist/bans que le `X-Creator-ID` de BMM). |
| GET | `/r/:id/contents` | — | La liste des fichiers du dépôt pour sa page web, plus un verdict `access` (`canDownload`, `restricted`, `reason`). Même règle de visibilité que `GET /r/:id` (listé+vérifié, lien de partage `?k=`, ou propriétaire/staff). Dépôt ouvert → liste complète pour tout le monde. Restriction + déconnecté → `reason: 'login_required'` et la **liste est retenue**, pas seulement le bouton (un dépôt privé ne doit pas divulguer ses noms de fichiers). Banni → 403. Les réponses restreintes sont `no-store`. |
| GET/POST/DELETE | `/repos/:id/files[/:fid]` · `/files/presign` | user | Gérer les fichiers d'un repo. |
| POST | `/repos/:id/publish` · `/unpublish` | user | État de publication. |
| GET/POST | `/admin/repos/:id/files` (+ `/download`, `/download-all`, `/publish`, `/unpublish`) | admin | Accès fichiers admin. |

## 9. Hébergement, facturation & Stripe (`hosting.mjs`, `stripe-webhook.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/hosting/plans` · `/capacity` · `/price` · `/feature-price` | — | Plans, capacité, aperçu de prix en direct. |
| POST | `/hosting/checkout` | user | Stripe Checkout pour un repo hébergé unique (supporte `autoRenew`). |
| POST | `/repos/:id/feature/checkout` | user | Checkout pour un feature/boost de repo (one-time ou `autoRenew`). |
| POST | `/hosting/cart/quote` | user | Chiffrer un **panier** (repos + boosts) en direct, en validant/combinant les codes promo empilés — sans effet de bord. |
| POST | `/hosting/cart/checkout` | user | Un Stripe Checkout pour tout un panier. Exige `acceptedTerms:true` ; persiste un `PendingCart` ; l'`autoRenew` par item sauve la carte + le webhook démarre un abonnement. |
| POST | `/me/billing/portal` | user | Lien du Customer Portal Stripe. |
| GET | `/me/billing/overview` | user | Abonnements Stripe actifs (type, nom du repo, date de renew/trial, état d'annulation). |
| GET | `/me/invoices` | user | Historique complet des factures Stripe (one-time + chaque cycle d'abonnement). |
| GET | `/me/invoices/:id/pdf` | user | Streamer la vraie PDF de facture Stripe en pièce jointe (propriété vérifiée). |
| GET | `/me/payments` · `/me/payments/:id` | user | Registre de paiements local. |
| GET | `/me/payments/:id/stripe-link` | user | Résoudre la vraie URL de facture/reçu hébergée par Stripe pour un paiement. |
| POST | `/me/subscriptions/:id/cancel` | user | Arrêter l'auto-renew (`cancel_at_period_end`) ou reprendre (`{resume:true}`), propriété vérifiée. |
| POST | `/hosting/webhook` | webhook | Webhook Stripe (provisionne repos/boosts/paniers au paiement, cycles d'abonnement, remboursements — signature vérifiée). Traite aussi `checkout.session.async_payment_succeeded` (un moyen de paiement différé qui s'encaisse plus tard — même livraison que `completed`) et `checkout.session.expired` (une clé de pool marketplace réservée est rendue). |
| GET | `/marketplace/checkout/:sessionId/status` | user | **Lecture seule.** Ce que la page de retour de l'acheteur interroge : `{status: pending \| paid \| delivered \| failed, purchase?}`. Propriété vérifiée (la session doit être celle de l'appelant). Ne livre jamais — la livraison se fait dans le webhook uniquement. 404 si la session est inconnue ou appartient à quelqu'un d'autre. |
| GET | `/admin/payments/pending` | manage_hosting | Le registre `PendingCheckout` : chaque checkout Stripe ouvert (le plus ancien d'abord, avec son âge en minutes) plus les lignes terminées les plus récentes. `?limit=` (1–500, défaut 100). |
| POST | `/admin/payments/reconcile` | manage_hosting | Lancer la réconciliation maintenant. Corps `{olderThanMin?}` (défaut 15, `0` = inclure les checkouts ouverts il y a quelques secondes). Renvoie `{ok, olderThanMin, summary: {scanned, delivered, alreadyDelivered, failed, stillPending, alerts, errors}}`. 503 `stripe_not_configured` sans clé. Audité en `payments.reconcile`. |

**Payé mais non livré, et comment on le referme.** Chaque route qui ouvre un Stripe Checkout
(marketplace, hébergement, panier, boost, pool, hébergement de catalogue, cagnotte, MYO,
listing vitrine, bot) écrit une ligne `PendingCheckout` (`kind`, `sessionId` UNIQUE, `status`)
à l'instant où la session existe. Le webhook passe la ligne à `delivered` (argent encaissé) ou
`failed` (expirée). Si le webhook n'a jamais tourné — API à l'arrêt, endpoint mal configuré —
la ligne reste `pending`, et `lib/stripe-reconcile.mjs` la rattrape : au démarrage (lignes de
plus d'1 min), depuis le sweeper toutes les ~10 min (plus de 15 min), ou depuis le bouton
admin. Pour chaque ligne en retard, il récupère la session chez Stripe et **rejoue le même
handler que le webhook** (`dispatchStripeEvent`), donc un seul chemin de livraison, pas deux ;
chaque branche est idempotente (marketplace : `checkoutSessionId` UNIQUE, `paymentIntentId`
enregistré). Une ligne payée que le webhook n'avait pas provisionnée lève un `ErrorEvent`
(source `reconcile`) et notifie chaque SUPERADMIN ; une ligne livrée deux fois fait pareil ;
une ligne que le webhook avait bien livrée pendant que le registre traînait est corrigée sans
bruit. L'URL de retour (`/dashboard?market=ok&session_id=…`) n'accorde rien : le dashboard
interroge la route de statut ci-dessus jusqu'à lire `delivered`.

## 10. Annonces & notifications (`announcements.mjs`, partie de `misc.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/announcements` | — | Bandeau/annonces actifs à l'échelle du site. |
| GET/POST/PUT/DELETE | `/admin/announcements[/:id]` | admin | Gérer les annonces (toggle bandeau, icônes de type). |
| POST | `/admin/notify-all` | admin | Pousser une notification à chaque utilisateur. |
| GET | `/me/notifications` | user | Mes notifications. |
| POST | `/me/notifications/:id/read` · `/read-all` | user | Marquer comme lu. |
| DELETE | `/me/notifications[/:id]` | user | Effacer une/toutes. |

## 11. Politique d'accès (`access-policy.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET/PUT | `/admin/access-policy` | superadmin | Politique globale whitelist/ban. |
| GET/PUT | `/me/access-policy` | user | Politique par propriétaire pour ses propres repos. |

## 12. Ko-fi (`kofi.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| POST | `/webhooks/kofi` | webhook | Webhook Ko-fi (flag donateur, log de pourboire ; token temps-constant). |
| GET | `/kofi/stats` | — | Stats publiques d'objectif de financement. |
| GET/PUT/DELETE | `/admin/kofi/goal` | admin | Gérer l'objectif de financement. |
| GET/PUT | `/admin/kofi/settings` | admin | Réglages d'intégration Ko-fi. |
| POST | `/admin/kofi/grant` | admin | Accorder manuellement l'avantage donateur. |

## 13. API du bot Discord (`bot.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| POST | `/bot/economy/buy` | bot | Un achat `/shop` depuis Discord. Exécute la MÊME `buyShopItem()` (`lib/economy-shop.mjs`) que le `/me/economy/buy` du site : prix relu, livraison avant débit, une ligne `EconomyPurchase` (l'inventaire). Badges / pool / boost / hébergement / codes promo fixes sont livrés par l'API ; rôles et récompenses perso sont enregistrés `pending` pour un admin. |
| POST | `/me/economy/purchases/:id/reveal` | user | Crée le code d'un achat scellé (ligne promo assignée au détenteur sauf si l'article est offrable ; expiration = item.codeDays à partir de maintenant). |
| POST | `/me/economy/purchases/:id/gift` | user | Remet un achat offrable `{ to }` (id, BC id, e-mail ou pseudo) à un autre membre. |
| POST | `/me/economy/gift` | user | Envoie des points `{ to, points, note? }` — minimum / plafond quotidien depuis `economy.gifts`. Les deux côtés ont une ligne de registre ; le destinataire est notifié. |
| GET | `/me/economy/history?kind=` | user | Le registre du membre (levelup · grant · purchase · casino · gift_out · gift_in · gift_item_out · gift_item_in). |
| GET | `/admin/economy/stats?days=` | `manage_economy` | Où vont les points : totaux (membres, actifs 7 j, XP, points, niveaux) plus générés / gagnés / perdus / donnés / dépensés pour aujourd’hui, hier, cette semaine, la semaine dernière, ce mois, le mois dernier, et une série quotidienne (7–90 jours). Un GROUP BY par jour et par type (`lib/economy-season.mjs`). |
| GET / PUT | `/admin/economy/season` | `manage_economy` | Le calendrier de saison (`every` : never / daily / weekly / monthly / quarterly / yearly / custom N jours ; `weekday`, `dayOfMonth` 1–28, `hour` UTC, `resetXp`, `announce`), l’état (numéro, dernière remise à zéro, historique) et la prochaine. Activer un calendrier démarre l’horloge maintenant. |
| POST | `/admin/economy/season/end` | `manage_economy` | Terminer la saison maintenant : les points de chaque membre à zéro (l’XP aussi si `resetXp`), une ligne `season` par détenteur. Le sweeper exécute la même remise à zéro quand le calendrier le dit. |
| GET | `/admin/economy/history?q=&kind=` | admin | Tout le registre, par membre. Rétention : `economy.historyDays` (sweeper). |
| POST | `/bot/economy/reveal` · `/bot/economy/gift` · GET `/bot/economy/history/:discordId` | bot | Les trois mêmes, pour Révéler / Offrir dans /inventory, /gift et /history. |
| GET | `/bot/economy/leaderboard?guildId=&discordId=` | bot | Top 10 — global, ou les membres liés d'un serveur avec `guildId` ; `me` = le rang de l'appelant. `GET /og/leaderboard.png?guildId=&me=` le dessine. |
| GET | `/admin/bot/emoji-keys` · `/admin/bot/emoji/:key.png` · `/admin/bot/emoji-pack.zip` | admin | Les icônes des boutons du bot : la liste des clés, un PNG, tout le pack à téléverser sur la page Emojis de l'app. Associées dans `economy.icons`. |
| GET | `/bot/emoji/keys` · `/bot/emoji/:key.png` | bot | Le même jeu d’icônes pour le bot lui-même : au démarrage il téléverse chaque clé comme **emoji d’application** (`bc_<clé>_<version>`), remplace celles dont le dessin a changé, et ne dessine jamais d’emoji unicode. |
| POST | `/admin/bot/actions` · `/me/discord/guilds/:id/actions` | mod / owner | Aussi `role_add` / `role_remove` avec `roleId` (+ `guildId` pour la route admin). Un propriétaire ne peut nommer qu'un rôle listé par le heartbeat pour ce serveur. |
| GET / PUT | `/me/discord/guilds/:id` | owner | Un serveur que l'appelant possède ou gère. Le GET renvoie sa `moderation` (règles automod + échelle, `features/automod.mjs`) et `logRouting` (`features/logs.mjs`), plus les `roles` / `channels` en direct du heartbeat ; le PUT accepte `moderation` et `logs` via les schémas bornés `MODERATION_SCHEMA` / `LOGS_SCHEMA` (chaque nombre borné, chaque action un enum, clés inconnues retirées) et les FUSIONNE dans `bot.config.guilds[id]` — un propriétaire n'atteint rien au-delà de ses propres sous-arbres. |
| POST | `/me/discord/guilds/:id/logs/test` | owner | « Où est-ce que ça atterrirait ? » — résout UNE catégorie de log contre le routage **enregistré** (le même ordre que `resolveRoute()` dans `features/logs.mjs` : la route propre de la catégorie, puis celle de son groupe, puis le forum des logs, puis le salon des logs, puis le salon de modération de `/config`) et répond `{ ok, route: { kind, id, tags, from } }`. Quand ça ne mène nulle part, `ok` est faux et **rien n'est mis en file**. Sinon une BotAction `log_test` est mise en file et le bot y publie une entrée d'exemple. |
| PUT | `/bot/guilds/:id/features` | bot | Les deux mêmes sous-arbres écrits depuis Discord (`/logs setup`, `/logs route`) : `{ actorDiscordId, patch: { moderation?, logs? } }`, mêmes schémas, même contrôle propriétaire-ou-gestionnaire-lié. |
| GET | `/bot/economy/purchases/:discordId` | bot | Les achats du membre — la commande `/inventory`. |
| GET | `/bot/economy/season` | bot | Le calendrier de saison, l’état (numéro, dernière remise à zéro, historique) et la prochaine — pour l’annonce du bot et sa ligne « saison N ». |
| POST | `/bot/economy/casino` | bot | Un siège contre la maison : `{ discordId, game, bet, multiplier, note? }`. Limites via `betLimits()` (`maxBet: 0` = pas de plafond, envoyé `max: null`), avantage via `edgePctFor()` (par jeu, sinon global), gain via `payoutFor()` — l’avantage ne taxe que le profit. Le multiplicateur de Crash porte déjà l’avantage (`crashPoint()`), il passe sans seconde taxe. |
| POST | `/bot/economy/casino/settle` | bot | Une table en direct : `{ game, plays: [{ discordId, bet, multiplier, note? }], pot? }`. Avec `pot: true` (deux sièges ou plus, tout jeu sauf crash) `splitPot()` réécrit les multiplicateurs : les mises des perdants forment la cagnotte, chaque gagnant garde sa mise et prend une part ∝ mise × multiplicateur, l’avantage est pris une fois sur la part, aucun gagnant → la maison garde. Renvoie `{ results: [{ discordId, ok, delta, payout, points, share }], edgePct, pot }`. |
| GET | `/bot/economy/leaderboard?discordId=` | bot | Top 10 par niveau (+ avatar, userId, total). Avec `discordId`, aussi `me: { rank, level, xp, points }` pour l'appelant. |
| GET | `/me/economy` | user | Niveau, XP, points, stats, taux — plus `shopItems`, `purchases`, `pendingDeliveries` pour la carte du tableau de bord. |
| GET | `/me/economy/shop` | user | La boutique depuis le site : solde, chaque article (`fulfil: site|admin`, `owned` pour un badge déjà possédé), et les achats. |
| POST | `/me/economy/buy` | user (limité) | Acheter `{ itemId }` depuis le site — même fonction que le bot. 402 `insufficient`, 404 `no_such_item`, 409 sinon. |
| GET | `/me/economy/purchases` | user | L'inventaire, du plus récent au plus ancien, avec le code remis le cas échéant. |
| GET | `/admin/economy/purchases` | admin | Chaque achat (en attente d'abord) — ce qu'une personne doit encore remettre. |
| POST | `/admin/economy/purchases/:id/deliver` | admin | Marquer un rôle / une récompense perso comme remis. |
| GET | `/bot/config` · `/bot/token` · `/bot/account/:discordId` | bot | Lookup config/token/compte du bot. |
| POST | `/bot/heartbeat` · `/bot/activity` · `/bot/link/issue` | bot | Heartbeat, activité, émission de code de liaison. |
| POST | `/bot/blog/sync` · `/bot/blog/announced` | bot | File d'annonce blog : le bot demande les articles dus dans ses salons, puis marque ce qu'il a publié. |
| GET/POST | `/bot/kofi/unannounced` · `/kofi/announced` | bot | File d'annonce de pourboires Ko-fi. |
| GET/POST | `/bot/payments/unannounced` · `/payments/announced` | bot | File d'annonce paiement/remboursement (+ ping `test` lu-une-fois). |
| GET/POST | `/bot/dm/pending` · `/dm/sent` | bot | File de livraison de DM. |
| GET/POST | `/bot/giveaways/active` · `/:id/posted` · `/:id/enter` · `/:id/drawn` · `/create` | bot | Sync giveaway (poster, participer, tirer, /giveaway create). |
| GET/PUT | `/admin/bot/config` · `/admin/bot/token` | admin | Config + token du bot (dashboard). |
| GET | `/admin/bot/logs` | admin | Logs console récents du bot (onglet logs live). |
| POST | `/admin/bot/payments/test` | admin | Envoyer un embed de paiement de test aux salons configurés. |
| POST | `/admin/bot/dm` | admin | DM à un utilisateur un message + code promo cadeau optionnel. |
| GET/POST/DELETE | `/admin/bot/giveaways[/:id]` (+ `/:id/end`) | admin | Créer/lister/tirer/supprimer les giveaways. |
| GET | `/admin/bot/members` · `/admin/bot/welcome-preview.png` | admin | Vue membres + image de bienvenue. |
| POST | `/admin/economy/race/circuit` | `manage_economy` | Un fichier de circuit, tel que l'admin l'a déposé ou collé : un export Paddock-Manager (liste `segments`, ses secteurs, sa voie des stands, un `speedFactor` par segment) ou un circuit écrit à la main `{ name, points: [[x, y], …] }`. Un objet, un tableau, ou `{ circuits: [...] }`. Renvoie `{ circuits }` dans la forme stockée (normalisée en 0..1 en conservant le rapport d'aspect, rééchantillonnée à 240 points au plus), ou 400 `not_a_circuit`. |
| POST | `/admin/economy/race/circuit/resolve` | `manage_economy` | `{ circuit, circuits, seed }` → `{ circuit, builtins }` : le circuit sur lequel ce choix tourne réellement, avec sa géométrie, via le même `pickCircuit` que le rendu. C'est ce que dessine l'aperçu live de l'admin, donc « au hasard » veut dire la même chose dans l'aperçu et dans le film. |
| POST | `/admin/economy/race/preview.gif` | `manage_economy` | Le film de la course avec les réglages **du corps de la requête** (`circuit`, `circuits`, `laps`, `colours`, `equalStats`, `incidents`, `pitStops`, `seed`, `winner`), pas ceux enregistrés : l'admin voit ce qu'il est en train de choisir avant d'enregistrer. `image/gif`, `no-store`. |
| GET/POST/DELETE | `/me/discord/links` · `/me/discord/redeem` | user | Lier/délier Discord. |

## 14. Liens créateur/Discord (`links.mjs`) & codes promo (`promo.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET/POST/DELETE | `/me/creator-links[/:id]` | user | Lier des creator ids BMM. |
| POST | `/link/discord` · `/link/request` · `/link/lookup` · GET `/link/status` | user/— | Flux de code de pairing. |
| GET/POST/PATCH/DELETE | `/admin/promo[/:id]` (+ `/:id/redemptions`) | admin | Gérer codes promo + rédemptions. Les codes supportent `stackable` (combiner dans un panier) et `assignedUserIds`/`assignedEmails` (codes cadeaux — seuls ces comptes peuvent les utiliser). |
| GET/POST | `/me/promo/validate` · `/me/promo/redeem` | user | Valider/utiliser un code. |

## 15. Admin : utilisateurs, réglages, stockage, contact, stats (`misc.mjs`, `analytics.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/theme` | — | Le thème du site **et `appIcons`** — les marques des projets Better* gérées par un admin, que le sélecteur d'icônes propose en `app:<clé>` (bmm/bsm/bi/bc fournies en secours ; une entrée stockée avec la même clé remplace l'image). |
| GET/PUT | `/admin/site/app-icons` | admin | La liste `{ icons: [{ key, label, url }] }` — clé `[a-z0-9-]{1,24}`, url un chemin média du site ou https, 40 max, une par clé. |
| GET | `/admin/users` · `/admin/users/:id` | admin | Recherche utilisateur (id/nom/e-mail/creator id/Discord/**BC id**) + détail ; les deux incluent l'état de modération du compte. |
| PUT | `/admin/users/:id/role` | superadmin | Réassigner le rôle. |
| DELETE | `/admin/users/:id/sessions/:sid` | superadmin | Déconnecter un appareil d'un utilisateur. Filtré par userId autant que par id de session ; idempotent ; effectif à la requête suivante de cet appareil. La liste elle-même revient dans `/admin/users/:id` sous `sessions`, qui vaut `null` (et non `[]`) pour tout rang inférieur à SUPERADMIN — chaque ligne porte l'IP de connexion et sa localisation approximative. |
| POST | `/admin/users/:id/moderate` | admin | **Suspendre / bannir / réactiver** un compte (`action`, `durationHours` optionnel = temporaire sinon permanent, `reason`). Déconnecte l'utilisateur en ~15s, bloque le login avec la raison + temps restant, e-maile + notifie. Staff/soi-même protégés. |
| GET | `/admin/settings` · PUT `/admin/settings/:key` | admin | Boutons de prix/hébergement. |
| GET | `/admin/storage` · `/admin/billing/users` | admin | Stockage : usage objet par zone **+ un total général sur tous les paliers** (stockage objet, BD, backups, télémétrie) chacun étiqueté local/distant ; + utilisateurs payants/gratuits. |
| GET | `/site/showcase` | — | Les projets par lesquels s'ouvrent les deux landing pages (`/` et `/dev`), en média : `{ enabled, intervalMs, items[] }`. Caché  60 s. `enabled` est faux tant qu'un admin ne l'a pas activé **et** qu'il n'y a pas au moins un élément, pour qu'un site jamais configuré garde son hero. |
| GET | `/admin/site/showcase` | admin | La valeur stockée BRUTE, y compris une liste désactivée — l'éditeur doit la voir, sinon la réactiver signifierait tout retaper. Renvoie aussi `kinds`, `fits` et `max`. |
| PUT | `/admin/site/showcase` | admin | `{ enabled?, intervalMs? (2–30 s), items? }`. Chaque élément est `{ id, kind: image\|video\|replay, url, href?, poster?, fit: cover\|contain, scale: 0.5–2, title{en,fr}, blurb{en,fr} }`, 12 au maximum. Chaque URL doit être `http(s)` ou un chemin de même origine — `javascript:`, `data:`, `file:` et un `//hôte` relatif au protocole sont refusés, parce que chacun finit dans un `src` ou un `href` sur une page publique. Les ids en double sont refusés (React réutiliserait un panneau pour deux projets). Un refus nomme la ligne et le champ fautifs plutôt que de dire `invalid_input`. |
| GET | `/reviews` | — | Feed de témoignages du landing : `{ enabled, reviews[] }` (chacun avec `body` EN + `bodyFr`). |
| GET/POST/PATCH/DELETE | `/admin/reviews[/:id]` | admin | Gérer les témoignages du landing (auteur/rôle/texte EN+FR/note/activé/ordre). |
| PUT | `/admin/reviews/settings` | admin | Activer/désactiver toute la section avis (`{ enabled }`). |
| GET/POST/DELETE | `/admin/contact[/:id]` (+ `/:id/read`) | admin | Boîte de réception des messages de contact. |
| POST | `/contact` | pow | Formulaire de contact public, désormais l'issue d'un triage. Corps : `{ name, email, body, pow, dest?, fields?, kind? }`. `dest` est la destination sur laquelle le questionnaire s'est arrêté (`hosting`, `invoice`, `account`, `data_export`, `data_delete`, `security`, `bug`, `other`) et, s'il est fourni, **c'est lui qui décide du `kind` enregistré** : un client ne peut pas déposer un rapport de sécurité dans la file des exports de données. `fields` contient les réponses propres à cette destination (référence de facture, pool concerné, ce qui a déjà été essayé, les confirmations obligatoires) ; chacune est validée d'après `lib/contact-triage.mjs` et refusée avec `{ error: 'field_required' \| 'field_too_long' \| 'unknown_destination', field }`. Les réponses sont écrites au-dessus du message, dans le corps que la boîte de réception admin affiche déjà. Les réclamations de droits et les signalements n'arrivent plus ici : la page les envoie vers `/rights/notice` et `/reports`. |
| GET | `/accounts/search` · `/stats` | user/— | Recherche de compte + stats publiques. |
| GET | `/admin/analytics` · `/admin/analytics/sessions` · `/admin/analytics/geo` | admin | Dashboard analytics ; les sessions entrelacent les pageviews avec les **interactions dans la page** (clics/édits/soumissions/modales) dans la timeline de chaque visiteur ; géo = pays/région/ville + carte globe. |
| GET | `/admin/analytics/vitals` | admin | Web Vitals : percentiles globaux + tendance + p75 par page (`?days=`/`?hours=` pour 24h/7j/30j/90j). |
| GET | `/admin/analytics/events?path=&kinds=&days=` | admin | Feed d'événements custom : flux pageview + interaction fusionné (plus récent d'abord) avec compteurs par type, filtrable par chemin (contient) et type. |
| GET | `/admin/analytics/errors?path=&days=` | admin | Erreurs client groupées par message : occurrences, sessions distinctes, première/dernière vue, dernier échantillon (chemin/stack/appareil/navigateur/OS/pays). |
| GET/POST/PATCH/DELETE | `/admin/analytics/goals[/:id]` | admin | Objectifs de conversion — matchent un pageview (chemin) ou une interaction (type + label) ; GET renvoie les complétions + taux de conversion visiteur-unique sur `?days=`. |
| POST | `/analytics/pageview` · `/analytics/vital` · `/analytics/interactions` · `/analytics/error` | — | Ingestion first-party, soumise au consentement (pageview, Web Vital avec appareil/navigateur/OS/pays, événements d'interaction batchés — labels seulement, jamais les valeurs de champ, et erreurs non catchées — message/stack bornés, rate-limité). |
| GET | `/events/active` | — | L'événement live (pilote l'effet feux d'artifice + badge d'annonce ; le badge fête nationale montre le drapeau du pays). |
| GET/POST/PATCH/DELETE | `/admin/events[/:id]` | admin | Gérer les événements (Nouvel An / fête nationale / custom) : fenêtre, feux d'artifice `fxDensity` (quantité) / `fxSize` / `fxFlagDrops`, drapeau du pays, `linkUrl` du badge (cliquable → chemin ou URL), promo %, code d'événement. L'UI admin a un **Aperçu** live (déclenche l'effet à la demande) ; les utilisateurs peuvent désactiver l'effet par appareil dans les Réglages. |
| GET | `/sitemap.xml` · `/robots.txt` | — | Fichiers SEO. |

## 16. Performance serveur & alertes (`server-perf.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/admin/server/metrics` · `/alerts` · `/deps-config` | admin | Métriques CPU/RAM/disque en direct, journal d'alertes, liste de dépendances. |
| GET | `/admin/server/metrics/daily?days=` | `manage_server` / admin | Le cumul quotidien (moyennes + pics CPU, mémoire, disque, latence par jour) pour la fenêtre, avec la fenêtre de même durée juste avant : `series`, `current`, `previous`, `change` (par métrique : `current`, `previous`, `abs`, `pct` — null face à une fenêtre précédente vide, jamais 0) et `coverage`. L'ancien bloc « Métriques système » de la page de statut publique ; `/status` ne porte plus `metrics`. Arithmétique dans `lib/metrics-compare.mjs`. |
| GET | `/admin/server/metrics/compare?days=` | admin | Comparaison longue portée jusqu'à un an (moyennes, pics, charge, latence, réseau, indisponibilité, uptime %) contre la période d'avant. |
| POST | `/admin/server/sample-now` · PUT `/deps-config` | admin | Forcer un échantillon / éditer les deps. |
| GET/POST | `/bot/alerts/unannounced` · `/bot/alerts/announced` | bot | File d'annonce d'alertes pour le bot. |

## 17. Gestion serveur avancée (`server-control.mjs`) — **server-control + 2FA renforcée**
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/server/elevate/status` | admin | Une SONDE d’état : elle répond au lieu de refuser, et l’octroi `canControlServer` fait partie de la réponse, pas de la garde. Elle était auparavant derrière ce qu’elle rapporte, donc quiconque n’avait pas l’octroi recevait un 403 pour un état parfaitement normal. |
| POST | `/server/elevate` | server-control | Élévation 2FA renforcée. Celle-ci est gardée. |
| GET | `/server/db/tables` · `/db/table/:name` | server-control | DB viewer (lecture journalisée). |
| PUT | `/server/db/table/:name/cell` | server-control | Éditer une cellule (tables d'audit refusées). |
| GET/POST | `/server/db/backups` · `/db/backups/:hash/restore` | server-control | Backups BD façon git. |
| GET/POST/PUT/DELETE | `/server/files*` (read/write/rename/mkdir/download/backups) | server-control | Gestionnaire de fichiers + backups. |
| GET/POST/PUT | `/server/backups/usage` · `/gc` · `/limit` | server-control | Ménage des backups. |
| POST | `/admin/telemetry/token` | admin | Émettre un token SSO pour ouvrir le dashboard télémétrie BMM (HMAC, borné par époque). |
| GET/PUT | `/admin/telemetry/config` | admin | Lire/mettre à jour la config live du service télémétrie BMM (limite de stockage, rétention, délai d'effacement) — proxyfié vers le service. |
| GET | `/server/telemetry-db/tables` · `/table/:name` | server-control | Viewer en lecture seule sur le Postgres télémétrie BMM séparé. |
| GET | `/admin/security/audit` · `/admin/security/logins` | admin | Journal de sécurité (actions, tentatives de login, IPs). |
| GET | `/admin/security/audit/verify` | admin | Recalcule toute la chaîne HMAC et recoupe les ancres externes. Indique la première cassure, sa raison, et ce qui a été écrit après. |
| GET | `/admin/security/audit/evidence` | admin | Le dossier de preuve : la cassure, les cent lignes autour, chaque ancre, signé avec la clé du site. La signature porte sur la **chaîne** `bundle`, pour qu'un lecteur vérifie exactement les octets signés. |
| POST | `/admin/security/audit/anchor` | admin | Écrit l'empreinte de l'entrée la plus récente sur le volume d'ancrage, hors base — après quoi supprimer les lignes récentes devient détectable. |
| POST | `/admin/security/audit/reseal` | superadmin + élevé | Re-signe la chaîne à partir de la cassure pour que la **prochaine** altération soit détectable. Refuse tant qu'un dossier de preuve n'a pas été exporté après la cassure, consigne ce qu'il a couvert, et ancre cette consignation. Ne rend pas fiables les entrées re-signées. |
| GET/PUT | `/admin/server-control/users` · `/admin/server-control/:userId` | superadmin | Accorder/révoquer la permission server-control. |

---

## 18. Personal API keys & the public v1 API (`api-keys.mjs`)
Clés nommées et limitées, créées par le propriétaire du compte pour l’API publique. Chaque route `/v1/*` est authentifiée par une clé et refuse tout ce qui sort de ses portées.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/me/api-keys` | user | Lister tes clés (jamais le secret). |
| POST | `/me/api-keys` | user | Créer une clé — le secret n’est renvoyé qu’une fois. |
| DELETE | `/me/api-keys/:id` | user | Révoquer une clé. |
| GET | `/v1/scopes` | — | Catalogue des portées (ce qu’une clé peut recevoir). |
| GET | `/v1/account` | `account:read` | Le compte propriétaire de la clé. |
| GET | `/v1/notifications` | `notifications:read` | Notifications depuis un repère (BMM l’interroge). |
| PATCH | `/v1/account` | `account:write` | Mettre à jour les champs de profil du propriétaire. |
| GET | `/v1/repos` | `repos:read` | Dépôts visibles par la clé. |
| GET | `/v1/repos/:id/files` | `repos:read` | Liste des fichiers d’un dépôt. |
| GET | `/v1/repos/:id/changes` | `repos:read` | Flux de changements incrémental d’un dépôt. |
| GET | `/v1/users/:id` | `users:read` | Un utilisateur public. |
| GET | `/v1/users` | `users:read` | Annuaire des utilisateurs. |
| GET | `/v1/catalog` | `catalog:read` | Flux du catalogue. |
| GET | `/v1/catalog/changes` | `catalog:read` | Changements incrémentaux du catalogue. |
| GET | `/v1/pools` | `pools:read` | Tes pools de stockage : capacité, ce qui y puise, l’abonnement derrière. |
| GET | `/v1/catalogs` | `catalogs:read` | Les catalogues que tu possèdes — y compris non listés et masqués. |
| GET | `/v1/catalogs/:id/items` | `catalogs:read` | Les éléments d’un de tes catalogues, quel que soit leur statut. |
| GET | `/v1/payments` | `payments:read` | Ton historique de paiements. Montants et dates, jamais de données de carte. |
| GET | `/v1/polls` | `polls:read` | Les sondages qui te sont ouverts, et ta réponse. |
| POST | `/v1/polls/:id/vote` | `polls:write` | Répondre à un sondage. Remplace la réponse précédente, comme sur le site. |
| GET | `/v1/polls/:id` | `polls:read` | Un sondage PUBLIC par id — ouvert **ou clos** — avec chaque id d'option (ce que prend `/vote`), la forme multi-questions (ids de question + de choix), `myVotes`, et le décompte dès qu'il peut être vu (après ta réponse, ou clos / `results: always`). Les sondages non listés et privés répondent 404. |
| GET | `/v1/charity` | `charity:read` | Éteinte → 404 `charity_disabled` (voir §44). La cagnotte Community Charity du mois — la même forme que le widget d'accueil : association, pourcentage, totaux, id + état ouvert du vote, et `design` (l'apparence de la carte d'accueil : `mode` default/custom, `width`/`height` du cadre, `ink`, `align`, les URL d'images `backdrop`/`overflow`/`sticker` avec `bleed`, `stickerSize`, `stickerCorner`, `stickerOffset`). |
| GET | `/v1/economy` | `economy:read` | Ton niveau Discord, ton XP (ce niveau / jusqu'au suivant), tes points, tes compteurs d'activité et les taux d'XP. |
| GET | `/v1/economy/purchases` | `economy:read` | Ce que tu as acheté en boutique de points, avec le code remis le cas échéant et son statut `delivered`/`pending`. |
| GET | `/v1/badges` | `badges:read` | Les badges de ton profil, avec `earnedAt` et si c'est le staff ou une règle (`how`) qui les a accordés. |
| GET | `/v1/transfers` | `transfers:read` | Les transferts de propriété proposés par ou pour toi. En lecture seule volontairement. |
| POST | `/v1/notifications/:id/read` | `notifications:write` | Marquer une notification comme lue. |
| POST | `/v1/notifications/read-all` | `notifications:write` | Marquer toutes les notifications non lues comme lues. |

## 19. Avatars (`avatar.mjs`)
Rendu d’avatar déterministe à partir de l’id de compte.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/avatar/:id` | — | Image d’avatar rendue pour un compte. |

## 20. Promo campaigns (`campaigns.mjs`)
Campagnes promotionnelles à l’échelle du site et le badge affiché tant qu’une campagne est active.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/promo/campaign/active` | — | La campagne en cours, s’il y en a une. |
| GET | `/admin/campaigns` | admin | Lister les campagnes. |
| POST | `/admin/campaigns` | admin | Créer une campagne. |
| PATCH | `/admin/campaigns/:id` | admin | Modifier une campagne. |
| DELETE | `/admin/campaigns/:id` | admin | Supprimer une campagne. |

## 21. Community catalogs (`catalogs.mjs`)
Catalogues appartenant aux utilisateurs et leurs éléments, le flux public que lit BMM, et la surface de modération.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/c` | — | Index public des catalogues. |
| GET | `/c/:slug` | — (soft) | Un catalogue public. |
| POST | `/c/:slug/favorite` | user | Basculer un favori. |
| GET | `/me/favorites` | user | Tes catalogues favoris. |
| GET | `/c/:slug/catalog.json` | — (soft) | Flux natif BMM de ce catalogue. |
| GET | `/c/:slug/items/:islug/dl` | — (soft) | Télécharger un élément (compte un téléchargement). |
| GET | `/me/catalogs` | user | Tes catalogues. |
| GET | `/me/catalogs/:id` | user | Un de tes catalogues. |
| POST | `/me/catalogs` | user | Créer un catalogue. |
| PATCH | `/me/catalogs/:id` | user | Modifier un catalogue. |
| POST | `/me/catalogs/:id/rotate-key` | user | Faire tourner la clé de partage privée. |
| DELETE | `/me/catalogs/:id` | user | Supprimer un catalogue. |
| POST | `/me/catalogs/:id/items` | user | Ajouter un élément. |
| PATCH | `/me/catalogs/:id/items/:iid` | user | Modifier un élément. |
| DELETE | `/me/catalogs/:id/items/:iid` | user | Retirer un élément. |
| GET | `/admin/catalogs` | `manage_catalogs` / mod | Liste de modération. |
| POST | `/admin/catalogs/:id/:action` | `manage_catalogs` | Action de modération sur un catalogue. |
| GET | `/admin/catalogs/:id/items` | `manage_catalogs` / mod | Éléments d’un catalogue en revue. |
| GET | `/admin/catalogs/:id/items/:itemId/inspect` | `manage_catalogs` / mod | Inspecter le contenu d’un élément. |
| GET | `/admin/catalogs/:id/items/:itemId/download` | `manage_catalogs` / mod | Télécharger un élément pour revue. |

## 22. Social connections (`connections.mjs`)
Rattachement de comptes tiers (et Ko-fi) à un profil, distinct de la connexion OAuth.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/auth/connect/providers` | — | Quels fournisseurs de connexion sont configurés. |
| GET | `/me/connections` | user | Tes comptes liés. |
| DELETE | `/me/connections/:provider` | user | Délier un fournisseur. |
| PUT | `/me/connections/kofi` | user | Définir le pseudo Ko-fi. |
| GET | `/auth/connect/:provider/start` | user | Démarrer la liaison d’un fournisseur. |
| GET | `/auth/connect/:provider/callback` | — | Retour du fournisseur → lie le compte. |

## 23. Documentation pages (`docs.mjs`)
La section Docs protégée par rôle : pages, recherche, historique de révisions et commentaires par page.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/docs` | — (soft) | Arborescence des docs visible par l’appelant. |
| GET | `/docs/search` | — (soft) | Rechercher dans les docs. |
| GET | `/docs/:slug` | — (soft) | Une page de doc. |
| POST | `/docs/:id/feedback` | — | Cette page a-t-elle été utile ? |
| POST | `/docs` | `manage_docs` / admin | Créer une page. |
| PATCH | `/docs/:id` | `manage_docs` / admin | Modifier une page. |
| GET | `/docs/:id/history` | — (soft) | Liste des révisions. |
| GET | `/docs/:id/history/:revId` | — (soft) | Une révision. |
| GET | `/docs/:id/comments` | — (soft) | Commentaires d’une page. |
| POST | `/docs/:id/comments` | `manage_docs` / admin | Ajouter un commentaire. |
| PATCH | `/docs/:id/comments/:cid` | `manage_docs` / admin | Modifier un commentaire. |
| GET | `/docs/:id/comments/:cid/history` | — (soft) | Historique d’édition d’un commentaire. |
| DELETE | `/docs/:id/comments/:cid` | `manage_docs` / admin | Supprimer un commentaire. |
| PATCH | `/docs` | `manage_docs` / admin | Réordonner / mettre à jour en lot. |
| DELETE | `/docs/:id` | `manage_docs` / admin | Supprimer une page. |

## 24. Site events (`events.mjs`)
Événements programmés à l’échelle du site auxquels réagit le front.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/events/active` | — | Événements en cours. |
| GET | `/admin/events` | admin | Lister les événements. |
| POST | `/admin/events` | admin | Créer un événement. |
| PATCH | `/admin/events/:id` | admin | Modifier un événement. |
| DELETE | `/admin/events/:id` | admin | Supprimer un événement. |

## 25. FAQ (`faq.mjs`)
La FAQ publique et son CRUD d’administration.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/faq` | — (soft) | Entrées publiques de la FAQ. |
| GET | `/admin/faq` | `manage_faq` | Toutes les entrées, y compris masquées. |
| POST | `/admin/faq` | `manage_faq` | Créer une entrée. |
| PATCH | `/admin/faq/:id` | `manage_faq` | Modifier une entrée. |
| DELETE | `/admin/faq/:id` | `manage_faq` | Supprimer une entrée. |

## 26. 404 game leaderboard (`game.mjs`)
Scores du jeu « Orb Fall » de la page 404.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/game/score` | user | Soumettre un score. |
| GET | `/game/leaderboard` | — | Meilleurs scores. |

## 27. Make Your Own (paid commissions) (`myo.mjs`)
Le parcours de commande en deux temps : consultation payante, puis devis. Chaque demande porte un fil de messages, diffusé en SSE.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/myo/products` | — | Produits de commande achetables. |
| POST | `/myo/requests` | user | Ouvrir une demande (étape consultation). |
| POST | `/myo/requests/:id/pay` | user | Payer les frais de consultation. |
| GET | `/myo/requests` | user | Tes demandes. |
| GET | `/myo/requests/:id` | user | Une demande et son fil. |
| POST | `/myo/requests/:id/messages` | user | Publier dans le fil. |
| GET | `/myo/requests/:id/stream` | user | Flux SSE du fil. |
| POST | `/myo/requests/:id/close` | user | Clore une demande. |
| POST | `/myo/requests/:id/reopen` | user | Rouvrir une demande. |
| POST | `/myo/quotes/:id/pay` | user | Payer un devis émis. |
| GET | `/admin/myo/products` | `manage_myo` | Lister les produits. |
| POST | `/admin/myo/products` | `manage_myo` | Créer un produit. |
| PUT | `/admin/myo/products/:id` | `manage_myo` | Modifier un produit. |
| DELETE | `/admin/myo/products/:id` | `manage_myo` | Supprimer un produit. |
| GET | `/admin/myo/requests` | `manage_myo` | Toutes les demandes. |
| POST | `/admin/myo/requests/:id/quotes` | `manage_myo` | Émettre un devis. |
| POST | `/admin/myo/quotes/:id/withdraw` | `manage_myo` | Retirer un devis. |
| POST | `/admin/myo/requests/:id/deliverables` | `manage_myo` | Joindre les livrables. |
| PUT | `/admin/myo/requests/:id/status` | `manage_myo` | Définir le statut de la demande. |
| GET | `/admin/myo/settings` | `manage_myo` | Réglages MYO. |
| PUT | `/admin/myo/settings` | `manage_myo` | Mettre à jour les réglages MYO. |

## 28. OAuth2 / OIDC provider (`oidc-provider.mjs`)
BCWEB en fournisseur d’identité pour d’autres applications, plus le registre des clients côté admin.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/.well-known/openid-configuration` | — | Document de découverte OIDC. |
| GET | `/.well-known/jwks.json` | — | Clés de signature. |
| GET | `/oauth2/authorize` | — (soft) | Endpoint d’autorisation. |
| GET | `/oauth2/consent-info` | — | Ce que le client demande. |
| POST | `/oauth2/authorize/decision` | — (soft) | Enregistrer la décision de consentement. |
| POST | `/oauth2/token` | — | Endpoint de jeton. |
| GET | `/oauth2/userinfo` | — | UserInfo (GET). |
| POST | `/oauth2/userinfo` | — | UserInfo (POST). |
| GET | `/oauth2/me/items` | — | Les éléments de catalogue du sujet. |
| GET | `/oauth2/me/repos` | — | Les dépôts du sujet. |
| POST | `/oauth2/revoke` | — | Révoquer un jeton. |
| GET | `/admin/oauth-clients` | admin | Clients enregistrés. |
| POST | `/admin/oauth-clients` | admin | Enregistrer un client. |
| PATCH | `/admin/oauth-clients/:id` | admin | Modifier un client. |
| POST | `/admin/oauth-clients/:id/rotate` | admin | Faire tourner le secret d’un client. |
| DELETE | `/admin/oauth-clients/:id` | admin | Supprimer un client. |

## 29. Platform assets & update feeds (`platform-assets.mjs`)
Installateurs et ressources JSON hébergés, et le flux de mise à jour compatible GitHub Releases que les apps interrogent.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/admin/assets` | admin | Lister les ressources de plateforme. |
| PUT | `/admin/assets/json/:key` | admin | Écrire une ressource JSON (links.json, contributors.json…). |
| POST | `/admin/assets/presign` | admin | Pré-signer un envoi de fichier. |
| PUT | `/admin/assets/file/:key` | admin | Enregistrer un fichier envoyé. |
| DELETE | `/admin/assets/:key` | admin | Supprimer une ressource. |
| GET | `/updates/:app/latest` | — | Dernière version (compatible GitHub Releases). |
| GET | `/updates/:app/releases` | — | Liste des versions. |
| GET | `/assets/:key` | — | Récupérer une ressource hébergée. |

## 30. Reports (`reports.mjs`)
Signalements déposés par les utilisateurs, avec fil de participants, invitations et file de modération.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/reports/config` | — | Catégories de signalement montrées aux utilisateurs. |
| POST | `/reports` | user | Déposer un signalement. |
| GET | `/me/reports` | user | Tes signalements. |
| GET | `/me/reports/:id` | user | Un de tes signalements. |
| POST | `/me/reports/:id/messages` | user | Publier dans le fil de ton signalement. |
| POST | `/me/reports/:id/status` | user | Changer le statut là où tu y es autorisé. |
| GET | `/me/reports/:id/stream` | user | Flux SSE de ton signalement. |
| GET | `/admin/reports` | `manage_reports` / mod | File de modération. |
| GET | `/admin/reports/:id` | `manage_reports` / mod | Un signalement. |
| POST | `/admin/reports/:id/participants` | `manage_reports` | Ajouter un participant. |
| DELETE | `/admin/reports/:id/participants/:userId` | `manage_reports` | Retirer un participant. |
| POST | `/admin/reports/:id/invites` | `manage_reports` | Créer un lien d’invitation. |
| DELETE | `/admin/reports/:id/invites/:inviteId` | `manage_reports` | Révoquer une invitation. |
| GET | `/reports/join/:token` | user | Prévisualiser une invitation. |
| POST | `/reports/join/:token` | user | Accepter une invitation. |
| POST | `/admin/reports/:id/messages` | `manage_reports` / mod | Répondre en tant qu’équipe. |
| POST | `/admin/reports/:id/status` | `manage_reports` / mod | Définir le statut. |
| DELETE | `/admin/reports/:id` | `manage_reports` | Supprimer un signalement. |
| GET | `/admin/reports/config` | `manage_reports` / mod | Lire la configuration des signalements. |
| PUT | `/admin/reports/config` | `manage_reports` | Mettre à jour la configuration des signalements. |

### 30b. Notifications de droits (`rights.mjs`)
Notifications formelles droit d’auteur / marque / vie privée / contenu illicite (DSA art. 16, LCEN, LDA suisse), un registre d’œuvres protégées avec correspondance par hachage + motif + URL, et l’outillage admin autour. Les règles vivent dans `lib/rights-match.mjs` (pur).

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/rights/resolve?q=` | — | Transforme une URL / un id collé en cible précise (dépôt, entrée de catalogue, utilisateur, fichier). Les ids de propriétaire sont retirés. |
| POST | `/rights/notice` | PoW, compte optionnel | Dépose une notification. Refusée s’il manque un élément (`no_target`, `work_required`, `explanation_short`, `name_required`, `email_invalid`, `good_faith_required`, `accuracy_required`, `signature_required`) ; `own_content` quand toutes les cibles sont à l’appelant ; 5 par jour par IP / e-mail. Renvoie la notification avec son `code`. |
| GET | `/rights/notice/:code?email=` | — | Suivre une notification par code + e-mail de l’expéditeur (404 sinon). |
| GET | `/me/rights` | user | Les notifications déposées par l’appelant, et celles contre son contenu (avec la contre-notification qu’il peut déposer). |
| GET | `/admin/rights` · `/admin/rights/:id` | `manage_reports` | La file (filtre statut / type) et une notification avec son historique. |
| POST | `/admin/rights/:id/status` · `/note` | `manage_reports` | `new` / `reviewing` / `closed` ; une note interne. |
| POST | `/admin/rights/:id/takedown` | `manage_reports` | Sanctionne chaque cible via `/admin/sanctions/content` (même chemin qu’un signalement), enregistre la décision, prévient expéditeur et propriétaire, compte un strike. |
| POST | `/admin/rights/:id/reject` · `/counter` · `/restore` | `manage_reports` | Rejeter avec motif (expéditeur prévenu si `tellReporter`) ; enregistrer la contre-notification du propriétaire ; lever la sanction. |
| GET/POST/PATCH/DELETE | `/admin/rights/works[/:id]` | `manage_reports` | Le registre des œuvres protégées : titre, titulaire, hachages, motifs de nom, URL. Les nouveaux envois sont comparés à la sauvegarde (`flagIfProtected`). |
| POST | `/admin/rights/scan` | `manage_reports` | Recompare le contenu existant au registre ; ouvre des notifications `match`. |
| GET/PUT | `/admin/rights/config` | `manage_reports` | `strikeThreshold`, `strikeWindowDays`, `counterDays`, texte des e-mails. |

### 30c. Équipes (`teams.mjs`)
Des comptes qui gèrent ensemble dépôts, catalogues et pools. `canManage()` (`lib/teams.mjs`) = propriétaire, staff, ou membre actif de l’équipe de l’élément ; facturation, suppression et clés restent au propriétaire.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/teams/:slug` | — | Carte publique : membres, e-mail / téléphone / site / Discord de contact, dépôts et catalogues listés. |
| GET | `/me/teams` | user | Les miennes, avec `myRole` (owner / admin / member) et `myStatus` (invited / active). |
| POST | `/me/teams` | user | Créer `{ name, contactEmail*, contactPhone?, website?, discord?, description? }` (≤ 10 possédées). |
| PATCH / DELETE | `/me/teams/:id` | owner (admin pour PATCH) | Détails ; dissoudre — les membres partent, les éléments rattachés sont détachés. |
| POST | `/me/teams/:id/members` | owner / admin | Inviter `{ to, role? }` — id, BC id, e-mail ou pseudo exact ; l’invité est notifié. |
| POST | `/me/teams/:id/accept` · `/decline` | invité | Répondre à l’invitation. |
| PATCH / DELETE | `/me/teams/:id/members/:userId` | owner (un admin peut retirer un membre) | Rôle ; retirer, ou quitter (soi-même). |
| POST | `/me/teams/:id/transfer` | owner | `{ userId }` — le nouveau propriétaire ; l’ancien reste admin. |
| PUT | `/me/teams/:id/attach` | admin d’équipe + propriétaire de l’élément | `{ kind: repo\|catalog\|group, id, attach }`. |

### 30d. Fils de contact (`threads.mjs`)
Une conversation avec le propriétaire et l’équipe derrière un dépôt, un catalogue, un profil ou une équipe — pas un signalement. Les limites sont comptées en base ; un compte / e-mail bloqué ne peut ni ouvrir ni répondre.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/threads` | optionnelle ; PoW + `email` si anonyme | `{ kind: repo\|catalog\|user\|team, targetId, subject, body, email?, name?, pow? }` → 201 avec le fil ; un expéditeur anonyme reçoit aussi `accessToken`. `yourself`, `blocked`, `rate_limited`, `disabled`. |
| GET | `/me/threads?box=inbox\|sent` | user | Reçues = adressées à moi ou à mes équipes ; envoyées = ouvertes par moi ; `unread`. |
| GET | `/me/threads/:id` | participant | Le fil et ses messages (marque mon côté lu) ; 404 pour quiconque d’autre. |
| POST | `/me/threads/:id/messages` · `/close` · `/reopen` · `/flag` | participant | Répondre (l’autre côté est notifié / e-mailé) ; fermer ; rouvrir ; signaler à l’équipe. |
| GET / POST | `/threads/t/:token` · `/threads/t/:token/messages` | le jeton | Le côté de l’expéditeur anonyme. |
| GET | `/admin/threads?status=&q=` · `/admin/threads/:id` | `manage_reports` | La file (`flagged` d’abord) et un fil avec messages masqués, e-mail et IP de l’expéditeur. |
| POST | `/admin/threads/:id/close` · `/block` · `/messages/:mid/hide` · `/unhide` | `manage_reports` | Modération ; bloquer ajoute l’expéditeur à la liste et bloque chaque fil qu’il a ouvert. |
| GET | `/legal` | public | Ajoute `optional: ['dpa']` — les documents livrés dans le bundle et DÉSACTIVÉS tant qu’aucune ligne `LegalPage` publiée n’existe. Leurs sections ne sont pas servies non plus, `/me/legal-pending` cesse d’en demander l’acceptation, et le client masque la copie qu’il détient. On en active un en publiant sa page (`PUT /admin/legal/pages/:id { published }`, ou `POST /admin/legal/pages` s’il n’y a pas encore de ligne). |
| GET / POST | `/me/teams/limits` · `/me/teams/slot/checkout` | session | Combien d’équipes le compte possède et peut posséder (`teams.maxOwned` + places achetées ; le personnel n’est pas plafonné) et le prix d’une place ; le checkout est un paiement Stripe unique (`metadata.type = team_slot`) — le webhook écrit un Payment `TEAM_SLOT` (idempotent sur la session) et incrémente `User.extraTeamSlots`. `POST /me/teams` répond 409 `too_many_teams` avec `{ owned, limit, slot }`. |
| GET / POST / DELETE | `/me/teams/:id/invites` · `/me/teams/:id/invites/:inviteId` · `/teams/join/:token` | propriétaire/admin · toute personne connectée | Liens d’invitation (`/teams/join/<jeton>`, pour un rôle). Deux formes : **un seul lien permanent** par équipe (`days` absent ou 0, n’expire jamais) et jusqu’à `teams.inviteMaxTemporary` liens temporaires, chacun avec une des durées `teams.inviteLifetimeDays`. `GET` renvoie `{ invites, permanent, temporary, policy }`, chaque invitation portant `kind` (`permanent` \| `temporary`), `usable` et son `url`. `POST` répond 409 `permanent_exists`, `too_many_invites` (`{ limit, open }`) ou `invalid_lifetime` (`{ allowed }`) ; seuls les liens encore valides comptent dans ces plafonds. `DELETE` révoque (404 si déjà révoqué) et libère la place immédiatement. `GET /teams/join/:token` dit quelle équipe et si le lien marche encore ; `POST` rejoint comme membre actif (plafond 50 membres). |
| GET | `/f/:token` · `/f/:token/info` | jeton (+ la session du propriétaire pour une livraison) | Un fichier derrière un lien qui cesse de fonctionner (`ExpiringFile`) : une livraison MYO (30 jours après la livraison ou 7 après le premier téléchargement, au premier des deux — le premier téléchargement est écrit dans la conversation comme preuve), une pièce jointe de mail (`attachDays`). `info` donne l’état / jusqu’à quand / les téléchargements ; le téléchargement redirige vers les octets, ou répond 410 `expired` / 403 `forbidden`. Le balayeur supprime l’objet une semaine après la date ; archiver une demande MYO révoque ses liens et supprime ses pièces jointes. |
| GET / PUT | `/admin/mail/custom-templates` | admin | Les modèles du compositeur `[{ id, label, subject, body, audience, cta? }]` (≤ 30), dans le markdown des mails. `POST /admin/mail/send` accepte aussi `attachments: [{ url, name, size }]` (envois MEDIA), `attachDays` (1–90) et `attachMode: link|inline` (≤ 8 Mo au total en pièce jointe). `GET /admin/mail/gallery` renvoie `builtin[id]`, le corps intégré de chaque mail modifiable, à éditer sur place. |
| GET | `/admin/search?q=` | staff | Une seule boîte sur les données du tableau de bord : comptes, Server-Repos, catalogues communautaires, équipes, conversations, signalements, sanctions, commandes, articles, docs, FAQ, sondages, codes promo, autres projets — chaque groupe seulement si l’appelant a sa capacité, ≤ 6 lignes par groupe, avec le `href` admin pour ouvrir. La recherche de la barre latérale classe les écrans localement (synonymes FR/EN, accents, fautes) et affiche ceci dessous. |
| GET | `/admin/media-flags?status=&page=` · POST `/admin/media-flags/:id` | `manage_reports` | Images ressemblantes : envois dont l’empreinte perceptuelle (pHash DCT 64 bits) est à moins de la distance de Hamming configurée — ou identique octet pour octet — d’une image détenue par un autre compte ; les deux images par signalement ; `{ status: cleared\|actioned\|pending, note? }` en résout un. |
| GET / PUT / POST | `/admin/media-hashes/stats` · `/settings` · `/scan` · `/:id/preview` | `manage_reports` | Compteurs et le réglage `{ threshold, enabled }` (`media.phash`) ; `scan` calcule un lot maintenant (`{ backfill: true }` enregistre aussi les anciens objets du média public) ; `preview` sert l’image (lien de stockage court, URL d’avatar, ou les octets d’une image dans une archive). Les lignes naissent à la présignature et sont calculées par le balayeur. |
| GET / PUT | `/admin/threads/config` | `manage_reports` | `enabled`, `userPerHour/Day`, `anonPerHour/Day`, `messagesPerHour`, `maxBody`, `blockedEmails[]`, `blockedUserIds[]`. |

## 31. Custom roles & project grants (`roles.mjs`)
Ensembles de rôles créés par un SUPERADMIN par-dessus l’énumération de rôles, et droits d’édition par projet.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/admin/showcase-requests/:id/approve` | admin | Prend aussi `project` (la page complète telle que l'écrit la modale Nouveau projet : name, short, icon, config, published, pinTopbar, visibility, whitelist, annonce) — « Approuver & configurer » crée la fiche finie plutôt que vide. |
| PUT/POST | `/admin/custom-roles[/:id]` | superadmin | Accepte `scope: { projectKeys[], showcaseSlugs[], allShowcase }`. Un rôle limité n'ajoute aucune capacité globale ; il donne les droits d'édition sur ces éléments via `projectGrants()`. |
| GET | `/admin/custom-roles` | superadmin | Lister les rôles personnalisés. |
| POST | `/admin/custom-roles` | superadmin | Créer un rôle personnalisé. |
| PUT | `/admin/custom-roles/:id` | superadmin | Modifier un rôle personnalisé. |
| DELETE | `/admin/custom-roles/:id` | superadmin | Supprimer un rôle personnalisé. |
| PUT | `/admin/users/:id/custom-roles` | superadmin | Attribuer des rôles personnalisés à un utilisateur. |
| GET | `/admin/project-permissions` | admin | Lister les droits par projet. |
| POST | `/admin/project-permissions` | admin | Accorder des droits d’édition sur un projet. |
| DELETE | `/admin/project-permissions/:id` | admin | Révoquer un droit. |

## 32. Public profiles & badges (`social.mjs`)
Lecture des profils publics, recherche d’utilisateurs et système de badges.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/u/:id` | — (soft) | Un profil public (respecte son réglage de confidentialité). |
| GET | `/users/search` | — (soft) | Rechercher des utilisateurs. |
| GET | `/badges/trigger/:trigger` | — | Badges rattachés à un déclencheur. |
| POST | `/me/badges/claim` | user | Réclamer un badge réclamable. |
| GET | `/admin/badges` | admin | Lister les badges. |
| POST | `/admin/badges` | admin | Créer un badge. |
| PATCH | `/admin/badges/:id` | admin | Modifier un badge. |
| DELETE | `/admin/badges/:id` | admin | Supprimer un badge. |
| GET | `/admin/badges/:id/holders` | admin | Qui détient un badge. |
| POST | `/admin/badges/:id/grant` | admin | Attribuer un badge. |
| DELETE | `/admin/badges/:id/holders/:userId` | admin | Retirer un badge. |

**Règles automatiques (`Badge.rule.type`).** `signup_nth` (chaque N), `signup_before` (date), `kofi_donation`, et depuis le 2026-09-05 : `level_reached` (niveau), `messages_sent` (nombre), `purchases_made` (nombre), `polls_answered` (nombre), `items_published` (nombre), `repo_hosted`, `discord_linked`, `twofa_enabled`, `account_age` (jours). Les règles événementielles s'appliquent sur le moment (`grantAutoBadges`, branché sur l'accumulation d'XP, les achats, les votes, les validations, la mise à disposition d'une pool, les liens, la 2FA) ; les règles à seuil sont aussi balayées une fois par jour (`sweepAutoBadges`) pour atteindre ceux qui avaient déjà passé la barre. Chaque attribution émet `badge.earned`.

## 33. Telemetry access (`telemetry.mjs`)
L’endpoint de forward-auth appelé par l’edge pour protéger le tableau de bord télémétrie BMM, et qui peut y accéder.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/telemetry/authorize` | — | Sonde de forward-auth appelée par l’edge avant de servir le tableau de bord. |
| GET | `/admin/telemetry-access/users` | superadmin | Qui peut atteindre le tableau de bord. |
| PUT | `/admin/telemetry-access/:userId` | superadmin | Accorder ou révoquer l’accès au tableau de bord. |
| GET | `/internal/telemetry/identity?creatorId=` | `x-link-secret` | **Serveur à serveur, pour le service télémétrie.** Si un creator id BMM (l’hex de la clé publique ed25519 d’une installation — la charge télémétrie ne porte AUCUN id de compte) est lié à un compte : `{ linked, userId, email, displayName, locale, creatorIds }`. `creatorIds` est chaque id lié au même compte : une demande RGPD déposée pour une installation les couvre toutes. Secret = `LINK_LOOKUP_SECRET` (le `BC_LINK_SECRET` du service). |
| POST | `/internal/telemetry/notify` | `x-link-secret` | **Serveur à serveur.** Envoyer le mail de confirmation RGPD : `{ kind: export\|delete, outcome: done\|rejected, requestId, creatorId, creatorIds?, to: { userId } \| { email }, counts?, erased?, attachment?: { filename, base64 } (zip, ≤ 18 Mo en base64), tooLarge? }`. `to.userId` est résolu ici en l’adresse ACTUELLE du compte, dans la langue du compte — l’adresse ne quitte jamais BCWEB ; `to.email` est ce qu’une installation non liée a saisi. Répond `{ ok, sent }`, ou `{ ok:false, reason }` (`email_disabled`, `account_not_found`…) pour que le service note « non notifié » au lieu de deviner. |
| POST | `/me/telemetry/data-request` | user | Déposer une demande RGPD pour une de MES installations BMM liées, `{ creatorId, kind: export\|delete }` (Paramètres → Cookies & confidentialité → Télémétrie BMM). Le creator id doit figurer dans les `CreatorLink` de l’appelant — c’est la preuve — et la demande est relayée au service télémétrie (`TELEMETRY_INTERNAL_URL` + la clé publique `TELEMETRY_API_KEY`) avec `source: bcweb` ; la confirmation (export joint) part vers l’e-mail du compte, rien n’est saisi. `{ ok, id, duplicate }` ; 403 `not_your_creator_id`, 503 `telemetry_not_configured`, 502 `telemetry_unreachable`. 10/h. Audité `telemetry.data_request`. |

**Le flux RGPD, de bout en bout.** Une demande est (creator id, type) et atteint la table
`data_requests` du service télémétrie depuis trois endroits : BMM (Paramètres › Confidentialité,
avec une adresse saisie), un compte connecté ici (la route ci-dessus, sans adresse), ou l’écran
Data requests du tableau de bord (un admin qui dépose pour quelqu’un qui a écrit). Le service
interroge `/internal/telemetry/identity` au dépôt puis au traitement : un compte lié ne porte
jamais d’adresse saisie (le mail part vers le compte, ce qui empêche quiconque de détourner
l’export d’un autre), une installation non liée doit en donner une. Les exports sont traités
dans la minute (un zip par personne : `README.txt`, `tables/<nom>.json`,
`replays/<session>.bmmreplay`, `export.json`, joint s’il fait ≤ 12 Mo) ; les effacements
attendent le délai de revue (`TELEMETRY_DELETE_DELAY_H`, modifiable en direct) sauf traitement
par un admin, puis suppriment dans la même liste de tables que celle lue par l’export, retirent
les lignes géo que personne d’autre ne partage, et anonymisent la ligne de demande
(`erased:<hash>`). Chaque issue est écrite dans le journal d’audit du service et envoyée par
`/internal/telemetry/notify`.

**Échantillonnage.** L’écran Settings du tableau de bord (ou `GET/PUT /admin/telemetry/config`
ci-dessus, clé `sampling`) tient un plafond total plus un pourcentage par type d’élément
(`events`, `replay`, `errors`, `perf`, `benchmarks`, `logs`). La décision est déterministe par
installation et par type (`fnv1a32("creatorId:kind") % 10000 < pct × 100`), livrée à BMM dans
chaque réponse `/batch` et sur le `GET /config` du service ; le service applique la même règle à
l’ingestion. Cela réduit ce qui est collecté et ne touche jamais ce qui est déjà stocké.

**Carte.** L’écran Geography du tableau de bord dessine des tuiles raster OpenStreetMap (sans
clé — tuiles OSM standard en clair, CARTO dark-matter issu des mêmes données OSM en sombre,
attribution toujours affichée) et regroupe les points utilisateurs en grappes côté MapLibre ;
les positions restent approximatives.

## 34. Outils développeur (`devtools.mjs`)
L'inspecteur, les cartes qu'affiche le tableau de bord admin, et deux vérificateurs qui lisent un
artefact avant sa publication.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| POST | `/dev/inspect` | connecté | Lire un document BMM et dire ce que c'est. |
| POST | `/admin/inspect` | `manage_catalogs` / mod | Le même lecteur, côté modération. |
| POST | `/dev/validate-recipe` | connecté | Vérifier un `installer.toml` BetterInstaller contre le schéma publié. |
| POST | `/dev/validate-feed` | connecté | Vérifier un flux de catalogue (par URL ou corps). |
| GET | `/admin/schema-map`, `/admin/rbac-map`, `/admin/compose-map`, `/admin/secrets-map`, `/admin/infra-map`, `/admin/migration-map`, `/admin/data-flow`, `/admin/config-diff` | admin | Les cartes générées derrière le tableau de bord admin. Les huit sont des `requireRole('ADMIN')`, pas SUPERADMIN, ce que ce tableau affirmait jusqu’à vérification dans le code. La carte des secrets donne les NOMS des variables d’environnement et si chacune est gardée au démarrage, jamais une valeur. |


### Les deux artefacts que lisent ces outils

Aucun des deux vérificateurs ne garde sa propre copie de ce contre quoi il vérifie, et tous deux
le disent à l'écran quand l'artefact manque, plutôt que de faire passer pour une faute chaque
nom qu'ils ne reconnaissent pas.

| Clé d'asset | Produit par | Alimente |
|---|---|---|
| `bmms-vocabulary.json` | `node scripts/gen-bmms-reference.mjs` dans BMM | le vérificateur `.bmmscript`, qui tourne dans le NAVIGATEUR (`apps/web/src/lib/bmmscript-lint.js`, exposé dans `/dev/tools`) et n'a pas de route à lui : il récupère cet asset et se rabat sur la vérification de forme quand il manque |
| `installer-schema` | `bpkg schema --out schema/installer-schema.json` dans BetterInstaller | `POST /dev/validate-recipe` |

Téléverse chacun comme asset de plateforme sous cette clé.

!!! warning "Ils périment en silence, et seulement de ce côté"

    La CI de BMM régénère son vocabulaire et échoue si quelqu'un oublie — le fichier dans ce
    dépôt est donc toujours juste. Rien ici ne peut savoir que la copie téléversée sur ce site a
    six mois de retard.

    Le symptôme est un vérificateur qui signale des noms d'actions valides comme inconnus, ce
    qui se lit comme un fichier cassé plutôt que comme un téléversement périmé. Re-téléverse
    quand le langage de BMM grandit : il est actuellement à 104 actions, 37 conditions et 59
    mots-clés.

**Ce que l'inspecteur reconnaît.** Par la FORME, jamais par ce que le fichier prétend être — un
document qui dit `format: "mm"` ne prouve rien sur lui-même, et un fichier signé qui ment sur son
propre type est exactement le cas pour lequel la modération existe :

| Rapporté comme | Reconnu par |
|---|---|
| `bmmpa` | `magic: "BMMPA"`, ou un tableau/`tasks` d'objets avec `steps` |
| `bmmnav` | `format: "bmmnav"` |
| `bmmlaunch` | un launch pack : `kind: "bmm-launchpack"`, ou un `name` accompagné de `exe_paths[]` |
| `bmmreplay` | `events` avec `console`/`rustLog`, ou un tableau rrweb nu |
| `bmmplug` | manifeste de plugin : `id` + `name` **et** l'un de `apply_mode` / `permissions` / `modlist` / `assets` / `scripts` |
| `mm-locked` | `bmm_locked: true` + un bloc `sealed` (contenu chiffré ; l'en-tête reste lisible exprès) |
| `repo` | manifeste de Server-Repo : `profiles[]` portant des `mods` |
| `mm` | `format_version` + `mods[]` |
| `bmp` | modpack : `mods[]` dont les entrées ont `mod_id` + `file_manifest` |
| `cbmp` | catalogue de modpacks : `modpacks[]` avec un `file` chacun |
| `bmmcat` | tout autre catalogue — vérifié en DERNIER, parce que `modpacks` est aussi l'un de ses tableaux |

Deux sont récents, et les deux étaient un trou plutôt qu'un choix. Un **manifeste `repo`** est le
fichier qu'un modérateur ouvrant un repo hébergé a le plus de chances d'avoir sous la main — et
celui qui porte désormais plugins, thèmes, tâches planifiées et catalogues en extras. Un
**manifeste de plugin** est ce que l'aide « format inconnu » disait de coller depuis toujours,
alors que le faire répondait « format BMM non reconnu » : le conseil était juste, c'est le
lecteur qui manquait.

Un **launch pack** est le plus récent et le plus bruyant : son contenu entier est une liste de
programmes qui seront lancés sur la machine qui l'importe. Le lecteur dit combien, imprime
chaque chemin exactement tel qu'écrit — sans jamais en résoudre ni en ouvrir un — et signale
deux choses qu'un nom de fichier ne peut pas montrer : lesquels passent par un **shell** (le
lanceur de BMM exécute un `.ps1` avec la stratégie d'exécution contournée et un `.bat` par
`cmd`), et lesquels sont désignés par un chemin **relatif**, résolu selon le dossier courant au
moment du déclenchement.

Un plugin est la seule chose ici qui est du CODE tournant dans le BMM de quelqu'un : son résumé
est donc ordonné par ce qu'il faut décider — ce qu'il peut atteindre (permissions), s'il exécute
quelque chose (scripts), ce qu'il change (sa liste de mods), puis ce qu'il livre à côté (assets).
La liste d'assets est une **déclaration** — écrite depuis le disque à l'empaquetage, et modifiable
à la main ensuite — : elle est rapportée comme ce que dit le manifeste, pas comme le contenu réel
de l'archive.

`signature` est rapporté pour **tous** les formats, y compris ceux que BMM ne signe pas encore :
« non signé » est une réponse, et c'est celle qu'un relecteur doit voir plutôt qu'un blanc là où
devrait être un verdict. Pour une archive, les entrées voyagent en `name` + `sha256` et le fichier
ne quitte jamais la machine du relecteur — la signature couvre exactement cette liste.

Rien ici n'écrit. Un inspecteur de contenu non fiable qui stocke ce qu'il a lu est un moyen de
faire stocker du contenu.

## 36. Export du contenu (`content-backup.mjs`)
Le contenu écrit, en JSON, pour être lu ailleurs — **pas** un point de restauration.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/admin/content-backup/preview` | ADMIN + server-control + step-up | Chaque section avec son nombre de lignes et si elle est active par défaut. Les comptes viennent d'abord parce que « quelles sections » n'est pas un choix sans un nombre à côté de chacune. |
| GET | `/admin/content-backup?include=a,b` | ADMIN + server-control + step-up | Un zip, un fichier JSON par section choisie. |

Les comptes sont exportés via un **`select` explicite** — jamais une ligne entière dont on
retire des champs ensuite, parce qu'un spread livre la colonne suivante quelle qu'elle soit,
et le jour où cette colonne est un secret personne ne relit ce fichier.
`content-backup.test.mjs` le vérifie contre le source et tourne sans base de données : il
échoue donc sur un portable où rien ne tourne.

La chaîne est celle qu'utilisent tous les autres outils de cet écran — visualiseur BDD,
gestionnaire de fichiers, Docker et power tournent tous en `[ADMIN, canControlServer,
elevated]`. Cette route livre chaque fiche de compte et chaque mot du site en un fichier :
être le seul bouton de l'écran que n'importe quel admin pouvait presser n'était pas une
différence défendable.

Catalogues et dépôts sont **désactivés** par défaut : leurs lignes sont des métadonnées
pointant vers des objets MinIO que le zip ne transporte pas. Voir
[BACKUP_FR.md](../run/BACKUP_FR.md) pour savoir laquelle des trois choses appelées
« sauvegarde » répond à quelle question.

## 37. Webhooks (`webhooks.mjs`, `lib/webhooks.mjs`)
Webhooks sortants auxquels un compte s'abonne depuis Dev → Config. Chaque livraison est signée (`X-Webhook-Signature`, HMAC sur `timestamp.body` avec le secret du point de terminaison) et réessayée avec un délai croissant (1 min → 10 h, six tentatives).

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/v1/webhook-events` | — | Chaque événement et ce qu'il signifie. |
| GET/POST | `/me/webhooks` | user | Lister / créer un point de terminaison `{ url, events[] }` — le secret est renvoyé une fois. |
| PATCH/DELETE | `/me/webhooks/:id` | user | Modifier (url, events, enabled) / supprimer. |
| POST | `/me/webhooks/:id/rotate` · `/test` | user | Nouveau secret · envoyer un `ping`. |
| GET | `/me/webhooks/:id/deliveries` · POST `…/deliveries/:did/replay` | user | Le journal des livraisons · en renvoyer une. |
| GET | `/admin/webhooks` | admin | Tous les points de terminaison, pour le support. |

**Événements.** Contenu : `catalog.item.published` · `.updated` · `.removed` · `.submitted`, `repo.updated`, `repo.status.changed`, `item.downloaded` (regroupé par minute), `item.milestone`, `repo.downloaded` (regroupé), `review.posted`, `stats.daily`. Compte : `pool.storage.warning` · `.changed`, `subscription.expiring`, `sanction.issued`, `transfer.offered`. Communauté & économie (2026-09-05) : `poll.opened` / `poll.closed` (**diffusion** — à chaque point de terminaison abonné, avec les ids d'options pour répondre), `charity.month.closed` (**diffusion**), `badge.earned` (une règle, un achat, le staff ou un œuf de Pâques — `via` le dit), `economy.level_up` (`level`, `from`, `pointsGranted`), `shop.purchased` (`purchaseId`, `kind`, `cost`, `status`).

## 38. Agent de dépôt — un serveur que le propriétaire gère (`repo-agent.mjs`)
Un dépôt qui vit ailleurs, pilotable d'ici sans que nous détenions une clé de cette machine. La
forme évidente de « gérer mon serveur depuis BCWEB », c'est une clé SSH ; nous refusons d'en
prendre une, parce qu'une clé privée qui ouvre un shell sur une machine qui n'est pas la nôtre
est le pire actif qu'une plateforme web puisse stocker — une fuite ici cesserait de coûter des
comptes pour coûter aux utilisateurs leurs serveurs. Le sens est donc inversé : c'est **leur**
machine qui garde un jeton pour **nous**.

Le propriétaire crée le jeton dans le tableau de bord du dépôt (onglet Serveur, dépôts externes
seulement). Il est affiché une seule fois et stocké sous forme de hash sha256, exactement comme
une clé d'API personnelle ; aucun endpoint ne peut le relire, et le renouvellement est le chemin
de secours.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/me/repos/:id/agent` | propriétaire | État : préfixe, dernier appel, ce que la machine a annoncé. Jamais le secret. |
| POST | `/me/repos/:id/agent` | propriétaire | Créer ou renouveler. Renvoie `{ token }` — le seul moment où il existe ici. |
| DELETE | `/me/repos/:id/agent` | propriétaire | Révoquer. La ligne reste, pour que le panneau dise encore ce qui servait. |
| POST | `/me/repos/:id/agent/command` | propriétaire | Mettre une tâche en file : `rescan` ou `ping`. Une seule place. |
| POST | `/agent/hello` | jeton agent | Battement de cœur. Corps `{ version?, host? }` → `{ repo, command }`. |
| POST | `/agent/report` | jeton agent | `{ ok, command?, fileCount?, totalBytes?, manifestSha?, error? }`. |

**La boucle.** `hello` sur une minuterie → si `command` n'est pas nul, l'exécuter localement →
`report` **en nommant cette commande**, ce qui est ce qui l’efface. Un rapport qui ne la nomme
pas la laisse en file : un battement de cœur de routine ne peut donc pas avaler une tâche mise
en file une seconde plus tôt.

**Ce qu'il ne peut pas faire.** Un rapport écrit sur la ligne de l'agent et nulle part ailleurs
— jamais `status`, `sha`, `verified` ni `pendingReview` du dépôt. Ces colonnes décident de ce que
la liste publique montre et de la vérification par un modérateur ; un chiffre auto-déclaré par
une machine que nous ne gérons pas ne doit pas les bouger. Un jeton volé permet donc de mentir
sur un nombre de fichiers, et révoquer est une ligne.

## 39. Domaines personnalisés (`domains.mjs`, `lib/domain.mjs`)
Un propriétaire payant fait pointer son propre nom vers nous et son dépôt ou son catalogue
répond dessus. Une ligne dans `CustomDomain` est l'autorisation de dépenser une vraie ressource
sur le nom de quelqu'un d'autre — l'edge obtient un certificat TLS à la demande — donc les
règles sont appliquées à trois endroits, pas un.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/domains/ask?domain=` | — (l'edge) | Le `on_demand_tls { ask }` de Caddy. 200 = émettre, autre = refuser. |
| GET | `/domains/guide?host=` | — | Les deux enregistrements pour un nom d'exemple (ou celui donné), construits par le même helper que ceux du propriétaire : la preuve TXT `_bcw-verify` (jeton fictif) et le `pointer` CNAME vers le nom du site. Ce que montre /hosting. |
| GET | `/me/:kind/:id/domain` | propriétaire | Le domaine et les enregistrements DNS à ajouter (`record` = la preuve TXT, `pointer` = le CNAME). `:kind` = `repos` ou `catalogs`. |
| PUT | `/me/:kind/:id/domain` | propriétaire | Revendiquer un nom. Un nouveau nom = un nouveau jeton et une vérification repartie de zéro. |
| DELETE | `/me/:kind/:id/domain` | propriétaire | Le retirer. L'adresse bettercommunity n'est pas touchée. |
| POST | `/me/:kind/:id/domain/verify` | propriétaire | Résoudre le TXT `_bcw-verify.<host>` maintenant et comparer. Répond aussi `traffic: ok / missing / unknown` (le nom pointe-t-il déjà chez nous), à titre indicatif, jamais pris en compte dans `verified`. |

**Preuve de contrôle.** Un enregistrement TXT sur `_bcw-verify.<host>` portant un jeton propre
au domaine. Par domaine et non par compte, pour qu'en retirer un n'invalide pas un
enregistrement déjà publié pour un autre.

**L'éligibilité** est un pool payant, vérifiée à la revendication, quand l'edge demande, et à
chaque requête — un pool qui expire doit cesser d'être une raison de renouveler un certificat et
de résoudre vers du contenu, sinon résilier nous laisserait servir du trafic et payer des
certificats indéfiniment.

**Routage.** Un hook `onRequest` réécrit une requête arrivant sur un nom client : `/` devient le
`repo.json` du dépôt (ou le `catalog.json` du catalogue), et `/x/y` devient
`/hosting/<hostPath>/files/x/y`. Tout ce qui suit — listes d'accès, mot de passe de sync,
compteurs, l'interrupteur d'index — est le code qui existait déjà. La recherche est évitée pour
notre propre nom (soit toutes les requêtes en pratique) et mise en cache une minute sinon.

**Noms refusés** : jokers (un certificat à la demande ne peut pas être un joker), adresses IP,
noms à un seul label, tout ce qui contient un underscore, et tout nom égal ou sous le nôtre —
comparé avec un point, pour que `notbettercommunity.test` ne passe pas pour un sous-domaine de
`bettercommunity.test`.

## 40. Lier une forge git (`lib/gitsource.mjs`)
« Lier mon dépôt git » veut dire coller `https://github.com/me/mods`, qui est une PAGE WEB : un
client qui la récupère reçoit du HTML, n'arrive pas à en tirer un manifeste, et déclare le dépôt
cassé. L'adresse est convertie vers le fichier brut que la forge sert pour le même arbre, à la
création et à la modification d'un dépôt — les deux portes, parce qu'une règle appliquée à une
seule dépend de la porte utilisée.

| Collé | Devient |
|---|---|
| `github.com/me/mods` | `raw.githubusercontent.com/me/mods/HEAD/repo.json` |
| `github.com/me/mods/tree/dev` | `raw.githubusercontent.com/me/mods/dev/repo.json` |
| `gitlab.com/team/sub/proj` | `gitlab.com/team/sub/proj/-/raw/HEAD/repo.json` |
| `codeberg.org/me/mods` | `codeberg.org/me/mods/raw/branch/HEAD/repo.json` |

`HEAD`, jamais `main` — un dépôt dont la branche par défaut s'appelle autrement donnerait un 404,
et ce 404 se lit comme « le manifeste est absent ». Une URL déjà brute est laissée telle quelle,
comme tout hôte qui n'est pas une forge connue.

**Ce n'est pas git.** Pas de clone, pas de protocole, pas d'identifiants, pas d'historique : la
forge sert de simple hébergeur de fichiers, ce qu'un dépôt est déjà. Ça marche donc avec le
client qui existe aujourd'hui et ne coûte rien à servir, et un dépôt PRIVÉ n'est pas supporté —
ses URLs brutes exigent un jeton, et détenir le jeton de forge de quelqu'un serait la même erreur
que détenir sa clé SSH.

## 41. Historique (`lib/changelog.mjs`, `ChangeEvent`)
Ce qui a changé sur un dépôt, un catalogue ou un pool — avec le diff, pas seulement le verbe. Le
journal d'audit par dépôt qui existait avant avait la faiblesse de tous les journaux d'audit :
un `detail` en texte libre, si bien que la ligne la plus fréquente de la plateforme disait
« sandbox settings updated ». Vrai, inutile, et sans réponse.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/repos/:id/dashboard/history` | tableau de bord | Du plus récent au plus ancien. `?limit=` (max 200) et `?before=<ISO>` pour paginer. |

Une ligne porte `action` (liste fermée : `settings`, `access`, `publish`, `unpublish`,
`file.add`, `file.update`, `file.remove`, `domain`, …), un `summary` d'une ligne, et `changes` :
`[{ field, from, to }]`.

**Ce qu'un diff ne doit jamais contenir**, décidé à un seul endroit parce qu'un diff écrit à
neuf endroits, ce sont neuf occasions de fuiter : tout champ dont le dernier segment ressemble à
un secret (password, hash, token, key, clé de partage) est écarté ; un tableau devient `[3]` et
un objet `{2}` — jamais leur contenu, parce qu'une liste de bannissement, ce sont des adresses IP
et qu'un historique est lisible par tous les collaborateurs ; et la descente s'arrête après un
niveau d'imbrication, car aucune liste noire ne suit un blob JSON qui grossit.

**Pas de prose dans les chaînes stockées.** `summaryFor` renvoie le nom du champ pour un seul
changement et rien du tout pour plusieurs, et les comptes sont en notation crochets plutôt que
« 3 items » — ces chaînes sont stockées telles quelles et rendues telles quelles dans une page
qui peut être en français, donc une phrase anglaise fabriquée sur le serveur passerait tout droit
à côté de l'i18n.

**Ce n'est pas du versionnage de contenu.** Garder chaque version de chaque fichier envoyé est un
autre produit, avec une facture de stockage. Un changement de fichier enregistre sa taille et son
empreinte, avant et après : de quoi retrouver quand le contenu a bougé et le comparer à une copie
qu'on a gardée.

## 42. Boosts inclus (`boosts.mjs`, `lib/boostcredit.mjs`)
Une formule d'hébergement peut inclure N boosts tous les M mois, valant chacun D jours de mise
en avant. Ils sont accordés sous forme de LIGNES dans `BoostCredit`, pas comptés sur
l'abonnement : « tu en as 2 » ne répond à rien quand on demande où sont passés les autres, et un
compteur doit être ajusté par chaque écrivain, donc il dérive dès que l'un d'eux échoue à
mi-chemin.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/me/boosts` | utilisateur | Le registre, combien sont utilisables, et tous les dépôts ET catalogues sur lesquels en dépenser un. |
| POST | `/me/boosts/spend` | utilisateur | `{ kind: 'repo' \| 'catalog', id }`. |
| POST | `/admin/hosting/boosts/grant` | manage_hosting | En offrir un — support, excuse, cadeau. |

Champs de formule côté admin : `boostsPerPeriod` (0 = aucun, et c'est le défaut parce que toutes
les formules antérieures à cette colonne n'en incluaient aucun), `boostPeriodMonths`,
`boostDays`.

**L'octroi** tourne dans le sweeper et est idempotent par un index unique
`(subscriptionId, periodStart, seq)`, pas par une vérification suivie d'une écriture — deux
conteneurs lançant le sweeper au même instant passeraient tous les deux la vérification. La
période est ancrée au début de l'abonnement, pas au calendrier : sinon, qui achète le 28
recevrait un deuxième mois de boosts trois jours plus tard. `Subscription.createdAt` a été
ajouté pour ça ; il n'existait pas.

**Dépenser cumule.** Un boost appliqué à quelque chose de déjà mis en avant prolonge à partir de
la fin en cours, pas de maintenant — mesurer depuis maintenant détruirait silencieusement le
reste, pour quelqu'un qui les empile justement pour qu'il n'y ait pas de trou. Le crédit est
réclamé par un `updateMany` gardé (`usedAt: null` dans le WHERE), donc deux clics ne peuvent pas
dépenser deux fois le même.

**Les catalogues aussi.** Les listes de dépôts et de catalogues trient depuis toujours par
`featuredUntil` : un catalogue mis en avant remontait déjà, il n'existait simplement aucun moyen
d'en mettre un.

## 43. Ce qui compte comme dépôt derrière une URL (`lib/repokind.mjs`)
Un dépôt externe est une URL, et jusqu'ici une seule réponse à cette URL comptait : un
`repo.json` au format courant. Tout le reste était `valid: false`, ce qui pour un dépôt listé
veut dire jamais vérifié, donc jamais public — si bien que la façon la plus répandue de publier
des fichiers, un simple serveur web avec l'index de dossier activé, pouvait être enregistrée,
s'affichait en ligne, et n'apparaissait jamais, sans que rien ne dise pourquoi.

Deux genres désormais : un MANIFESTE est un dépôt qui se décrit lui-même, un INDEX est un
dossier que le client parcourt. BMM lit le second depuis toujours (il analyse l'index et se sert
de la taille et de la date de chaque ligne pour éviter de re-hacher ce qui n'a pas bougé) ; la
plateforme n'avait simplement pas de mot pour ça.

La reconnaissance est volontairement étroite, parce que « valide » rend un dépôt vérifié et
public — c'est une affirmation qu'il fonctionne. Un index exige un titre `Index of /…` ou une
suite de liens dans un `<pre>`, près du DÉBUT du document, et au moins deux entrées. Une page
d'accueil avec des liens est refusée. Le type de contenu est un indice, jamais la décision : les
serveurs envoient assez souvent `text/html` sur un manifeste et `application/json` sur une page
404 pour que s'y fier se trompe dans les deux sens.

`checkRepoHealth(repo, fetcher = safeFetch)` prend son fetcher pour être testable — safeFetch
refuse les adresses loopback, la garde SSRF faisant son travail, donc une sonde vers un serveur
de test local reçoit un refus qui se lit comme du code cassé.

## 44. Cagnotte solidaire (`charity.mjs`)
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/charity/current` | — | La cagnotte du mois : association, pourcentage, totaux, le vote (id + ouvert), `design`. Cache 30 s. **Éteinte → 404 `charity_disabled`** (`{ error, enabled:false }`), la même réponse que `/charity/contribute` et `/v1/charity` — une fonction éteinte n'est pas là. |
| POST | `/charity/contribute` | user optionnel | Démarre un checkout de don `{ amountCents }` (anonyme permis). Validation d'abord (`too_small`…), puis l'interrupteur (404 `charity_disabled`), puis Stripe (503 `stripe_not_configured`). |
| GET / PUT | `/admin/charity` | `manage_donations` | La config (`enabled`, `percent` ≤ 50, `currency`, `association`, le `design` de l'accueil) + la cagnotte du mois et l'aperçu des revenus. Admin → Ko-fi & financement → Cagnotte solidaire. |
| PUT | `/admin/charity/pot` · POST `/close` | `manage_donations` | Éditer la cagnotte du mois (vote lié, association, statut, preuve) / geler la part de BetterCommunity. |

## 45. Composants du studio (`studio.mjs`)
Le studio (`/studio/:kind/:id/:index` côté web) permet à un auteur de garder un groupe de blocs
de planche sous un nom et d'en déposer des copies sur d'autres pages. La liste est personnelle —
| GET | `/charity/history` | — | Les mois précédents, du plus récent au plus ancien (jusqu'à 24) : association, statut, les deux flux et leur total, le nombre de dons, et le lien de preuve + la date une fois versé. Jamais qui a donné (ni identifiant, ni note admin). Même interrupteur : désactivé → 404 `charity_disabled`. Cache 60 s. |
une valeur JSON par utilisateur dans le magasin clé/valeur des réglages
(`studio.components:<userId>`), sans table dédiée — lue entière à l'ouverture du studio et
réécrite entière à chaque changement.

| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/me/studio/components` | user | Tes composants enregistrés : `{ components: [{ id, name, w, h, blocks[], createdAt }] }`. |
| PUT | `/me/studio/components` | user | Remplace la liste. Au plus 60 composants de 40 blocs chacun, 512 Ko en tout (413 `too_large`) ; une forme invalide donne 400 `invalid_input` ; les ids en double se replient sur le premier. Le contenu des blocs est du JSON de planche libre — le moteur le normalise (`apps/web/src/lib/canvas.js`). |

*Généré depuis `apps/api/src/routes/` (dernier contrôle sur le code le 2026-09-17 : la colonne d’auth a été relue route par route, et trois lignes qui annonçaient une garde plus stricte que celle du code ont été corrigées. La §35 était le page builder et n’existe plus ; la numérotation garde son trou plutôt que de renuméroter quarante sections autour. La couverture n’est PAS complète : environ 22 des 71 modules de routes ont une section, le reste est atteignable par les cartes générées du §34. Mise à jour précédente 2026-08-13 — sections 18-33 ajoutées : tous les modules de routes qui n'avaient aucune section, plus les endpoints des appareils connectés au §1 ; §34 ajoutée le 2026-08-27 avec la table des formats de l’inspecteur ; §§35-36 ajoutées le 2026-08-29 pour le constructeur de pages et l’export du contenu ; §37 (webhooks) et les lignes du 2026-09-05 aux §§5, 13, 15, 18 — import de commits, boutique + inventaire du site, icônes d'apps, `/v1/polls/:id`, `/v1/charity`, `/v1/economy`, `/v1/badges`. Les chemins, méthodes et la colonne Auth ont été extraits du source, pas écrits de mémoire). Pour les formes de requête/réponse, lire le module de route correspondant — chacun est court et commenté.*
