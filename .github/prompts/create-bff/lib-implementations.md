# BFF Library Implementations

Complete source code for all shared BFF libraries. These form the foundation that all function endpoints depend on.

## session.ts — Encrypted, chunked session cookies

Uses `@hapi/iron` for symmetric encryption. Cookies are httpOnly (no JS access), SameSite=Lax, and Secure except on plain http.

Three things here are load-bearing:

**Chunking.** An access token, refresh token and ID token sealed by Iron come to roughly 4.9 KB. Browsers cap a single cookie at 4096 bytes and drop larger ones without any error, so the login completes and `/auth/me` still reports nobody. The sealed string is therefore spread over `__session.0`, `__session.1`, … and reassembled on read.

**Expiring surplus chunks.** If a new session needs fewer chunks than the old one, the leftovers would be appended on the next read and break unsealing. `sessionCookies()` takes the incoming `Cookie` header and expires anything beyond the new count.

**`Secure` derived from `ALLOWED_ORIGIN`.** Browsers silently drop `Secure` cookies over plain http, so local dev must omit the flag. Anything not starting with `http://` (including an unset value, i.e. Azure) stays secure.

The `decodeURIComponent()` in `parseCookie` is equally critical: Azure SWA URL-encodes cookie values, turning `Fe26.2**...` into `Fe26.2%2A%2A...`, and `unseal()` then fails silently.

```typescript
import * as Iron from '@hapi/iron';
import type { Cookie } from '@azure/functions';
import type { TokenResponse } from './keycloak.js';

const SESSION_SECRET = process.env.SESSION_SECRET!;

const SESSION_COOKIE = '__session';
const SESSION_MAX_AGE = 86400;

export const PKCE_COOKIE = '__pkce';
const PKCE_MAX_AGE = 600;

// Browsers cap a single cookie at 4 KB and drop oversized ones without a word.
// Three JWTs plus Iron's overhead exceed that, so the sealed session is spread
// over `__session.0`, `__session.1`, … and reassembled on the way in.
const CHUNK_SIZE = 3500;

// Browsers drop `Secure` cookies sent over plain http, so local dev (http://localhost)
// must omit it. Defaults to secure when ALLOWED_ORIGIN is unset (i.e. in Azure).
const SECURE_COOKIE = !process.env.ALLOWED_ORIGIN?.startsWith('http://');

export type SessionData = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
};

/** Login-flow state, held only between the redirect to Keycloak and the callback. */
export type PkceData = {
  verifier: string;
  state: string;
  returnUrl: string;
};

async function seal(data: unknown): Promise<string> {
  return Iron.seal(data, SESSION_SECRET, Iron.defaults);
}

async function unseal<T>(sealed: string): Promise<T | null> {
  try {
    return (await Iron.unseal(sealed, SESSION_SECRET, Iron.defaults)) as T;
  } catch {
    return null;
  }
}

export async function sealSession(data: SessionData): Promise<string> {
  return seal(data);
}

export async function unsealSession(sealed: string): Promise<SessionData | null> {
  return unseal<SessionData>(sealed);
}

export async function sealPkce(data: PkceData): Promise<string> {
  return seal(data);
}

export async function unsealPkce(sealed: string): Promise<PkceData | null> {
  return unseal<PkceData>(sealed);
}

export function sessionFromTokens(tokens: TokenResponse): SessionData {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

export function parseCookie(cookieHeader: string | null, name = SESSION_COOKIE): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  const raw = match.substring(name.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function cookie(name: string, value: string, maxAge: number): Cookie {
  return {
    name,
    value,
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  };
}

export function sessionCookies(sealed: string, cookieHeader: string | null = null): Cookie[] {
  const chunks: Cookie[] = [];
  let i = 0;

  for (; i * CHUNK_SIZE < sealed.length; i++) {
    const value = sealed.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    chunks.push(cookie(`${SESSION_COOKIE}.${i}`, value, SESSION_MAX_AGE));
  }

  // A shorter session leaves the previous session's higher chunks behind, and the
  // next read would glue that stale tail onto the new value and fail to unseal.
  for (; parseCookie(cookieHeader, `${SESSION_COOKIE}.${i}`) !== null; i++) {
    chunks.push(cookie(`${SESSION_COOKIE}.${i}`, '', 0));
  }

  return chunks;
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  const parts: string[] = [];
  for (let i = 0; ; i++) {
    const part = parseCookie(cookieHeader, `${SESSION_COOKIE}.${i}`);
    if (part === null) break;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join('') : null;
}

/** Expires every chunk the browser actually sent, so no stale tail is left behind. */
export function clearSessionCookies(cookieHeader: string | null): Cookie[] {
  const cleared: Cookie[] = [];
  for (let i = 0; parseCookie(cookieHeader, `${SESSION_COOKIE}.${i}`) !== null; i++) {
    cleared.push(cookie(`${SESSION_COOKIE}.${i}`, '', 0));
  }
  return cleared.length > 0 ? cleared : [cookie(`${SESSION_COOKIE}.0`, '', 0)];
}

export function pkceCookie(sealed: string): Cookie {
  return cookie(PKCE_COOKIE, sealed, PKCE_MAX_AGE);
}

export function clearPkceCookie(): Cookie {
  return cookie(PKCE_COOKIE, '', 0);
}

export function isSessionExpired(session: SessionData): boolean {
  return Date.now() >= session.expiresAt;
}
```

