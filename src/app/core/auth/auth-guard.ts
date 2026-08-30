import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlSegment } from '@angular/router';

import { AuthStore } from './auth-store';

export const authGuard: CanMatchFn = async (_route, segments: UrlSegment[]) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  // No BFF hosted -> the protected route is simply unavailable.
  if (!authStore.authEnabled) {
    return router.createUrlTree(['/']);
  }

  await authStore.ready;

  if (authStore.isAuthenticated() && authStore.roles().includes('user')) {
    return true;
  }

  const returnUrl = '/' + segments.map((s) => s.path).join('/');
  return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
};

export default authGuard;
