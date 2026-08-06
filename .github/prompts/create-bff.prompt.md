---
description: >
  Set up a Backend-for-Frontend (BFF) using Azure Functions v4, Keycloak OAuth2, encrypted session cookies (@hapi/iron), CORS, CSRF protection, and a backend proxy deployed to Azure Static Web Apps.
  Use this prompt whenever someone needs to: create a BFF, add server-side auth to an SPA, proxy API calls through Azure Functions, integrate Keycloak with a BFF, deploy Azure Functions alongside a frontend on Azure SWA, add login/logout endpoints, set up session cookies, secure API calls without tokens in the browser, add cookie-based auth, migrate from SPA-based OIDC or PKCE to a BFF, troubleshoot CORS/CSRF in a BFF, or set up server-side session management.
mode: agent
---

# Create a BFF (Backend-for-Frontend) with Azure Functions

This prompt guides you through creating a complete BFF layer using Azure Functions v4 (TypeScript, ESM) that sits between an SPA frontend and a backend API. The BFF handles authentication via Keycloak, manages encrypted session cookies, enforces CSRF protection, and proxies API requests with bearer token injection.

## Reference files

Read the following reference files for exact implementation details:

- Project setup (package.json, tsconfig, host.json): #file:.github/prompts/create-bff/project-setup.md
- Library implementations (session, keycloak, cors, csrf, proxy): #file:.github/prompts/create-bff/lib-implementations.md
- Function endpoints (auth-login, auth-logout, auth-me, proxies): #file:.github/prompts/create-bff/function-implementations.md
- Deployment (GitHub Actions, Azure SWA, Keycloak setup): #file:.github/prompts/create-bff/deployment.md

## When to use this pattern

The BFF pattern is the right choice when:

- Your SPA needs to authenticate users but you don't want tokens in the browser (XSS risk)
- You're deploying to Azure Static Web Apps and need a server-side auth layer
- You want automatic token refresh transparent to the frontend
- You're migrating away from SPA-based OIDC (angular-auth-oidc-client, PKCE) to server-side session management

## Why ROPC (Resource Owner Password Credentials) grant?

This BFF uses the ROPC grant (password grant) rather than Authorization Code flow. This means the SPA collects credentials via a custom login form and sends them to the BFF, which forwards them to Keycloak. This is appropriate when:

- You want a **custom-branded login UI** (no redirect to Keycloak login page)
- The app is **internal or first-party** (you control both the frontend and the identity provider)
- You need a **simple auth flow** without browser redirects

If your app is public-facing or must comply with OAuth 2.1 (which deprecates ROPC), use Authorization Code flow with PKCE instead. The Keycloak client must have "Direct Access Grants" enabled for ROPC.

> **Note:** The reference files use blog-specific names (e.g., `BACKEND_API_URL`, `proxy-entries`). Adapt resource names, routes, and backend paths to your project's domain.

## Architecture overview

```
Frontend (SPA)
    | fetch with credentials (cookies)
    v
BFF (Azure Functions v4)
    |-- Session Management (@hapi/iron sealed cookies)
    |-- CSRF Validation (X-Requested-With header)
    |-- CORS Handling (preflight + response headers)
    |-- Token Management (Keycloak OAuth2 ROPC)
    |   \-- Auto-refresh on expiry
    \-- Backend Proxy
        \-- Attach bearer token --> Backend API
```

## Step-by-step implementation

### Step 1: Scaffold the BFF directory

Create a `bff/` directory at the project root with the structure below. Read the **project-setup** reference for the exact file contents.

```
bff/
  src/
    index.ts              # Entry point - imports all function files
    lib/
      session.ts          # @hapi/iron seal/unseal + cookie helpers
      keycloak.ts         # OAuth2 ROPC auth, refresh, revoke
      cors.ts             # CORS preflight + response headers
      csrf.ts             # X-Requested-With header check
      proxy.ts            # Backend proxy with auto-refresh
    functions/
      auth-login.ts       # POST /api/auth/login
      auth-logout.ts      # POST /api/auth/logout
      auth-me.ts          # GET /api/auth/me
      auth-refresh.ts     # POST /api/auth/refresh
      proxy-*.ts          # One file per proxied resource
  package.json
  tsconfig.json
  host.json
  local.settings.json     # Not committed - env vars for local dev
```

### Step 2: Implement shared libraries

