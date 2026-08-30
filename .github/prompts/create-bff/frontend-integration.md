# Frontend Integration

Examples are Angular (signals, standalone components), but the shape carries over: a store that asks the BFF who is logged in, a guard that waits for the answer, a login page that navigates instead of posting, and an interceptor that attaches cookies and the CSRF header.

## What changes when moving from a login form to the redirect flow

| Before (ROPC)                            | After (Authorization Code + PKCE)                                  |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `authStore.login(username, password)`    | `window.location.href = '/api/auth/login?returnUrl=…'`             |
| Login page owns a form with two fields   | Login page owns a button and an error line                         |
| Login response carries the user          | Login ends in a **full page reload**; `/auth/me` carries the user  |
| `logout()` clears the cookie             | `logout()` fetches the end-session URL, then navigates to Keycloak |
| Guard rarely waits for the session check | Guard waits on **every** protected route                           |

The store's `login()` method disappears. Deleting it is part of the migration, not an afterthought.

## The auth store

Two things matter here: `checkSession()` runs once at construction, and the promise it returns is exposed as `ready` so the guard can await it instead of polling.

```typescript
import { computed, Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';

type UserInfo = {
  preferred_username: string;
  email: string;
  name: string;
  roles: string[];
};

type AuthState = {
  isAuthenticated: boolean;
  user: UserInfo | null;
  loading: boolean;
};

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  loading: true,
};

@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly #state = signal<AuthState>(initialState);

  /** Resolves once the initial session check finished — awaited by the auth guard. */
  readonly ready: Promise<void>;

  isAuthenticated = computed(() => this.#state().isAuthenticated);
  userData = computed(() => this.#state().user);
  loading = computed(() => this.#state().loading);
  roles = computed(() => this.#state().user?.roles ?? null);

  constructor() {
    this.ready = this.checkSession();
  }

  async checkSession(): Promise<void> {
    try {
      const res = await fetch(`${environment.bffUrl}/auth/me`, {
        credentials: 'include',
      });
      const data = await res.json();
      this.#state.set({
        isAuthenticated: data.isAuthenticated,
        user: data.user,
        loading: false,
      });
    } catch {
      this.#state.set({ ...initialState, loading: false });
    }
  }

  /** Leaves the app: the BFF ends the session, Keycloak ends its SSO session. */
  async logout(): Promise<void> {
    try {
      const res = await fetch(`${environment.bffUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const { logoutUrl } = await res.json();
      window.location.href = logoutUrl;
    } catch {
      window.location.href = '/';
    }
  }
}
```

There is no `error` signal any more. Login errors arrive as a query parameter on the login page, not through the store.

Whatever calls `logout()` must not navigate afterwards — the store is already leaving the page:

```typescript
async logout() {
  // Navigates away to Keycloak's end-session endpoint, so no router call here.
  await this.#authStore.logout();
}
```

## The guard

```typescript
import { CanMatchFn, Router, UrlSegment } from '@angular/router';
import { inject } from '@angular/core';
import { AuthStore } from './state';

export const authGuard: CanMatchFn = async (_route, segments: UrlSegment[]) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  await authStore.ready;

  if (authStore.isAuthenticated() && authStore.roles()?.includes('user')) {
    return true;
  }

  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
};

export default authGuard;
```

Do **not** poll a `loading()` signal on a `setInterval` here. Every login now ends in a full page reload, so this path runs on every protected navigation; a 50 ms poll adds latency for nothing when the store can just hand out its promise.

This role check is UX, not security — it keeps users out of routes that would fail anyway. The BFF and the backend make the binding decision.

## The login page

The password is typed on Keycloak's page. What remains is branding, a button, and an error line.

```typescript
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { environment } from '../../../environments/environment';

const KNOWN_ERRORS = ['access_denied', 'expired', 'failed'];

@Component({
  selector: 'app-login',
  template: `
    @if (errorKey(); as key) {
      <div class="error-message" data-testid="login-error">{{ key | translate }}</div>
    }
    <button type="button" data-testid="login-submit" (click)="signIn()">
      {{ 'LOGIN.SUBMIT' | translate }}
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class LoginPage {
  // Bound from the query string via withComponentInputBinding().
  readonly returnUrl = input('/');
  readonly error = input<string | undefined>();

  protected readonly errorKey = computed(() => {
    const error = this.error();
    if (!error) return null;
    return KNOWN_ERRORS.includes(error)
      ? `LOGIN.ERROR.${error.toUpperCase()}`
      : 'LOGIN.ERROR.FAILED';
  });

  /**
   * Full navigation, not a fetch — the browser has to follow the BFF's redirect
   * to Keycloak and carry the `__pkce` cookie back to the callback.
   */
  signIn(): void {
    const returnUrl = encodeURIComponent(this.returnUrl());
    window.location.href = `${environment.bffUrl}/auth/login?returnUrl=${returnUrl}`;
  }
}
```

Unknown error codes collapse to `LOGIN.ERROR.FAILED`, so a translation key never leaks into the UI as raw text.

Translation keys to add, and to remove:

```
LOGIN.SUBMIT
LOGIN.ERROR.ACCESS_DENIED     "Sign-in was cancelled."
LOGIN.ERROR.EXPIRED           "The sign-in attempt expired. Please try again."
LOGIN.ERROR.FAILED            "Sign-in failed. Please try again."

- LOGIN.USERNAME              (delete: the form is gone)
- LOGIN.PASSWORD              (delete)
```

## The HTTP interceptor

Cookies are not sent cross-origin by default, and the CSRF header must be on every state-changing request.

```typescript
import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const cookieInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith(environment.bffUrl)) {
    return next(
      req.clone({
        withCredentials: true,
        setHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
      }),
    );
  }
  return next(req);
};
```

The store's own `fetch` calls are not covered by the interceptor — that is why `checkSession()` and `logout()` set `credentials` and the header themselves.

## Switching auth off where no BFF is hosted

This template deploys the frontend to an Azure Storage static website, which cannot host the BFF.
`environment.authEnabled` therefore has to genuinely disable the flow in production, otherwise the
deployed site offers a sign-in button that leads to a 404.

```typescript
// AuthStore — skip the call entirely, stay anonymous
async checkSession(): Promise<void> {
  if (!environment.authEnabled) {
    this.#state.set({ ...initialState, loading: false });
    return;
  }
  // … fetch /auth/me as usual
}
```

```typescript
// authGuard — no auth means the protected route is simply unavailable
if (!environment.authEnabled) {
  return router.createUrlTree(['/']);
}
```

And hide the sign-in button: pass `environment.authEnabled` into the header alongside
`isAuthenticated`, and render the login and logout controls only when it is true.

Backend services read `environment.apiUrl`, not `bffUrl` — in development that is the BFF proxy, in
production the backend directly. Public reads keep working either way; anything requiring a token
only works locally.

## Environment config

In development everything goes through `/api`, which the dev-server proxy makes same-origin — the
same shape a deployment on Azure Static Web Apps would have.

```typescript
// src/environments/environment.development.ts
export const environment = {
  production: false,
  apiUrl: '/api', // ng serve proxies /api to the BFF (see proxy.conf.json)
  bffUrl: '/api',
  authEnabled: true,
};
```

Production keeps `apiUrl` pointing at the backend and sets `authEnabled: false`, because this
template's deployment target cannot host the BFF. See Step 0 of the prompt.

## Route binding

The login page reads `returnUrl` and `error` from the query string through `input()`, which needs component input binding enabled:

```typescript
provideRouter(APP_ROUTES, withComponentInputBinding());
```

Without it both inputs stay at their defaults and the error line never appears.
