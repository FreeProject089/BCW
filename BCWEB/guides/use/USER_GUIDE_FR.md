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
