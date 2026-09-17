# Le bon petit utilisateur — utiliser BetterCommunity

*Un guide convivial, fonctionnalité par fonctionnalité, de BetterCommunity (BCWEB) pour les
membres au quotidien. Pour les modérateurs voir [MODERATOR_GUIDE_FR.md](MODERATOR_GUIDE_FR.md) ;
pour héberger tes propres dépôts/catalogues voir [HOST_GUIDE_FR.md](HOST_GUIDE_FR.md).
🇬🇧 [English version](USER_GUIDE_EN.md).*

---

## 1. Ton compte

- **Inscription / connexion** sur `/auth`. E-mail + mot de passe, ou connexion en un clic
  **GitHub / Discord** (ton avatar est récupéré automatiquement).
- La **double authentification (2FA)** est optionnelle mais recommandée — active-la depuis
  ton tableau de bord. Il existe aussi un authentificateur local sur `/2fa` (100 % hors ligne).
- Ton **identifiant BC** (`BC-XXXX-XXXX`) est ton identifiant public stable. Il apparaît sur
  ton profil et tes dépôts/catalogues ; clique dessus pour le copier.
- Ton **profil public** est sur `/u/<ton-id>`. Tu contrôles ce qui s'affiche dans
  **Tableau de bord → Profil → Connexions à montrer** : choisis quels comptes liés (GitHub,
  Discord, identifiant créateur BMM, site web, Ko-fi…) apparaissent, et si le profil est public.

**À faire :** active la 2FA et n'expose que les connexions que tu assumes de partager.
**À éviter :** réutiliser un mot de passe faible.

## 2. Connexions & Ko-fi

- Lie **GitHub / Discord / YouTube / Twitch / Steam / Ko-fi** depuis ton profil. Les marques
  liées apparaissent en pastilles compactes (icône + pseudo, clic pour copier).
- **Ko-fi** : colle ton pseudo (`nom`, `@nom`, ou une URL complète `ko-fi.com/...` — c'est
  normalisé). Ça devient un lien de pourboire ; un **badge donateur** Ko-fi peut être accordé
  automatiquement.

### Points, boutique & inventaire (économie Discord)
Si le bot Discord de la communauté a son économie activée, être actif sur les serveurs où il est (messages, réactions, vocal) rapporte de l'XP, l'XP fait monter de niveau, et tous les quelques niveaux tu gagnes des points. Une fois ton Discord lié :
- **Tableau de bord → Vue d'ensemble** montre ton anneau de niveau, d'où vient ton XP, et ton solde.
- **Tableau de bord → Boutique & inventaire** est la boutique de points sur le site — les mêmes articles et prix que `/shop` sur Discord — et l'inventaire : tout ce que tu as acheté, d'un côté ou de l'autre, avec le code remis (pool de stockage, boost, hébergement offert, promo). Un rôle Discord ou une récompense perso reste *en attente* jusqu'à ce qu'un admin le remette.
- Un code acheté (pool, boost, hébergement, promo) arrive **scellé** : appuie sur **Révéler** quand tu le veux (il est créé à ce moment, avec sa validité), ou **Offre** l'article non ouvert à un autre membre. Les points s'envoient aussi — l'onglet Historique sur le site, ou `/gift` sur Discord — dans les limites fixées par les admins.
- Sur Discord : `/level`, `/shop`, `/inventory`, `/gift`, `/history`, `/leaderboard` (ce serveur ou global, en image, avec ton propre rang), `/profile`, et `/casino` (une table animée — pile ou face, dés, machine à sous, roulette avec mise couleur / vert / numéro, roue, plinko). `/casino` sans option ouvre une table interactive : choisis le jeu, la mise (paliers, tapis ou montant libre) et les options du jeu dans des menus, puis Jouer ; les options de la commande sont des raccourcis vers le même tirage. L’avantage maison ne taxe que ce que tu gagnes — une case 1× rend ta mise au point près, une case 0,3× en rend exactement 30 %. Deux jeux de plus sont des **tables en direct** que d’autres membres rejoignent depuis le même message : **Course** (six voitures, choisis la tienne) et **Cagnotte** (chacun mise ce qu’il veut ; plus tu mises, plus tu as de chances), et **Multi** ouvre pile ou face, dés, roulette ou roue en tirage partagé. À deux ou plus, la table se règle **entre les joueurs** : les mises des perdants forment la cagnotte, chaque gagnant garde sa propre mise et en prend une part au prorata de sa mise, et **la maison ne prend rien sur une table** : la somme versée égale la somme misée. Personne ne gagne → chaque siège récupère sa mise. Seul à une table, tu joues contre la maison comme d’habitude. Si le serveur n’a pas fixé de mise maximale, **Tapis** est vraiment tout ; sinon la table dit quel est le plafond.
- Autres commandes : `/link` et `/verify` (lier ton compte et rafraîchir tes rôles), `/voice` (le panneau de ton salon vocal temporaire), `/giveaway` (en lancer un, 5 en cours maximum par serveur), `/season` (quand les points repartent à zéro), et `/help`, qui explique chaque fonction dans ta langue. Liste complète : [guide du bot Discord](../run/DISCORD_BOT_FR.md).
- Des badges s'obtiennent par les règles que les admins fixent — un niveau, un nombre de messages, un achat, un sondage répondu, un élément publié, un dépôt hébergé, Discord lié, la 2FA activée, l'âge du compte — en plus des attributions du staff et des œufs de Pâques. Ils apparaissent aussitôt sur ton profil.

