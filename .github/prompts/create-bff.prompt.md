---
description: >
  Set up a Backend-for-Frontend (BFF) using Azure Functions v4, Keycloak with Authorization Code Flow + PKCE, encrypted session cookies (@hapi/iron), CORS, CSRF protection, and a backend proxy deployed to Azure Static Web Apps.
  Use this prompt whenever someone needs to: create a BFF, add server-side auth to an SPA, proxy API calls through Azure Functions, integrate Keycloak with a BFF, deploy Azure Functions alongside a frontend on Azure SWA, add login/logout endpoints, set up session cookies, secure API calls without tokens in the browser, add cookie-based auth, migrate from SPA-based OIDC or from the ROPC password grant to a BFF, troubleshoot CORS/CSRF in a BFF, or set up server-side session management.
mode: agent
---

# Create a BFF (Backend-for-Frontend) with Azure Functions

This prompt guides you through creating a complete BFF layer using Azure Functions v4 (TypeScript, ESM) that sits between an SPA frontend and a backend API. The BFF runs the OAuth2 Authorization Code Flow with PKCE against Keycloak, manages encrypted session cookies, enforces CSRF protection, and proxies API requests with bearer token injection.

Everything here has been built and verified end-to-end against a real Keycloak instance. The pitfalls near the bottom are not theoretical — each one silently broke a login.

## Reference files

Read the following reference files for exact implementation details:

- Project setup (package.json, tsconfig, host.json): #file:.github/prompts/create-bff/project-setup.md
- Library implementations (session, keycloak, cors, csrf, proxy, tests): #file:.github/prompts/create-bff/lib-implementations.md
- Function endpoints (auth-login, auth-callback, auth-me, auth-logout, proxies): #file:.github/prompts/create-bff/function-implementations.md
- Frontend integration (auth store, guard, login page, interceptor): #file:.github/prompts/create-bff/frontend-integration.md
- Deployment (GitHub Actions, Azure SWA, Keycloak client setup): #file:.github/prompts/create-bff/deployment.md

## When to use this pattern

The BFF pattern is the right choice when:

- Your SPA needs to authenticate users but you don't want tokens in the browser (XSS risk)
- You're deploying to Azure Static Web Apps and need a server-side auth layer
- You want automatic token refresh transparent to the frontend
- You're migrating away from SPA-based OIDC (angular-auth-oidc-client, PKCE in the browser) or from the ROPC password grant

## Why Authorization Code Flow with PKCE

The user authenticates on **Keycloak's own login page**; the BFF never sees the password. The browser returns with a short-lived authorization code, which the BFF exchanges for tokens server-side.

This is the flow to build. The alternative — ROPC (`grant_type=password`, a custom login form posting credentials to the BFF) — is removed in OAuth 2.1 and deprecated in Keycloak, and it rules out SSO, MFA, social login, consent screens and identity brokering. Only consider ROPC if a hard requirement forces the login form to stay inside the app, and say plainly what it costs.

PKCE is used **even though the client is confidential**. The BFF authenticates with `client_secret` _and_ proves possession of a `code_verifier`, so an intercepted authorization code is worthless on its own. `code_challenge_method` is always `S256`; never offer `plain`.

> **Note:** Reference files use placeholder names (`BACKEND_API_URL`, `proxy-entries`). Adapt resource names, routes, and backend paths to the project's domain.

## Architecture overview

```
Frontend (SPA)
    |
    |-- "Sign in" = full navigation --> /api/auth/login --> 302 to Keycloak
    |                                                          |
    |<--------------------- 302 back to /api/auth/callback -----+
    |
    | fetch with credentials (cookies) for everything else
    v
BFF (Azure Functions v4)
    |-- Login          (PKCE pair + state --> sealed __pkce cookie --> redirect)
    |-- Callback       (verify state, exchange code, seal session, redirect back)
    |-- Session        (@hapi/iron sealed cookies, split across chunks)
    |-- CSRF           (X-Requested-With header + Origin check, fetch endpoints only)
    |-- CORS           (preflight + response headers)
    |-- Token refresh  (transparent, inside /auth/me and the proxy)
    |-- Logout         (revoke + return Keycloak end-session URL)
    \-- Backend Proxy
        \-- Attach bearer token --> Backend API
```

