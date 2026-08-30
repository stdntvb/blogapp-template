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