## keycloak.ts — OAuth2 integration with PKCE

Implements the Authorization Code Flow with PKCE plus refresh, revocation and RP-initiated logout.

Notes on the design:

- **`requiredEnv` fails at import time.** `ALLOWED_ORIGIN` builds the redirect URIs; with a `!` assertion a missing value silently yields `undefined/api/auth/callback` and a baffling Keycloak error. A trailing slash is trimmed because Keycloak compares redirect URIs byte for byte.
- **`safeReturnUrl` lives here** because it guards the same redirect the callback performs. Anything not a same-site path becomes `/`.
- **No `offline_access` in the scope.** An offline token has no idle timeout and survives an SSO logout, which makes the session effectively unbounded. Without it, Keycloak's SSO Session Idle/Max decide when a session dies.
- `code_challenge_method` is hard-coded to `S256`; `plain` is never offered.

```typescript
import { createHash, randomBytes } from 'node:crypto';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

const KEYCLOAK_URL = requiredEnv('KEYCLOAK_URL');
const CLIENT_ID = requiredEnv('KEYCLOAK_CLIENT_ID');
const CLIENT_SECRET = requiredEnv('KEYCLOAK_CLIENT_SECRET');

// Public origin of the app. Same value as the CORS origin: locally the dev server
// (which proxies /api to the BFF), in Azure the Static Web App hostname. A trailing
// slash would produce a double slash in the redirect URI, which Keycloak compares
// verbatim and rejects.
const APP_BASE_URL = requiredEnv('ALLOWED_ORIGIN').replace(/\/+$/, '');

const SCOPE = 'openid profile email';

export const REDIRECT_URI = `${APP_BASE_URL}/api/auth/callback`;
export const POST_LOGOUT_REDIRECT_URI = `${APP_BASE_URL}/`;

function endpoint(name: string): string {
  return `${KEYCLOAK_URL}/protocol/openid-connect/${name}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
};

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(16).toString('base64url');
}

