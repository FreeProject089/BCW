# BCWEB — Guide de mise en place pas à pas

*🇬🇧 [English version](SETUP_GUIDE_EN.md).*

Un parcours pratique et dans l'ordre pour monter une instance BCWEB neuve : premier boot,
compte admin, 2FA, rôles, et les intégrations optionnelles (bot Discord, Stripe). Pour l'aperçu
architecture/fonctionnalités voir [README.md](./README.md) et
[ARCHITECTURE_FR.md](./ARCHITECTURE_FR.md) — ce doc, c'est juste « sur quoi je clique/tape, dans
quel ordre ».

## 1. Prérequis

- Docker + Docker Compose v2 (`docker compose version`).
- Une copie de ce repo.

## 2. Configurer les variables d'environnement

```bash
cd infra/compose
cp .env.example .env
```

Ouvre `.env` et règle, au minimum :

| Variable | À quoi ça sert |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base — choisis-en un vrai, même en local. |
| `JWT_SECRET` | Signe les cookies de session, les tokens 2FA, les tokens d'élévation. Génère avec `openssl rand -hex 32`. **L'app refuse de booter en production avec le défaut non sécurisé.** |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credentials MinIO (ou vrai S3) pour les uploads hébergés. |
| `SITE_DOMAIN` / `SITE_URL` | Dev local : laisse `http://localhost`. Production : ton vrai domaine — Caddy provisionne le HTTPS depuis `SITE_DOMAIN`. |

Tout le reste (Stripe, GTM, bot Discord, télémétrie) est optionnel et couvert dans sa propre
section ci-dessous — laisse-les vides pour l'instant et reviens une fois le site de base en marche.

## 3. Premier boot

```bash
docker compose up -d
docker compose exec api npm run seed
```

Le seed est idempotent (rejouable sans risque) et crée :
- Les quatre projets de base (BMM, BSM, community, installer).
- Les plans d'hébergement par défaut.
- **Un compte SUPERADMIN** : `admin@bettercommunity.local` / `change-me-now` (ou
  `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` si tu as réglé ces variables avant le seed). Créé
  en **SUPERADMIN** spécifiquement pour qu'il y ait toujours au moins un compte capable
  d'accorder/réassigner les rôles ensuite.

Vérifie qu'il est sain :
```bash
curl http://localhost/api/health   # { "ok": true, "db": true, ... }
```

## 4. Première connexion — change le mot de passe seedé immédiatement

1. Va sur `http://localhost` → **Connexion** → utilise les identifiants admin seedés ci-dessus.
2. Va dans **Profil** → *Changer le mot de passe* → mets un vrai mot de passe. Le
   `change-me-now` seedé ne devrait jamais survivre à cette étape, même en local/dev.

## 5. Active la 2FA sur le compte admin

Profil → **Authentification à deux facteurs** → **Activer la 2FA** :

1. L'app montre un QR code et, en dessous, le même secret en texte clair (pour les
   authentificateurs qui ne peuvent pas scanner). Scanne-le avec Google Authenticator, Authy,
   1Password, etc. — ou saisis le secret manuellement.
2. Entre le code à 6 chiffres que ton authentificateur affiche → **Confirmer & activer**.
3. On te montre **8 codes de récupération à usage unique, exactement une fois** — clique
   **Télécharger les codes** (sauve un `.txt`, nommé `{nom}_2FA_{date}.txt`) ou copie-les en
   lieu sûr avant de fermer. Chaque code marche une fois si tu perds ton appareil.
4. Désormais, la connexion demande un code 2FA après le mot de passe.

La 2FA est **en self-service uniquement** — un admin ne peut jamais l'activer/désactiver pour un
autre compte, car c'est un facteur d'auth personnel. Pour la désactiver plus tard : Profil →
Deux facteurs → entre ton mot de passe actuel **et** un code actuel (ou un code de récupération).

## 6. Rôles & accès (SUPERADMIN uniquement)

Dashboard admin → **Rôles & accès** (visible aux SUPERADMIN seulement — les ADMIN normaux ne
voient pas cet onglet) :

- **Trouver un utilisateur** → recherche par id / nom / e-mail / creator id lié / Discord lié →
  choisis quelqu'un → **réassigne son rôle** (USER/MOD/ADMIN/SUPERADMIN). Tu ne peux pas changer
  ton propre rôle ici (évite de te verrouiller par accident) — fais-le faire par un autre
  SUPERADMIN, ou utilise le compte seed.
- **Politique d'accès globale** (même écran) — une whitelist/blacklist optionnelle à l'échelle du
  site, appliquée à chaque Server-Repo hébergé, par-dessus les réglages propres de chaque repo.
  Laisse tout vide/off sauf besoin spécifique.