## 3. Parcourir le contenu

BetterCommunity agrège deux types de contenu téléchargeable, tous deux consommables par
l'app BetterModsManager (BMM) :

- **Catalogues communautaires** (`/catalog`, pages `/c/<slug>`) — collections de plugins /
  thèmes / apps / presets. Chaque page a des deeplinks **« Ajouter à BMM »**
  (`bmm://catalog/...`) et une URL de feed copiable.
- **Dépôts serveur** (`/repos`, pages `/r/<id>`) — sources de mods hébergées ou par URL.
  Chacun a un deeplink **« Ouvrir dans BMM »** et un lien `repo.json`.

### Nommer ce que vous publiez

BMM détermine si quelque chose est *officiel* ou *partenaire* d'après **l'endroit d'où le
catalogue a été récupéré**, jamais d'après ce que le catalogue dit de lui-même — une
soumission communautaire ne peut donc jamais porter un badge qu'on ne lui a pas donné. Cette
défense fonctionne, et ce n'est pas celle que l'on contourne.

Les noms, si. Un catalogue intitulé « Mods Officiels BMM » afficherait un badge *communauté*
correct à côté d'un titre choisi pour être cru, et les gens lisent les titres. Le vocabulaire
d'adoubement est donc réservé, à la soumission comme au renommage : **officiel, partenaire,
vérifié, certifié, approuvé, équipe/staff BMM**, et leurs équivalents anglais. Espacement,
accents et substitutions du type `0ffic1el` sont normalisés avant le contrôle : ils ne
permettent pas de passer.

Les noms honnêtes ne sont pas touchés — **« Communauté », « Non officiel », « Fan-made »**
passent tous, parce qu'ils disent le vrai. Une soumission refusée renvoie `reserved_name` et
le mot en cause.

Si un catalogue que vous suivez étiquette ses propres entrées « officiel », BMM affiche
l'entrée comme **communauté** et ajoute une pastille distincte indiquant que le catalogue
l'*affirme*, avec l'hôte source. La revendication ne vous est pas cachée — elle est attribuée
à celui qui l'a faite.

### Télécharger depuis un dépôt sans BMM

La page d'un dépôt hébergé liste son **contenu** (mods, profils, …) et chaque fichier se
télécharge en un clic, directement depuis le navigateur — pas besoin d'installer BMM pour
récupérer un seul fichier. (BMM reste la meilleure voie pour *utiliser* un dépôt : il le
synchronise et le met à jour pour toi.)

Ce qui décide si tu peux télécharger, c'est uniquement la config du propriétaire :

| Le dépôt est… | Ce que tu obtiens |
|---|---|
| **Ouvert** (aucune restriction) | le contenu et tous les téléchargements, connecté ou non |
| **Restreint** (whitelist, ou bans actifs) | **connecte-toi d'abord** — on compare alors ton compte BCWEB (et son Discord lié) à la liste du propriétaire. Le contenu reste masqué tant que tu n'es pas autorisé : la liste des fichiers d'un dépôt privé n'est pas publique. |
| Tu en es **banni** | rien — la page indique l'absence d'accès |

Si un dépôt restreint te refuse encore une fois connecté, c'est que ton compte n'est
simplement pas sur la liste : demande l'accès au propriétaire. Lier ton Discord (§2) aide —
les propriétaires autorisent souvent des comptes Discord plutôt que des ids BCWEB.

**Niveaux de confiance** : **Officiel** (vert, équipe BMM), **Partenaire** (bleu, membres de
confiance), **Communauté** (non vérifié — ajoute à ta discrétion).

**À faire :** privilégie Officiel/Partenaire en cas de doute. **À éviter :** faire aveuglément
confiance à une source Communauté non identifiable — vérifie le profil et le BC id du propriétaire.

## 4. Favoris, avis & profils

