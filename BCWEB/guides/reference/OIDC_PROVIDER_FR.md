# Se connecter avec BetterCommunity (OpenID Connect)

> **Statut : pas ouvert au public.** Les clients sont créés par un administrateur dans
> *Admin → SSO*. Il n'y a pas d'enregistrement dynamique et il ne doit pas y en avoir pour
> l'instant. Ce document existe pour que le provider puisse être confié à un développeur le
> jour où il sera ouvert, et pour que la prochaine personne qui y touche sache ce qu'il
> fait déjà.

BetterCommunity est un provider OpenID Connect. Si ta bibliothèque parle OIDC, pointe-la
sur le document de découverte et elle se configurera toute seule :

```
https://bettercommunity.ch/.well-known/openid-configuration
```

Tout ce qui suit est ce que ce document annonce déjà. C'est écrit noir sur blanc parce que
« lis la découverte » n'aide pas beaucoup quand quelque chose ne marche pas.

## Ce qui est supporté

| | |
|---|---|
| Flux | Code d'autorisation. **Uniquement** — ni implicite, ni password grant |
| PKCE | `S256`, obligatoire pour les clients publics, accepté de tout le monde |
| Grants | `authorization_code`, `refresh_token` |
| ID token | RS256, à vérifier contre `/.well-known/jwks.json` |
| Scopes | `openid`, `profile`, `email`, plus `items` et `repos` pour nos ressources |
| `prompt` | `none`, `login`, `consent` |
| Auth client | `client_secret_post`, `client_secret_basic`, ou `none` pour un client public |
| Endpoints | authorize · token · userinfo · introspect · revoke · fin de session |

L'absence de flux implicite est délibérée : il met les tokens dans un fragment d'URL,
c'est-à-dire dans l'historique du navigateur, les en-têtes `Referer` et les logs serveur.
Utilise le flux code avec PKCE — c'est fait pour ça, et ça marche aussi pour les SPA et les
applications de bureau.

## Le flux

**1. Envoie l'utilisateur sur l'endpoint d'autorisation.**

```
GET /oauth2/authorize
  ?client_id=<le tien>
  &redirect_uri=<une que tu as enregistrée, à l'identique>
  &response_type=code
  &scope=openid%20profile%20email
  &state=<aléatoire, que tu revérifies au retour>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256
```

`redirect_uri` doit correspondre **exactement** à une URI enregistrée — pas de
correspondance par préfixe, pas de jokers. Sinon tu obtiens une page d'erreur et non une
redirection, volontairement : une redirection non validée, c'est comme ça qu'on fabrique
une redirection ouverte par accident.

**2. Échange le code.** Sous 10 minutes, une seule fois :

```
POST /oauth2/token          (application/x-www-form-urlencoded)
  grant_type=authorization_code
  code=…&redirect_uri=…&code_verifier=…
  client_id=…&client_secret=…        # ou HTTP Basic, ou rien pour un client public
```

Les codes sont à usage unique et réclamés de façon atomique : si deux requêtes se
télescopent, exactement une gagne et l'autre reçoit `invalid_grant`.

**3. Utilise les tokens.** L'access token est un JWT : vérifie-le contre le JWKS, ou
appelle `/oauth2/introspect` si tu préfères demander.

## Les refresh tokens tournent — prévois-le

Chaque rafraîchissement renvoie un **nouveau** refresh token et tue l'ancien. Enregistre le
nouveau.

Si un refresh token déjà utilisé est présenté à nouveau, nous le traitons comme un vol :
**tous** les refresh tokens de cet utilisateur pour ce client sont révoqués et il doit se
reconnecter. C'est la détection de réutilisation du BCP de sécurité OAuth — ce qui veut
dire qu'un client négligent qui renvoie un vieux token ressemblera exactement à un
attaquant. Persiste le dernier token reçu, et ne lance jamais deux rafraîchissements en
parallèle.

## `prompt=none` (renouvellement silencieux)

Tu renouvelles dans une iframe cachée ? Envoie `prompt=none`. Tu obtiendras toujours une
redirection vers ton `redirect_uri`, jamais une page HTML :

- `error=login_required` — personne n'est connecté ici
- `error=consent_required` — connecté, mais n'a pas approuvé ces scopes

Ce sont des réponses normales, pas des pannes : bascule sur une connexion visible.

## Mettre fin à une session

```
GET /oauth2/logout?client_id=…&post_logout_redirect_uri=…&state=…
```

Une page de confirmation est affichée plutôt qu'une déconnexion sur simple GET — sans quoi
n'importe quelle page capable d'héberger une balise `<img>` pourrait déconnecter tes
utilisateurs. À la confirmation, nous terminons leur session BetterCommunity **et révoquons
tous leurs refresh tokens** : une « déconnexion » qui laisse vivre un token de 30 jours n'a
déconnecté personne de quoi que ce soit.

`post_logout_redirect_uri` n'est honorée que si elle fait partie de tes URI de redirection
enregistrées. Sinon l'utilisateur est ramené sur le site.

## Introspection (RFC 7662)

```
POST /oauth2/introspect     token=<access, id ou refresh token> + tes identifiants client
```

Fonctionne sur les trois types de tokens. Un token inconnu, expiré, révoqué ou malformé
donne `{"active": false}` — jamais une erreur, pour qu'on ne puisse pas s'en servir à
distinguer ces cas. Tu n'obtiens de réponses que sur **tes propres** tokens.

## Ce que l'utilisateur voit, et peut reprendre

Le consentement est par client et par scope, et ce n'est pas une porte à sens unique : les
utilisateurs le gèrent depuis leur profil (`GET /me/connected-apps`,
`DELETE /me/connected-apps/:clientId`). Révoquer là supprime le consentement **et** tous les
refresh tokens que ton client détient pour cet utilisateur — le rafraîchissement suivant
renvoie `invalid_grant`. Traite ça comme « l'utilisateur a changé d'avis », pas comme une
erreur à réessayer.

## Avant l'ouverture au public

Manques connus, pour que personne n'ait à les redécouvrir :

- **Pas d'enregistrement dynamique de clients** (RFC 7591). Les clients sont créés par un
  administrateur.
- **Pas de `at_hash` / `c_hash`** dans l'ID token. Optionnel dans la spec ; les validateurs
  stricts peuvent avertir.
- **Pas de `max_age` / `auth_time`** : un client ne peut pas exiger une authentification
  récente.
- **Pas de notification de déconnexion** (front-channel ni back-channel) — la déconnexion
  termine la session ici, mais ne prévient aucun autre client.
- **Pas d'identifiants de sujet par paire** : `sub` est l'identifiant utilisateur
  BetterCommunity et vaut la même chose pour tous les clients, ce qui permet à deux clients
  de recouper leurs utilisateurs.
