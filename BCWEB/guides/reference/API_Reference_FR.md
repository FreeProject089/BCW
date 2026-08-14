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

### Niveaux d'auth (la colonne « Auth »)
| Tag | Signification |
|---|---|
| **—** | Public, sans auth. |
| **user** | Cookie de session connecté. |
| **mod** / **admin** | `requireRole('MOD'/'ADMIN')` — **compte avec 2FA activée requis**. |
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
| GET | `/blog/mine` · `/blog/my-scopes` | user | Articles/espaces que je peux écrire. |
| GET | `/blog-admin` | admin | Aperçu blog admin. |
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
| POST | `/repos` · DELETE `/repos/:id` · PATCH `/repos/:id` | user | Créer / supprimer / éditer son propre repo. |
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
| POST | `/repos/:id/dashboard/publish` · `/unpublish` · `/lock` · `/unlock` · `/ban` · `/unban` | owner | Contrôles publish/lock/ban. |
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
| POST | `/hosting/webhook` | webhook | Webhook Stripe (provisionne repos/boosts/paniers au paiement, cycles d'abonnement, remboursements — signature vérifiée). |

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
| GET | `/bot/config` · `/bot/token` · `/bot/account/:discordId` | bot | Lookup config/token/compte du bot. |
| POST | `/bot/heartbeat` · `/bot/activity` · `/bot/link/issue` | bot | Heartbeat, activité, émission de code de liaison. |
| GET/POST | `/bot/blog/unannounced` · `/blog/announced` | bot | File d'annonce blog. |
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
| GET | `/admin/users` · `/admin/users/:id` | admin | Recherche utilisateur (id/nom/e-mail/creator id/Discord/**BC id**) + détail ; les deux incluent l'état de modération du compte. |
| PUT | `/admin/users/:id/role` | superadmin | Réassigner le rôle. |
| DELETE | `/admin/users/:id/sessions/:sid` | superadmin | Déconnecter un appareil d'un utilisateur. Filtré par userId autant que par id de session ; idempotent ; effectif à la requête suivante de cet appareil. La liste elle-même revient dans `/admin/users/:id` sous `sessions`, qui vaut `null` (et non `[]`) pour tout rang inférieur à SUPERADMIN — chaque ligne porte l'IP de connexion et sa localisation approximative. |
| POST | `/admin/users/:id/moderate` | admin | **Suspendre / bannir / réactiver** un compte (`action`, `durationHours` optionnel = temporaire sinon permanent, `reason`). Déconnecte l'utilisateur en ~15s, bloque le login avec la raison + temps restant, e-maile + notifie. Staff/soi-même protégés. |
| GET | `/admin/settings` · PUT `/admin/settings/:key` | admin | Boutons de prix/hébergement. |
| GET | `/admin/storage` · `/admin/billing/users` | admin | Stockage : usage objet par zone **+ un total général sur tous les paliers** (stockage objet, BD, backups, télémétrie) chacun étiqueté local/distant ; + utilisateurs payants/gratuits. |
| GET | `/reviews` | — | Feed de témoignages du landing : `{ enabled, reviews[] }` (chacun avec `body` EN + `bodyFr`). |
| GET/POST/PATCH/DELETE | `/admin/reviews[/:id]` | admin | Gérer les témoignages du landing (auteur/rôle/texte EN+FR/note/activé/ordre). |
| PUT | `/admin/reviews/settings` | admin | Activer/désactiver toute la section avis (`{ enabled }`). |
| GET/POST/DELETE | `/admin/contact[/:id]` (+ `/:id/read`) | admin | Boîte de réception des messages de contact. |
| POST | `/contact` | pow | Formulaire de contact public. |
| GET | `/accounts/search` · `/stats` | user/— | Recherche de compte + stats publiques. |
| GET | `/admin/analytics` · `/admin/analytics/sessions` · `/admin/analytics/geo` | admin | Dashboard analytics ; les sessions entrelacent les pageviews avec les **interactions dans la page** (clics/édits/soumissions/modales) dans la timeline de chaque visiteur ; géo = pays/région/ville + carte globe. |
| GET | `/admin/analytics/vitals` · `/admin/analytics/vitals/page?path=` | admin | Web Vitals : percentiles globaux + tendance + p75 par page (`?days=`/`?hours=` pour 24h/7j/30j/90j) ; `/page` décompose UN chemin par appareil / navigateur / OS / pays. |
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
| POST | `/admin/server/sample-now` · PUT `/deps-config` | admin | Forcer un échantillon / éditer les deps. |
| GET/POST | `/bot/alerts/unannounced` · `/bot/alerts/announced` | bot | File d'annonce d'alertes pour le bot. |

## 17. Gestion serveur avancée (`server-control.mjs`) — **server-control + 2FA renforcée**
| Méthode | Chemin | Auth | But |
|---|---|---|---|
| GET | `/server/elevate/status` · POST `/server/elevate` | server-control | Élévation 2FA renforcée. |
| GET | `/server/db/tables` · `/db/table/:name` | server-control | DB viewer (lecture journalisée). |
| PUT | `/server/db/table/:name/cell` | server-control | Éditer une cellule (tables d'audit refusées). |
| GET/POST | `/server/db/backups` · `/db/backups/:hash/restore` | server-control | Backups BD façon git. |
| GET/POST/PUT/DELETE | `/server/files*` (read/write/rename/mkdir/download/backups) | server-control | Gestionnaire de fichiers + backups. |
| GET/POST/PUT | `/server/backups/usage` · `/gc` · `/limit` | server-control | Ménage des backups. |
| POST | `/admin/telemetry/token` | admin | Émettre un token SSO pour ouvrir le dashboard télémétrie BMM (HMAC, borné par époque). |
| GET/PUT | `/admin/telemetry/config` | admin | Lire/mettre à jour la config live du service télémétrie BMM (limite de stockage, rétention, délai d'effacement) — proxyfié vers le service. |
| GET | `/server/telemetry-db/tables` · `/table/:name` | server-control | Viewer en lecture seule sur le Postgres télémétrie BMM séparé. |
| GET | `/admin/security/audit` · `/admin/security/logins` | admin | Journal de sécurité (actions, tentatives de login, IPs). |
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

## 31. Custom roles & project grants (`roles.mjs`)
Ensembles de rôles créés par un SUPERADMIN par-dessus l’énumération de rôles, et droits d’édition par projet.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
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

## 33. Telemetry access (`telemetry.mjs`)
L’endpoint de forward-auth appelé par l’edge pour protéger le tableau de bord télémétrie BMM, et qui peut y accéder.

| Méthode | Chemin | Auth | Rôle |
|---|---|---|---|
| GET | `/telemetry/authorize` | — | Sonde de forward-auth appelée par l’edge avant de servir le tableau de bord. |
| GET | `/admin/telemetry-access/users` | superadmin | Qui peut atteindre le tableau de bord. |
| PUT | `/admin/telemetry-access/:userId` | superadmin | Accorder ou révoquer l’accès au tableau de bord. |

*Généré depuis `apps/api/src/routes/` (dernière mise à jour 2026-08-13 — sections 18-33 ajoutées : tous les modules de routes qui n'avaient aucune section, plus les endpoints des appareils connectés au §1. Les chemins, méthodes et la colonne Auth ont été extraits du source, pas écrits de mémoire). Pour les formes de requête/réponse, lire le module de route correspondant — chacun est court et commenté.*
