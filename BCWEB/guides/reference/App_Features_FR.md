# BCWEB — Fonctionnalités

> Un tour fonctionnalité par fonctionnalité de **BetterCommunity Web** côté
> produit/utilisateur. Pour la vue technique voir **Technical_Analysis_FR.md**. Non
> commité — document vivant.

## Comptes & connexion
- Inscription/connexion **email + mot de passe** (argon2id), reset par jeton.
- **Continuer avec GitHub / Discord** (OAuth2) — boutons visibles seulement si configuré.
- **Double authentification (TOTP)** — QR + clé manuelle, 8 codes de récupération à
  usage unique (`.txt` téléchargeable), activation/désactivation en self-service.
  Obligatoire pour tous les niveaux admin.
- **2FA optionnelle à l'inscription** — les nouveaux comptes (y compris via
  GitHub/Discord) se voient proposer une étape de configuration 2FA ; tout compte
  connecté sans 2FA voit une invite dismissible sur le dashboard.
- **Profil** — avatar (généré), bio, changement de mot de passe, section Infos
  personnelles cachée par défaut, liaison des **ids créateur** BMM et **Discord**, lien
  rapide vers les Réglages.
- **Unique BC id** — chaque compte a un id de support stable `BC-XXXX-XXXX`.

- **Fermer ton compte** — planifiée à 30 jours et annulable pendant tout ce mois, depuis un
  lien qui fonctionne déconnecté (celui qui arrête une suppression est souvent sur un
  téléphone où il ne s’est jamais connecté). Le mail emporte toutes tes factures : après, il
  n’y a plus de compte pour aller les chercher. Ce qui se produit au terme est une
  anonymisation, pas une suppression de ligne : factures et dossier de modération survivent,
  tout ce qui est personnel est effacé. Un hachage à sens unique de l’adresse est conservé
  pour que t’inscrire à nouveau avec elle rattache ton historique — y compris un éventuel
  dossier de modération. Une autre adresse repart vraiment de zéro.
- **Transferts de propriété** — passe un dépôt ou un élément de catalogue à quelqu’un par
  e-mail. La personne peut refuser, rien ne bouge avant qu’elle accepte, et l’offre expire en
  14 jours. Un dépôt hébergé avec un abonnement actif est refusé, un dépôt en offre gratuite
  aussi : le gratuit c’est un par compte, donc le céder consommerait un droit que la personne
  n’a jamais demandé.
- **Sondages** — réponds sur `/polls`. Changer d’avis remplace ta réponse au lieu d’être
  refusé, et tu peux la retirer entièrement.

## Parcourir & catalogue
- **Catalogue** d'apps / plugins / thèmes / presets — barre de filtres nette : switcher de
  projet (Tous / BMM / BSM), tri, recherche, pills de type à icônes. Une bande **Catalogues
  communautaires** sous la grille officielle liste les catalogues hébergés par les membres
  (bien séparés visuellement des items officiels de confiance).
- **Pages d'item** avec détails, versions, téléchargements (plusieurs options en dropdown),
  et un lien `catalog.json` copiable (flux consommable par BMM).
- **Wizard de soumission** (`/submit`) — flux pleine page à deux chemins :
  1. **Proposer au catalogue officiel** (gratuit, modéré) : dépose un `.bmmplug`, un `.json`
     de thème/preset, ou un `catalog.json` entier → **analyse automatique** qui préremplit
     le formulaire ; un fichier catalogue bascule en **mode masse** (une proposition par
     entrée). Un panneau « Avancé » garde l'éditeur JSON brut. Envois jusqu'à 100 Mo ; les
     fichiers plus gros passent par la page contact. PoW + toast d'annulation + modération
     conservés.
  2. **Héberger ton propre catalogue** : **raw** (dépose ton `catalog.json`, téléchargements
     self-hosted — gratuit) ou **managed** (items + fichiers chez nous, puisés dans un pool).
- **Catalogues communautaires** — tu héberges ton propre catalogue d'apps/plugins/thèmes.
  Public ou **privé** (sur invitation) : un catalogue privé n'est jamais listé et son flux +
  téléchargements sont protégés par une liste d'accès — **IP, creator id, BC id, e-mail ou
  Discord** (même modèle que les Server-Repos), plus des **bans** sur 3 couches (site +
  owner + catalogue). Chaque catalogue a une page `/c/:slug` avec des deep-links **« Ajouter
  à BMM »** par type + une URL de flux copiable. Les admins les modèrent (suspendre /
  délister) dans l'onglet *Catalogues communautaires*.
- **Item privé par défaut** (comme les Server-Repos) : un item n'apparaît dans le catalogue
  public + le flux `catalog.json` qu'une fois validé par un admin. Avant ça il reste
  **privé** mais accessible via son **lien de partage** (`?k=…`) ; ce lien marche aussi
  une fois public. **Suspendre** (admin) est plus fort qu'un rejet : l'owner ne peut plus
  resoumettre (rejet → il corrige et resoumet ; suspension → contacter le support).

