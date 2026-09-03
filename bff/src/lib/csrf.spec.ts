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
