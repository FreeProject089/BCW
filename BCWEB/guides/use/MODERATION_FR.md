# Le moteur de modération

*Comment BetterCommunity décide quoi faire d’un message, d’un signalement, d’un formulaire ou
d’un lien : les surfaces, les règles, les politiques, la file de revue, l’IA facultative et son
coupe-circuit, et ce qui est gardé sur qui. 🇬🇧 [English version](MODERATION_EN.md).*

Le moteur vit dans `apps/api/src/lib/moderation/`. L’écran d’admin est **Admin → Modération →
Moteur de modération** (`/admin?s=modqueue`). Il fonctionne **règles d’abord** : chaque
décision s’explique ligne par ligne, le site marche exactement pareil avec l’IA éteinte, et tout
ce qui compte va à une personne.

---

## 1. Surfaces : par où le contenu entre

| Surface | D’où il vient | Ce que le moteur peut y faire |
|---|---|---|
| `contact` | le formulaire de contact (support, compte, facturation, autre) | **retenir** le message hors de la boîte jusqu’à ce qu’un modérateur le libère (l’expéditeur lit « envoyé » dans les deux cas) |
| `legal` | les genres légaux du formulaire de contact (signalement, droit d’auteur, export de données, effacement, recours), le formulaire de notification de droits | seulement ouvrir un cas **à relire** à côté |
| `report` | un nouveau signalement, et les messages du signaleur dedans | seulement ouvrir un cas **à relire** à côté |
| `bug`, `suggestion` | le formulaire de contact avec ce genre ; le centre de retours (`POST /feedback/:key`, retour et bug) | refuser (`422 filtered`) ou retenir (classé *ignoré*) |
| `crash` | le centre de retours, rapports de plantage | refuser ou retenir, comme bug |
| `member_message` | les fils de contact vers un membre, un dépôt, un catalogue, un projet | refuser (`422 content_refused`) ou retenir (message masqué) |
| `team_message` | la même chose, quand une équipe répond à la boîte | refuser ou retenir |
| `community` | les avis de projet | refuser (`400 content_refused`) ; un avis attend déjà une approbation, il n’est donc jamais « retenu » |
| `discord_automod` | le bot Discord demande (`POST /bot/moderation/check`) | **conseiller** seulement : le bot décide |
| `phishing` | le bot demande à propos de liens | conseiller seulement |

Les messages du staff dans les fils ne sont jamais modérés. Un rapport de sécurité envoyé par le
formulaire de contact est vérifié pour les signaux de spam, mais son texte n’est jamais copié
dans un cas et il n’est jamais retenu.

## 2. Les règles

Chaque règle déclenche une **raison** avec un **poids**. Le score est la somme. Aucune règle
n’est un verdict à elle seule, sauf deux : un lien `javascript:` / `data:`, et un domaine de la
liste de blocage.

| Famille | Règles (poids par défaut) |
|---|---|
| Liens | schéma de script (100), domaine bloqué (100 : la liste de l’admin et la liste de blocage des Conditions, les liens refusés dans les fiches), sosie d’une marque protégée (70 : homoglyphes IDN/punycode, à une ou deux lettres près), marque placée devant un autre domaine (50), arnaque cadeau/nitro (45), marque à l’intérieur d’un domaine (40), écritures mélangées (40), IP brute (35), chemin de connexion/portefeuille sur un domaine étranger qui nomme une marque (30), punycode (20), raccourcisseur (20), plus de cinq sites (15), extension risquée (8) |
| Listes | tes mots (comparés comme mots entiers après normalisation : casse, accents, caractères invisibles, lettres sosies cyrilliques/grecques ; en option « loose », à travers le leetspeak et les espaces) et tes motifs (expressions régulières vérifiées) |
| Forme | mentions de masse (30), zalgo (25), caractères invisibles (20), répétition (15), majuscules (10) |
| Comportement | flood au-dessus de la limite de la surface (40), bien au-dessus (70), même texte de 3 expéditeurs ou plus (45), même texte deux fois du même expéditeur (20), quasi-doublon (15) |
| Confiance | seulement quand autre chose s’est déjà déclenché : compte de moins d’un jour / d’une semaine (15 / 8), e-mail non confirmé (10), sanctions actives (15 chacune, 30 au plus), compte restreint (20), pas de compte (5) ; compte établi (-10) ; staff (-50, toujours) |

