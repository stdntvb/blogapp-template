import { computed, Injectable, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

export interface UserInfo {
  preferred_username: string;
  email: string;
  name: string;
  roles: string[];
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  // Signal-based state.
  readonly isAuthenticated = signal(false);
  readonly user = signal<UserInfo | null>(null);
  readonly loading = signal(true); // the session check runs from the constructor

  readonly roles = computed(() => this.user()?.roles ?? []);

  /** True where a BFF is actually reachable; false disables the whole flow. */
  readonly authEnabled = environment.authEnabled;

  /** Resolves once the initial session check finished — awaited by the auth guard. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.checkSession();
  }

  async checkSession(): Promise<void> {
    // No BFF is hosted where auth is disabled — stay anonymous without a call.
    if (!environment.authEnabled) {
      this.isAuthenticated.set(false);
      this.user.set(null);
      this.loading.set(false);
      return;
    }

    try {
      const res = await fetch(`${environment.bffUrl}/auth/me`, {
        credentials: 'include',
      });
      const data = await res.json();
      this.isAuthenticated.set(data.isAuthenticated);
      this.user.set(data.user);
    } catch {
      this.isAuthenticated.set(false);
      this.user.set(null);
    } finally {
      this.loading.set(false);
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