/** Only same-site paths are valid post-login targets — anything else is an open redirect. */
export function safeReturnUrl(url: string | null | undefined): string {
  if (!url?.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    return '/';
  }
  return url;
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${endpoint('auth')}?${query}`;
}

export function buildLogoutUrl(idToken: string): string {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    id_token_hint: idToken,
    post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI,
  });

  return `${endpoint('logout')}?${query}`;
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(endpoint('token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error_description || 'Token request failed');
  }

  return res.json() as Promise<TokenResponse>;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  );
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  );
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });

  await fetch(endpoint('revoke'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}
```

## cors.ts — CORS handling

Every BFF response must include CORS headers — not just success responses, but also error responses (CSRF failures, session expired). Without them the browser blocks the response entirely and the frontend gets an opaque network error.

With the same-origin dev setup this module is mostly inert, but it costs nothing and covers deployments where the frontend and BFF are on different origins.

```typescript
import { HttpRequest, HttpResponseInit } from '@azure/functions';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN!;

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

export function handlePreflight(request: HttpRequest): HttpResponseInit | null {
  if (request.method !== 'OPTIONS') return null;
  return {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  };
}
```

> Never reflect the request's `Origin` back into `Access-Control-Allow-Origin` either. It looks like it works — every origin gets a matching header — which is exactly the problem: the browser then allows credentialed requests from anywhere, and the check silently stops being a check.

> Never set `Access-Control-Allow-Origin: *` here. Combined with `Allow-Credentials: true` it is invalid per spec and browsers reject it — and since `ALLOWED_ORIGIN` also builds the redirect URIs, `*` would break login outright.

## csrf.ts — CSRF protection

Two independent checks. The `X-Requested-With: XMLHttpRequest` header works because browsers will not send custom headers cross-origin without a preflight, the preflight is only answered for `ALLOWED_ORIGIN`, and form submissions cannot set custom headers. The `Origin` comparison is the server-side counterpart: it holds even if the browser does not enforce CORS, and it fails closed should the CORS headers ever be loosened to reflect the request origin.

Apply it to **fetch-reachable** state-changing endpoints: `auth/logout` and the proxies. `auth/login` and `auth/callback` are browser navigations and structurally cannot carry the header — login mutates nothing, and the callback is protected by the `state` comparison instead.

```typescript
import { HttpRequest, HttpResponseInit } from '@azure/functions';

// Same value the CORS headers use. A trailing slash would never match the
// browser's `Origin`, which is always sent bare.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN!.replace(/\/+$/, '');

function reject(reason: string): HttpResponseInit {
  return { status: 403, jsonBody: { error: reason } };
}

/**
 * Two independent checks against cross-site requests:
 *
 * 1. `X-Requested-With` cannot be set by a form post or an image tag, and a
 *    cross-origin `fetch` that sets it triggers a preflight our CORS handler
 *    only answers for the allowed origin.
 * 2. `Origin` is compared server-side. This does not depend on the browser
 *    enforcing CORS, and it fails closed if the CORS headers are ever loosened
 *    to reflect the request origin. It also closes the gap left by
 *    `SameSite=Lax`, whose boundary is the *site* — a sibling subdomain counts
 *    as same-site and would still get the cookie attached.
 *
 * Requests without an `Origin` header (curl, Postman) pass check 2: they carry
 * no ambient cookies, so they are not the CSRF case. Browsers always send
 * `Origin` on POST.
 */
export function checkCsrf(request: HttpRequest): HttpResponseInit | null {
  if (request.headers.get('x-requested-with') !== 'XMLHttpRequest') {
    return reject('Missing or invalid X-Requested-With header');
  }

  const origin = request.headers.get('origin');
  if (origin !== null && origin !== ALLOWED_ORIGIN) {
    return reject('Origin not allowed');
  }

  return null;
}
```

> The `Origin` check is defence in depth, not the primary barrier — the header check plus a **fixed** `Access-Control-Allow-Origin` already stops classic CSRF in current browsers. Its value is that it does not rely on either of those two things staying correct.

## proxy.ts — Backend proxy with auto-refresh

The core of the BFF:

1. Extracts and unseals the session from the chunked cookie
2. Rejects state-changing requests without a session (401) instead of forwarding them anonymously
3. Refreshes transparently if the access token expired, expiring surplus chunks
4. Attaches the bearer token and forwards to the backend
5. Returns the backend response plus any refreshed session cookies

Reads are allowed through anonymously so public pages keep working; the backend remains the authority either way.

```typescript
import { Cookie, HttpRequest } from '@azure/functions';
import {
  parseSessionCookie,
  unsealSession,
  isSessionExpired,
  sealSession,
  sessionCookies,
  sessionFromTokens,
  clearSessionCookies,
  SessionData,
} from './session.js';
import { refreshTokens } from './keycloak.js';

const BACKEND_API_URL = process.env.BACKEND_API_URL!;

type ProxyResult = {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  cookies: Cookie[];
};

export async function proxyToBackend(
  request: HttpRequest,
  path: string,
  method: string,
): Promise<ProxyResult> {
  const cookieHeader = request.headers.get('cookie');
  const sealed = parseSessionCookie(cookieHeader);
  const responseCookies: Cookie[] = [];

  let session: SessionData | null = null;
  if (sealed) {
    session = await unsealSession(sealed);
  }

  // Reads may pass through anonymously; writes must not reach the backend
  // without a session, even though the backend rejects them too.
  if (!session && method !== 'GET') {
    return {
      status: 401,
      body: { error: 'Authentication required' },
      headers: {},
      cookies: [],
    };
  }

  let accessToken: string | undefined;

  if (session) {
    if (isSessionExpired(session)) {
      try {
        const tokens = await refreshTokens(session.refreshToken);
        session = sessionFromTokens(tokens);
        const newSealed = await sealSession(session);
        responseCookies.push(...sessionCookies(newSealed, cookieHeader));
      } catch {
        return {
          status: 401,
          body: { error: 'Session expired' },
          headers: {},
          cookies: clearSessionCookies(cookieHeader),
        };
      }
    }
    accessToken = session.accessToken;
  }

  const backendHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    backendHeaders['Authorization'] = `Bearer ${accessToken}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers: backendHeaders,
  };

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const body = await request.text();
    if (body) {
      fetchOptions.body = body;
    }
  }

  const queryString = request.query.toString();
  const url = queryString
    ? `${BACKEND_API_URL}${path}?${queryString}`
    : `${BACKEND_API_URL}${path}`;
  const backendRes = await fetch(url, fetchOptions);
  const responseBody = await backendRes.json().catch(() => null);

  return {
    status: backendRes.status,
    body: responseBody,
    headers: {},
    cookies: responseCookies,
  };
}
```

## Tests — node:test, no framework needed

Add to `bff/package.json`:

```json
"scripts": {
  "test": "npm run build && node --test dist/lib/*.spec.js"
}
```

`keycloak.spec.ts` must set the environment before importing, because `keycloak.ts` validates at import time. The deliberate trailing slash doubles as the trim test.

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.KEYCLOAK_URL ??= 'https://keycloak.test/realms/test';
process.env.KEYCLOAK_CLIENT_ID ??= 'test-client';
process.env.KEYCLOAK_CLIENT_SECRET ??= 'test-secret';
process.env.ALLOWED_ORIGIN ??= 'http://localhost:4200/';

const { createPkcePair, safeReturnUrl, REDIRECT_URI, buildAuthorizeUrl } =
  await import('./keycloak.js');

test('safeReturnUrl rejects anything that could leave the site', () => {
  for (const hostile of [
    'https://phishing.example/login',
    '//phishing.example/login',
    '/\\phishing.example',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeReturnUrl(hostile), '/', `should reject ${hostile}`);
  }
  assert.equal(safeReturnUrl('/add-blog'), '/add-blog');
});

test('createPkcePair derives an S256 challenge from the verifier', async () => {
  const { createHash } = await import('node:crypto');
  const { verifier, challenge } = createPkcePair();

  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual(createPkcePair().verifier, verifier);
});

test('a trailing slash on ALLOWED_ORIGIN does not reach the redirect URI', () => {
  assert.equal(REDIRECT_URI, 'http://localhost:4200/api/auth/callback');
});

test('the authorize URL always demands S256', () => {
  const params = new URL(buildAuthorizeUrl('state-value', 'challenge-value')).searchParams;
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.ok(!params.get('scope')?.includes('offline_access'));
});
```

