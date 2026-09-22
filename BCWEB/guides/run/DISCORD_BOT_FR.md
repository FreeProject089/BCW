# Le bot Discord

`apps/bot` est un service à part entière, pas un extra : c'est la présence de
BetterCommunity à l'intérieur d'un serveur Discord. Il ne détient **aucun accès à la base de
données**. Chaque lecture et chaque écriture passe par la surface `/bot/*` de l'API avec un
secret partagé, et c'est ce qui en fait un conteneur séparé.

Presque tout se configure depuis le site (Admin → **Bot Discord**, et le tableau de bord
Discord du propriétaire du serveur) et est repris en moins de 30 secondes, sans redéploiement.

> Là où ce guide ne sait pas, il le dit. Tout ce qui figure sous *non vérifié ici* n'a pas
> été confirmé dans le code au moment de l'écriture.

**À lire aussi :** [Architecture §3.7](../reference/ARCHITECTURE_FR.md) pour la conception,
[Analyse technique §7](../reference/Technical_Analysis_FR.md) pour la carte des modules,
[Guide de configuration §8](SETUP_GUIDE_FR.md) pour le chemin court,
[Référence env](ENV_FR.md) pour les variables.

---

## 1. L'installer et lui donner un token

1. Crée une application et un bot sur le
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Sous **Bot → Privileged Gateway Intents**, active **Server Members** et
   **Message Content**. Les deux sont obligatoires : sans eux la connexion échoue, et le bot
   remonte la raison au dashboard au lieu de boucler en silence. Les autres intents qu'il
   demande (serveurs, états vocaux, messages, réactions, modération, expressions, webhooks)
   ne sont pas privilégiés.
3. Copie le token, puis au choix :
   - colle-le dans Admin → Bot Discord → Vue d'ensemble → **Token du bot**, ou
   - règle `DISCORD_TOKEN` dans `infra/compose/.env`.
4. Invite le bot sur le serveur. Le site construit le lien d'invitation lui-même, sur le
   tableau de bord **utilisateur** → **Serveurs Discord** (pas l'écran admin) : le bot
   rapporte son propre id d'application à chaque battement de cœur, donc personne n'a de
   client id à coller. Le lien demande `bot` et `applications.commands`, avec un jeu de
   permissions couvrant gérer les rôles, gérer les salons, expulser, bannir, exclure
   temporairement, déplacer des membres, envoyer des messages, intégrer des liens, lire
   l'historique et voir les salons. Il ne demande pas Administrateur.
5. `docker compose up -d bot`.

**Quel token gagne.** `DISCORD_TOKEN` dans l'environnement gagne toujours. Quand il est posé,
l'API refuse purement et simplement de changer celui qui est stocké (`PUT /admin/bot/token`
répond 409 `token_from_env`), et le champ du dashboard est remplacé par une note qui le dit.

**Le bot doit être désactivé pour changer le token stocké.** Avec `enabled` encore à vrai, la
même route répond 409 `bot_enabled`, et le dashboard cache le champ tant que le bot n'est pas
éteint. Éteins-le, change le token, rallume-le.

**Seul un administrateur peut le poser.** Cette route-là est gardée par le rôle ADMIN et non
par la capacité `manage_bot`, délibérément : un identifiant ne se délègue pas. Quelqu'un qui
a `manage_bot` configure tout le reste et voit une note lui disant que le token n'est pas à
lui.

**Comment le token stocké est gardé.** Comme une ligne `AdminSetting` sous la clé
`bot.token`, en JSON clair. Il n'est **pas chiffré au repos** : toute personne qui a accès à
la base peut le lire. Traite un dump de base comme le token lui-même. Aucune route d'API ne
le renvoie au navigateur (la route de config admin répond avec les seuls booléens `hasToken`
et `tokenFromEnv`). `GET /bot/token` renvoie `null` tant que le bot est désactivé, et c'est
ainsi que « désactivé » est appliqué même si le conteneur tourne toujours.

**Aucun redémarrage n'est jamais nécessaire.** `index.mjs` est un gestionnaire de connexion,
pas un simple démarrage. Un tick de supervision toutes les 20 secondes connecte quand un
token apparaît, reconnecte quand le token change ou quand un admin appuie sur
**Reconnecter**, et déconnecte quand le bot est éteint. Sans token le processus reste au
repos et continue d'interroger l'API ; il ne s'arrête pas.

**Une connexion ratée temporise** au lieu de marteler Discord : 10 minutes sur un token
invalide (il attend que le token change), 1 minute quand les intents privilégiés sont
désactivés (pour que les activer dans le portail reconnecte vite), 30 secondes sinon.

### Environnement

| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | Token du bot. Vide : le bot reste au repos jusqu'à ce qu'un token soit posé au dashboard. Posé : il gagne et verrouille le champ du dashboard. |
| `BCWEB_API_URL` | Base de l'API interne. Défaut `http://api:3000`. |
| `BOT_SHARED_SECRET` | L'identifiant présenté à chaque appel `/bot/*`. L'API accepte `BOT_SHARED_SECRET`, sinon `LINK_LOOKUP_SECRET`, sinon la valeur littérale `dev-bot-secret`, et le garde-fou de démarrage refuse de lancer la prod sans l'une des deux premières. Comparé en temps constant. |
| `SITE_URL` | L'URL publique du site que le bot met dans ses liens et ses boutons. |

Attention : `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` sont l'identité de la **connexion
OAuth**, autre chose que le token du bot. Voir [Guide de configuration §8b](SETUP_GUIDE_FR.md).

---

## 2. Comment il se configure

Trois écrans :

- **Admin → Bot Discord** (`manage_bot`). Un rail de modules à gauche plutôt qu'un long
  défilement : Vue d'ensemble (token, interrupteur principal, Reconnecter, barre de stockage,
  base de membres, logs en direct, MP à un membre), Annonces (routes d'annonces, routes de
  blog, alertes, Ko-fi, paiements), Communauté (panneaux de rôles, MP de masse, giveaways),
  Par serveur (le sélecteur de serveur, les serveurs bloqués, et modération / logs / vocal /
  bienvenue / accès par rôle propres à chaque serveur), Membres (le registre et les vues
  économie, saisons comprises), Économie (monnaie, courbe d'XP, casino, boutique, dons,
  historique, icônes), Limites.
- **Admin → Langues** édite le dictionnaire du bot, une couche de surcharge par langue
  au-dessus de ce que le bot a livré. Demande `translate_site`, pas `manage_bot`.
- **Tableau de bord → Serveurs Discord** est l'écran du propriétaire du serveur : automod,
  logs, bienvenue, vocal à la demande, rôles gatés et panneaux de rôles, routes de blog, et
  une liste de membres en lecture seule avec des actions de modération mises en file. Un
  utilisateur voit un serveur s'il en est propriétaire ou s'il y détient Gérer le serveur,
  revérifié côté serveur à chaque appel ; il doit d'abord lier son Discord. Le pool de
  stockage et le budget en octets n'y sont **pas** : ils appartiennent au titulaire du compte,
  sur le site.

Le bot tire un seul objet de config depuis `GET /bot/config` et le met en cache 30 secondes,
donc un changement au dashboard prend effet en moins d'une demi-minute.

- **Les réglages globaux** s'appliquent partout où le bot est : l'interrupteur principal, les
  routes de blog, les alertes, Ko-fi, les paiements, les annonces, les MP, les giveaways, les
  panneaux de rôles, l'économie avec son casino et ses saisons, le jeu d'icônes, la base de
  membres, les limites de stockage, les serveurs bloqués.
- **Les réglages par serveur** vivent sous `guilds[<guildId>]` et *remplacent* le défaut
  global pour ce serveur. Cinq fonctions seulement sont par serveur : `moderation`,
  `welcome`, `joinToCreate`, `gating`, `logs`. Un serveur sans surcharge suit la valeur
  globale, donc une installation mono-serveur n'a besoin d'aucune config par serveur.