## Hébergement (pools de stockage)
- **Achète de l'espace, utilise-le librement** — un achat provisionne un **pool de
  stockage** (pas un repo fixe). Remplis-le comme tu veux : un repo, plusieurs repos, des
  catalogues, ou un mélange — repos et catalogues partagent les mêmes octets du pool, et
  libérer l'un rend la place à l'autre. Un pool fraîchement acheté et vide apparaît dans
  *Mes Repos* comme une carte actionnable (« Ajouter un dépôt » / « Ajouter un catalogue »).
  Plans (5/10/25/50 Go + custom) et un free-tier à 0 $.
- **La carte d’offre se lit d’un coup d’œil** — chaque offre payante liste ce qu’elle donne
  dans une seule colonne : le stockage, la bande passante, les boosts inclus (avec une ligne
  qui dit ce que fait un boost), le domaine personnalisé, et l’état de l’offre gratuite. L’offre
  recommandée passe devant les autres au lieu d’être seulement teintée. Le paiement et le terme
  prépayé flexible ne changent pas.
- **Les deux offres les plus chères incluent des boosts** — un boost est le crédit *à la une*
  déjà en place : il met un dépôt ou un catalogue en tête de la liste publique pendant
  quelques jours. Le nombre, la période et les jours se règlent par offre dans Admin →
  Hébergement → Offres, et le sweeper les accorde une fois par période (idempotent — un
  index unique, pas une vérification, donc deux sweepers simultanés n’en accordent qu’un
  jeu). À dépenser depuis *Mes boosts*.
- **La facturation est rattachée au pool** — la souscription (terme prépayé ou auto-renew)
  est sur le pool ; un achat peut donc contenir des repos, des catalogues, ou rien encore.
  À l'expiration, tout le pool (ses repos **et** catalogues) est suspendu avec la grâce de
  suppression habituelle de 72h ; le renouvellement (auto ou manuel) restaure tout.