Read the **lib-implementations** reference for the exact source code of all five library files. Copy these as-is, then adapt environment variable names and backend URL patterns to the target project. The key design decisions:

1. **session.ts** — Uses `@hapi/iron` for symmetric encryption of `{ accessToken, refreshToken, expiresAt }`. Cookie is httpOnly, SameSite=Lax, and `Secure` unless `ALLOWED_ORIGIN` is an `http://` URL (local dev). Includes `decodeURIComponent()` fallback because Azure SWA URL-encodes cookie values.

2. **keycloak.ts** — Resource Owner Password Credentials (ROPC) grant for login, refresh_token grant for renewal, token revocation for logout. Uses `URLSearchParams` for form-encoded bodies.

3. **cors.ts** — Every response includes `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials: true`. Preflight returns 204 with allowed methods and headers.

4. **csrf.ts** — Validates `X-Requested-With: XMLHttpRequest` on state-changing requests (POST, PUT). Returns 403 if missing.

5. **proxy.ts** — Extracts session from cookie, auto-refreshes if expired, attaches bearer token, forwards request to backend. Returns refreshed cookie if token was renewed.

### Step 3: Implement Azure Function endpoints

Read the **function-implementations** reference for complete source code. Adapt the proxy endpoints to your domain's resources. Every function follows this pattern:

```typescript
async function handler(request: HttpRequest): Promise<HttpResponseInit> {
  // 1. Handle CORS preflight
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // 2. Check CSRF (only for state-changing methods)
  if (request.method === 'POST' || request.method === 'PUT') {
    const csrfError = checkCsrf(request);
    if (csrfError) return { ...csrfError, headers: corsHeaders }; // CORS on errors too!
  }

  // 3. Do the work (auth or proxy)
  // 4. Return response with corsHeaders and cookies array
}

app.http('function-name', {
  methods: ['POST', 'OPTIONS'], // Always include OPTIONS
  authLevel: 'anonymous',
  route: 'your/route',
  handler,
});
```

### Step 4: Register all functions in index.ts

The entry point must import every function file so Azure Functions discovers them:

```typescript
import './functions/auth-login.js';
import './functions/auth-logout.js';
// ... all other functions
```

This file is referenced by `"main": "dist/index.js"` in `package.json`.

### Step 5: Configure the frontend

The frontend needs two changes:

1. **HTTP interceptor** — Cookies are not sent cross-origin by default, and the CSRF header must be present on every state-changing request. Example for Angular:

```typescript
export const bffInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith(environment.bffUrl)) {
    req = req.clone({
      withCredentials: true,
      setHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  }
  return next(req);
};
```

2. **Environment config** — Use `/api` in **both** environments. Production is same-origin via Azure SWA; development is made same-origin by the dev-server proxy (Step 6). Do not point development at `http://localhost:7071/api` — that is cross-origin and breaks the login cookie (see Step 6).

```typescript
// src/environments/environment.development.ts
export const environment = {
  production: false,
  // Same-origin as production: ng serve proxies /api to the BFF (see proxy.conf.json)
  bffUrl: '/api',
};
```

### Step 6: Configure local development (same-origin login)

Local login only works if the browser actually stores and returns the session cookie. Two things break it out of the box:

- **Cross-origin cookies** — `http://localhost:4200` calling `http://localhost:7071` is a cross-site request. Modern browsers reject the `SameSite=Lax` session cookie there, so login returns 200 but every following request is anonymous. Fix: proxy `/api` through the dev server so frontend and BFF share one origin.
- **`Secure` over plain http** — browsers silently drop `Secure` cookies on `http://localhost`. Fix: derive the flag from `ALLOWED_ORIGIN` in `session.ts` (see **lib-implementations** reference).

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
  },
  "configurations": { }
}
```

3. **Run both together** with `concurrently`:

```json
{
  "start": "concurrently \"ng serve\" \"npm run start:bff\"",
  "start:bff": "cd bff && npm start"
}
```

Set `ALLOWED_ORIGIN` to `http://localhost:4200` in `bff/local.settings.json` — it drives both the CORS headers and the non-secure cookie fallback.

### Step 7: Deploy to Azure Static Web Apps

Read the **deployment** reference for the full deployment guide including GitHub Actions workflow config and environment variable setup.

### Step 8: Verify environment variables on Azure SWA

