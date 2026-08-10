import { TestBed } from '@angular/core/testing';

import { BlogState } from './blog-state';

describe('BlogState', () => {
  let service: BlogState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BlogState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