Les marques protégées sont incluses (BetterCommunity, Discord, Steam, GitHub, PayPal, Stripe,
Nexus Mods, CurseForge, Epic, Ko-fi, Patreon, Google, Microsoft, Apple) et tu peux ajouter les
tiennes avec leurs domaines officiels. Les noms de marque courts ne sont reconnus qu’à
l’identique : « stream » n’est pas pris pour « steam ».

Le **flood** compte un auteur connecté comme lui-même et un expéditeur anonyme par adresse
(hachée), dans Redis quand `REDIS_URL` est défini pour que toutes les répliques de l’API
s’accordent, dans une table mémoire bornée sinon. Des collègues derrière la même IP de bureau
sont des personnes distinctes. Les doublons sont comparés par une empreinte du texte normalisé,
jamais le texte lui-même, et seulement pour les textes de 30 caractères ou plus (« merci, c’est
réglé » de deux personnes n’est pas une campagne).

### Motifs : pourquoi certaines expressions régulières sont refusées

Une expression régulière s’exécute sur un texte écrit par un attaquant, et on ne peut pas
l’arrêter une fois lancée. Un motif est donc refusé à l’enregistrement s’il a un groupe répété
qui peut lui-même se répéter (`(a+)+`, `(a|aa)*`), plus d’une répétition illimitée
(`.*a.*b` : utilise `.{0,40}`), une référence arrière, s’il correspond à un texte vide, dépasse
200 caractères ou est lent sur une entrée hostile chronométrée. À l’exécution, le texte est
parcouru par morceaux de 1 000 caractères et la passe des motifs s’arrête après 25 ms, en le
disant dans les raisons. Les mots ne deviennent jamais une expression régulière.

## 3. Les politiques : ce que le moteur a le droit de faire

Chaque surface a un **mode** et quatre **seuils** (par défaut 30 / 55 / 75 / 90) :

| Le score atteint | Décision brute |
|---|---|
| signaler | FLAG |
| relire | REVIEW |
| quarantaine | QUARANTINE |
| bloquer | BLOCK |

| Mode | Ce qui se passe |
|---|---|
| **Agir automatiquement** | QUARANTINE retient le contenu jusqu’à ce qu’un modérateur le libère ; BLOCK le refuse là où le formulaire peut dire non, le retient là où il ne peut pas |
| **Signaler seulement** | le contenu passe ; un cas FLAG s’ouvre |
| **Revue manuelle** | le contenu passe ; un cas REVIEW s’ouvre |
| **Analyse seule** | rien ne se passe ; le cas est seulement journalisé pour les statistiques (« qu’auraient fait les règles ? ») |

**Signalements et demandes légales sont toujours en revue manuelle.** Le serveur refuse de les
enregistrer en automatique, l’IA ne peut rien y changer, et un signalement propre n’ouvre aucun
cas : les files Signalements et Notifications de droits sont déjà l’endroit où une personne les
lit.

**Réglages livrés :** rien n’est retenu ni refusé tant que tu n’as pas choisi « Agir
automatiquement » pour une surface. Tout est signalé, les signalements et le légal sont relus,
les rapports de plantage sont seulement analysés. Observe les cas signalés pendant une semaine,
puis passe en automatique les surfaces auxquelles tu fais confiance.

Par surface, tu règles aussi : consulter l’IA en cas de doute, attendre sa réponse, prévenir le
staff des cas à relire (au plus un avis par surface toutes les dix minutes), et la limite de
flood.

## 4. La file de revue

Le contenu retenu d’abord, puis par score. Un cas montre la décision (et ce que disaient les
règles avant la politique), chaque raison avec son poids, ce qu’a dit l’IA si elle a été
consultée, l’auteur et combien d’autres cas il a, et un lien vers l’endroit où vit le contenu.
Actions :

| Action | Effet |
|---|---|
| Approuver / Libérer | le contenu retenu est remis en place (un message de contact retenu est classé dans la boîte, daté de son envoi ; un message de fil masqué est affiché ; une ligne de retour revient à *nouveau*) |
| Retirer | le contenu quitte son public : un message de fil est masqué, un retour est classé *ignoré*, un avis de projet est refusé, un message de contact est marqué lu. Rien n’est supprimé |
| Avertir l’auteur | une sanction *avertissement* avec un code, envoyée par mail à l’auteur (demande aussi **Gérer les utilisateurs**), en retirant le contenu si tu le choisis |
| Faux positif | approuver, et apprendre aux règles : ce texte exact ne compte plus jamais, et les domaines que tu indiques rejoignent la liste autorisée |
| Classer | rien à faire |

