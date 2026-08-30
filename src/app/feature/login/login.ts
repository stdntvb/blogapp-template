import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { environment } from '../../../environments/environment';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Die Anmeldung wurde abgebrochen.',
  expired: 'Der Anmeldeversuch ist abgelaufen. Bitte versuche es erneut.',
  failed: 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.',
};

@Component({
  selector: 'app-login',
  imports: [MatButtonModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  // Bound from the query string via withComponentInputBinding(). The router writes
  // `undefined` when `?returnUrl=` is absent, so coerce it — and only keep
  // same-site paths (the BFF validates again before sealing it).
  readonly returnUrl = input('/', {
    transform: (value: string | undefined) =>
      value && value.startsWith('/') && !value.startsWith('//') ? value : '/',
  });
  readonly error = input<string | undefined>();

  protected readonly errorMessage = computed(() => {
    const error = this.error();
    if (!error) return null;
    return ERROR_MESSAGES[error] ?? ERROR_MESSAGES['failed'];
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

export default LoginPage;