- **Outils de contrôle serveur** — accorde ça à un ADMIN/SUPERADMIN précis si tu veux qu'il
  atteigne l'onglet « Gestion serveur avancée » (gestionnaire de fichiers, DB viewer, redémarrage).
  Il doit avoir sa **propre** 2FA activée (étape 5) — l'octroi seul ne suffit pas, il re-vérifie
  aussi avec un code frais à chaque usage de ces outils (une « élévation » séparée de la 2FA de login).

Les octrois de permission d'articles de blog vivent dans leur propre onglet **Accès blog**
(ADMIN+, pas SUPERADMIN-only) — séparé de la gestion rôle/politique.

**Identifiant BC unique.** Chaque compte a un **Identifiant BC unique** stable (`BC-XXXX-XXXX`),
montré sur sa carte/modale admin (copiable). Tu peux en coller un directement dans le champ
**Trouver un utilisateur** pour sauter à ce compte — pratique pour les tickets support où un
utilisateur cite son id mais pas son e-mail. Chaque repo hébergé / item de catalogue porte aussi
son propre id d'élément (`BCR-…` / `BCI-…`) sur la modale. Ce sont des HMAC de l'id du compte
(ils ne révèlent rien seuls et ne sont pas des secrets).

## 7. Explore le reste du dashboard admin

Une fois les bases ci-dessus faites, la barre latérale est groupée par thème — survole chaque
section une fois pour savoir ce qui existe :

- **Modération** — la file de soumissions (rechercher/filtrer/tagger/commenter les items en attente).
- **Utilisateurs & accès** — Utilisateurs, Gratuit vs payant, Rôles & accès, Accès blog, Journal de sécurité.
- **Repos & hébergement** — Dépôts serveur, Hébergement gratuit, Codes promo, Stockage.
- **Contenu** — Catalogues, Projets, Autres projets, Annonces.
- **Serveur** — Perf serveur (CPU/RAM/disque/latence en direct + alertes), Gestion serveur avancée (protégée par élévation).
- **Bot & statistiques** — Config du bot Discord, Statistiques.
- **Réglages** — boutons de prix, caps d'hébergement, limites du free-tier, etc.

## 8. Optionnel : bot Discord

Dashboard admin → **Bot Discord** :