Chaque action est une ligne du journal d’audit infalsifiable du staff. La file est ouverte au rôle
**MOD** et à la capacité `manage_moderation` ; les politiques, les règles et le coupe-circuit
demandent `manage_moderation` (les admins ont toutes les capacités).

L’onglet **Règles et test** a une case « Tester ce texte » : elle passe chaque règle sur ce que
tu colles, avec les règles et la politique enregistrées, et montre ce qui s’est déclenché. Rien
n’est stocké ni compté.

## 5. L’IA : un signal facultatif

La couche IA (`lib/moderation/ai.mjs`, mise en place dans [IA (Laya)](../run/AI_LAYA_FR.md))
n’est consultée que dans la **zone grise**, un score entre la moitié du seuil de signalement et
le seuil de blocage, et seulement là où tout dit oui : la politique de la surface (« consulter
l’IA en cas de doute »), l’interrupteur propre de la couche IA pour cette surface, et le
coupe-circuit levé.

- Par défaut, elle est consultée **après** la réponse : personne n’attend un modèle. Avec
  « attendre sa réponse », la requête attend, avec un délai strict (200 à 5 000 ms), et un
  dépassement veut simplement dire pas d’IA.
- Elle peut faire monter un cas **jusqu’à REVIEW au plus**. Elle ne retient jamais, ne refuse
  jamais, n’est jamais la raison d’un BLOCK, et ne clôt jamais un signalement ni une demande
  légale.
- IA éteinte, coupée, en panne, lente ou cassée : chaque surface répond avec les règles seules.
  Un `ai.mjs` absent ou cassé veut dire « pas d’IA », jamais une erreur.

**Le coupe-circuit** (Admin → Moteur de modération → IA, ou le panneau du fournisseur IA) arrête
tout appel à l’IA immédiatement, sur chaque réplique en quelques secondes, sans toucher aux
règles. C’est le même interrupteur que lit la couche IA (`ai.killed`) ; `AI_KILL_SWITCH=1` dans
l’environnement l’emporte sur lui. Toute personne qui configure la modération peut le tirer ;
seul un admin peut rallumer l’IA.

## 6. Vie privée : ce qui est gardé sur qui

- Un cas garde : la surface, la décision, les raisons, le score, qui l’a écrit (un id de compte,
  ou une empreinte de l’adresse IP, ou un id Discord), un extrait du texte (2 000 caractères au
  plus) et, pour un message de contact retenu, le message lui-même jusqu’à sa libération.
- Un cas sur un **signalement ou une demande légale ne copie jamais le texte** : ils portent
  l’identité de personnes et se lisent dans leur propre file, avec leurs propres permissions.
- Le texte et toute copie retenue d’un cas clos sont **effacés** après la durée de conservation
  (onglet Politiques, 90 jours par défaut). La décision et ses raisons restent : elles sont la
  trace de la façon dont la file a été tenue.
- Les compteurs de doublons et de flood stockent des empreintes, jamais du texte, et expirent
  avec leur fenêtre.
- L’effacement d’un compte retire son lien avec ses cas et leur texte.
- Rien ne quitte le serveur, sauf si la couche IA est configurée avec un fournisseur
  **externe** ; voir le guide IA pour ce qui est alors envoyé.

## 7. Pour les développeurs

- `moderate(surface, { text, links, authorId, ip, meta }, opts)` renvoie
  `{ decision, action, score, reasons, caseId, ai }`. `action` est ce que fait la route :
  `allow`, `hold` ou `refuse`, tiré de la décision et de ce que la route a dit pouvoir faire
  (`canHold`, `canRefuse`).
- Branche une nouvelle surface par `lib/moderation/index.mjs`, pas par les fichiers du moteur.
- Le moteur échoue ouvert : une erreur interne renvoie ALLOW avec une raison `engine.error`.
- Tests : `test/moderation-rules.test.mjs` (règles pures) et `test/moderation-engine.test.mjs`
  (base de données et routes).
