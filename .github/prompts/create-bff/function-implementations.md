# BFF Function Implementations

Complete source code for all Azure Function endpoints.

Two shapes exist, and confusing them is the most common mistake:

- **Navigation endpoints** (`auth/login`, `auth/callback`) — the browser goes there directly. `methods: ["GET"]` only, no CORS, no CSRF, and every outcome is a redirect. Returning JSON from these means the user stares at raw JSON in the address bar.
- **Fetch endpoints** (`auth/me`, `auth/logout`, all proxies) — preflight, CSRF on state-changing methods, CORS headers on every response including errors, cookies via the `cookies` array.

## auth-login.ts — GET /api/auth/login

Starts the flow. Generates the PKCE pair and `state`, validates `returnUrl`, stores all three in the short-lived sealed `__pkce` cookie, and redirects to Keycloak.

Azure Functions are stateless and there is no session store, so the `__pkce` cookie _is_ the state between the two requests. `SameSite=Lax` sends it back on the callback because that is a top-level GET navigation.

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { buildAuthorizeUrl, createPkcePair, randomState, safeReturnUrl } from '../lib/keycloak.js';
import { sealPkce, pkceCookie } from '../lib/session.js';

/**
 * Starts the Authorization Code flow. This is a top-level browser navigation,
 * not a fetch — no CSRF header is possible or needed, nothing is mutated.
 */
async function authLogin(request: HttpRequest): Promise<HttpResponseInit> {
  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const returnUrl = safeReturnUrl(request.query.get('returnUrl'));

  const sealed = await sealPkce({ verifier, state, returnUrl });

  return {
    status: 302,
    headers: { Location: buildAuthorizeUrl(state, challenge) },
    cookies: [pkceCookie(sealed)],
  };
}

app.http('auth-login', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLogin,
});
```

## auth-callback.ts — GET /api/auth/callback

Completes the flow. Compares `state` against the sealed cookie, exchanges the code for tokens, and swaps the flow cookie for the session cookies.

The `state` comparison is what protects this endpoint — it is exactly why `state` exists, and it substitutes for the CSRF header a navigation cannot carry.

Every failure redirects to `/login?error=…` with one of three user-facing codes. Details go to the log, not the URL: the browser only needs to know whether to apologise, ask again, or offer a retry.

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { exchangeCode } from '../lib/keycloak.js';
import {
  PKCE_COOKIE,
  clearPkceCookie,
  parseCookie,
  sealSession,
  sessionCookies,
  sessionFromTokens,
  unsealPkce,
} from '../lib/session.js';

type LoginError = 'access_denied' | 'expired' | 'failed';

function backToLogin(reason: LoginError): HttpResponseInit {
  return {
    status: 302,
    headers: { Location: `/login?error=${reason}` },
    cookies: [clearPkceCookie()],
  };
}

async function authCallback(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const error = request.query.get('error');
  if (error) {
    context.log(`Keycloak rejected the login: ${error}`);
    return backToLogin(error === 'access_denied' ? 'access_denied' : 'failed');
  }

  const sealed = parseCookie(request.headers.get('cookie'), PKCE_COOKIE);
  const pkce = sealed ? await unsealPkce(sealed) : null;
  if (!pkce) {
    return backToLogin('expired');
  }

  if (request.query.get('state') !== pkce.state) {
    context.error('Callback state does not match the one issued at login');
    return backToLogin('failed');
  }

  const code = request.query.get('code');
  if (!code) {
    return backToLogin('failed');
  }

  try {
    const tokens = await exchangeCode(code, pkce.verifier);
    const session = await sealSession(sessionFromTokens(tokens));

    return {
      status: 302,
      headers: { Location: pkce.returnUrl },
      cookies: [...sessionCookies(session, request.headers.get('cookie')), clearPkceCookie()],
    };
  } catch (err) {
    context.error('Token exchange failed', err);
    return backToLogin('failed');
  }
}

app.http('auth-callback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/callback',
  handler: authCallback,
});
```

`pkce.returnUrl` is safe to redirect to without re-checking: it was validated by `safeReturnUrl()` before being sealed, and the seal is authenticated.

## auth-me.ts — GET /api/auth/me

The only way the SPA learns who is logged in. Called on every app start, and therefore after every login, since the callback ends in a full page load.

Refreshes transparently when the token has expired. Never returns 401 for "not logged in" — an anonymous visitor is a normal state, not an error.

`decodeJwt()` does not verify the signature, which is fine: the token came straight from Keycloak over HTTPS into a sealed cookie, and the backend verifies it for real.

