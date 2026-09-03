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
