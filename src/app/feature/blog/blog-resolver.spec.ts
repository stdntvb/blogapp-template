import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, ResolveFn, RouterStateSnapshot } from '@angular/router';

import { BlogDetail } from '../../models/blog.model';
import { blogResolver } from './blog-resolver';
import { BlogService } from './blog';

describe('blogResolver', () => {
  const executeResolver: ResolveFn<BlogDetail | undefined> = (...resolverParameters) =>
    TestBed.runInInjectionContext(() => blogResolver(...resolverParameters));

  const blogServiceMock = {
    getById: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: BlogService, useValue: blogServiceMock }],
    });
  });

  it('should be created', () => {
    expect(executeResolver).toBeTruthy();
  });

  it('should resolve a blog by id', async () => {
    const blog = { id: 1, title: 'Test' } as BlogDetail;
    blogServiceMock.getById.mockResolvedValue(blog);

    const route = {
      paramMap: { get: () => '1' },
    } as unknown as ActivatedRouteSnapshot;

    const result = await executeResolver(route, {} as RouterStateSnapshot);

    expect(blogServiceMock.getById).toHaveBeenCalledWith(1);
    expect(result).toEqual(blog);
  });
});