```typescript
import { app, Cookie, HttpRequest, HttpResponseInit } from '@azure/functions';
import {
  parseSessionCookie,
  unsealSession,
  isSessionExpired,
  sealSession,
  sessionCookies,
  sessionFromTokens,
  clearSessionCookies,
} from '../lib/session.js';
import { refreshTokens } from '../lib/keycloak.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
import { decodeJwt } from 'jose';

function userFromToken(accessToken: string) {
  const claims = decodeJwt(accessToken) as Record<string, unknown>;
  const realmAccess = claims.realm_access as { roles: string[] } | undefined;

  return {
    preferred_username: claims.preferred_username,
    email: claims.email,
    name: claims.name,
    roles: realmAccess?.roles ?? [],
  };
}

async function authMe(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const cookieHeader = request.headers.get('cookie');
  const sealed = parseSessionCookie(cookieHeader);

  if (!sealed) {
    return {
      status: 200,
      jsonBody: { isAuthenticated: false, user: null },
      headers: corsHeaders,
    };
  }

  let session = await unsealSession(sealed);
  if (!session) {
    return {
      status: 200,
      jsonBody: { isAuthenticated: false, user: null },
      headers: corsHeaders,
      cookies: clearSessionCookies(cookieHeader),
    };
  }

  const extraCookies: Cookie[] = [];

  if (isSessionExpired(session)) {
    try {
      const tokens = await refreshTokens(session.refreshToken);
      session = sessionFromTokens(tokens);
      extraCookies.push(...sessionCookies(await sealSession(session), cookieHeader));
    } catch {
      // Keycloak's SSO Session Idle/Max has run out — the session is genuinely over.
      return {
        status: 200,
        jsonBody: { isAuthenticated: false, user: null },
        headers: corsHeaders,
        cookies: clearSessionCookies(cookieHeader),
      };
    }
  }

  return {
    status: 200,
    jsonBody: { isAuthenticated: true, user: userFromToken(session.accessToken) },
    headers: corsHeaders,
    cookies: extraCookies.length > 0 ? extraCookies : undefined,
  };
}

app.http('auth-me', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: authMe,
});
```

## auth-logout.ts — POST /api/auth/logout

Revokes the refresh token, clears the session chunks, and hands back the Keycloak end-session URL for the client to navigate to.

**Why it stays a POST.** Making logout a redirect endpoint would strip its CSRF protection — a navigation cannot carry `X-Requested-With`, so any page could log your users out with an `<img src>`. Returning the URL as JSON keeps the check and still ends the SSO session.

**Why `id_token_hint` matters.** Without the end-session call, Keycloak's SSO session survives. The user logs out, clicks login, and is back in without a password — indistinguishable from a bug. This is the reason the ID token is stored in the session at all.

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { parseSessionCookie, unsealSession, clearSessionCookies } from '../lib/session.js';
import { buildLogoutUrl, revokeToken, POST_LOGOUT_REDIRECT_URI } from '../lib/keycloak.js';
import { checkCsrf } from '../lib/csrf.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

async function authLogout(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const csrfError = checkCsrf(request);
  if (csrfError) return { ...csrfError, headers: corsHeaders };

  const cookieHeader = request.headers.get('cookie');
  const sealed = parseSessionCookie(cookieHeader);
  const session = sealed ? await unsealSession(sealed) : null;

  let logoutUrl = POST_LOGOUT_REDIRECT_URI;

  if (session) {
    await revokeToken(session.refreshToken).catch(() => {
      /* ignore */
    });
    logoutUrl = buildLogoutUrl(session.idToken);
  }

  return {
    status: 200,
    jsonBody: { logoutUrl },
    headers: corsHeaders,
    cookies: clearSessionCookies(cookieHeader),
  };
}

app.http('auth-logout', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: authLogout,
});
```

> There is no `auth-refresh.ts`. Refresh already happens inside `auth-me` and the proxy before the real work, so an explicit endpoint is code the frontend never calls — and one more place to keep in sync.

## Proxy endpoints

All proxy endpoints follow the same pattern. Authorisation lives in `proxyToBackend()`: it returns 401 for state-changing requests without a session, so these files only handle routing and CSRF.

### proxy-entries.ts — GET/POST /api/entries

Handles both read (GET, public) and create (POST, auth + CSRF required) on the same route. Two functions cannot share a route in Azure Functions, so both methods live in one file.

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { checkCsrf } from '../lib/csrf.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

async function proxyEntries(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method === 'POST') {
    const csrfError = checkCsrf(request);
    if (csrfError) return { ...csrfError, headers: corsHeaders };
  }

  const result = await proxyToBackend(request, '/entries', request.method);

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-entries', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries',
  handler: proxyEntries,
});
```

### proxy-entry-by-id.ts — GET /api/entries/{id}

Route parameter with type constraint. The `{id:int}` ensures only numeric IDs match.

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

async function proxyEntryById(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const id = request.params.id;
  const result = await proxyToBackend(request, '/entries/' + id, 'GET');

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-entry-by-id', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries/{id:int}',
  handler: proxyEntryById,
});
```

### proxy-like.ts — PUT /api/entries/{id}/like

State-changing operation with CSRF check. Note CORS headers are spread into the CSRF error response — without this, the browser blocks the 403 entirely. The BFF route (`/like`) maps to a different backend path (`/like-info`) — adapt this mapping to your backend's actual API paths.

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
import { checkCsrf } from '../lib/csrf.js';

async function proxyLike(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const csrf = checkCsrf(request);
  if (csrf) return { ...csrf, headers: corsHeaders };

  const id = request.params.id;
  const result = await proxyToBackend(request, '/entries/' + id + '/like-info', 'PUT');

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-like', {
  methods: ['PUT', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries/{id:int}/like',
  handler: proxyLike,
});
```

### proxy-comment.ts — POST /api/entries/{id}/comments

```typescript
import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';
import { checkCsrf } from '../lib/csrf.js';

async function proxyComment(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const csrf = checkCsrf(request);
  if (csrf) return { ...csrf, headers: corsHeaders };

  const id = request.params.id;
  const result = await proxyToBackend(request, '/entries/' + id + '/comments', 'POST');

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-comment', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries/{id:int}/comments',
  handler: proxyComment,
});
```