1. Crée un bot sur le [Discord Developer Portal](https://discord.com/developers/applications),
   active les intents privilégiés **Server Members** et **Message Content**, et copie son token.
2. Colle le token dans le champ **Bot token** du dashboard et sauve — ou règle `DISCORD_TOKEN`
   dans `.env` (la variable d'env gagne toujours sur celui stocké au dashboard).
3. Configure la modération, les messages de bienvenue, le join-to-create vocal, les annonces de
   blog, et les **alertes de perf serveur** (un champ de salon — poste les alertes
   CPU/RAM/disque/service-down au fil de l'eau) depuis le même écran.
4. **Module paiements & remboursements** — activé, le bot poste chaque paiement Stripe réussi et
   chaque remboursement sur Discord. Les deux acceptent **plusieurs ids de salon** (clique
   « Ajouter un salon ») : un paiement est posté sur *tous* les salons de paiement, un
   remboursement sur *tous* les salons de remboursement (ou les salons de paiement si tu laisses
   les remboursements vides). Les embeds de remboursement masquent l'e-mail client. Nécessite
   Stripe (section 9) pour que le webhook enregistre paiements/remboursements à annoncer.
5. En production, règle aussi `BOT_SHARED_SECRET` dans `.env` (défaut à une valeur dev non
   sécurisée) — c'est le secret partagé entre l'API et le conteneur du bot.

## 8b. Optionnel : connexion OAuth GitHub / Discord (« Continuer avec… »)

Permet aux visiteurs de se connecter / s'inscrire avec GitHub ou Discord au lieu d'un mot de
passe. Les boutons n'apparaissent qu'une fois les credentials configurés (le frontend sonde
`/api/auth/oauth/providers` et cache un provider non configuré), donc tu peux laisser ça off sans
trace visible.

1. **GitHub** — crée une OAuth App dans *GitHub → Settings → Developer settings → OAuth Apps*.
   Mets l'URL de callback à `https://ton-domaine/api/auth/oauth/github/callback` (local :
   `http://localhost/api/auth/oauth/github/callback`). Copie le client id + secret dans `.env`
   comme `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
2. **Discord** — dans le [Discord Developer Portal](https://discord.com/developers/applications)
   → ton app → **OAuth2**, ajoute le redirect de même forme
   (`…/api/auth/oauth/discord/callback`), et copie le client id + secret dans `.env` comme
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`. (C'est l'identité de l'app OAuth — distincte du
   `DISCORD_TOKEN` du bot à l'étape 8.)
3. `docker compose up -d api web` pour prendre en compte l'env. L'état est protégé CSRF par un
   param `state` signé HMAC et borné dans le temps, et seuls les e-mails *vérifiés* par le
   provider sont fiables. Les comptes créés purement via OAuth n'ont pas de mot de passe (le
   login leur dit d'utiliser le provider) ; ils peuvent en définir un plus tard depuis Profil.
4. Les nouveaux comptes — quelle que soit la méthode d'inscription — se voient proposer une étape
   de **configuration 2FA optionnelle**, et tout compte connecté sans 2FA voit un rappel
   dismissable au dashboard.

## 9. Optionnel : Stripe (facturation hébergement/catalogue payant)

1. Récupère les clés API sur `dashboard.stripe.com` (utilise les clés **mode test** en dev),
   règle `STRIPE_SECRET_KEY` dans `.env`.
2. Crée un endpoint webhook pointant sur `https://ton-domaine/api/hosting/webhook` et règle
   `STRIPE_WEBHOOK_SECRET` à son secret de signature. Active **exactement ces événements** (le
   handler dans `apps/api/src/routes/stripe-webhook.mjs` les écoute) :
   - `checkout.session.completed` — provisionne hébergement / boosts / upgrades / renouvellements.
   - `invoice.paid` — cycles d'auto-renouvellement récurrents (subs hébergement + subs boost).
   - `invoice.payment_failed` — avertit le propriétaire qu'un renouvellement a échoué.
   - `customer.subscription.deleted` — suspend quand un abonnement se termine enfin.
   - `charge.refunded` — enregistre les remboursements (montrés dans les salons de remboursement du bot).
   Pour les tests **locaux**, lance `stripe listen --forward-to localhost/api/hosting/webhook` et
   utilise le secret de signature imprimé par le CLI comme `STRIPE_WEBHOOK_SECRET`.
3. Active le **Customer Portal** Stripe (nécessaire pour le lien « Gérer la facturation » et pour
   laisser les utilisateurs annuler/changer leurs abonnements).
4. **Les factures sont de vrais documents Stripe.** Les checkouts one-time sont créés avec
   `invoice_creation` activé, et Facturation → *Facture* / la modale de succès résolvent la vraie
   **PDF** de facture/reçu hébergée par Stripe en direct (les vieux paiements, pré-upgrade,
   retombent sur le reçu in-app stylé). Rien à configurer — ne désactive juste pas les
   e-mails/PDF de facture dans tes réglages Stripe si tu veux le lien PDF.
5. **Auto-renouvellement** — la ligne « Renouveler » de l'hébergement et la modale de boost ont
   toutes deux un toggle *auto-renew* qui démarre un abonnement récurrent au lieu d'une charge
   one-time ; `invoice.paid` (étape 2) pilote les renouvellements.
6. Une fois `STRIPE_SECRET_KEY` réglé, la liste de dépendances de l'onglet Perf serveur commence
   automatiquement à vérifier aussi la joignabilité de Stripe.

## 10. Optionnel : dashboard de télémétrie BMM

Le service de télémétrie (`bmm/telemetry-dashboard`, son propre conteneur + SQLite) collecte les
statistiques opt-in de l'app BMM. La config env vit dans `bmm/telemetry-dashboard/.env`
(`API_KEY` doit correspondre à l'`analytics_key` de l'app BMM ; `ADMIN_KEY` déverrouille le panneau
admin). Au-delà du premier boot, tu **n'édites pas** ce `.env` pour les limites du quotidien :

- **Le cap de stockage, la rétention RGPD et le délai d'effacement sont éditables EN DIRECT**
  depuis Admin → **Réglages d'hébergement** → la carte *« BMM telemetry (live) »*. Sauver pousse
  au service de télémétrie, persiste dans son `config.json` (override `.env`, survit aux
  redémarrages), et rogne les données au-delà de la limite immédiatement — sans redémarrage.
- Pour que BCWEB joigne le service de télémétrie, le conteneur `api` a besoin de
  `TELEMETRY_INTERNAL_URL` (défaut `http://telemetry:8900`) et `TELEMETRY_ADMIN_KEY` (=
  l'`ADMIN_KEY` du service) — les deux déjà câblés dans `infra/compose/docker-compose.yml`, donc
  régler `TELEMETRY_ADMIN_KEY` dans `.env` suffit.
- Les admins avec accès télémétrie ont un bouton SSO « ouvrir la télémétrie » (aucune clé statique
  nécessaire) ; accorde-le par utilisateur dans **Rôles & accès**.

## 11. Checklist de production

- Suis **[DOMAIN_SETUP_FR.md](./DOMAIN_SETUP_FR.md)** pour quitter `localhost` vers ton propre
  domaine avec HTTPS automatique (Caddy + Let's Encrypt), y compris le sous-domaine optionnel
  `telemetry.<domaine>`.
- Vois la **checklist de production** dans [README.md](./README.md) pour la liste complète
  (backups, clés Stripe **live** + un webhook en mode live, rotation des secrets, etc.).
- Assure-toi que chaque compte SUPERADMIN et ADMIN a la 2FA activée (étape 5) avant la mise en
  ligne, et que `JWT_SECRET` / `BOT_SHARED_SECRET` / `TELEMETRY_ADMIN_KEY` sont tous de vraies
  valeurs aléatoires, pas les défauts dev.
