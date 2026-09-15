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
