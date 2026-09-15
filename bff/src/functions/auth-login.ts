import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { buildAuthorizeUrl, createPkcePair, randomState, safeReturnUrl } from '../lib/keycloak.js';
import { sealPkce, pkceCookie } from '../lib/session.js';
import { trace } from '../lib/trace.js';

/**
 * Starts the Authorization Code flow. This is a top-level browser navigation,
 * not a fetch — no CSRF header is possible or needed, nothing is mutated.
 */
async function authLogin(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const returnUrl = safeReturnUrl(request.query.get('returnUrl'));

  const sealed = await sealPkce({ verifier, state, returnUrl });
  const location = buildAuthorizeUrl(state, challenge);

  trace(context, 'login: redirecting to Keycloak', { returnUrl, state });

  return {
    status: 302,
    headers: { Location: location },
    cookies: [pkceCookie(sealed)],
  };
}

app.http('auth-login', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLogin,
});