- **Gestion des pools** — les pools sont **repliables** et chacun prend sa propre **couleur**
  dans le dashboard. **Fusionne** plusieurs pools en un (multi-sélection → fusionner, avec un
  undo de 6 s ; repos, catalogues **et** abonnements suivent ensemble) ; les admins peuvent
  **défusionner** un pool. Un pool fusionné portant plusieurs abos récurrents payants affiche
  un **devis d'économies de consolidation** et peut les consolider en un seul plan plus grand
  via Stripe (remise réglable par l'admin ; seuls les abos récurrents, donc un terme prépayé
  n'est jamais perdu).
- **Partager un repo non listé** — chaque repo a une page publique `/r/<id>` avec un deeplink
  « Ouvrir dans BMM » ; un repo *non listé* peut quand même être partagé via un lien généré
  par l'owner `/r/<id>?k=<clé>` (comme les liens `?k=` des catalogues privés).
- **Héberger un repo** (payant ou free-tier), **auto-publication** par l'owner, URL auto.
- **Niveaux de confiance** — badges Communauté / Partenaire / Officiel (officiel + partenaire
  remontent en tête de la liste publique) ; filtrables sur /repos et dans la liste admin.
- **Suspendu = totalement figé** — un repo suspendu est en lecture seule partout : aucun
  ajout/suppression de fichier, ni publication, ni changement de réglages/accès/état
  (client + serveur). Le dashboard reste consultable ; contacter le support pour lever.
- **Dashboard par repo** — gestionnaire de fichiers, téléchargement groupé en zip,
  graphe de trafic/usage, backup/rollback façon git, favoris (étoile + compteur visible
  par l'owner), contrôle d'accès (owner / email / mot de passe), et un **BC id**
  d'élément par repo (`BCR-…`).
- **Flux publics** — index agrégé `/repos.json`, `repo.json` par repo.
- **Free tier** — 1 repo gratuit + 1 item catalogue gratuit par compte & par id créateur
  (survit au unlink/relink), avec affichage en unités MB/GB et plafonds optionnels.

## Communauté & contenu
- **Blogs** — "Latest news" de la home (la plus récente d'abord, puis cascade) + blogs
  par projet, attributions de droits de blog granulaires.
- **Projets** — pages projet riches (BMM/BSM/BetterInstaller) avec onglets,
  téléchargements, notes de version, communauté, légal.
- **Other projects** — les admins mettent en avant N'IMPORTE quel projet avec le même
  style de page, sans code (géré depuis le dashboard admin) ; chacun obtient
  `/project/<slug>` + une carte.
- **Demandes de listing** — les gens hors de l'équipe peuvent demander que leur projet
  figure dans la grille, gratuitement ou en payant, chaque porte s'ouvrant séparément
  (les deux fermées par défaut). Payer achète une place dans la file de revue et rien
  d'autre ; approuver crée la page non publiée et non listée.
  → [OTHER_PROJECTS_GUIDE_FR.md](OTHER_PROJECTS_GUIDE_FR.md)
- **Outils développeur** (`/dev/tools`) — inspecter un fichier BMM (le même inspecteur
  que la modération, sur un endpoint développeur) et vérifier un `.bmmscript` avant de le
  publier. L'inspecteur lit dix types de documents BMM **par leur forme**, jamais par ce que le
  fichier prétend être — dont un manifeste de Server-Repo et un manifeste de plugin, les deux
  qu'un relecteur a le plus de chances d'avoir sous la main. Table complète →
  [API_Reference_FR.md](API_Reference_FR.md) §34. Le vérificateur contrôle la **forme** (accolades déséquilibrées) et les **noms**
  face au vocabulaire que BMM publie — volontairement pas un second compilateur, puisque
  BMM n'en a qu'un, en Rust, et qu'une copie ici serait fausse dès le jour de son
  écriture.
- **Annonces de projet** — teaser à compte à rebours avant lancement, épinglage en
  topbar, bascule auto vers la vraie page à l'heure de révélation ; barrière de
  visibilité par page.
- **Mises à jour planifiées** — préparer du contenu de projet pour publication à une
  date/heure future (paresseux, sans cron), annulable.
- **Documents légaux optionnels** — un document livré avec l’application mais qui n’est pas vrai de chaque déploiement (aujourd’hui l’Accord de traitement des données) reste DÉSACTIVÉ tant qu’Admin → Légal ne l’a pas publié. Désactivé, sa page répond « ne fait pas partie des conditions de ce site », l’API ne sert pas son texte, il est absent du menu et de l’index, le renvoi de la politique de confidentialité disparaît, et aucun compte n’est invité à l’accepter.
- **Équipes : liens et places** — un propriétaire ou admin crée des liens d’invitation que toute personne connectée peut ouvrir pour rejoindre avec le rôle choisi. Une équipe garde au plus **un lien permanent** (il n’expire jamais, on le copie une fois, on le supprime et on le recrée quand on veut) et un nombre configurable de liens **temporaires**, chacun avec sa durée, le temps restant affiché et son bouton Supprimer ; le serveur refuse un second lien permanent et toute durée que l’admin ne propose pas. Les deux plafonds sont dans Réglages d’hébergement → Tarifs, à côté de la limite d’équipes (`teams.inviteMaxTemporary`, `teams.inviteLifetimeDays`). Un compte possède jusqu’à la limite d’équipes fixée par l’admin, et une de plus est un paiement Stripe unique pour une place définitive.
- **Fichiers qui expirent** — un seul mécanisme (`/f/<jeton>`) pour les livraisons Make Your Own (30 jours après la livraison ou 7 après le premier téléchargement ; le premier téléchargement est la preuve, écrite dans la conversation ; les archives ne gardent aucune pièce jointe), les pièces jointes des mails (liens datés, ou jointes quand petites) et tout fichier remis pour un temps. Mail : le compositeur garde les modèles de l’admin et la galerie permet de modifier un texte intégré sur place au lieu de le réécrire ; le logo d’en-tête est sur une plaque blanche.
- **Recherche admin** — la boîte de la barre latérale trouve les écrans par libellé, synonyme (FR/EN), préfixe sans accents ou faute d’une lettre, classés d’après le texte du guide admin, et dessous les données elles-mêmes (comptes, dépôts, catalogues, équipes, conversations, signalements, sanctions, commandes, articles, docs, FAQ, sondages, codes) via `/admin/search`.
- **Images ressemblantes** — chaque image envoyée (et les images dans les archives envoyées, et les avatars liés) reçoit une empreinte perceptuelle ; une image à quelques bits de celle d’un autre compte, ou identique octet pour octet, arrive dans Admin → Modération → Images ressemblantes, les deux côte à côte, à effacer ou traiter.
- **Bot Discord** — accès multi-rôles avec exigences par rôle + `/refreshroles`,
  annonces de tips Ko-fi, alertes server-perf, modération, bienvenue, join-to-create
  vocal, annonces de blog. Le `/casino` a des **tables en direct** (une course à six voitures
  avec la voiture choisie dans un menu — une simulation Paddock-Manager accélérée : l’admin choisit le circuit (intégré, généré à chaque course, ou importé en JSON), les tours, les couleurs des voitures, machines égales ou grille réaliste, incidents et arrêts au stand, sous Bot Discord → Économie → Casino → Course — une cagnotte pondérée par la mise, et un tirage partagé de
  n’importe quel jeu solo) que d’autres membres rejoignent depuis le même message ; à deux ou
  plus, la table se règle **entre les joueurs** — les mises des perdants forment la cagnotte,
  répartie par mise × multiplicateur, avantage pris sur la part seulement — et l’admin fixe
  l’**avantage maison par jeu** et une mise max où **0 = pas de plafond** (le tapis est alors
  vraiment tout). L’économie a des **saisons** — les points repartent à zéro selon un calendrier (du quotidien à l’annuel ou tous les N jours, en UTC, XP conservée ou effacée, annoncé par le bot) ou à la main — et une carte de **statistiques** : générés / gagnés / perdus / donnés / dépensés pour aujourd’hui vs hier, cette semaine vs la dernière, ce mois vs le dernier, avec un graphique quotidien par flux. Chaque message est un embed. Les réglages par serveur s'éditent
  sous un sélecteur qui montre dans quels serveurs le bot se trouve, et la navigation par
  sections marche sur téléphone. Un admin peut **bloquer un serveur** — le bot le quitte et
  n'y revient jamais, ou y reste mais toutes ses commandes sont inertes — et une commande
  `/appeal` (qui répond même dans un serveur bloqué) renvoie la référence du blocage plus un
  lien vers la page de contact. Les bannières de bienvenue/au revoir acceptent un **fond
  personnalisé** envoyé sur place, conservé comme image hébergée sur le site (modérable).
  **Automod** — onze règles pilotées par les données (spam, mentions de masse, invitations,
  liens, mots, majuscules, zalgo, pièces jointes, âge du compte, selfbot, raid). Chaque règle
  se lit en deux phrases : ce qu'elle attrape, avec ses nombres comme champs à remplir
  (« plus de 6 messages en 5 secondes »), et ce qu'elle fait ensuite. Au-delà de l'action
  (journaliser / supprimer / avertir / exclusion temporaire / expulser / bannir, quarantaine
  pour l'âge du compte), chaque règle porte ses **paramètres** : la durée de l'exclusion, si
  le message est supprimé, si le membre est prévenu en MP, et un mode **observation** qui
  enregistre le déclenchement sans rien appliquer — plus ses **propres exemptions** (rôles,
  salons) en plus de la liste globale (rôles, salons, membres, modérateurs). Une règle
  enregistrée avant ces paramètres se comporte exactement comme avant.
  L'**échelle des avertissements** s'édite depuis les deux tableaux de bord : des lignes
  « à N avertissements, faire X » qu'on ajoute et retire librement, triées par nombre, avec une
  durée quand l'action en prend une, et la péremption (combien de temps un avertissement
  compte) à côté. Seul le palier dont le membre vient d'atteindre le nombre se déclenche,
  jamais ceux d'en dessous et jamais deux fois.
  **Routage des logs** : un forum (un post étiqueté par catégorie ou par jour) ou un salon
  texte, avec une route par groupe et par catégorie (23 catégories en 8 groupes). Chaque ligne
  nomme la **destination où elle mène en ce moment**, en toutes lettres — « va dans #mod-log »,
  « va dans le forum des logs, étiquette Serveur », « nulle part » — si bien qu'une route
  héritée montre l'endroit où elle finit plutôt que le mot « défaut », et chaque catégorie a
  un **bouton de test** qui publie une entrée d'exemple et dit où elle est partie. Les rôles,
  salons et membres se choisissent dans des listes cherchables alimentées par le heartbeat du
  bot (la couleur d'un rôle, le `#` d'un salon, forum distingué du texte), la saisie d'id brut
  restant le repli quand le bot n'a rien rapporté.
  Les deux s'éditent depuis le tableau de bord du propriétaire du serveur (sections Automod /
  Logs) et depuis l'onglet bot de l'admin sous le sélecteur de serveur, où une bulle **Défauts
  globaux** règle ce que suit tout serveur sans config propre ; le module Alertes de l'admin
  peut aussi nommer un **forum des alertes** pour que chaque type d'alerte admin devienne un
  post étiqueté.
- **Community Charity** — chaque mois une part des revenus éligibles va à une association
  choisie par la communauté, payée manuellement. C'est un **interrupteur** admin (Admin →
  Ko-fi & financement → Cagnotte solidaire) : éteint, `/charity` dit que le programme ne tourne
  pas, la palette de commandes cache l'entrée, le sitemap l'omet et chaque route publique de
  la cagnotte (`/charity/current`, `/charity/contribute`, `/v1/charity`) répond 404
  `charity_disabled`. Le vote du mois se choisit dans la liste des
  sondages plutôt qu'en collant un id, et un don crédite la cagnotte **net des frais de carte**
  (le montant exact des frais lu depuis Stripe) ; le donateur voit les frais et est prévenu que
  les dons sont définitifs avant de payer.
- **Ko-fi** — un widget d'objectif de financement épinglé en bas de la home, discount
  d'hébergement de 25% lié aux dons.

## Back-office admin
- **File de modération** — recherche / filtre (dont par statut : en attente / rejeté /
  suspendu / publié) / tag / commentaire ; approuver, rejeter (l'owner corrige et
  resoumet) ou **suspendre** (l'owner ne peut plus resoumettre).
- **Utilisateurs** — recherche par id / nom / email / id créateur / Discord /
  **Unique BC id** ; le modal utilisateur montre le BC id + l'id d'élément de chaque
  repo/item, les rôles, les liens, les paiements.
- **Modération de compte** — **suspendre ou bannir** un compte (temporaire avec compte à
  rebours, ou permanent), avec une raison affichée à la connexion, envoyée par e-mail et
  en notification ; le compte est déconnecté sous ~15s et bloqué à la reconnexion jusqu'à
  la levée (permanent → contacter le support). Staff/soi-même protégés.
- **Rôles & accès** (SUPERADMIN) — réassigner les rôles ; politique whitelist/ban
  globale ; accorder la permission server-control. Des **capacités granulaires** permettent
  d'accorder à un MOD/USER une seule zone admin (`manage_users` / `manage_repos` /
  `manage_analytics` / `manage_newsletter` / `manage_faq` / `manage_catalogs`) — le
  dashboard n'affiche alors que ses sections et l'API vérifie chaque action ; les grants
  prennent effet sans reconnexion et une permission manquante s'affiche en toast explicite.
- **Guide admin** — une référence bilingue et cherchable **dans le tableau de bord** qui
  explique chaque écran admin, groupée comme la barre latérale (ce qu'il fait, qui en voit le
  résultat, et les pièges à connaître). Visible par tout membre du staff.
- **Langues & traduction** — un éditeur de Langues modifie **chaque texte de l'interface en
  direct** : l'anglais et le français intégrés comme couche de surcharge (vide un champ pour
  revenir au texte livré), plus toute langue ajoutée — y compris **de droite à gauche**, qui
  définissent leur sens de lecture sur la page. Trois **capacités de traducteur**
  (`translate_site`, `translate_blog`, `translate_docs`) permettent de traduire sans donner
  l'admin, et l'onglet Langues s'affiche pour qui détient `translate_site`. Enregistrer applique
  pour tout le monde en une minute (les textes publics sont mis en cache). Cela a remplacé
  l'ancien éditeur de texte limité à la page d'accueil, qui est désormais la **mise en page**.