Only the login, callback and the final logout hop are browser navigations. Everything else is `fetch`.

## Step-by-step implementation

### Step 0: Check the starting point

This repository ships without a BFF and without any auth code, so this is a greenfield build, not a
migration. Two consequences:

- Wherever the steps below describe removing something ("the login page loses its form", "the store's
  `login()` method disappears"), there is nothing to remove — create the redirect-based version
  directly.
- `src/environments/environment*.ts` currently exposes `api`, pointing straight at the backend. This
  needs to differ per environment, because the deployed site has no BFF (see the note below):

  ```typescript
  // environment.development.ts — everything through the BFF
  export const environment = {
    production: false,
    apiUrl: '/api', // reads go through the proxy, which attaches the bearer token
    bffUrl: '/api',
    authEnabled: true,
  };

  // environment.ts — no BFF deployed, public reads straight from the backend
  export const environment = {
    production: true,
    apiUrl: 'https://d-cap-blog-backend---v2.whitepond-b96fee4b.westeurope.azurecontainerapps.io',
    bffUrl: '/api',
    authEnabled: false,
  };
  ```

  Backend services use `apiUrl`; the auth store, guard and login page use `bffUrl`. Without this
  split the deployed site would call `/api` on a storage account, get a 404 for every request and
  show an empty page — with a green build.

- `authEnabled: false` must actually switch things off, or production shows a login that cannot work:
  `checkSession()` returns anonymous without calling the BFF, the sign-in button is hidden, and
  `authGuard` sends the user away instead of to `/login`. Three small guards, no separate code path.

**The BFF runs locally only in this template.** `.github/workflows/azure-deploy.yml` publishes the
frontend to an Azure Storage static website (`$web` container), and a storage account cannot host
Azure Functions — there is no `/api` there. Build and run the BFF locally; do not wire it into that
workflow, and do not tell the user their deployed site will have a login. Making it work in
production would mean moving the frontend to Azure Static Web Apps (which hosts managed functions
under `/api`, keeping the same-origin design intact) or hosting the BFF as a separate Azure Function
App — the latter turns `/api` into a cross-origin call and would need `SameSite=None`, real CORS and
a different redirect URI. Neither is part of this prompt.

Also missing and created along the way: `proxy.conf.json` (Step 6), the `proxyConfig` entry in
`angular.json` (Step 6), and a `start` script that runs frontend and BFF together — the current one
is a bare `ng serve`.

### Step 1: Scaffold the BFF directory

Create a `bff/` directory at the project root. Read #file:.github/prompts/create-bff/project-setup.md for the exact contents of `package.json`, `tsconfig.json`, `host.json`, and `local.settings.json`.

```
bff/
  src/
    index.ts              # Entry point - imports all function files
    lib/
      session.ts          # Iron seal/unseal, chunked cookies, PKCE cookie
      keycloak.ts         # PKCE, authorize/logout URLs, code exchange, refresh, revoke
      cors.ts             # CORS preflight + response headers
      csrf.ts             # X-Requested-With header + server-side Origin check
      proxy.ts            # Backend proxy with auto-refresh
      keycloak.spec.ts    # node:test — safeReturnUrl, PKCE, URL building
      session.spec.ts     # node:test — cookie chunking round trip
      csrf.spec.ts        # node:test — header check, Origin check
    functions/
      auth-login.ts       # GET  /api/auth/login    (302 to Keycloak)
      auth-callback.ts    # GET  /api/auth/callback (code -> session)
      auth-logout.ts      # POST /api/auth/logout   (returns end-session URL)
      auth-me.ts          # GET  /api/auth/me
      proxy-*.ts          # One file per proxied resource
  package.json
  tsconfig.json
  host.json
  local.settings.json     # Not committed - env vars for local dev
```

There is deliberately **no `auth-refresh.ts`**. Refresh happens transparently inside `auth-me` and the proxy before the real work; a separate endpoint is dead weight the frontend never calls.

### Step 2: Implement shared libraries

Read #file:.github/prompts/create-bff/lib-implementations.md — it contains the exact source for all five library files. The key design decisions:

1. **session.ts** — Iron-encrypts `{ accessToken, refreshToken, idToken, expiresAt }`. **The sealed value is split across `__session.0`, `__session.1`, …** because three JWTs plus Iron overhead exceed the browsers' 4 KB per-cookie limit (see pitfalls). Also holds the short-lived `__pkce` cookie for the login flow. Cookies are httpOnly, SameSite=Lax, and `Secure` unless `ALLOWED_ORIGIN` is an `http://` URL. Includes a `decodeURIComponent()` fallback because Azure SWA URL-encodes cookie values.

2. **keycloak.ts** — PKCE pair generation (`node:crypto`, S256), authorize-URL and end-session-URL building, authorization-code exchange, refresh, revocation. Also owns `safeReturnUrl()` and validates its environment at import time.

3. **cors.ts** — Every response includes `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials: true`. Preflight returns 204. Note that with the same-origin setup of Step 6 this is mostly inert, but keep it: it costs nothing and covers split-origin deployments.

4. **csrf.ts** — Validates `X-Requested-With: XMLHttpRequest` and, independently, compares `Origin` against `ALLOWED_ORIGIN` server-side. Applies to fetch-reachable state-changing endpoints only — a browser navigation structurally cannot carry the header. The `Origin` check is what still holds when `SameSite=Lax` does not: its boundary is the _site_, so a sibling subdomain would otherwise get the cookie attached.

5. **proxy.ts** — Extracts and unseals the session, **rejects non-GET requests without a session with 401**, auto-refreshes if expired, attaches the bearer token, forwards to the backend.

### Step 3: Implement the endpoints

Read #file:.github/prompts/create-bff/function-implementations.md for complete source. There are two shapes, and mixing them up is the most common mistake.

**Navigation endpoints** (`auth/login`, `auth/callback`) — the browser goes there directly. No CORS, no CSRF (impossible), and errors must be redirects, never JSON, or the user stares at raw JSON.

```typescript
app.http('auth-login', {
  methods: ['GET'], // no OPTIONS: navigations never preflight
  authLevel: 'anonymous',
  route: 'auth/login',
  handler,
});
```

**Fetch endpoints** (`auth/me`, `auth/logout`, all proxies) — the familiar pattern:

```typescript
async function handler(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== 'GET') {
    const csrfError = checkCsrf(request);
    if (csrfError) return { ...csrfError, headers: corsHeaders }; // CORS on errors too!
  }

  // do the work, return with corsHeaders and a cookies array
}

app.http('function-name', {
  methods: ['POST', 'OPTIONS'], // always include OPTIONS
  authLevel: 'anonymous',
  route: 'your/route',
  handler,
});
```

**Logout stays a POST.** It returns the Keycloak end-session URL as JSON and lets the client navigate there. Making logout a redirect endpoint would strip it of its CSRF protection for no gain.

### Step 4: Register all functions in index.ts

The entry point must import every function file so Azure Functions discovers them:

```typescript
import './functions/auth-login.js';
import './functions/auth-callback.js';
// ... all other functions
```

This file is referenced by `"main": "dist/index.js"` in `package.json`.

### Step 5: Configure the frontend

Four changes. Read #file:.github/prompts/create-bff/frontend-integration.md for complete source.

1. **HTTP interceptor** — cookies and the CSRF header on every BFF call:

```typescript
export const cookieInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith(environment.bffUrl)) {
    req = req.clone({
      withCredentials: true,
      setHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  }
  return next(req);
};
```

2. **Environment config** — see Step 0 for the exact shape: `apiUrl` for data, `bffUrl` for auth, `authEnabled` to switch auth off where no BFF is hosted. In development both point at `/api`, which the dev-server proxy makes same-origin (Step 6). Do not point development at `http://localhost:7071/api` — that is cross-origin and breaks the session cookie.

3. **The login page loses its form.** The password is typed on Keycloak's page now. What remains is branding, a button, and an error line fed from `?error=`:

```typescript
signIn(): void {
  const returnUrl = encodeURIComponent(this.returnUrl());
  window.location.href = `${environment.bffUrl}/auth/login?returnUrl=${returnUrl}`;
}
```

It must be `window.location.href`, not the router — the browser has to follow the redirect chain to Keycloak and carry the `__pkce` cookie back.

4. **The auth store exposes a `ready` promise**, and the guard awaits it. Every login now ends in a full page reload, so the guard races the session check on every protected route. Do not poll a `loading()` signal on an interval; hand out the promise the session check already produces.

```typescript
readonly ready: Promise<void>;
constructor() { this.ready = this.checkSession(); }
```

```typescript
export const authGuard: CanMatchFn = async (_route, segments) => {
  const authStore = inject(AuthStore);
  await authStore.ready;
  // ... check roles, return true or a UrlTree to /login?returnUrl=...
};
```

The store's `login()` method disappears entirely — there is nothing left for it to do.

### Step 6: Configure local development (same-origin login)

Local login only works if the browser actually stores and returns the session cookie. Two things break it out of the box:

- **Cross-origin cookies** — `http://localhost:4200` calling `http://localhost:7071` is a cross-site request. Browsers reject the `SameSite=Lax` session cookie there, so login "succeeds" and every following request is anonymous. Fix: proxy `/api` through the dev server so frontend and BFF share one origin.
- **`Secure` over plain http** — browsers silently drop `Secure` cookies on `http://localhost`. Fix: derive the flag from `ALLOWED_ORIGIN` in `session.ts`.

Same-origin has a second payoff here: the redirect URI becomes `http://localhost:4200/api/auth/callback`, so Keycloak needs exactly two registered URIs (dev and prod) rather than a matrix of ports.

1. **Dev-server proxy** — create `proxy.conf.json` at the project root:

```json
{
  "/api": {
    "target": "http://localhost:7071",
    "secure": false
  }
}
```

2. **Wire it into the serve target** in `angular.json` (`projects.<app>.architect.serve.options`):

```json
"serve": {
  "builder": "@angular/build:dev-server",
  "options": {
    "proxyConfig": "proxy.conf.json"
  }
}
```

3. **Run both together** with `concurrently`:

```json
{
  "start": "concurrently \"ng serve\" \"npm run start:bff\"",
  "start:bff": "cd bff && npm start"
}
```

Set `ALLOWED_ORIGIN` to `http://localhost:4200` in `bff/local.settings.json` — it drives the CORS headers, the non-secure cookie fallback, **and the redirect URIs**.

### Step 7: Configure the Keycloak client

The flow cannot work until this is done, and a fresh client has **Standard flow off and no redirect URIs**, which fails with a bare "Invalid parameter: redirect_uri".

| Setting                         | Value                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Client authentication           | **On** (confidential)                                                             |
| Standard flow                   | **On**                                                                            |
| Direct access grants            | **Off** — closes the ROPC path                                                    |
| PKCE Code Challenge Method      | **S256** (Advanced settings)                                                      |
| Valid redirect URIs             | `http://localhost:4200/api/auth/callback`, `https://<swa-host>/api/auth/callback` |
| Valid post logout redirect URIs | `http://localhost:4200/`, `https://<swa-host>/`                                   |
| SSO Session Idle / Max          | these now decide how long a session lives                                         |

When migrating an app that is already live on ROPC, turn **Direct access grants off only after deploying** the new code — otherwise the running version's login breaks immediately.

#file:.github/prompts/create-bff/deployment.md has an Admin-API script for this. Two things to know before reaching for wildcards:

- Redirect URIs accept a trailing `*` in the **path** (`http://localhost:4200/*`). A wildcard in the **host** (`https://*.example.net/*`) is silently never matched.
- Admin-console access tokens live for about 60 seconds. Fetch a token and apply the change in one go, or use client credentials.

### Step 8: Verify

Do not declare this done because the code compiles. Verify from outside, which needs no credentials:

```bash
# 1. The BFF redirects with the right parameters
curl -s -o /dev/null -D - "http://localhost:4200/api/auth/login?returnUrl=/somewhere" \
  | grep -iE "^location:|^set-cookie:"
# expect: 302 to .../protocol/openid-connect/auth with code_challenge_method=S256,
#         and a Set-Cookie for __pkce

# 2. Keycloak enforces PKCE (omit code_challenge -> rejected)
# 3. An unregistered redirect_uri is rejected
# 4. Callback error paths redirect, never return JSON
curl -s -o /dev/null -D - "http://localhost:4200/api/auth/callback?error=access_denied" | grep -i location
```

Then have the user log in for real and watch the function log. **A callback that finishes in a few milliseconds did not exchange anything** — a genuine token exchange takes 100-500 ms. Confirm afterwards that the browser holds `__session.0` (and `.1`), that `/auth/me` reports the user, and that logging out and back in asks for the password again.

### Step 9: Hand over

Tell the user exactly what is left for them, and do not skip the secrets — they cannot be filled in
for them:

1. `npm install` inside `bff/`
2. Put the Keycloak client secret and a fresh `SESSION_SECRET` (`openssl rand -base64 32`) into
   `bff/local.settings.json`
3. Make sure `bff/local.settings.json` is listed in `.gitignore` — add it if it is not, before the
   first commit
4. `npm start` runs the dev server and the BFF together; sign in at `http://localhost:4200`

Deployment is out of scope here: see the note in Step 0 about why the BFF cannot run on the Azure
Storage static website this template deploys to.

The variables `bff/local.settings.json` must carry: `SESSION_SECRET`, `KEYCLOAK_URL`,
`KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `BACKEND_API_URL`, `ALLOWED_ORIGIN`.

## Critical pitfalls to avoid

Real bugs, each of which cost significant debugging time. The first three are silent — nothing throws, nothing logs, the user simply is not logged in.

### The session cookie exceeds 4 KB and is dropped

An access token, a refresh token and an ID token sealed by Iron come to roughly **4.9 KB**. Browsers cap a single cookie at **4096 bytes and discard anything larger without a word**. The login completes perfectly — code exchanged, `Set-Cookie` sent — and `/auth/me` then reports `isAuthenticated: false`.

Split the sealed value across `__session.0`, `__session.1`, … and reassemble on read. Do not try to stay under the limit by dropping the ID token: it is needed as `id_token_hint` for logout.

### Leftover chunks corrupt the next session

If a new session seals into fewer chunks than the previous one, the higher `__session.N` cookies stay in the browser, get appended on the next read, and unsealing fails — logging the user out at random. **Every write path** (callback, refresh in `/auth/me`, refresh in the proxy) must expire the surplus chunks, so pass the incoming `Cookie` header into the cookie builder.

### Logout that does not log out

Clearing the session cookie leaves **Keycloak's SSO session** untouched. The user clicks logout, clicks login, and is straight back in without a password — looking exactly like a bug. Redirect to the `end_session_endpoint` with `id_token_hint` and a registered `post_logout_redirect_uri`. This means storing the ID token in the session.

### The callback is an open redirect

The callback finishes with `302 Location: <returnUrl>`, and `returnUrl` arrives in a query string the attacker controls. Unvalidated, **your domain** forwards freshly authenticated users to a phishing page. Allow only same-site paths: must start with `/`, must not continue with `//` or `/\`. Validate when writing it into the `__pkce` cookie, so the callback can trust its own sealed data.

### Missing configuration fails silently and late

`ALLOWED_ORIGIN` is not decoration once it builds redirect URIs. With a `!` non-null assertion, a missing value produces `undefined/api/auth/callback` and a baffling Keycloak error page. Validate required variables at import time and fail with a message naming the variable. Trim a trailing slash while you are there — Keycloak compares redirect URIs byte for byte, and `//api/auth/callback` is a rejection.

### Azure SWA strips Set-Cookie headers

Azure SWA silently drops `Set-Cookie` headers from managed function responses. Use the `cookies: Cookie[]` property on `HttpResponseInit` instead of setting headers manually. The login appears to succeed (200, correct body) but no cookie is set.

### Azure SWA URL-encodes cookie values

Iron sealed tokens contain `*` (`Fe26.2**...`), which SWA encodes to `%2A`. When the browser sends it back, `unseal()` fails. Always `decodeURIComponent()` before unsealing, with a try/catch fallback for already-decoded values.

### Local login "succeeds" but the user stays logged out

Two independent causes, both silent: a cross-site call to `http://localhost:7071` (proxy `/api` through the dev server instead), and a `Secure` cookie over plain http (derive `secure` from `ALLOWED_ORIGIN`). See Step 6.

### CORS headers on error responses

A failed CSRF or session check still needs CORS headers, or the browser blocks the response and the frontend sees an opaque network error instead of a useful 401/403. Always spread `corsHeaders` into error responses.

### ESM configuration

`jose` is ESM-only. The BFF needs `"type": "module"` in `package.json`, and all local imports need `.js` extensions (`import { foo } from './session.js'`).

### Azure Functions route conflicts

Two functions cannot share a route, even with different methods. For GET and POST on `/entries`, use one file handling both.

### The `api_location` in GitHub Actions

The Azure SWA workflow needs `api_location: "bff"`. Left empty, the BFF is silently not deployed.

### @types/hapi\_\_iron version

Version `^6.0.6` does not exist on npm. Use `^6.0.1`.

### CSRF triggers CORS preflight

The `X-Requested-With` header triggers an OPTIONS preflight. Every fetch endpoint accepting state-changing requests must also accept OPTIONS.

## Tests worth writing

The BFF has no test framework by default and does not need one — `node:test` plus `node:assert` ship with Node. Add `"test": "npm run build && node --test dist/lib/*.spec.js"` and cover the logic that fails silently in production:

- `safeReturnUrl` accepts `/path`, rejects `https://evil.example`, `//evil.example`, `/\evil.example`
- `createPkcePair` produces a verifier whose SHA-256 is the challenge, and a fresh pair each call
- Cookie chunking round-trips a value over 4 KB, and a shorter session expires the previous session's surplus chunks
- A trailing slash on `ALLOWED_ORIGIN` never reaches the redirect URI
- `checkCsrf` rejects a foreign `Origin` **and** a sibling subdomain, and lets a request without any `Origin` through

Because `keycloak.ts` and `csrf.ts` validate their environment at import time, their specs must set `process.env` before a dynamic `await import()`. That is also the cheapest way to test the trailing-slash trim.

## Adding new proxy endpoints

1. Create `bff/src/functions/proxy-<name>.ts`
2. Handle OPTIONS preflight first
3. Check CSRF for state-changing methods
4. Include CORS headers on ALL responses (success AND error)
5. Call `proxyToBackend()` with the backend path
6. Register with `app.http()` including OPTIONS in methods
7. Import the file in `bff/src/index.ts`
8. Build and test locally before deploying

## Environment variables

| Variable                 | Description                                                                                                          | Example                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SESSION_SECRET`         | 32+ char secret for @hapi/iron                                                                                       | `openssl rand -base64 32`                                     |
| `KEYCLOAK_URL`           | Keycloak realm URL                                                                                                   | `https://keycloak.example.com/realms/myapp`                   |
| `KEYCLOAK_CLIENT_ID`     | Confidential client ID                                                                                               | `bff-myapp`                                                   |
| `KEYCLOAK_CLIENT_SECRET` | Client secret from Keycloak                                                                                          | `R8jk2D8...`                                                  |
| `BACKEND_API_URL`        | Backend API base URL                                                                                                 | `https://api.example.com`                                     |
| `ALLOWED_ORIGIN`         | Public origin of the app. Drives CORS, the `Secure` cookie flag, **and the OAuth redirect URIs**. No trailing slash. | `https://myapp.azurestaticapps.net` / `http://localhost:4200` |

Set these in `bff/local.settings.json`, and make sure that file is gitignored. In a deployment on Azure Static Web Apps they would go into the Application Settings via `az staticwebapp appsettings set` — but see Step 0: this template does not deploy to SWA.
