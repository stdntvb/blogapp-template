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
