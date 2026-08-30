import { HttpInterceptorFn } from '@angular/common/http';

import { environment } from '../../../environments/environment';

/**
 * Cookies are not sent by default and the CSRF header must ride along on every
 * BFF call. Only requests aimed at the BFF are touched.
 */
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