After deploying, verify that all required environment variables are set. Present the `az staticwebapp appsettings set` command from the deployment reference to the user and ask them to fill in their values (do NOT set secrets yourself). Then verify:

```bash
az staticwebapp appsettings list --name <swa-name> --query "[].name" -o tsv
```

All six must be present: `SESSION_SECRET`, `KEYCLOAK_URL`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `BACKEND_API_URL`, `ALLOWED_ORIGIN`.

## Critical pitfalls to avoid

These are real bugs encountered during development and deployment. Each one cost significant debugging time:

### Azure SWA strips Set-Cookie headers

Azure SWA silently drops `Set-Cookie` headers from managed function responses. Use the `cookies: Cookie[]` property on `HttpResponseInit` instead of setting headers manually. This is the single most painful bug in the entire BFF setup because the login appears to succeed (200 response with correct body) but no cookie is set.

### Azure SWA URL-encodes cookie values

`@hapi/iron` sealed tokens contain `*` characters (e.g., `Fe26.2**...`). Azure SWA encodes these to `%2A`. When the browser sends the cookie back, `unseal()` fails on the encoded string. Always `decodeURIComponent()` the cookie value before unsealing, with a try/catch fallback for already-decoded values.

### Local login "succeeds" but the user stays logged out

Two independent causes, both silent:

1. The frontend calls `http://localhost:7071` directly while served from `http://localhost:4200` — cross-site request, browser discards the `SameSite=Lax` session cookie. Proxy `/api` through the dev server instead (Step 6).
2. The cookie carries `Secure` over plain http — browser discards it. Derive `secure` from `ALLOWED_ORIGIN` instead of hardcoding `true`.

### CORS headers on error responses

When a CSRF check or session validation fails, the error response still needs CORS headers. Without them, the browser blocks the error response entirely and the frontend gets an opaque network error instead of a useful 401/403. Always spread `corsHeaders` into error responses.

### ESM configuration

`jose` (used for JWT decoding) is ESM-only. The BFF must have `"type": "module"` in `package.json`. All local imports need `.js` extensions (e.g., `import { foo } from './session.js'`).

### Azure Functions route conflicts

Two Azure Functions cannot share the same route, even with different HTTP methods. If you need GET and POST on `/entries`, use a single function file that handles both methods.

### The `api_location` in GitHub Actions

The Azure SWA GitHub Actions workflow needs `api_location: "bff"` to deploy the managed functions. If left empty, the BFF code is silently not deployed.

### @types/hapi\_\_iron version

The `@types/hapi__iron` package version `^6.0.6` does not exist on npm. Use `^6.0.1`.

### CSRF triggers CORS preflight

The `X-Requested-With` custom header triggers a CORS preflight (OPTIONS) request. Every endpoint that accepts state-changing requests must also accept OPTIONS and return proper CORS headers.

## Adding new proxy endpoints

When adding a new proxied resource, follow this checklist:

1. Create `bff/src/functions/proxy-<name>.ts`
2. Handle OPTIONS preflight first
3. Check CSRF for state-changing methods (POST, PUT, DELETE)
4. Include CORS headers on ALL responses (success AND error)
5. Call `proxyToBackend()` with the backend path
6. Register the function with `app.http()` including OPTIONS in methods
7. Import the file in `bff/src/index.ts`
8. Build and test locally before deploying

## Environment variables

| Variable                 | Description                                                                                       | Example                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SESSION_SECRET`         | 32+ char secret for @hapi/iron                                                                    | `openssl rand -base64 32`                                     |
| `KEYCLOAK_URL`           | Keycloak realm URL                                                                                | `https://keycloak.example.com/realms/myapp`                   |
| `KEYCLOAK_CLIENT_ID`     | Confidential client ID                                                                            | `bff-myapp`                                                   |
| `KEYCLOAK_CLIENT_SECRET` | Client secret from Keycloak                                                                       | `R8jk2D8...`                                                  |
| `BACKEND_API_URL`        | Backend API base URL                                                                              | `https://api.example.com`                                     |
| `ALLOWED_ORIGIN`         | Frontend origin for CORS; an `http://` value also disables the `Secure` cookie flag for local dev | `https://myapp.azurestaticapps.net` / `http://localhost:4200` |

For local development, set these in `bff/local.settings.json` (gitignored). For production, set them as Azure SWA Application Settings via `az staticwebapp appsettings set`.