- **Mets en favori** (étoile) un dépôt (purement social, n'accorde aucun accès). Filtre la
  liste sur tes favoris.
- Parcours les membres sur `/users` (recherche par nom, BC id, id de dépôt ou de catalogue)
  et visite leur profil `/u/:id`.
- Les **badges** se gagnent (inscription précoce, donateur Ko-fi…) et s'affichent sur ton profil.

## 5. Blog, docs & FAQ

- **Blog** (`/blog`) — actus et articles, avec réactions et co-auteurs. Les nouveaux articles
  peuvent être annoncés par e-mail si tu es abonné à la **newsletter** (double opt-in).
- **Docs** (`/docs`) — guides catégorisés, avec barre latérale, rail des titres à droite et blocs B.MD.
- **FAQ** (`/faq`) — réponses rapides. Page introuvable ? Profite du petit jeu **« Orb Fall »**
  sur la page 404 (il y a un classement 😉).

## 6. Signaler un problème

- La plupart des contenus (dépôts, catalogues, profils, articles) ont un bouton **Signaler**.
  Utilise-le pour du contenu cassé, malveillant ou hors-règles. Un signalement peut ouvrir un
  petit fil pour qu'un modérateur te pose des questions.

**À faire :** signale avec une raison claire. **À éviter :** utiliser les signalements pour
harceler — l'abus du système de signalement est lui-même modérable.

### Joindre les gens derrière un élément

Chaque dépôt, catalogue, profil et page d’équipe a un bouton **Contacter**. Il ouvre une
conversation avec ceux qui gèrent l’élément — le propriétaire et son équipe — pas avec
l’équipe du site. Connecté, elle vit dans **Tableau de bord → Messages & signalements**
(reçues / envoyées, non-lus, fermer, et « signaler à l’équipe » si ça tourne mal). Déconnecté,
tu laisses un e-mail et reçois un lien privé vers la conversation ; les réponses t’arrivent par
e-mail. Il y a des limites d’envoi, et l’équipe du site peut bloquer un expéditeur qui en
abuse. Un dépôt servi depuis le serveur de son propriétaire affiche aussi l’e-mail de contact
que celui-ci a dû donner ; une page d’équipe affiche celui de l’équipe.

### Équipes

**Tableau de bord → Équipes** permet de créer une équipe avec une adresse de contact,
d’inviter des membres (par BC id, e-mail ou pseudo — ils acceptent depuis leur propre tableau
de bord) et de leur donner des rôles. Le propriétaire d’un dépôt, d’un catalogue ou d’un pool
de stockage peut le **rattacher** à une équipe : chaque membre le modifie, publie et répond à
ses messages, la facturation restant au propriétaire. L’équipe a une page publique en
`/t/<slug>`.

### Droits d’auteur et notifications de droits

Pour un contenu qui viole **tes** droits — un mod, un thème ou un catalogue qui est à toi,
une image, un nom — passe par **`/report`** (aussi lié depuis le pied de page et depuis
chaque bouton Signaler quand tu n’es pas connecté). C’est une notification formelle, pas un
signalement de modération : tu nommes la cible précisément (un dépôt, une entrée de
catalogue, un utilisateur, ou n’importe quelle URL du site — colle un lien et le formulaire le
résout, jusqu’au fichier), l’œuvre concernée, à quel titre tu agis (titulaire, mandataire,
licencié), et tu signes les déclarations de bonne foi et d’exactitude. Pas besoin de compte.
Tu reçois un **code de notification** et tu la suis sur `/report` avec ton e-mail, ou depuis
**Tableau de bord → Notifications de droits** une fois connecté. L’équipe accuse réception,
examine, puis retire le contenu, rejette la notification avec un motif, ou te demande des
précisions. Le propriétaire du contenu peut déposer une **contre-notification**, et les
récidivistes sont sanctionnés. Si tu as fait enregistrer une œuvre à l’avance (l’équipe peut
le faire pour toi), les envois qui lui correspondent sont repérés avant que quiconque ait à
le remarquer.

## 7. Réglages & apparence

- **Réglages** (`/settings`) — thème, langue (EN/FR partout) et **Surfaces translucides**
  (cartes en verre dépoli, avec curseur d'opacité).
- La **topbar** est configurable par les admins ; ce que tu vois peut varier selon le site.

## 8. La vie privée en bref

- Seul un cookie de **session essentiel** est requis. Les **statistiques sont opt-in** — tu
  choisis au bandeau cookies, et tu peux Refuser le non-essentiel en un clic.
- Les statistiques sont **anonymes et internes** (aucune pub, aucun pistage inter-sites).

---

### Récap à faire / à éviter

| ✅ À faire | ❌ À éviter |
|---|---|
| Activer la 2FA | Réutiliser un mot de passe faible |
| Privilégier Officiel/Partenaire | Faire confiance aveuglément à Communauté |
| Signaler avec une raison | Détourner les signalements |
| Ne partager que les connexions voulues | Exposer un pseudo privé |
