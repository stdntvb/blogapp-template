import { app, Cookie, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
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
import { trace } from '../lib/trace.js';
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

async function authMe(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
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

  const user = userFromToken(session.accessToken);
  trace(context, 'me: authenticated', { user: user.preferred_username, roles: user.roles });

  return {
    status: 200,
    jsonBody: { isAuthenticated: true, user },
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
