import type { InvocationContext } from '@azure/functions';

// Verbose auth logging, toggled by the AUTH_TRACE env var. Off by default so
// production logs stay quiet; set AUTH_TRACE=true in local.settings.json while
// debugging the login round trip.
const AUTH_TRACE = process.env.AUTH_TRACE === 'true';

export function trace(context: InvocationContext, message: string, data?: unknown): void {
  if (!AUTH_TRACE) return;
  if (data === undefined) {
    context.log(`[auth] ${message}`);
  } else {
    context.log(`[auth] ${message}`, data);
  }
}