- **Permissions en ligne** — un SUPERADMIN définit le niveau de rôle d'un utilisateur et active
  ses lots de capacités directement depuis la fiche utilisateur, qui replie aussi ses sections
  lourdes (appareils, facturation, contenu, actions) derrière un « Afficher plus ».
- **Catalogues communautaires** (cap `manage_catalogs`) — modérer les catalogues hébergés
  par les membres : recherche, **suspendre** (masqué à tous), **délister** (retiré du
  navigateur public, l'URL marche encore), et l'inverse.
- **Repos & hosting** — server repos (expiration, statut de paiement, annulation),
  hébergement gratuit, codes promo (discount / hébergement gratuit / boost gratuit),
  stockage (tous les consommateurs).
- **Contenu** — catalogues, config projets, other projects, **avis** (témoignages
  d'accueil gérés par l'admin : texte EN + FR, note, bascule par avis + section entière),
  **events** (Nouvel An / fête nationale / custom : **aperçu** des feux d'artifice à la
  demande, **quantité + taille + taux d'apparition du drapeau** configurables, feux calmes
  cantonnés au ciel, badge fête nationale avec le drapeau du pays et un lien cliquable au
  choix ; désactivables par l'utilisateur dans les Réglages), annonces (bannière site +
  notifications typées, limite de taille de corps, icônes par type).
- **Constructeur de pages** — bâtir une page publique à partir de blocs, et modifier
  celles que le site fournit déjà. Il s'ouvre sur la page **telle que la voient les
  visiteurs**, avec une couche d'édition par-dessus : une modification se juge donc contre
  la vraie chose, pas contre un croquis.
  - *Mise en page* : section, ligne, colonne, et une **grille de cartes** dont les cartes
    contiennent d'autres blocs — une carte n'est donc pas un couple titre-résumé auquel
    on visse un troisième champ plus tard. Chaque carte prend une image ou un fond de
    couleur, une icône, un lien, et n'importe quel contenu à l'intérieur.
  - *Contenu* : titre, **texte (tout le markdown personnalisé BCWEB — chaque directive,
    pas un sous-ensemble)**, boutons (plein ou contour, trois tailles — les deux mêmes classes que
    rend la directive markdown `:button`, une page et une page de docs ne peuvent donc pas
    diverger), image, espace, **séparateur** (trait, tirets, points, dégradé ou simple
    espace, avec libellé si tu veux) et un **chiffre**
    qui lit l'un des onze nombres du site en direct.
  - *Dynamique* : les sections de la page d'accueil elles-mêmes — vitrine, produits,
    actualités, sondage, avis, Make-Your-Own, outils dev — chacune avec des **styles**,
    parce que les mêmes actualités ne sont pas la même section en haut d'une page et en bas.
  - `{{members}}`, `{{downloads}}` et les autres sont remplacés dans n'importe quel texte.
    La liste est une liste blanche, pas un chemin dans la base. Un nom inconnu ne rend rien
    dans du texte et affiche — dans une tuile de chiffre : jamais `0`, qui serait une mesure
    plutôt qu'une absence.
  - **Pleine largeur** replie la palette et les propriétés : la page est jugée à la largeur
    qu'elle aura vraiment, pas dans la colonne qui reste à l'intérieur d'un tableau de bord.
  - **À** rend la page à une vraie largeur d'écran — 1440, 1280, 1024, 768 ou 390 — et
    met le cadre à l'échelle pour qu'il tienne, en affichant le pourcentage. Mis à l'échelle,
    pas rétréci : l'élément garde sa vraie largeur, donc chaque media query répond comme
    elle répondra sur cet écran. Rétrécir l'élément aurait continué de répondre pour la
    fenêtre — la seule chose qu'un aperçu responsive ne doit pas faire.
  - Les presets **Partir de** reconstruisent les vraies pages d'accueil en blocs — mêmes
    sections, même ordre, mêmes formulations. Ils portent exactement les noms et les
    descriptions de l'éditeur de page d'accueil, depuis une liste partagée, et celui avec
    lequel le site ouvre est marqué **en ligne** : une page d'accueil se choisit sur sa
    description, et deux écrans qui décrivent les trois mêmes pages différemment, c'est
    l'un des deux qui a tort. Deux vérifications tiennent tout ça — l'une à la liste de
    variantes dont la page publique est rendue, l'autre aux noms — donc un preset ne peut
    ni devenir une autre page ni gagner un second nom.
  - L'orbe du site est un **réglage de page**, pas un bloc — il est monté une seule fois
    derrière tout, et un bloc qui le « contiendrait » ferait un second orbe devant le premier.
- **Projets officiels** — ajouter et modifier depuis le dashboard les projets dont le site
  parle. Les clés intégrées existent toujours ; les nouvelles sont des lignes ordinaires,
  donc un projet n'a plus besoin d'une migration pour naître.
- **Export du contenu** (Advanced server management) — docs, blog, FAQ, versions des pages
  légales, réglages du site, avis et fiches de comptes, en un fichier JSON par section dans
  un zip, avec le nombre de lignes de chacune affiché avant de choisir. Les comptes ne sont
  que des fiches — aucun hash de mot de passe, aucun secret 2FA, aucun token. Catalogues et
  dépôts sont désactivés par défaut, leurs lignes pointant vers des fichiers que le zip ne
  transporte pas. Six des neuf sections **s’importent** aussi — docs, blog, FAQ, versions légales, réglages et
  avis/sondages ; comptes, catalogues et dépôts sont en export seul et marqués ainsi sur la
  ligne. Un import remplace les entrées de même id et laisse tranquille ce dont le zip n’a
  jamais entendu parler, et ce que disait le site avant est d’abord commité dans un historique
  git — l’Annuler du toast et la liste de rollback sont donc le même acte. Toujours pas un
  point de reprise après sinistre ; voir
  **[BACKUP_FR.md](../run/BACKUP_FR.md)** pour savoir laquelle des trois « sauvegardes »
  répond à quelle question.
- **Téléchargement du kit markdown** (`/dev/markdown`) — prendre le moteur de rendu
  lui-même. Coche les parties voulues — les 384 raccourcis emoji, les logos de marque
  inline, les deux blocs qui réclament un composant à toi (`:::roadmap`, `:::replay`) — et
  le zip est fabriqué avec le reste découpé à des régions marquées, la liste des fichiers et
  la taille annoncées d'abord. Une partie qui ne se découpe pas proprement refuse de
  s'emballer plutôt que de livrer un fichier avec un import dans le vide.
  **JavaScript ou TypeScript**, au choix avant le téléchargement : la version TS embarque
  les déclarations de types et un `tsconfig.json`, la version JS retire la section types de
  son README plutôt que de laisser des instructions pour des fichiers qu'elle n'a pas
  envoyés.
- **Serveur** — dashboard perf en direct (totaux CPU/RAM/disque/uptime + valeurs au
  survol + alertes Discord), et les **chiffres quotidiens** (CPU, mémoire, disque, latence
  par jour) qui formaient le bloc « Métriques système » de la page de statut publique —
  désormais réservés à l'admin, chaque graphique comparé à la période de même durée juste
  avant (delta % par métrique, la hausse colorée comme une dégradation) ; le `/status`
  public ne les porte plus. Advanced server management (DB viewer avec journal
  d'audit, gestionnaire de fichiers, Docker, redémarrage/power) derrière un droit
  server-control + step-up 2FA.
- **Journal de sécurité** — tentatives de connexion, IPs connectées, actions admin ;
  les lectures du DB viewer sont journalisées et les tables d'audit protégées.
- **Bot & analytics**, **Réglages** (leviers de prix, plafonds d'hébergement, limites
  free-tier).
- **Sondages** (`manage_polls`) — pose une question, choisis qui peut répondre (membres
  seulement, une voix chacun et c’est exact ; ou tout le monde, dédoublonné par une
  empreinte d’appareil propre au sondage) et quand le décompte devient visible (après avoir
  répondu par défaut — un total affiché avant oriente la réponse). Les options se figent dès
  qu’une réponse existe : les modifier après laisse un décompte qui tombe juste et ne veut
  plus rien dire. Chaque résultat est reporté séparé connectés / anonymes, et la part
  anonyme est présentée comme une estimation : deux personnes derrière une même box comptent
  pour une, une personne sur deux appareils compte double.
- **API publique** (`manage_api`) — à quoi sert chaque clé. Deux jeux de données tenus à
  part volontairement : un COMPTEUR quotidien d’appels et d’erreurs, exact et conservé, et
  un ÉCHANTILLON de courte durée d’appels individuels pour expliquer un incident. La liste
  d’appels le dit en tête, là où l’on se mettrait sinon à compter les lignes. Révoquer une
  clé prévient son propriétaire : une clé qui meurt sans explication, c’est un ticket de
  support qui part d’une fausse piste.
- **SSO — Personnes** — à côté du registre des applications, qui a réellement autorisé quoi :
  la personne, l’application, le nombre de sessions actives, et un bouton pour couper.
  Couper révoque les jetons dans le même geste (retirer le consentement seul laisse
  l’application fonctionner jusqu’à leur expiration) et prévient la personne, pour que la
  redemande d’autorisation ne passe pas pour un bug de cette application. Les deux moitiés du
  mot « SSO » sont étiquetées et jamais fondues : se connecter ICI avec GitHub, contre se
  connecter à une application externe avec ce compte.
- **Fermeture de compte, côté équipe** — la fiche utilisateur s’ouvre sur l’état de
  fermeture, parce qu’une fermeture en cours change le sens de toutes les autres actions de
  cet écran. L’équipe peut en planifier une avec un motif obligatoire ; la personne reçoit le
  motif, la date et un lien pour nous contacter — pas un bouton d’annulation, car une
  fermeture décidée par l’équipe ne s’annule pas de son côté.
- **Paiements en attente** (Hébergement & facturation) — chaque checkout Stripe est inscrit
  dans un registre à l'ouverture et terminé par le webhook. L'onglet liste ceux encore
  ouverts (avec leur âge) et ceux terminés récemment ; **Réconcilier maintenant** demande à
  Stripe ce qu'il est advenu de chaque checkout de plus de 15 minutes et livre ce qui a été
  payé (**Inclure les récents** fait pareil pour ceux ouverts il y a quelques secondes, quand
  on sait que le webhook était en panne). La même réconciliation tourne au démarrage et toutes
  les dix minutes toute seule ; un paiement pris et non livré atterrit aussi sur la page
  Erreurs et notifie les super-admins.
- **Assistant produit de la marketplace** — Nouveau / Modifier un produit est un assistant en
  quatre étapes (Base → Fichiers & livraison → Prix → Aperçu & publication). Chaque étape se
  valide sur Suivant avec l'erreur sous le champ ; les étapes visitées sont cliquables, les
  autres non ; chaque frappe est gardée dans la session de l'onglet, donc un clic à côté du
  modal ne perd rien (**Enregistrer le brouillon** le garde explicitement, et une réouverture
  dit « reprise où tu en étais » avec une option Abandonner). Rien ne part vers l'API avant
  Publier à la dernière étape.
- **Page de retour de l'acheteur** — après un paiement marketplace, le dashboard affiche
  « Confirmation de ton paiement » et interroge une route de statut en lecture seule jusqu'à
  ce que le webhook ait livré, puis montre la clé / le contenu / le lien sur place. L'URL de
  retour elle-même n'accorde rien.

## Aspect & ressenti
- **Orbe héro Three.js** — se construit à partir de ses éclats à l'intro, spirale au
  scroll (voyage proportionnel à la longueur de page), particules en orbite,
  survol/clic éclate & recompose, plongée de transition de page optionnelle (off par
  défaut).
- **Apparitions progressives au scroll** sur toute la home (robustes au scroll rapide).
- **Thèmes** (clair/sombre), réglage **surfaces translucides** (cartes + modals, %),
  **bascule d'intro**, **langue / thème par défaut**, choix cookies/vie privée — tout
  dans les **Réglages**.
- **i18n** EN/FR partout ; le sélecteur de langue est une bascule à 2 langues et un
  dropdown automatique au-delà, plus un sélecteur dans le footer (desktop + mobile).
- **Thème du site** (SUPERADMIN) — un dégradé d'accent, des couleurs de page par mode, un
  catalogue de tokens complet et un éditeur de géométrie des halos, un aperçu composé en direct
  — et **export/import** d'un thème entier en fichier JSON.
- **Barre du bas mobile** — la barre d'onglets du téléphone est configurable : **icônes seules
  / texte seul / les deux**, et un jeu personnalisé jusqu'à cinq boutons (icône, nom FR/EN,
  chemin) qui remplace le jeu auto-dérivé.
- **Squelettes de chargement** — les pages en liste/grille (dépôts, catalogue, blog, tableau de
  bord) affichent des cartes fantômes de la forme du contenu pendant le chargement, au lieu
  d'un spinner centré.
- **Pages projet** — l'aperçu porte des **mises en avant** (updates, vidéos, directs et annonces
  — embed YouTube/Twitch/mp4) et un **compteur en tête** optionnel, au-dessus du média et du
  suivi d'avancement ; l'onglet Activité montre les **avatars** des contributeurs et un
  calendrier de commits **cliquable pour le détail d'un jour**, et les notes de chronologie
  s'affichent en Markdown. Les pages personnalisées d’un projet se dessinent dans le
  **studio** : des blocs placés à la main sur une planche de 1200 px (texte, image, boîte,
  vidéo, embed, replay, **bouton** — simple, carte ou menu déroulant, avec actions lien /
  copie / défilement / téléchargement / API), une **planche téléphone** (390 px) séparée à côté
  des variantes claire et sombre, des **animations** par bloc (fondu, montée, glissement,
  zoom, pulsation, flottement, keyframes libres ; à l’apparition, au chargement, après un
  délai, au survol ; en boucle ou non), un panneau **Calques** (nom, verrou, masquage,
  ordre), rotation, ombre, effets au survol, lien sur tout le bloc, alignement du texte, pas
  de grille au choix et des presets pour démarrer ; des **formes** (douze, en SVG inline avec remplissage / dégradé / contour / libellé), du **SVG collé** passé par un assainisseur à liste blanche, douze **motifs** répétés, une **feuille de style de page** confinée à la page (url() externes, @import et expression() refusés et signalés), des classes et un style en ligne par bloc, l’**éditeur B.MD** complet pour les blocs texte, copier / coller, zoom, et l’import de fichiers `.css` / `.svg`.
  Le studio est **une page à part entière** en `/studio/<project|showcase>/<id>/<index>`
  (ouverte par « Ouvrir le studio » dans les réglages de la page ; l’adresse sans index liste
  les planches de cette page) : une barre haute (retour, nom du document, état
  d’enregistrement, annuler / rétablir, le sélecteur planche claire / sombre / téléphone, les
  aperçus, Enregistrer), un volet gauche (palette de **Blocs**, **Calques**, **Composants**),
  la planche, et un volet droit (propriétés). À partir de 1024 px les trois sont côte à côte ;
  en dessous, la planche prend toute la largeur et les deux volets deviennent des feuilles en
  bas, choisies dans une rangée d’onglets Blocs · Planche · Propriétés. Les modifications
  restent en **brouillon dans l’onglet** jusqu’à Enregistrer (qui écrit toute la config de la
  page par la même route que le formulaire des réglages), et quitter avec des changements non
  enregistrés demande d’abord. L’**aperçu** rend la planche avec le moteur public dans un
  cadre ordinateur, tablette (820 px) ou téléphone (390 px, empilé), rejoue les animations
  d’entrée à la demande, et peut montrer la **page projet entière** avec le brouillon dans son
  onglet. **Composants** : sélectionner des blocs, « Enregistrer comme composant » (nom +
  vignette), et l’onglet Composants les liste par compte ; insérer place une copie liée,
  **Détacher** la délie, **Mettre à jour toutes les copies** reconstruit chaque copie de la page
  depuis la définition enregistrée, **Redéfinir depuis la sélection** remplace la définition.
  Clavier : Suppr, Ctrl+Z / Ctrl+Y, Ctrl+D dupliquer, Ctrl+A, Ctrl+C / V, Ctrl+S enregistrer,
  flèches pour décaler d’un pas de grille et Maj+flèches de dix ; plus guides d’alignement et
  aimantation, sélection multiple au lasso, ordre de superposition, verrou / masquage, grille
  affichable et zoom (ajuster / 100 % / + / -).
