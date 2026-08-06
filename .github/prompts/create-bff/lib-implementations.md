# BFF Library Implementations

Complete source code for all shared BFF libraries. These form the foundation that all function endpoints depend on.

## session.ts — Encrypted session cookies

Uses `@hapi/iron` for symmetric encryption. The session cookie is httpOnly (no JS access), Secure (HTTPS only), SameSite=Lax (CSRF baseline protection).

`Secure` is derived from `ALLOWED_ORIGIN`: browsers silently drop `Secure` cookies sent over plain http, so local dev on `http://localhost` must omit the flag or login never sticks. Anything else (including an unset `ALLOWED_ORIGIN`, i.e. Azure) stays secure.

The `decodeURIComponent()` in `parseCookie` is critical: Azure SWA URL-encodes cookie values, turning `Fe26.2**...` into `Fe26.2%2A%2A...`. Without decoding, `unseal()` fails silently and the user appears logged out.

```typescript
import * as Iron from '@hapi/iron';
import type { Cookie } from '@azure/functions';

const SESSION_SECRET = process.env.SESSION_SECRET!;
const COOKIE_NAME = '__session';

// Browsers drop `Secure` cookies sent over plain http, so local dev (http://localhost)
// must omit it. Defaults to secure when ALLOWED_ORIGIN is unset (i.e. in Azure).
const SECURE_COOKIE = !process.env.ALLOWED_ORIGIN?.startsWith('http://');

export type SessionData = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export async function sealSession(data: SessionData): Promise<string> {
  return Iron.seal(data, SESSION_SECRET, Iron.defaults);
}

export async function unsealSession(cookie: string): Promise<SessionData | null> {
  try {
    return (await Iron.unseal(cookie, SESSION_SECRET, Iron.defaults)) as SessionData;
  } catch {
    return null;
  }
}

export function parseCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const raw = match.substring(COOKIE_NAME.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function sessionCookie(sealed: string): Cookie {
  return {
    name: COOKIE_NAME,
    value: sealed,
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: 'Lax',
    path: '/',
    maxAge: 86400,
  };
}

export function clearSessionCookieObj(): Cookie {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: SECURE_COOKIE,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  };
}

export function isSessionExpired(session: SessionData): boolean {
  return Date.now() >= session.expiresAt;
}
```

## keycloak.ts — OAuth2 integration

Implements three OAuth2 flows against Keycloak's token and revocation endpoints:

- **ROPC (password grant)** for login — the BFF collects credentials via a custom login form, not a Keycloak redirect
- **Refresh token grant** for transparent token renewal
- **Token revocation** for logout (best-effort, errors swallowed)

The Keycloak client must be configured as a "confidential" client with "Direct Access Grants" (ROPC) enabled. The `offline_access` scope ensures refresh tokens are issued.

```typescript
const KEYCLOAK_URL = process.env.KEYCLOAK_URL!;
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID!;
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET!;

function tokenEndpoint(): string {
  return `${KEYCLOAK_URL}/protocol/openid-connect/token`;
}

function revokeEndpoint(): string {
  return `${KEYCLOAK_URL}/protocol/openid-connect/revoke`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export async function authenticateUser(username: string, password: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username,
    password,
    scope: 'openid profile email offline_access',
  });

  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error_description || 'Authentication failed');
  }

  return res.json() as Promise<TokenResponse>;
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error('Token refresh failed');
  }

  return res.json() as Promise<TokenResponse>;
}

export async function revokeToken(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });

  await fetch(revokeEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}
```

## cors.ts — CORS handling

Every BFF response must include CORS headers — not just success responses, but also error responses (CSRF failures, session expired, etc.). Without CORS headers on error responses, the browser blocks the response entirely and the frontend gets an opaque network error.

The `X-Requested-With` header in `Allow-Headers` is critical because the CSRF check requires it, and custom headers trigger CORS preflight.

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

## csrf.ts — CSRF protection

A lightweight CSRF check using the `X-Requested-With: XMLHttpRequest` custom header. This works because:

1. Browsers won't send custom headers on cross-origin requests without a CORS preflight
2. The CORS preflight will be rejected unless the request comes from `ALLOWED_ORIGIN`
3. Simple form submissions and link navigations cannot set custom headers

Only enforce CSRF on state-changing operations (POST, PUT, DELETE). GET endpoints skip this check.

```typescript
import { HttpRequest, HttpResponseInit } from '@azure/functions';

export function checkCsrf(request: HttpRequest): HttpResponseInit | null {
  const xRequestedWith = request.headers.get('x-requested-with');
  if (xRequestedWith !== 'XMLHttpRequest') {
    return {
      status: 403,
      jsonBody: { error: 'Missing or invalid X-Requested-With header' },
    };
  }
  return null;
}
```

## proxy.ts — Backend proxy with auto-refresh

The proxy is the core of the BFF. It:

1. Extracts the session cookie and decrypts it
2. Checks if the access token has expired
3. If expired, refreshes transparently using the refresh token
4. Attaches the (possibly refreshed) access token as a Bearer header
5. Forwards the request to the backend API
6. Returns the backend response along with any refreshed session cookie

If the refresh fails, the session is cleared and a 401 is returned. The frontend should handle this by redirecting to the login page.

```typescript
import { Cookie, HttpRequest } from '@azure/functions';
import {
  parseCookie,
  unsealSession,
  isSessionExpired,
  sealSession,
  sessionCookie,
  clearSessionCookieObj,
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
  const sealed = parseCookie(cookieHeader);
  const responseCookies: Cookie[] = [];

  let session: SessionData | null = null;
  if (sealed) {
    session = await unsealSession(sealed);
  }

  let accessToken: string | undefined;

  if (session) {
    if (isSessionExpired(session)) {
      try {
        const tokens = await refreshTokens(session.refreshToken);
        session = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
        };
        const newSealed = await sealSession(session);
        responseCookies.push(sessionCookie(newSealed));
      } catch {
        return {
          status: 401,
          body: { error: 'Session expired' },
          headers: {},
          cookies: [clearSessionCookieObj()],
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
