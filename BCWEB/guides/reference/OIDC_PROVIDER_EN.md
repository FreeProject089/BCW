# Signing in with BetterCommunity (OpenID Connect)

> **Status: not open to the public.** Clients are created by an administrator in
> *Admin → SSO*. There is no dynamic client registration and there is not meant to be one
> yet. This document exists so the provider can be handed to a developer when it is
> opened, and so the next person to touch it knows what it already does.

BetterCommunity is an OpenID Connect provider. If your library speaks OIDC, point it at
the discovery document and it will configure itself:

```
https://bettercommunity.ch/.well-known/openid-configuration
```

Everything below is what that document already tells a client. It is written out because
"read the discovery doc" is not much help when something does not work.

## What is supported

| | |
|---|---|
| Flow | Authorization code. **Only** — there is no implicit and no password grant |
| PKCE | `S256`, required for public clients, accepted from everyone |
| Grants | `authorization_code`, `refresh_token` |
| ID token | RS256, verify against `/.well-known/jwks.json` |
| Scopes | `openid`, `profile`, `email`, plus `items` and `repos` for our own resources |
| `prompt` | `none`, `login`, `consent` |
| `max_age` | honoured; ID tokens carry `auth_time` |
| Subjects | `public` or `pairwise`, per client |
| Client auth | `client_secret_post`, `client_secret_basic`, or `none` for public clients |
| Endpoints | authorize · token · userinfo · introspect · revoke · end-session |

No implicit flow is deliberate: it puts tokens in a URL fragment, which is browser
history, referrer headers and server logs. Use the code flow with PKCE — that is what it
is for, and it works for SPAs and desktop apps too.

## The flow

**1. Send the user to the authorization endpoint.**

```
GET /oauth2/authorize
  ?client_id=<yours>
  &redirect_uri=<one you registered, exactly>
  &response_type=code
  &scope=openid%20profile%20email
  &state=<random, you check it on return>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256
```

`redirect_uri` must match a registered URI **exactly** — no prefix matching, no
wildcards. If it does not, you get an error page rather than a redirect, on purpose: an
unvalidated redirect is how an open redirect gets built by accident.

**2. Exchange the code.** Within 10 minutes, once:

```
POST /oauth2/token          (application/x-www-form-urlencoded)
  grant_type=authorization_code
  code=…&redirect_uri=…&code_verifier=…
  client_id=…&client_secret=…        # or HTTP Basic, or nothing for a public client
```

Codes are single-use and claimed atomically — if two requests race, exactly one wins and
the other gets `invalid_grant`.

**3. Use the tokens.** The access token is a JWT; verify it against the JWKS, or call
`/oauth2/introspect` if you would rather ask.

## Refresh tokens rotate — handle it

Every refresh returns a **new** refresh token and kills the old one. Store the new one.

If a refresh token that has already been rotated is presented again, we treat it as
theft: **every** refresh token for that user and client is revoked and the user has to
sign in again. That is the OAuth security BCP's reuse detection, and it means a sloppy
client that keeps re-sending an old token will look exactly like an attacker. Persist the
token you were last given, and do not run two refreshes concurrently.

## `prompt=none` (silent renewal)

Renewing in a hidden iframe? Send `prompt=none`. You will always get a redirect back to
your `redirect_uri`, never an HTML page:

- `error=login_required` — nobody is signed in here
- `error=consent_required` — signed in, but has not approved these scopes

Both are normal answers, not failures: fall back to a visible sign-in.

## Ending a session

```
GET /oauth2/logout?client_id=…&post_logout_redirect_uri=…&state=…
```

This shows the user a confirmation page rather than signing them out on a bare GET —
otherwise any page able to host an `<img>` tag could sign your users out. On confirm we
end their BetterCommunity session **and revoke every refresh token they hold**; a
"logout" that leaves a 30-day refresh token alive has not logged anyone out of anything.

`post_logout_redirect_uri` is honoured only if it is one of your registered redirect
URIs. Anything else returns the user to the site instead.

## Introspection (RFC 7662)

```
POST /oauth2/introspect     token=<access, id or refresh token> + your client credentials
```

Works on all three token types. An unknown, expired, revoked or malformed token is
`{"active": false}` — never an error, so it cannot be used to tell those cases apart.
You only ever get answers about **your own** client's tokens.

## What the user sees, and can take back

Consent is per client and per scope, and it is not a one-way door: users manage it under
their profile (`GET /me/connected-apps`, `DELETE /me/connected-apps/:clientId`).
Revoking there kills the consent **and** every refresh token your client holds for that
user — the next refresh returns `invalid_grant`. Treat that as "the user changed their
mind", not as an error to retry.

## Before this is opened up

Known gaps, so nobody has to rediscover them:

- **No dynamic client registration** (RFC 7591). Clients are created by an admin.
- **No `c_hash`**. `at_hash` is issued; `c_hash` only applies to hybrid flows, which we do
  not support.
- **No front-channel or back-channel logout notifications** — logout ends the session
  here, but does not push anything to other clients. Deliberately not built: it cannot be
  tested without a real relying party, and an untested notification channel is worse than
  a documented absence.

### Pairwise subjects

`subject_type` is chosen when the client is created:

- **`public`** (default) — `sub` is the BetterCommunity user id. Every client sees the same
  value, so two of them comparing notes can tell they have the same person.
- **`pairwise`** — `sub` is an opaque `p_…` id unique to your client. Stable forever for
  that user, and useless to anyone else.

Pick `pairwise` unless you have a reason not to. It cannot be changed afterwards: flipping
an existing client would re-identify all of its users at once, which orphans their accounts
rather than migrating them.
