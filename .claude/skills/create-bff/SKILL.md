---
name: create-bff
description: >
  Set up a Backend-for-Frontend (BFF) using Azure Functions v4, Keycloak with Authorization Code Flow + PKCE, encrypted session cookies (@hapi/iron), CORS, CSRF protection, and a backend proxy deployed to Azure Static Web Apps.
  Use this skill whenever someone needs to: create a BFF, add server-side auth to an SPA, proxy API calls through Azure Functions, integrate Keycloak with a BFF, deploy Azure Functions alongside a frontend on Azure SWA, add login/logout endpoints, set up session cookies, secure API calls without tokens in the browser, add cookie-based auth, migrate from SPA-based OIDC or from the ROPC password grant to a BFF, troubleshoot CORS/CSRF in a BFF, or set up server-side session management. Even if the user just says "add authentication" or "I don't want tokens in the browser", this skill applies.
---

# Create a BFF (Backend-for-Frontend) with Azure Functions

The full instructions live in `.github/prompts/create-bff.prompt.md`, so that Claude Code and GitHub
Copilot work from one source instead of two copies that drift apart. Copilot discovers that file on
its own; this skill is how Claude Code gets there.

**Read `.github/prompts/create-bff.prompt.md` now and follow it.** It walks through the whole build
in nine steps and points at five reference files under `.github/prompts/create-bff/` for the exact
source code:

| File                          | Contents                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `project-setup.md`            | `package.json`, `tsconfig.json`, `host.json`, `local.settings.json`, entry point |
| `lib-implementations.md`      | `session.ts`, `keycloak.ts`, `cors.ts`, `csrf.ts`, `proxy.ts` and their tests    |
| `function-implementations.md` | `auth-login`, `auth-callback`, `auth-me`, `auth-logout`, proxy endpoints         |
| `frontend-integration.md`     | Auth store, guard, login page, HTTP interceptor                                  |
| `deployment.md`               | GitHub Actions, Azure SWA settings, Keycloak client setup, troubleshooting       |

Ignore the `#file:` prefixes in those links — they are Copilot syntax. The paths after the colon are
plain repository paths and can be read directly.

In short, what gets built: the user signs in on Keycloak's own page (Authorization Code Flow with
PKCE, S256), the BFF exchanges the code server-side, and the browser only ever holds an encrypted
session cookie split across `__session.0`, `__session.1`, … because three JWTs exceed the 4 KB
per-cookie limit. Logout ends the Keycloak SSO session too. The pitfalls section is the important
part — every entry there is a bug that failed silently in a real deployment.
