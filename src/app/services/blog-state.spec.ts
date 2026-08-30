import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import { BlogStateService } from './blog-state';

describe('BlogStateService', () => {
  let service: BlogStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });

    service = TestBed.inject(BlogStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