- **Équipes & contact** — une équipe (une adresse de contact, des rôles, des invitations par
  BC id / e-mail / pseudo, une page publique en `/t/<slug>`) gère les dépôts, catalogues et
  pools que son propriétaire y rattache ; un bouton **Contacter** sur chaque dépôt, catalogue,
  profil et équipe ouvre une conversation avec le propriétaire et l’équipe — dans les deux
  tableaux de bord, ou par un lien privé envoyé par e-mail pour un visiteur sans compte — avec
  des limites comptées en base, une liste de blocage et une modération du staff (masquer,
  fermer, bloquer) sous Admin → Messages. Un dépôt servi depuis le serveur de son propriétaire
  doit publier un e-mail de contact.
- **Notifications de droits** — `/report` dépose une notification formelle droit d’auteur /
  marque / vie privée / contenu illicite avec tous les éléments légalement requis, en
  résolvant un lien collé en cible précise (dépôt, entrée de catalogue, utilisateur,
  fichier) ; codes de suivi, contre-notifications, strikes, un **registre d’œuvres protégées**
  dont les hachages / motifs / URL repèrent les envois correspondants à la sauvegarde, et une
  file admin **Droits** avec retrait, rejet, restauration et scan.
- **Le contact est un triage** — `/contact` pose deux questions courtes au lieu d'un
  formulaire unique avec une liste de sujets, et envoie la personne à la bonne destination. Une
  réclamation de droits ou un retrait et un signalement de contenu ou de personne sont confiés
  aux parcours qui existent déjà (`/report` et la fenêtre de signalement), avec l'adresse déjà
  saisie, pour ne pas reposer deux fois la même question. Les autres aboutissent à un petit
  formulaire qui demande les deux ou trois choses dont sa réponse a besoin : le pool pour une
  question d'hébergement, la référence pour une facture, ce qui a déjà été essayé pour un
  problème de compte, l'endroit concerné et la confirmation « aucun secret » pour un rapport de
  sécurité, le compte et la confirmation d'irréversibilité pour une suppression. Chaque champ
  est revalidé côté serveur, c'est la destination (et non le navigateur) qui décide de la file
  admin qui compte le message, et les réponses sont écrites au-dessus du message : le personnel
  lit toujours un seul fil au même endroit. Revenir en arrière ne perd jamais ce qui a été
  écrit, et un lien `?topic=` venu d'une autre page va toujours directement à son formulaire
  avec son modèle.
- **Légal** — Confidentialité, CGU, Cookies, **À propos**, **Paiements & Remboursements**
  (EN/FR). Sur la page d'un document, les autres documents tiennent dans un seul contrôle qui
  nomme celui qu'on lit et ouvre la liste : il ne déborde pas, ne coupe aucun libellé, et
  fonctionne pareil sur téléphone et sur ordinateur, quel que soit le nombre de documents
  ajoutés par un admin.

## Abus & sûreté
- Anti-bot / anti-DDoS en edge (Caddy + Fastify), proof-of-work à l'inscription & au
  contact, vérifications de secrets à temps constant, fetches sortants gardés contre le
  SSRF, contenu hébergé en sandbox (jamais exécuté ; téléchargement seul ;
  bans/whitelist/bande passante appliqués au service).