Deux choses se configurent **depuis Discord**, par le propriétaire du serveur ou un
gestionnaire dont le Discord est lié à un compte BetterCommunity : `/config` (la langue du
bot ici, s'il modère, son salon de logs) et `/logs` (où va chaque catégorie de log). Les deux
écrivent via l'API, qui revérifie l'acteur elle-même : le bot n'est cru que sur l'identité de
qui a appuyé, rien de plus. L'exigence de compte lié est voulue : un identifiant Discord seul
n'est personne dont la plateforme ait trace, donc il n'y aurait rien contre quoi écrire une
ligne d'audit.

Les décisions de stockage et de facturation ne sont **pas** exposées dans Discord. Elles
appartiennent au titulaire du compte, sur le site.

---

## 3. Ce que fait chaque fonction

### Liaison de compte et accès par rôle

`/link` délivre un code que le membre échange sur `SITE_URL/profile` pour lier son id Discord
à son compte BetterCommunity. Le **gating** attribue ensuite les rôles : une liste de règles,
chacune avec ses propres exigences (un Discord lié, un compte BCWEB, un creator id BMM) et
son propre rôle. Une ancienne config mono-rôle reste honorée.

Les rôles sont réconciliés dans les deux sens, attribués *et* retirés : à l'arrivée, toutes
les 5 minutes sur chaque serveur, sur `/verify` ou `/refreshroles`, et rapidement après une
connexion Discord sur le site (le tampon de liaison est vidé toutes les 30 secondes). Un rôle
que le bot ne peut pas attribuer (permission manquante, ou rôle situé au-dessus du sien) est
sauté en silence pour ce membre ; le sélecteur de rôles du dashboard rapporte la position
d'un rôle et peut donc prévenir avant.

### Modération, automod et échelle d'avertissements

- `/clear [count]` supprime en masse jusqu'à 100 messages récents (Gérer les messages).
- `/warn <membre> <raison>` et `/warnings <membre>` (Modérer les membres). Le **dossier vit
  sur le site**, pas dans le bot : un avertissement donné ici et un donné depuis l'écran
  admin sont la même ligne. Si le site refuse l'écriture, la réponse dit que l'avertissement
  n'a **pas** été enregistré au lieu de faire semblant.
- **Salons interdits à la publication** : y poster supprime les messages récents de l'auteur
  dans ce salon et l'expulse.
- `/lockdown on|off [minutes]` monte la vérification et exclut temporairement les nouveaux
  arrivants, à la main.

L'**automod** est piloté par les données. Onze règles : spam, mentions en masse, invitations,
liens, mots, majuscules, zalgo, pièces jointes, âge du compte, selfbot, raid. Chacune a ses
propres seuils et une action parmi `log` / `delete` / `warn` / `timeout` / `kick` / `ban` /
`addRole` / `removeRole` (ces deux-là prennent un `roleId` ; `addRole` aussi un `roleMin`, 0 =
jusqu'à ce qu'un modérateur le retire — le retrait minuté vit dans la mémoire du bot, un
redémarrage avant l'échéance laisse le rôle),
plus trois paramètres que toute règle accepte : si le message est supprimé, si le membre est
prévenu en MP, et un interrupteur **observation seule** qui enregistre le déclenchement sans
rien exécuter. Les règles sur les messages prennent aussi leurs propres exemptions de rôles
et de salons, en plus de la liste globale (rôles, salons, membres, et les modérateurs, exempts
par défaut). Quand plusieurs règles se déclenchent en même temps, la plus sévère l'emporte ;
elles ne se cumulent jamais.

L'**échelle d'avertissements** (`warnThresholds`) est partagée par `/warn` et l'automod : des
lignes « à N avertissements, faire X », sur le compte exact, de sorte que l'avertissement qui
franchit un palier agit et que les suivants non. `warnDecayHours` (défaut 168) est la durée
pendant laquelle un avertissement compte.

Une règle sur les messages peut **alimenter cette échelle progressivement** : `countsAsWarn`
(toujours actif pour l'action `warn`), `warnEvery` (N : chaque Nième déclenchement de cette
règle par ce membre enregistre un avertissement, donc 3 = les deux premiers ne coûtent que
l'action de la règle) et `warnWindowMin` (défaut 60 ; durée de mémoire d'un déclenchement).
L'avertissement passe par le même dossier que `/warn` : il n'y a pas de second compteur.
Plusieurs règles sur un même message enregistrent au plus un avertissement. Les infractions en
attente vivent en mémoire : un redémarrage les oublie, jamais les avertissements enregistrés.

Défauts à connaître : automod activé, avec spam, mentions, invitations, zalgo, pièces
jointes, selfbot et raid actifs ; liens, mots, majuscules et âge du compte inactifs.

La modération demandée depuis le site (un ban, une expulsion, une exclusion décidée dans les
écrans admin) est **mise en file** par le site et exécutée ici par un poller, parce que le
site ne peut pas joindre Discord. Le résultat est toujours rapporté, échecs compris : Discord
les refuse constamment pour des raisons qui ne sont la faute de personne, et un admin qui
regarde un bouton passer au vert alors que rien ne s'est produit est exactement ce que cette
file existe pour éviter. Une exclusion plus longue que le plafond Discord de 28 jours est
refusée franchement au lieu d'être rabotée en silence.

### Journalisation

23 catégories en 8 groupes (messages, membres, vocal, automod, modération, serveur, bot,
économie), chacune routée indépendamment vers un **forum** (un post taggé par catégorie, ou
un par jour), un **salon texte**, ou nulle part. Une route se pose par catégorie ou par
groupe ; la catégorie exacte l'emporte sur son groupe, et les deux l'emportent sur le forum
ou le salon par défaut du serveur.

Depuis Discord : `/logs setup` crée le forum avec ses tags, `/logs route` envoie une
catégorie ou un groupe quelque part, `/logs test` poste un exemple là où cette catégorie
atterrit, et `/logs status` liste chaque catégorie avec sa destination (Gérer le serveur).

Une file par destination fusionne les rafales et respecte les limites de débit de Discord.
Les **alertes** admin sont globales et non par serveur, et peuvent aussi aller dans un forum
où chaque genre d'alerte (perf, incident, Ko-fi, paiements, contact, légal, modération,
annonces) devient son propre post taggé.

### Bienvenue et au revoir

Une bannière GIF animée 1200x400 sur le thème sombre BCWEB (avatar et nom du membre sur des
particules qui dérivent) plus un message à variables : `{user}`, `{username}`,
`{servername}`, `{joinnumber}`, `{joindate}`. Six fonds intégrés (dark, midnight, plum,
forest, rose, slate), ou un fond personnalisé **téléversé sur le site** : le bot n'accepte
qu'un chemin média du site, jamais une URL quelconque, parce qu'il tourne dans le réseau
Docker et que « va chercher ce que dit la config » laisserait une config trafiquée atteindre
n'importe quoi dessus. L'encodeur GIF et la bibliothèque canvas sont tous deux optionnels à
l'exécution ; si l'un manque, le message part quand même, sans la bannière.

### Vocal à la demande (join-to-create)

Rejoindre le salon d'accueil configuré crée un salon vocal temporaire personnel dans une
catégorie dédiée et y poste un panneau de contrôle : renommer (12 minutes de délai entre deux),
limite d'utilisateurs, région, verrouiller/déverrouiller, bascule privé, liste blanche,
expulser, bannir/débannir, annuler une expulsion, et un préréglage vocal enregistré. Seul le
propriétaire du salon manœuvre les contrôles ; quand il est parti, n'importe qui encore
présent peut le reprendre.

Le propriétaire est inscrit **dans le salon lui-même**, comme la surcharge de permission qui
accorde Gérer les salons, si bien qu'un balayage au démarrage puis toutes les deux minutes
réadopte les salons créés par un processus précédent et supprime les vides. Une catégorie
créée automatiquement disparaît avec son dernier salon. `limits.maxTempChannels` (défaut 50)
plafonne les salons par serveur.

### Panneaux de rôles en libre-service

Un post de règles, ou un post « choisis tes pings », avec ses rôles attachés en boutons ou en
menu déroulant. Éditer le panneau au dashboard **est** le publier : le bot compare une
empreinte de ce à quoi le panneau devrait ressembler avec ce qu'il a posté la dernière fois,
donc il n'y a pas de bouton Publier à retenir, et une édition qui ne change rien de visible ne
repost rien. Un clic relit la définition du panneau à neuf plutôt que de faire confiance à un
message qui peut avoir des mois.

### Accueil du serveur

Dès que le bot rejoint un serveur, il poste une carte dans le salon système (sinon le premier
salon texte où il peut écrire, sinon un MP au propriétaire) : lier un compte, choisir la
langue du bot pour ce serveur, ouvrir le tableau de bord. `/setup` la reposte.

### Giveaways

Deux sortes. Les giveaways **du staff** se créent au dashboard et peuvent porter une
récompense d'inventaire, ou un **lot économie** (`prizeKind: economy`) : des points dans la
monnaie configurée et/ou de l'XP, versés par le même registre qu'un don du staff (type
`grant`, `ref giveaway:<id>`), donc visibles dans l'historique du membre. Un gagnant non lié
est crédité sur sa ligne fantôme et le reçoit en liant son compte. Le tirage n'est pris
qu'une fois (mise à jour conditionnelle) : un rapport rejoué ne paie ni n'annonce deux fois. Les giveaways **des membres** sont
`/giveaway <lot> <minutes> [gagnants]`, uniquement sur Discord, plafonnés à 5 actifs par
serveur ; le lot est ce que l'organisateur remet lui-même. Le bot poste la carte avec un
bouton Participer, tire au sort à l'échéance, et enregistre participations et gagnants sur le
site. Un giveaway peut exiger un compte lié, ou un compte lié avec un creator id BMM.

### Publier pour le compte du site

Chacun de ces mécanismes est un poller de la même forme : demander à l'API ce qui n'a pas
encore été annoncé, le poster, le marquer fait **côté serveur**, de sorte qu'un redémarrage
ne réannonce jamais rien.

| Quoi | Cadence | Notes |
|---|---|---|
| Articles de blog | 5 min | Plusieurs routes ; chaque route choisit un salon et quels blogs inclure (`*`, une clé de projet, ou `showcase`). Un id de salon est unique au monde, donc une route peut viser n'importe quel serveur où est le bot. La déduplication est par salon. |
| Alertes de perf serveur | 2 min | CPU / RAM / disque / service à terre / erreurs, depuis le moniteur de l'API. **Un message par incident**, modifié à mesure et clos par une courte réponse « résolu » ; les événements d'un même type arrivés ensemble partagent un message. Chacun porte un bouton **Détails** vers `/admin?s=serverperf&alert=<id>`. Un salon général séparé pour les incidents est optionnel. |
| Pourboires Ko-fi | 2 min | Avec le total courant. Copié aussi dans le forum d'alertes admin. |
| Paiements et remboursements Stripe | 2 min | Plusieurs salons pour chacun ; les remboursements retombent sur les salons de paiement. L'e-mail client est masqué et les noms affichés sont dépouillés du markdown Discord. |
| Annonces | 20 s | Événements, promotions, demandes de commission, incidents. Un rôle n'est pingué que si c'est urgent. |
| MP admin | 30 s | Un message, portant éventuellement un code cadeau. Un utilisateur injoignable est abandonné plutôt que retenté sans fin. |
| MP de masse | 30 s | **Cadencé exprès** : 10 par passage, espacés d'une seconde, soit environ 1200 par heure. Discord traite une rafale de MP comme du spam et c'est le bot qui est signalé. La progression est une ligne sur le serveur, donc un redémarrage reprend au lieu de tout renvoyer deux fois. |
| Panneaux de rôles | 60 s | Voir plus haut. |
| Saisons d'économie | 10 min | Le premier passage après un redémarrage amorce le numéro de saison et n'annonce rien. |

### Son statut Discord

Désactivé par défaut (`presence.enabled`). Admin → Bot Discord règle la pastille (`online` /
`idle` / `dnd` / `invisible`), le type d'activité et la ligne, avec `{guilds}` `{members}`
`{status}` `{stripe}`, plus des lignes optionnelles affichées à tour de rôle toutes les
`rotateSec` (30 s minimum). Avec `health`, un incident de la page de statut prend la ligne et
passe la pastille en idle ou dnd ; avec `stripe`, le **statut publié par Stripe lui-même** (lu
par l'API sur `www.stripestatus.com/api/v2/status.json`, en cache 5 minutes, jamais bloquant)
s'affiche dans les mots de Stripe tant qu'il n'est pas opérationnel. La même source décide
désormais la ligne Stripe de la page de statut : elle appelait `/v1/balance` avec notre clé,
ce qui répondait « notre clé marche-t-elle » et virait au rouge sur une clé restreinte ou
renouvelée.

### L'économie

Éteinte par défaut. Messages, réactions et temps en vocal rapportent de l'XP ; l'XP fait
monter de niveau ; les niveaux distribuent des points ; les points achètent des articles et
des mises au casino.

Le bot tamponne l'activité par membre et vide le tampon une fois par minute. Il tamponne
**tout le monde** et laisse l'API décider : seul un membre dont le Discord est lié à un
compte BCWEB est crédité. La carte `/level` d'un membre non lié montre ce qui l'attend plutôt
que de prétendre que rien ne s'accumule.

Défauts, tous modifiables : 5 XP par message, 1 par réaction, 3 par minute de vocal ; la
courbe est 100 XP pour le niveau 1, multipliée par 1,18 à chaque niveau ; 10 points tous les
5 niveaux ; le registre de points est gardé 180 jours (0 = pour toujours) ; dons activés,
minimum 1, pas de plafond quotidien (0 = aucun).

La **boutique** vend des badges, des rôles Discord, des pools de stockage, des boosts, de
l'hébergement offert, des codes promo et des récompenses personnalisées. L'API fait foi sur
chaque achat : elle relit le prix, vérifie le stock et l'exclusivité, débite de façon atomique
et enregistre la ligne. Un code arrive **scellé** : Révéler le crée, ou Offrir remet l'article
non ouvert à quelqu'un d'autre. Un rôle ou une récompense personnalisée reste *en attente*
jusqu'à ce qu'un admin la remette. Un article peut être caché de la boutique Discord tout en
restant sur le site, et inversement.

`/gift` déplace des points entre membres, dans le minimum et le plafond quotidien fixés par
les admins. `/history` liste les derniers mouvements, filtrables par genre. `/leaderboard`
dessine le classement en image rendue par le site, ce serveur ou global, avec ton propre rang.

Les **saisons** remettent les points à zéro selon un calendrier fixé par l'admin (quotidien,
hebdomadaire, mensuel, trimestriel, annuel, ou tous les N jours/semaines/mois, plus
« jamais », qui est le défaut), avec l'XP conservée ou effacée. Tout est en UTC, et l'heure de
la remise à zéro est 04:00 par défaut. Le calendrier vit dans la config du bot ; l'horloge
(numéro de saison, dernière remise, historique) vit dans sa propre ligne de réglage, donc
sauver la config ne peut pas la rembobiner. Une remise à zéro annule les points et écrit une
ligne de registre par détenteur. `/season` montre quelle saison tourne et quand elle finit,
sous forme d'horodatage Discord, si bien que le compte à rebours continue de tourner sur une
carte que le bot ne redessine jamais et que chaque lecteur le voit dans sa propre langue. Une
nouvelle saison est annoncée une fois par serveur, via la route de log `economy.season` s'il y
en a une, sinon le salon d'annonces général du serveur.

### Le casino

Éteint par défaut (`economy.casino.enabled`). Les limites de mise sont par défaut min 1,
max 100 ; **max 0 veut dire pas de plafond**, et la table le dit alors au lieu de raboter un
tapis en silence.

Six jeux se jouent seul, contre la maison : **pile ou face** (2x, 50 %), **dés** (gagne sur
4 à 6, 2x), **machine à sous** (8x pour trois identiques, 1,5x pour deux), **roulette** (roue
européenne : une couleur 2x, le vert 14x, un numéro exact 35x), **roue** (choisis un
multiplicateur : 2x à 45 %, 3x à 24 %, 5x à 16 %, 10x à 9 %, 20x à 4 %, 50x à 2 %),
**plinko** (bas 0,5x-5x, moyen 0,3x-13x, haut 0,2x-50x).

Deux autres n'existent qu'en **tables en direct** que d'autres membres rejoignent depuis la
même carte : **course** (six voitures, choisis la tienne, 6x en solo) et **cagnotte** (chacun
mise ce qu'il veut, un seul rafle tout, chances proportionnelles à la mise, deux joueurs
minimum). Les quatre jeux classiques se jouent aussi en **multi** : un seul tirage partagé
pour toute la table. Chaque table a un code de 6 caractères pris dans un alphabet sans
sosies, une visibilité (publique, ce serveur, ou privée), et des cartes miroir dans chaque
salon d'où un joueur l'a rejointe. Une table inactive ou terminée est balayée au bout de
10 minutes ; une table en cours ne l'est jamais.

**L'avantage de la maison taxe le gain d'une victoire, jamais la mise.** Une case 1x rend la
mise au point près ; une case 0,3x en rend exactement 30 %. C'est un pourcentage global
(défaut 5) avec une surcharge facultative par jeu.

**Une table à deux joueurs ou plus est à somme nulle : la maison n'y prend rien.** Les mises
des perdants forment la cagnotte, chaque gagnant garde sa propre mise et prend une part de la
cagnotte au prorata de sa mise, et la somme versée égale la somme misée au point près. Si
personne ne gagne, chaque siège récupère sa mise. Seul à une table, tu joues la maison comme
d'habitude.

`/casino` sans option ouvre la table interactive : choisis le jeu, la mise et les options du
jeu dans des menus, puis Jouer. Les options de la commande sont des raccourcis vers le même
tirage. Tout le choix voyage dans les identifiants des boutons, donc la table survit à un
redémarrage du bot sans aucun état de session.

**Écart connu.** La bibliothèque de règles de l'API et le dashboard admin portent tous deux
encore un jeu **crash**, et la config par défaut l'active sous `economy.casino.live`. Le bot
n'implémente aucun jeu crash : ni dans le tirage solo, ni dans les tables en direct, et
`/casino` n'offre aucune option crash. L'activer au dashboard n'a aujourd'hui aucun effet
dans Discord.

### La base de membres

Un scan complet du registre au démarrage puis toutes les 30 minutes pousse chaque membre non
bot de chaque serveur (id, pseudo, avatar, date d'arrivée, noms de rôles, surnom) vers le
site, pour que la base de membres admin ne soit pas seulement ceux qui ont parlé. Elle
nécessite l'intent Server Members, et elle est entièrement sautée quand la base de membres est
désactivée.

### Icônes et langues

Le bot ne dessine **aucun emoji unicode**. Chaque glyphe est une des icônes du site,
téléversée une fois comme **emoji d'application** (`bc_<clé>_<version>`), ce qui marche dans
tous les serveurs et en MP. Un admin peut surcharger n'importe quelle clé avec son propre
emoji. Une clé que personne n'a mappée ne dessine rien : le libellé reste seul, jamais un
emoji parasite.

Quatre langues sont livrées : anglais, français, allemand, espagnol. Laquelle une carte
utilise : le choix du serveur si son gestionnaire en a fait un dans `/setup` ou `/config`,
sinon la locale Discord du lecteur, sinon l'anglais. Tout le dictionnaire s'édite depuis
l'écran **Langues** du site ; le bot envoie son dictionnaire anglais au site à son premier
battement de cœur, parce que le bot est le seul endroit où ce dictionnaire existe.

Les cartes postées par un poller (un giveaway, le panneau vocal) n'ont pas de lecteur dont on
connaisse la langue, donc leurs libellés sont en anglais. La carte d'aide qu'un bouton ouvre
est dans la langue de celui qui appuie.

---

## 4. Toutes les commandes

| Commande | Qui | Quoi |
|---|---|---|
| `/link` | tout le monde | Obtenir un code pour lier son Discord à un compte BetterCommunity. |
| `/verify` | tout le monde | Revérifier ses liaisons et mettre à jour ses rôles d'accès. |
| `/refreshroles` | tout le monde | Identique à `/verify`. |
| `/voice` | tout le monde | Le panneau de contrôle de son salon vocal temporaire. |
| `/help [sujet]` | tout le monde | Ce que fait chaque partie du bot. Le même texte que les boutons **En savoir plus**. |
| `/appeal` | tout le monde | Répond même dans un serveur bloqué : la référence du blocage et comment le contester. |
| `/level` | tout le monde | Ton niveau, ton XP et tes points. |
| `/profile [membre]` | tout le monde | Le profil BetterCommunity d'un membre, avec la carte qu'un lien de profil partagé déplie. |
| `/shop` | tout le monde | La boutique de points, 8 articles par page. |
| `/inventory` | tout le monde | Ce que tu as acheté : révéler des codes, offrir des articles. |
| `/gift <membre> <points> [note]` | tout le monde | Donner des points à un autre membre. |
| `/history [genre]` | tout le monde | Tes derniers mouvements de points. |
| `/season` | tout le monde | Combien de temps avant la remise à zéro de la saison. |
| `/leaderboard [portée]` | tout le monde | Les meilleurs membres, ce serveur ou global. |
| `/casino [bet] [game] [bet_on] [number] [target] [risk] [visibility] [join] [lobbies]` | tout le monde | Le casino. Sans option, ouvre la table interactive. |
| `/giveaway <lot> <minutes> [gagnants]` | tout le monde | Lancer un giveaway ici. 5 actifs maximum par serveur. |
| `/clear [count]` | Gérer les messages | Supprimer jusqu'à 100 messages récents. |
| `/warn <membre> <raison>` | Modérer les membres | Avertir un membre. Enregistré sur le site. |
| `/warnings <membre>` | Modérer les membres | Les avertissements d'un membre, les révoqués barrés. |
| `/lockdown <on\|off> [minutes]` | Modérer les membres | Confinement anti-raid à la main. |
| `/config` | gestionnaires du serveur | Le bot sur ce serveur : langue, modération, salon de logs. |
| `/setup` | Gérer le serveur | Reposter la carte d'accueil. |
| `/logs setup\|route\|test\|status` | Gérer le serveur | Où chaque genre d'événement est journalisé. |

Les commandes sont enregistrées globalement à chaque connexion, donc un changement atteint
tous les serveurs où le bot se trouve.

---

## 5. Ce qu'il stocke, et les plafonds

Le bot lui-même ne garde presque rien : son état en mémoire, ce sont les salons vocaux
temporaires, quelques limiteurs, les compteurs de modération et un tampon circulaire de sa
propre sortie console. Tout ce qui est durable est une ligne sur le site.

`limits` dans la config du bot est le budget :

| Clé | Défaut | Quoi |
|---|---|---|
| `maxTempChannels` | 50 | Salons vocaux temporaires par serveur. Lu par le bot. |
| `storageMB` | 200 | Le budget en octets auquel la base de membres est tenue. Une ligne est comptée à environ 512 octets, donc le défaut vaut à peu près 409 000 membres. 0 = pas de plafond. |
| `keepLinked` | true | Un membre au compte site lié n'est jamais évincé : atteindre la limite élague d'abord les lignes non liées. |
| `purgeUnlinks` | true | **Non implémenté.** L'interrupteur est au dashboard et dans les défauts ; aucun code ne le lit. |
| `relinkDays` | 0 | **Non implémenté.** Pareil : le champ est éditable et rien ne le lit. |

`memberStorage` décide de ce que le scan du registre garde : `enabled` (défaut vrai),
`evictInactive` (vrai) et `inactiveDays` (30). « Inactif » veut dire aucun message et aucune
arrivée en vocal dans cette fenêtre ; une ligne qui n'a jamais enregistré ni l'un ni l'autre
compte comme inactive. Quand le plafond est atteint, les lignes inactives non liées sont
évincées, les plus anciennes d'abord, pour faire de la place ; les membres liés sont gardés
tant que `keepLinked` tient. L'API répond `full` dès que le budget est épuisé et le bot cesse
de pousser le reste de ce registre au lieu de le sérialiser pour rien. Un balayage de fond
toutes les 10 minutes ramène la table à 95 % du plafond, et cette passe-là a le droit
d'évincer aussi des lignes non liées actives une fois les inactives épuisées.

`economy.historyDays` (180) est la durée de conservation du registre de points ; 0 le garde
pour toujours. Le balayage tourne une fois par jour.

**Les logs de modération Discord ne sont pas plafonnés.** Les lignes `ModerationLog` ne sont
écrites que pour un serveur dont le propriétaire a activé le stockage des logs, et rien ne les
élague. Dimensionne cette table toi-même. (Admin → Stockage la liste à côté du registre
Discord.)

Le **fond de la bannière de bienvenue** est le seul endroit où une valeur de config devient
une requête sortante, et il est restreint à un chemin média du site par la même expression
régulière des deux côtés.

---

## 6. L'exploiter

- **Battement de cœur, toutes les 60 secondes.** Il porte l'uptime, les compteurs de serveurs
  et d'utilisateurs, le nombre de salons temporaires, le ping de la passerelle, les compteurs
  de modération, les 60 dernières lignes de log, l'id d'application du bot, et pour chaque
  serveur (jusqu'à 200) son nom, son icône, son nombre de membres, son propriétaire, une
  liste au mieux des admins Gérer-le-serveur, jusqu'à 100 rôles attribuables avec leur
  couleur et leur position, et jusqu'à 200 salons. C'est ce qui alimente le sélecteur de
  serveurs du dashboard et ses sélecteurs de rôles et de salons, et c'est pourquoi un
  sélecteur peut prévenir qu'un rôle est au-dessus de celui du bot. Le dashboard considère le
  bot **en ligne** quand le dernier battement a moins de deux minutes.
- **Logs en direct et erreurs.** Chaque gestionnaire d'événement est enveloppé. Une erreur est
  journalisée, envoyée dans la queue du battement de cœur, remontée comme `ErrorEvent` sur le
  site **avec ce qu'elle traitait** (la commande ou le bouton, le serveur, le membre), et
  écrite dans la catégorie de log `bot.errors` de ce serveur. « Invalid Form Body » sans la
  commande qui a construit le formulaire est un message sur lequel personne ne peut agir.
- **Reconnecter** depuis le dashboard démonte proprement le client et le reconstruit, le même
  chemin qu'une rotation de token. Le marqueur est amorcé au premier tick, donc déployer le
  conteneur ne déclenche pas de reconnexion parasite.
- **Bloquer un serveur.** Un admin peut bannir un serveur en mode `leave` (le bot part et
  repart s'il est réinvité) ou `disable` (il reste et toutes les commandes y sont inertes). La
  réponse immédiate est à l'arrivée ; un balayage toutes les 20 secondes est le filet pour un
  bannissement ajouté alors que le bot était déjà là. `/appeal` continue de répondre dans un
  serveur bloqué, parce que retrouver la référence est la seule chose que le modérateur d'un
  serveur bloqué attend du bot.
- **Un nouveau scan des membres** demandé depuis Admin → Base de membres revient dans la
  réponse au battement de cœur et s'exécute tout de suite au lieu d'attendre le cycle de
  30 minutes.
- **Un bouton périmé** (un message plus vieux que le déploiement qui a renommé son
  identifiant) reçoit une ligne « cette carte n'est plus à jour » au lieu de tourner puis
  d'afficher « Cette interaction a échoué », ce qui se lit comme un bot en panne.

### Quand quelque chose cloche

| Symptôme | Où regarder |
|---|---|
| Ne se connecte jamais | Admin → Bot Discord affiche la raison de l'échec. « Privileged intents disabled » et « Invalid bot token » sont remontés tels quels. |
| Se connecte, ne fait rien | L'interrupteur principal `enabled`, et si ce serveur est dans `bannedGuilds`. |
| Un rôle n'est jamais attribué | Les règles de gating, et si le rôle est au-dessus de celui du bot. |
| Les paiements ne sont jamais postés | Admin → Bot Discord → Paiements a un diagnostic clé Stripe / webhook. C'est presque toujours le webhook Stripe qui n'atteint pas l'API. Voir [Déploiement §6](DEPLOY_FR.md). |
| Une catégorie de log ne va nulle part | `/logs status` dit où chacune atterrit en ce moment, et `/logs test` le prouve. |
| 401 sur chaque appel API | `BOT_SHARED_SECRET` ne correspond pas à celui de l'API. |

---

## 7. Notes de sécurité

- Chaque route `/bot/*` est authentifiée par l'en-tête `x-bot-secret`, comparé en temps
  constant. Il n'y a **aucune limite de débit** sur ces routes : le secret partagé est toute
  la porte.
- Une route `/bot/*` est délibérément publique et non authentifiée : `GET /bot/invite`, qui
  renvoie l'URL d'invitation. Un client id n'est pas un secret.
- `PUT /bot/guilds/:id/settings` et `PUT /bot/guilds/:id/features` vérifient l'acteur rapporté
  par le bot contre le propriétaire et la liste des gestionnaires du serveur **et** exigent un
  compte lié, donc un secret de bot compromis ne permet quand même pas de réécrire les
  réglages d'un serveur au nom de n'importe quel membre. `PUT /bot/guilds/:id/language` n'a
  pas ce contrôle d'acteur : le secret partagé suffit à changer la langue du bot sur un
  serveur.
- Les annonces de paiement et de remboursement masquent l'e-mail client et dépouillent les
  noms affichés du markdown Discord avant de poster.

## 8. Non vérifié ici

- Si chaque contrôle du dashboard nommé dans cette page s'affiche bien dans l'interface
  actuelle. Le comportement décrit a été lu dans le bot et dans l'API ; les écrans ont été lus
  séparément et peuvent avoir bougé.
- `BotGuild.memberMode` (`none` / `moderation` / `pool`) et `storageQuotaBytes` existent
  toujours et restent réglables via la route admin des serveurs, mais les chemins d'écriture
  des membres budgétisent contre le seul `limits.storageMB` global. Ce que `memberMode` change
  encore, s'il change quelque chose, n'a pas été établi.
- `apps/bot/README.md` dit encore que le processus s'arrête s'il n'y a pas de token. Le
  Dockerfile et `index.mjs` disent qu'il reste au repos et continue d'interroger l'API, et
  c'est ce qui a été vérifié ici. Ce fichier a été laissé tel quel.
