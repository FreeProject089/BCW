# BCWEB — Mise en place du domaine & HTTPS

*🇬🇧 [English version](DOMAIN_SETUP_EN.md).*

Comment faire passer BCWEB du `http://localhost:5176` local à votre propre domaine avec
HTTPS automatique. Caddy provisionne et renouvelle un certificat Let's Encrypt pour vous —
aucune gestion manuelle de certificat.

---

### 0. Prérequis
- Un serveur (VPS) avec Docker + Docker Compose et une **IP publique**.
- Un domaine que vous contrôlez (ex. `community.example.com`).
- **Ports 80 et 443 ouverts** sur ce serveur (le 80 est requis pour le challenge ACME de
  Let's Encrypt, le 443 sert le HTTPS).

### 1. Pointer le DNS vers le serveur

**D'abord, un choix.** Servir BCWEB depuis le domaine nu (`example.com`) remplace ce que ce
domaine sert aujourd'hui — vérifiez qu'il ne sert rien d'autre avant de toucher son `A`. Un
sous-domaine (`app.example.com`) laisse le reste intact et se défait en une minute ; c'est le
choix prudent tant que la mise en production n'est pas jouée.

Chez votre fournisseur DNS, créez :

| Type | Nom | Valeur | Pourquoi |
|---|---|---|---|
| `A` | `example.com` (ou `app.`) | l'IPv4 du serveur | le site |
| `AAAA` *(si vous avez une IPv6)* | idem | l'IPv6 du serveur | — |
| `A` | `telemetry.example.com` | la même IPv4 | tableau de bord télémétrie |
| `A` | `s3.example.com` | la même IPv4 | téléversements — voir §5, il faut aussi un bloc Caddy |

**Ne créez pas `www.`** sans ajouter d'abord le bloc Caddy qui le redirige : le `Caddyfile`
n'a de bloc que pour le site et la télémétrie, donc `www.` répondrait un 200 vide — pas une
erreur, une page blanche.

**Si vous avez un enregistrement `CAA`**, il doit autoriser `letsencrypt.org`, sinon Caddy ne
peut pas obtenir de certificat et échouera en boucle :

```
example.com. CAA 0 issue "letsencrypt.org"
```

Sans `CAA` du tout, n'importe quelle autorité peut émettre — c'est le défaut, et ça marche.

**Le mail ne passe pas par cette pile** et ses enregistrements sont indépendants. Si vous
envoyez les e-mails de vérification depuis une boîte de votre domaine, il vous faut un `SPF`
qui inclut votre fournisseur, du `DKIM`, et un `DMARC`. Attention à `p=reject` : un message
qui ne s'aligne pas n'est pas mis en indésirable, il est **refusé** — donc l'expéditeur
configuré dans `SMTP_FROM` doit bien être une boîte de ce domaine, pas une adresse d'ailleurs.

Attendez la propagation, puis vérifiez les trois :

```sh
nslookup example.com            # doit renvoyer l'IP du serveur
nslookup telemetry.example.com
nslookup s3.example.com
```

### 2. Définir le domaine dans `.env`
Éditez `infra/compose/.env`. **Six valeurs** portent `localhost` dans le modèle, et les six
doivent changer — en oublier une ne casse rien au démarrage, seulement plus tard et ailleurs :

```dotenv
# Domaine nu (SANS http://) → Caddy provisionne + renouvelle le HTTPS automatiquement.
SITE_DOMAIN=community.example.com
# URL publique complète AVEC https:// → callbacks OAuth, redirections Stripe, liens e-mail.
SITE_URL=https://community.example.com

# Domaine du cookie de session. ⚠ LAISSÉ SUR `localhost`, PERSONNE NE PEUT SE CONNECTER :
# une page servie depuis community.example.com ne peut pas accepter un cookie destiné à
# localhost, le navigateur le jette sans un mot. La connexion répond « bienvenue » et la
# requête suivante repart anonyme.
# Le point initial le partage avec les sous-domaines (nécessaire pour la télémétrie).
COOKIE_DOMAIN=.example.com

# Adresse MinIO vue par le NAVIGATEUR. Les téléversements ne passent pas par l'API : le
# navigateur reçoit une URL pré-signée et envoie les octets directement ici. Sur localhost,
# c'est la machine du visiteur — joindre un fichier ne fait alors rien, sans erreur.
S3_PUBLIC_ENDPOINT=https://s3.example.com

# Base publique des dépôts hébergés — cette valeur part DANS les adresses remises à BMM.
REPO_PUBLIC_BASE=https://community.example.com/repos

# Optionnel : dashboard télémétrie sur son propre sous-domaine (les deux, pas une seule).
TELEMETRY_DOMAIN=telemetry.example.com
TELEMETRY_PUBLIC_URL=https://telemetry.example.com
```

> Le dev local garde `http://localhost:5176`. La production utilise un **domaine nu** pour
> `SITE_DOMAIN` — c'est ce qui déclenche l'activation du HTTPS par Caddy.

> **Les secrets sont obligatoires en production.** L'API **refuse de démarrer** avec
> `NODE_ENV=production` si `JWT_SECRET`, `BOT_SHARED_SECRET` ou `LINK_LOOKUP_SECRET` sont
> restés à leur valeur du dépôt. `openssl rand -hex 32` pour chacun. C'est délibéré : ces
> valeurs sont lisibles par quiconque a le dépôt.

### 3. Démarrer
```sh
cd infra/compose
docker compose up -d          # recrée caddy/api avec le nouveau domaine
```
Caddy demande le certificat au premier démarrage (`docker compose logs -f caddy` pour
suivre). Ouvrez ensuite `https://community.example.com` — vous devriez avoir un cadenas
valide.

### 4. Mettre à jour les intégrations qui codent l'URL en dur
- **OAuth** (si utilisé) : dans les réglages développeur GitHub/Discord, mettez les URLs de
  callback à `https://community.example.com/api/auth/oauth/github/callback`
  (et `…/discord/callback`).
- **Stripe** (si utilisé) : pointez le webhook sur
  `https://community.example.com/api/hosting/webhook` et utilisez les clés live.

### 5. Notes

**MinIO n'est PAS derrière Caddy.** Le `Caddyfile` a un bloc pour le site et un pour la
télémétrie, aucun pour le stockage — MinIO publie son port 9000 directement. Donner à
`S3_PUBLIC_ENDPOINT` un `https://s3.example.com` suppose donc que vous ajoutiez vous-même
un bloc Caddy qui le sert :

```
s3.example.com {
	reverse_proxy minio:9000
}
```

Sans ce bloc, le seul point d'entrée public est le `:9000` en clair, sans certificat — et la
CSP du site n'autorise que `https:` en `connect-src`, donc le navigateur refuserait l'envoi.
C'est le genre de détail qui ne se voit qu'au premier téléversement d'un utilisateur réel.

- Le mapping de port local `5176:5176` dans `docker-compose.yml` ne sert qu'aux tests
  locaux ; en production le trafic arrive sur 80/443. Vous pouvez le garder ou le retirer.
- Pour changer le port local plus tard, éditez `SITE_DOMAIN` (ex. `http://localhost:8080`)
  et le mapping `ports:` correspondant du service `caddy`, puis `docker compose up -d`.
