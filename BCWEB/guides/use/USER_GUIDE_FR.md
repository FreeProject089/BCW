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
- **Docs** (`/docs`) — guides catégorisés, mise en page façon GitBook.
- **FAQ** (`/faq`) — réponses rapides. Page introuvable ? Profite du petit jeu **« Orb Fall »**
  sur la page 404 (il y a un classement 😉).

## 6. Signaler un problème

- La plupart des contenus (dépôts, catalogues, profils, articles) ont un bouton **Signaler**.
  Utilise-le pour du contenu cassé, malveillant ou hors-règles. Un signalement peut ouvrir un
  petit fil pour qu'un modérateur te pose des questions.

**À faire :** signale avec une raison claire. **À éviter :** utiliser les signalements pour
harceler — l'abus du système de signalement est lui-même modérable.

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