`session.spec.ts` covers the chunking, including the failure mode that caused the silent logout:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearSessionCookies, parseSessionCookie, sessionCookies } from './session.js';

/** Rebuilds the `Cookie:` header a browser would send back for these cookies. */
function asHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
}

test('a session larger than one cookie survives the round trip', () => {
  // Realistic size: three Keycloak JWTs sealed by Iron came to 4857 bytes.
  const sealed = 'Fe26.2**' + 'x'.repeat(4849);
  const cookies = sessionCookies(sealed);

  assert.ok(cookies.length > 1);
  for (const c of cookies) {
    assert.ok(c.value.length <= 3500, `${c.name} must stay under the 4 KB browser cap`);
  }
  assert.equal(parseSessionCookie(asHeader(cookies)), sealed);
});

test('a shorter session expires the previous session leftover chunks', () => {
  const previous = asHeader(sessionCookies('o'.repeat(8000))); // 3 chunks
  const cookies = sessionCookies('n'.repeat(100), previous); // 1 chunk

  assert.deepEqual(
    cookies.map((c) => [c.name, c.maxAge]),
    [
      ['__session.0', 86400],
      ['__session.1', 0],
      ['__session.2', 0],
    ],
  );

  const kept = cookies.filter((c) => c.maxAge !== 0);
  assert.equal(parseSessionCookie(asHeader(kept)), 'n'.repeat(100));
});

test('clearing expires every chunk the browser sent', () => {
  const cleared = clearSessionCookies(asHeader(sessionCookies('y'.repeat(8000))));
  assert.equal(cleared.length, 3);
  for (const c of cleared) {
    assert.equal(c.maxAge, 0);
  }
});
```

`csrf.spec.ts` reads its environment at import time as well, so the same dynamic-import trick applies. The sibling-subdomain case is the one worth writing down — it is the one `SameSite=Lax` alone does not cover:

```typescript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HttpRequest } from '@azure/functions';

process.env.ALLOWED_ORIGIN ??= 'https://my-app.net';

const { checkCsrf } = await import('./csrf.js');

/** Just enough of an `HttpRequest` for `checkCsrf`. */
function request(headers: Record<string, string>): HttpRequest {
  return { headers: new Headers(headers) } as unknown as HttpRequest;
}

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

test('a request from the app passes', () => {
  assert.equal(checkCsrf(request({ ...XHR, Origin: 'https://my-app.net' })), null);
});

test('a form post from another site has no X-Requested-With', () => {
  const result = checkCsrf(request({ Origin: 'https://evil.example' }));
  assert.equal(result?.status, 403);
});

test('a sibling subdomain is same-site for the cookie but not an allowed origin', () => {
  // SameSite=Lax would still attach the session cookie here — the Origin check
  // is what stops the request.
  const result = checkCsrf(request({ ...XHR, Origin: 'https://evil.my-app.net' }));
  assert.equal(result?.status, 403);
});

test('a client without an Origin header is not the CSRF case', () => {
  assert.equal(checkCsrf(request(XHR)), null);
});
```
