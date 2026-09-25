import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/** Matches the mobile-first breakpoint used across the app's SCSS (< 768px). */
const MOBILE_QUERY = '(max-width: 767.98px)';

/**
 * Tracks the viewport via the native `matchMedia` API (not `BreakpointObserver`)
 * so components can render different navigation for mobile vs. desktop.
 *
 * Provided in root: the listener lives for the app's lifetime, but it is still
 * torn down through `DestroyRef` in case this service is ever provided at a
 * component level instead, where it would otherwise leak on destroy.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  private readonly mediaQueryList = window.matchMedia(MOBILE_QUERY);

  readonly isMobile = signal(this.mediaQueryList.matches);

  constructor() {
    const listener = (event: MediaQueryListEvent) => this.isMobile.set(event.matches);

    this.mediaQueryList.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.mediaQueryList.removeEventListener('change', listener));
  }
}
