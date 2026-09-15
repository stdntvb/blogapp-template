# BFF (Backend-for-Frontend)

Azure Functions v4 (TypeScript, ESM) zwischen der Angular-SPA und der Blog-Backend-API.
Führt den OAuth2 Authorization Code Flow mit PKCE gegen Keycloak aus, verwaltet eine
verschlüsselte Session im HTTP-Only-Cookie und proxied API-Calls mit Bearer-Token.

## Voraussetzung: Azure Functions Core Tools

Nicht als npm-Dependency gebündelt (das Paket ist auf manchen Netzen nicht installierbar).
Global installieren:

```bash
brew tap azure/functions && brew install azure-functions-core-tools@4   # macOS
# oder:
npm i -g azure-functions-core-tools@4 --unsafe-perm true
```

Prüfen: `func --version` → `4.x`.

## Setup

```bash
cd bff
npm install
```

`local.settings.json` mit den Werten aus dem Unterricht füllen:

| Variable                 | Wert                                                     |
| ------------------------ | -------------------------------------------------------- |
| `KEYCLOAK_URL`           | Realm-URL, vom Dozenten                                  |
| `KEYCLOAK_CLIENT_ID`     | vom Dozenten (z. B. `bff-blog`)                          |
| `KEYCLOAK_CLIENT_SECRET` | vom Dozenten                                             |
| `SESSION_SECRET`         | `openssl rand -base64 32`                                |
| `BLOG_BACKEND_URL`       | Blog-Backend-URL (bereits gesetzt)                       |
| `ALLOWED_ORIGIN`         | `http://localhost:4200` — **ohne** abschliessenden Slash |
| `AUTH_TRACE`             | optional, `true` = ausführliche Login-Logs im BFF        |

`local.settings.json` ist gitignored.

## Starten

Aus dem Projekt-Root (Frontend + BFF zusammen):

```bash
npm start
```

Nur den BFF:

```bash
cd bff && npm start        # func start auf :7071, prestart baut via tsc
```

Frontend und BFF laufen über `proxy.conf.json` same-origin auf `http://localhost:4200`
— Voraussetzung dafür, dass der Session-Cookie zur Frontend-Origin gehört.

## Testen

```bash
npm test                                   # node:test, lib/*.spec
curl http://localhost:4200/api/auth/me     # {"isAuthenticated":false,"user":null}
```

## Endpoints

| Route                                                                                       | Methode | Zweck                                                   |
| ------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `/api/auth/login?returnUrl=…`                                                               | GET     | Navigation → 302 auf Keycloak, setzt `__pkce`           |
| `/api/auth/callback`                                                                        | GET     | Code → Tokens, setzt `__session.*`, 302 auf `returnUrl` |
| `/api/auth/me`                                                                              | GET     | User-Info bzw. `isAuthenticated:false`                  |
| `/api/auth/logout`                                                                          | POST    | löscht Session, liefert `{ logoutUrl }`                 |
| `/api/entries`, `/api/entries/{id}`, `/api/entries/{id}/like`, `/api/entries/{id}/comments` |         | Proxy zum Backend mit Bearer-Token                      |
