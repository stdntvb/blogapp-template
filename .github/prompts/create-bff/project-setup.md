# BFF Project Setup

## package.json

The `"type": "module"` field is required because `jose` (JWT decoding) is ESM-only. The `"main"` field must point to the compiled entry file so Azure Functions discovers all registered functions.

```json
{
  "name": "bff-your-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "func start",
    "prestart": "npm run build",
    "test": "npm run build && node --test dist/lib/*.spec.js"
  },
  "dependencies": {
    "@azure/functions": "^4.11.2",
    "@hapi/iron": "^7.0.1",
    "jose": "^6.2.2"
  },
  "devDependencies": {
    "@types/hapi__iron": "^6.0.1",
    "typescript": "~5.9.3",
    "azure-functions-core-tools": "^4.8.0"
  }
}
```

**Watch out:** `@types/hapi__iron@^6.0.6` does not exist on npm. Use `^6.0.1`.

The `test` script needs no dependency: `node:test` and `node:assert` ship with Node. The glob picks up `src/lib/*.spec.ts` once compiled — see the test section in `lib-implementations.md`.

## tsconfig.json

Must use Node16 module resolution for ESM compatibility with Azure Functions v4.

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## host.json

Standard Azure Functions v4 host configuration with extension bundle.

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  },
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

## local.settings.json (template - do not commit)

Add `bff/local.settings.json` to `.gitignore`. This file holds secrets for local development.

`ALLOWED_ORIGIN` must be the dev server origin (`http://localhost:4200`), with no trailing slash. It does three jobs: the CORS origin, the `http://` scheme that makes `session.ts` drop the `Secure` cookie flag (without which local login never persists), and the base for the OAuth redirect URIs. `keycloak.ts` refuses to start without it.

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "KEYCLOAK_URL": "https://your-keycloak-host/realms/your-realm",
    "KEYCLOAK_CLIENT_ID": "bff-your-app",
    "KEYCLOAK_CLIENT_SECRET": "your-client-secret",
    "SESSION_SECRET": "change-me-to-a-random-32-char-string!!",
    "BACKEND_API_URL": "https://your-backend-api.example.com",
    "ALLOWED_ORIGIN": "http://localhost:4200"
  },
  "Host": {
    "CORS": "*"
  }
}
```

## index.ts (entry point)

Every function file must be imported here. Azure Functions v4 uses the programming model where functions self-register via `app.http()`, but the runtime needs to execute the registration code. The `"main"` field in `package.json` points to the compiled version of this file.

```typescript
import './functions/auth-login.js';
import './functions/auth-callback.js';
import './functions/auth-logout.js';
import './functions/auth-me.js';
import './functions/proxy-entries.js';
import './functions/proxy-entry-by-id.js';
// Add more proxy imports as needed
```

All imports use `.js` extension (not `.ts`) because TypeScript compiles to JavaScript and Node16 module resolution requires explicit extensions.
