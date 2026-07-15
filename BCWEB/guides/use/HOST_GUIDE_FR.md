# Le bon petit hébergeur — héberger dépôts & catalogues sur BetterCommunity

*Comment publier et héberger ton propre contenu sur BetterCommunity (BCWEB) : dépôts serveur,
catalogues communautaires, pools de stockage et facturation — avec les astuces et les pièges.
🇬🇧 [English version](HOST_GUIDE_EN.md).*

---

## 1. Deux façons de publier

- **Dépôt serveur** — une source de mods. Soit **par URL** (tu héberges le `repo.json`, on le
  vérifie / surveille), soit **hébergé par nous** (tu téléverses les fichiers ; on sert le
  `repo.json`).
- **Catalogue communautaire** — une collection de plugins / thèmes / apps / presets, servie
  comme feed natif BMM (`/c/<slug>/catalog.json`) avec des deeplinks « Ajouter à BMM » par type.

Pars de **`/submit`** (Soumettre du contenu) — il te guide entre la voie officielle et
communautaire, et les options d'hébergement.

## 2. Les pools de stockage — le concept clé

Acheter de l'hébergement provisionne un **pool de stockage vide**, pas un seul dépôt. Un pool
a un quota d'octets ; tu le remplis ensuite de **dépôts et/ou catalogues**, qui *partagent*
cet espace de façon fongible.

- Vois tes pools dans **Tableau de bord → Dépôts serveur → Pools de stockage**. Chacun peut
  être **renommé**, avoir sa **couleur**, et être **replié** pour désencombrer.
- Ajoute un dépôt ou un catalogue à un pool à tout moment, en puisant dans l'espace libre.
- Un dépôt **unique** peut passer en **multi** (crée un pool à la taille de son quota) et revenir.

**À faire :** dimensionne un pool selon ce que tu stockeras vraiment ; tu peux agrandir plus tard.
**À éviter :** croire qu'un dépôt a un stockage privé — tout dans un pool compte pour le pool.

## 3. Fusionner & défusionner les pools

- **Fusionne** plusieurs pools en un plus grand (multi-sélection → *Fusionner dans…*). Les
  dépôts, catalogues **et les abonnements** suivent. Il y a un **undo de 6 secondes**.
- Un pool fusionné peut porter plusieurs abonnements distincts. Si c'est pertinent,
  **consolide**-les en un seul plan plus grand — la carte du pool affiche le **devis
  d'économies** ; le changement réel passe par le checkout Stripe (seuls les abos récurrents
  sont consolidés, donc un terme prépayé n'est jamais perdu).
- Un admin peut **défusionner** un pool si besoin.

**À faire :** fusionne les pools liés pour simplifier la facturation et partager l'espace.
**À éviter :** fusionner entre comptes — stockage/abonnements mutualisés ne traversent pas les propriétaires.

## 4. Facturation

- Terme **prépayé** (1/3/6/12/24 mois, plus long = plus de remise) ou **renouvellement**
  mensuel automatique. Les premiers `hostingFreeGB` de stockage sont gratuits ; seul le
  surplus (plus l'upload/CPU supplémentaire) est facturé. Les **codes promo** peuvent donner
  une remise ou de l'hébergement gratuit.
- Cycle de vie : un pool qui expire t'avertit d'abord ; un défaut donne **72 h de grâce**
  avant que les dépôts soient suspendus et les catalogues masqués. Renouvelle (ou corrige le
  paiement) pour tout restaurer.

**À faire :** active le renouvellement auto si le contenu compte, et surveille l'avertissement
d'expiration. **À éviter :** laisser un terme payé expirer en croyant que rien ne se passe.

## 5. Lister, vérifier & partager

- **Liste publiquement** pour apparaître dans les pages de navigation ; le contenu listé est
  surveillé et un mod accorde le **check vert** vérifié. Une modif d'un dépôt vérifié peut
  repasser en revue.
- **Non listé ?** Tu peux quand même le partager : **Copier le lien de partage public** génère
  un `/r/<id>?k=<clé>` (dépôts) — quiconque a le lien voit la page sans qu'elle soit dans la
  liste. Les catalogues privés marchent pareil (`/c/<slug>?k=…`).
- Chaque dépôt porte une **empreinte** unique (`BCR-XXXX-XXXX`) le reliant à ton identité.

**À faire :** utilise un lien de partage pour du contenu bêta/privé. **À éviter :** coller une
clé de partage en public si le contenu doit rester non listé — la clé est le verrou.

## 6. Bac à sable & contrôle d'accès (par dépôt)

- **Réglages de bac à sable** éditables par le propriétaire : whitelist / ban par IP, clé ou
  compte (BCWEB / Discord), et une limite d'upload demandée (toujours plafonnée au quota dur
  de ton plan).
- La **Politique d'accès globale** s'applique *au-dessus* de tes réglages — tu ne peux pas
  élargir l'accès au-delà de ce que la plateforme autorise.

### Tes règles valent aussi pour les téléchargements web

La page de ton dépôt liste son contenu et permet de télécharger un fichier directement depuis
le navigateur, sans BMM. C'est **la même porte**, pas une seconde : le contrôle
whitelist/bans identique s'exécute que la requête vienne de BMM ou d'un navigateur, et ton
plafond d'upload comme tes compteurs s'appliquent dans les deux cas.

Ce qui change selon le visiteur :

- **Dépôt ouvert** → tout le monde peut parcourir et télécharger, connecté ou non.
- **Une restriction active** → un visiteur déconnecté est invité à se connecter ; on compare
  ensuite son compte BCWEB *et son Discord lié* à tes listes. Ton **contenu reste masqué** à
  quiconque n'est pas autorisé — un dépôt whitelisté ne divulgue pas sa liste de fichiers.
- **Banni** → refusé, comme partout ailleurs.

Un membre que tu as autorisé par id Discord peut donc télécharger depuis le site, à condition
d'avoir lié ce Discord à son compte BCWEB. Rien à configurer : si le dépôt est ouvert il l'est
sur le web, s'il est restreint il l'est sur le web.

## 7. Recommandé vs non recommandé

**Recommandé**
- Garder un vrai `repo.json` accessible et valide (les health checks en dépendent).
- Remplir description, tags et liens — c'est comme ça qu'on te fait confiance et qu'on te trouve.
- Utiliser les pools pour grouper le contenu lié et consolider la facturation.
- Renouveler (rotate) une clé de partage si elle fuit.

**Non recommandé**
- Héberger du contenu que tu n'as pas le droit de distribuer.
- Sur-provisionner « au cas où » — tu paies le pool, pas ce qui est utilisé.
- Compter sur le niveau Communauté pour la portée — fais-toi vérifier (Officiel/Partenaire) si possible.
- Partager ton mot de passe de dashboard au lieu d'ajouter l'e-mail d'un collaborateur autorisé.

---

### Récap à faire / à éviter

| ✅ À faire | ❌ À éviter |
|---|---|
| Dimensionner les pools au réel | Sur-provisionner par précaution |
| Renouveler auto le contenu important | Laisser un terme dépasser les 72 h de grâce |
| Partager le non listé via un lien | Divulguer la clé de partage |
| Ajouter des collaborateurs par e-mail | Distribuer le mot de passe du dashboard |
