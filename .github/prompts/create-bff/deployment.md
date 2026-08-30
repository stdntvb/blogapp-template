# BFF Deployment to Azure Static Web Apps

> **Not applicable to this template.** `.github/workflows/azure-deploy.yml` publishes the frontend to
> an Azure Storage static website, and a storage account cannot host Azure Functions. Everything
> below describes a deployment on Azure Static Web Apps and is kept as a reference for when the
> project moves there. For this template the BFF runs locally only — see Step 0 of the prompt.
> The Keycloak section further down **does** apply: it is needed for local sign-in too.

## GitHub Actions workflow

The key setting is `api_location: "bff"`. If this is empty or missing, the BFF Azure Functions are silently not deployed and all `/api` requests return 404.

```yaml
# In your Azure SWA GitHub Actions workflow file
- name: Build And Deploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: 'upload'
    app_location: '/'
    api_location: 'bff' # <-- This MUST be "bff", not ""
    output_location: 'dist/your-app/browser'
```

## Setting environment variables

Environment variables must be set as Azure SWA Application Settings. They are NOT read from `local.settings.json` in production.

**The user must run this command themselves** — it contains secrets that should not be generated or handled by the skill. Present this command to the user and ask them to fill in their values:

```bash
az staticwebapp appsettings set \
  --name <your-swa-name> \
  --setting-names \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  KEYCLOAK_URL="https://your-keycloak-host/realms/your-realm" \
  KEYCLOAK_CLIENT_ID="bff-your-app" \
  KEYCLOAK_CLIENT_SECRET="your-client-secret" \
  BACKEND_API_URL="https://your-backend-api.example.com" \
  ALLOWED_ORIGIN="https://your-swa-name.azurestaticapps.net"
```

**After the user confirms they've run it**, verify by listing setting names (values are not shown):

```bash
az staticwebapp appsettings list --name <swa-name> --query "[].name" -o tsv
```

All six must be present: `SESSION_SECRET`, `KEYCLOAK_URL`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `BACKEND_API_URL`, `ALLOWED_ORIGIN`. If any are missing, tell the user which ones and provide the specific `az` command to add them.

**Important notes:**

- `SESSION_SECRET` must be consistent across cold starts — generate once and set permanently
- `ALLOWED_ORIGIN` must exactly match the frontend URL, **with no trailing slash**. It is not just
  CORS: the BFF derives `redirect_uri` and `post_logout_redirect_uri` from it, and Keycloak compares
  those byte for byte. Missing it takes the whole API down at startup, by design — a loud failure
  beats `undefined/api/auth/callback`.
- Never set it to `*`. Combined with `Allow-Credentials: true` that is invalid CORS anyway, and it
  would produce `*/api/auth/callback` as the redirect URI.

## staticwebapp.config.json

