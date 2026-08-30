import { HttpRequest, HttpResponseInit } from '@azure/functions';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN!;

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Credentials': 'true',
};

export function handlePreflight(request: HttpRequest): HttpResponseInit | null {
  if (request.method !== 'OPTIONS') return null;
  return {
    status: 204,
    headers: {
      ...corsHeaders,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  };
}
