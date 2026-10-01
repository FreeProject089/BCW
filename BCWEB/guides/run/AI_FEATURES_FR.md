# BCWEB — Aides IA, clés des membres et statistiques d’usage de l’IA (FR)

🇬🇧 [English version](AI_FEATURES_EN.md)

La couche des fournisseurs d’IA ([AI_LAYA_FR.md](AI_LAYA_FR.md)) est ce que BCWEB interroge. Ce
guide couvre ce qui est **construit dessus** : les aides que les membres utilisent en écrivant,
les outils du staff sur les files, les clés des aides à la rédaction, les limites, et le tableau
qui montre ce que tout cela coûte. **Chaque aide aux membres est désactivée par défaut**, le
coupe-circuit coupe l’ensemble, et le site fonctionne pareil sans aucune aide.

---

## 1. Les fonctions

| Fonction | Pour | Ce qu’il faut | Sans IA |
|---|---|---|---|
| Suggestions de tags et de catégorie | membres (page de soumission) | le classifieur (Laya ou le fournisseur externe) | correspondance de mots sur notre serveur |
| Détection de la langue | membres | le classifieur | mots-outils, sur notre serveur |
| Vérification avant publication | membres | les règles de modération, + le classifieur en zone grise | les règles seules |
| Brouillons de description | membres | une clé **générative** : celle du membre (BYOK) ou celle du site | non proposé |
| Tri de la file | staff | rien (score des règles, signal IA déjà sur le cas, ancienneté) | pareil |
| Détection des doublons | staff (il faut aussi Signalements) | rien (fragments de mots, Jaccard) | pareil |
| Causes de plantage | staff (il faut aussi Signalements) | le classifieur pour les 8 plus gros groupes | causes par mots-clés |
| Résumés de fils | staff (il faut aussi Signalements) | la **clé du site seulement** (jamais la clé personnelle d’un membre du staff) | non proposé |

Laya classe et n’écrit jamais : les deux fonctions de « brouillon » demandent un point d’accès
`/chat/completions` compatible OpenAI, avec la clé d’un membre ou la clé du site.

La **vérification avant publication** est un essai à blanc de la modération : les règles
d’inondation ne comptent rien, rien n’est stocké, aucun cas n’est ouvert, et la réponse est
GROSSIÈRE : un niveau (ok / peut-être / probable) et des genres de problème (un lien risqué, le
ton, du spam, la mise en forme, des mots surveillés). Elle ne nomme jamais la règle, le mot ni
la liste qui a réagi, et elle ignore l’ancienneté du compte (ce n’est pas la faute du texte).

## 2. Qui peut utiliser quoi

**Admin → Modération → Aides IA → Fonctions et limites** (capacité `manage_moderation`).

- Chaque aide aux membres : activée ou non, **qui** (tous les membres / membres payants / staff
  seulement), et deux quotas quotidiens : gratuit, et payant (membres payants et staff).
  « Payant » veut dire un abonnement actif à une offre dont le prix est supérieur à zéro ; une
  offre gratuite n’est pas une offre payante.
- Outils du staff : activés ou non. Doublons, causes de plantage et résumés demandent aussi
  `manage_reports`, car ils lisent les files de signalements et de retours.
- Limites de tout appel d’aide : par personne et par minute, par IP et par minute, tout le site
  par jour. Elles répondent `429` avec la portée (`user`, `ip`, `global`, `feature`) et un
  `Retry-After`. Le quota quotidien est lu dans la table d’usage : il survit à un redémarrage
  et vaut pour toutes les répliques ; les limites à la minute passent par Redis quand
  `REDIS_URL` est défini, sinon en mémoire.
- Les surfaces de modération gardent leurs propres limites à la minute (écran Moteur de
  modération).

## 3. Les clés

**Les clés des membres (BYOK).** Désactivées tant que « les membres peuvent apporter leur propre
clé » n’est pas coché. Un membre ajoute alors, dans **Réglages → Aides IA**, l’adresse de base
d’une API compatible OpenAI, la clé et éventuellement un modèle. La clé est scellée
(AES-256-GCM, `lib/ai-keys.mjs`) avant d’être stockée, n’est jamais renvoyée à un navigateur (le
membre voit l’hôte et les quatre derniers caractères) et est supprimée avec le compte.
L’adresse suit les règles du fournisseur externe : https, publique, sans identifiants, sans
paramètres. Une limite d’appels quotidienne par membre protège sa facture.

**La clé du site.** Admins seulement (un modérateur avec `manage_moderation` voit si elle est
posée, pas le formulaire). Scellée de la même façon, stockée dans `AdminSetting ai.siteKey`,
tenue hors de `GET /admin/settings`, de la porte des réglages et de tous les exports. Elle sert :
- aux résumés du staff, toujours et seulement elle : un signalement est une donnée de la
  plateforme, il ne part jamais avec la clé personnelle d’un modérateur (pas de clé du site =
  pas de résumé, raison `no_site_key`) ;
- aux brouillons des membres payants, seulement si « l’inclure dans les offres payantes » est
  coché (c’est vous qui payez).
Ses propres plafonds par personne et pour tout le site s’ajoutent aux limites des fonctions.

**Secret de scellement.** `AI_KEYS_SECRET` dans `.env` (voir [ENV_FR.md](ENV_FR.md)) ; vide =
dérivé de `JWT_SECRET` avec sa propre étiquette. Le changer rend toutes les clés stockées
illisibles : les membres et la clé du site doivent être ressaisis. C’est l’échec voulu :
illisible, jamais lu par la mauvaise personne.

## 4. Le tableau d’usage