The SPA needs a fallback route for client-side routing. API routes are handled automatically by Azure SWA.

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/*.{css,js,svg,png,jpg,ico,woff2}"]
  }
}
```

## Keycloak client setup

The BFF requires a **confidential** client running the Authorization Code Flow with PKCE. A freshly
created client has **Standard flow off and no redirect URIs**, and the only symptom is a bare
"Invalid parameter: redirect_uri" — so this step is not optional.

| Setting                         | Value                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Client type                     | OpenID Connect                                                                    |
| Client authentication           | **On** (confidential)                                                             |
| Standard flow                   | **On**                                                                            |
| Direct access grants            | **Off** — closes the ROPC path                                                    |
| PKCE Code Challenge Method      | **S256** (Advanced settings)                                                      |
| Valid redirect URIs             | `http://localhost:4200/api/auth/callback`, `https://<swa-host>/api/auth/callback` |
| Valid post logout redirect URIs | `http://localhost:4200/`, `https://<swa-host>/`                                   |

**Migrating a live app?** Turn Direct access grants off only _after_ deploying the new code —
otherwise the running ROPC version can no longer log anyone in.

### Applying it via the Admin REST API

Admin-console access tokens live about **60 seconds**. Read, modify and write in one run, or fetch a
token with client credentials instead of copying one out of the browser.

```javascript
// configure-client.mjs — node configure-client.mjs
const KC = 'https://keycloak.example.com';
const REALM = 'myrealm';
const APP = 'https://myapp.azurestaticapps.net';
const TOKEN = process.env.KC_TOKEN; // admin access token

const auth = { Authorization: `Bearer ${TOKEN}` };
const api = `${KC}/admin/realms/${REALM}/clients`;

const [client] = await fetch(`${api}?clientId=bff-your-app`, { headers: auth }).then((r) =>
  r.json(),
);

client.standardFlowEnabled = true;
client.directAccessGrantsEnabled = true; // flip to false after deploying
client.publicClient = false;
client.redirectUris = ['http://localhost:4200/api/auth/callback', `${APP}/api/auth/callback`];
client.webOrigins = ['+'];
client.attributes = {
  ...client.attributes,
  'pkce.code.challenge.method': 'S256',
  // multi-valued attributes are ## separated
  'post.logout.redirect.uris': `http://localhost:4200/##${APP}/`,
};

const res = await fetch(`${api}/${client.id}`, {
  method: 'PUT',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(client),
});
console.log(res.status); // 204
```

**Wildcards:** a trailing `*` works in the **path** (`http://localhost:4200/*`). A wildcard in the
**host** (`https://*.example.net/*`) is accepted by the form but never matches anything. For many
deployed apps, register each origin, or give each app its own client.

### Verifying without credentials

The authorize endpoint answers honestly before any password is typed, which makes the whole client
configuration testable from a shell:

```bash
AUTH="https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth"

curl -s -G "$AUTH" \
  --data-urlencode "client_id=bff-your-app" \
  --data-urlencode "response_type=code" \
  --data-urlencode "scope=openid" \
  --data-urlencode "code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" \
  --data-urlencode "code_challenge_method=S256" \
  --data-urlencode "redirect_uri=https://myapp.azurestaticapps.net/api/auth/callback" \
  | grep -c 'id="kc-form-login"'
```

- `1` — the login form rendered, the redirect URI is registered
- Grep the body for `Invalid parameter: redirect_uri` instead to confirm that unregistered URIs are refused
- Repeat **without** `code_challenge`: a 302 carrying `error=invalid_request` and
  "Missing parameter: code_challenge_method" proves PKCE is enforced rather than merely allowed

Match on `id="kc-form-login"`, not on the word `disabled` or similar — Keycloak's login page contains
plenty of incidental markup that produces false positives.

## Troubleshooting deployment

| Symptom                                                | Cause                                                        | Fix                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Login loops back to `/login?error=expired`             | `__pkce` cookie missing or older than 10 min                 | Check the cookie is set on `/api/auth/login`; same-origin dev proxy in place? |
| Login succeeds, `auth/me` still anonymous              | Session cookie above the 4 KB browser cap                    | Split the sealed value across `__session.N` chunks                            |
| Random logouts after a while                           | Stale chunks from a larger previous session                  | Pass the `Cookie` header into `sessionCookies()` on every write               |
| Logging out then in skips the password                 | Keycloak SSO session never ended                             | Redirect to `end_session_endpoint` with `id_token_hint`                       |
| "Invalid parameter: redirect_uri"                      | URI not registered, or `ALLOWED_ORIGIN` has a trailing slash | Register both origins; trim the slash                                         |
| Callback shows raw JSON in the browser                 | Error path returns `jsonBody` instead of a redirect          | Redirect to `/login?error=…` from every callback failure                      |
| All `/api` routes return 404                           | `api_location` is empty in workflow                          | Set `api_location: "bff"`                                                     |
| Login returns 200 but no cookie set                    | Azure SWA strips `Set-Cookie` headers                        | Use `cookies: Cookie[]` property on `HttpResponseInit`                        |
| `auth/me` returns `isAuthenticated: false` after login | Cookie value URL-encoded by Azure SWA                        | Add `decodeURIComponent()` in `parseCookie()`                                 |
| CORS error on login/like/comment                       | Missing CORS headers on error response                       | Spread `corsHeaders` into all responses including errors                      |
| `X-Requested-With` preflight fails                     | OPTIONS handler missing or incomplete                        | Include `X-Requested-With` in `Access-Control-Allow-Headers`                  |
| `func start` fails with ESM errors                     | Missing `"type": "module"` in package.json                   | Add `"type": "module"` to `bff/package.json`                                  |
| Functions not discovered at startup                    | Missing import in index.ts                                   | Import every function file in `bff/src/index.ts`                              |
| TypeScript import errors                               | Missing `.js` extension on local imports                     | Use `./session.js` not `./session` or `./session.ts`                          |
