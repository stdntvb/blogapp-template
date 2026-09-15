import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { proxyToBackend } from '../lib/proxy.js';
import { corsHeaders, handlePreflight } from '../lib/cors.js';

async function proxyEntryById(request: HttpRequest): Promise<HttpResponseInit> {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const id = request.params.id;
  const result = await proxyToBackend(request, '/entries/' + id, 'GET');

  return {
    status: result.status,
    jsonBody: result.body,
    headers: corsHeaders,
    cookies: result.cookies.length > 0 ? result.cookies : undefined,
  };
}

app.http('proxy-entry-by-id', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'entries/{id:int}',
  handler: proxyEntryById,
});
