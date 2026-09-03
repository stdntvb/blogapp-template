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