**Admin → Modération → Aides IA → Usage**, pour aujourd’hui, 7, 30 ou 90 jours :

- appels, taux d’erreur, délais dépassés, latence p50 / p95, taux de réponses en cache,
  ouvertures du disjoncteur et appels qu’il a refusés, abandons de file, appels limités, jetons
  et coût estimé ;
- par surface / fonction (`mod:contact`, `describe`, …) et par fournisseur (Laya, API externe,
  clés des membres, clé du site, règles seules) ;
- les décisions que l’IA a placées au-dessus des règles, combien de fois un humain l’a jugée
  fausse (un cas signalé par l’IA, clos comme faux positif ou écarté ; ou un membre qui clique
  « cet avertissement est faux ») et juste (retiré ou sanctionné) ;
- les plus gros consommateurs (appels, jetons, coût par compte).

**Ce qui est stocké** : `AiUsageDay` (une ligne par jour, fonction et fournisseur : compteurs,
histogramme de latence, jetons, coût) et `AiUserUsageDay` (par compte, jour et fonction :
appels, jetons, coût). Aucun texte, aucun extrait, aucune empreinte de texte, aucune URL, aucune
clé : l’enregistreur prend des nombres nommés et des noms courts et jette le reste. Les
compteurs sont gardés en mémoire et écrits toutes les 15 secondes, donc un appel n’attend jamais
une écriture de statistiques (un plantage perd au plus 15 secondes de compteurs). Les lignes par
compte sont purgées après `retentionDays` (90 par défaut, de 7 à 730) par le balayeur et
supprimées avec le compte ; les agrégats quotidiens ne nomment personne et sont gardés.

Le **coût** est une estimation : jetons × les prix par million saisis pour la clé du site et le
fournisseur externe. Les clés des membres et Laya comptent zéro. La facture du fournisseur fait
foi.

## 5. Où part le texte

Chaque bouton d’aide le dit avant d’être pressé :

| Source | Où part le texte |
|---|---|
| Laya | le conteneur `laya` sur votre serveur ; rien ne sort |
| Fournisseur externe | le fournisseur de `AI_EXTERNAL_URL`, un tiers |
| Clé du membre | le fournisseur choisi par le membre, selon son contrat avec lui |
| Clé du site | le fournisseur de la clé du site, votre sous-traitant |
| Local / règles | nulle part : correspondance de mots et règles de modération, dans l’API |

**Capacité.** La modération et les aides (recherche intelligente, suggestions BMM, aides
`feat:*`) ne partagent ni file ni budget. Les aides ont au plus un emplacement de moins que la
concurrence (la modération en garde un dès qu’il y en a deux), un quart de la file et la moitié
du budget par minute ; un appel de modération en attente passe d’abord et fait tomber les aides
en file. Une rafale de recherches anonymes répond `busy` ou `rate_limited` aux recherches,
jamais à la modération.

`AI_EXTERNAL_ALLOW_PRIVATE=1` ne vaut jamais pour la clé d’un membre ni celle d’un serveur
Discord : seuls le fournisseur de l’opérateur et la clé du site peuvent viser une adresse privée.

Un résumé envoie les messages du fil avec leur rôle (auteur du signalement, staff, système),
jamais les noms ni les adresses e-mail. Un brouillon envoie le type de l’élément, son nom et les
notes du membre. Avant d’activer la clé du site pour l’un ou l’autre, nommez son fournisseur
dans la liste des sous-traitants de la politique de confidentialité (la politique décrit déjà
les aides, les clés des membres et les statistiques).

## 6. Quand quelque chose cloche

| Symptôme | Cause probable |
|---|---|
| Un membre ne voit aucune aide | aucune n’est activée, ou toutes sont réservées à une offre qu’il n’a pas |
| « Ajoute ta propre clé IA » sur le bouton de brouillon | BYOK est actif mais il n’a pas de clé, et la clé du site n’est pas incluse dans son offre |
| « Ta clé enregistrée ne peut plus être lue » | `AI_KEYS_SECRET` (ou `JWT_SECRET` s’il est vide) a changé : il faut ressaisir la clé |
| « Le fournisseur a refusé la clé » | le fournisseur a répondu 401/403 |
| 429 `quota_reached` | le membre a épuisé le quota du jour de la fonction ; il repart à minuit UTC |
| Tags ou langue disent « calculé par correspondance de mots » | le classifieur est éteint, coupé, ou son fournisseur n’est pas configuré |
| Le tableau reste à zéro | aucun appel encore, ou des compteurs dans le tampon de 15 secondes (le tableau le vide d’abord) |

## 7. Ce qui a été vérifié, et ce qui ne l’a pas été

Vérifié (2026-09-29) : l’enregistreur et l’arithmétique du rapport (percentiles depuis
l’histogramme, taux, série complétée, plus gros consommateurs, prix), le pipeline qui compte
chaque issue (ok, cache, coupé, désactivé, disjoncteur ouvert une fois et appels refusés à part),
le scellement des clés (contrôle du propriétaire, secret changé, enveloppe modifiée), les règles
d’adresse, les solutions sans IA, la vérification grossière, et chaque porte sur une base
jetable face à de faux fournisseurs sur 127.0.0.1 : une clé entre et ne ressort jamais, le
réservé-aux-payants, les limites par minute, par IP et par jour, un brouillon envoyé avec la clé
du membre et compté sans son texte, la clé du site réservée aux admins et jamais relue, les
outils du staff refusés à un membre, l’ordre du tri, l’interrupteur global du mode OS.

**Non vérifié** : aucun vrai fournisseur d’IA externe n’a été appelé (voulu), et les aides n’ont
été contrôlées côté navigateur que par les portes build, lint et i18n.
