import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { checkCsrf } from '../lib/csrf.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

async function proxyEntries(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method === 'POST') {
    const csrfError = checkCsrf(request);
    if (csrfError) return { ...csrfError, headers: corsHeaders };
  }

  const result = await proxyToBackend(request, '/entries', request.method);

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-entries', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries',
  handler: proxyEntries,
});
