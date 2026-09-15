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

const BACKEND_API_URL = (process.env.BLOG_BACKEND_URL ?? process.env.BACKEND_API_URL)!;

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
