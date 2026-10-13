import { TestBed } from '@angular/core/testing';

import { LayoutService } from './layout-service';

describe('LayoutService', () => {
  let service: LayoutService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LayoutService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('exposes isMobile as a signal reflecting the initial media query match', () => {
    expect(service.isMobile()).toBe(window.matchMedia('(max-width: 767.98px)').matches);
  });

  it('updates isMobile when the media query change event fires', () => {
    const mediaQueryList = window.matchMedia('(max-width: 767.98px)') as MediaQueryList & {
      dispatchChange: (matches: boolean) => void;
    };

    mediaQueryList.dispatchChange(true);

    expect(service.isMobile()).toBe(true);
  });
});
