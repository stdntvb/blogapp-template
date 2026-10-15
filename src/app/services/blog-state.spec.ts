import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';

import { BlogStateService } from './blog-state';
import { BlogService } from '../feature/blog/blog';
import { Blog } from '../models/blog.model';

function makeBlog(overrides: Partial<Blog> = {}): Blog {
  return {
    id: 1,
    title: 'Test Blog',
    contentPreview: 'Kurzer Testinhalt',
    author: 'Fabio',
    likes: 0,
    comments: 0,
    likedByMe: false,
    createdByMe: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('BlogStateService', () => {
  let service: BlogStateService;
  let blogServiceSpy: { getBlogs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    blogServiceSpy = { getBlogs: vi.fn().mockResolvedValue([]) };

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), { provide: BlogService, useValue: blogServiceSpy }],
    });

    service = TestBed.inject(BlogStateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start with an empty blogs array', () => {
    expect(service.blogs()).toEqual([]);
    expect(service.blogCount()).toBe(0);
  });

  it('should update loading state while blogs are loaded', async () => {
    let resolveGetBlogs!: (blogs: Blog[]) => void;
    blogServiceSpy.getBlogs.mockReturnValue(
      new Promise<Blog[]>((resolve) => {
        resolveGetBlogs = resolve;
      }),
    );

    const loadPromise = service.loadBlogs();
    expect(service.loading()).toBe(true);

    resolveGetBlogs([]);
    await loadPromise;

    expect(service.loading()).toBe(false);
  });

  it('should calculate the blog count from loaded blogs', async () => {
    const blogs = [makeBlog({ id: 1 }), makeBlog({ id: 2 }), makeBlog({ id: 3 })];
    blogServiceSpy.getBlogs.mockResolvedValue(blogs);

    await service.loadBlogs();

    expect(service.blogCount()).toBe(3);
  });

  it('should recalculate the blog count when blogs become empty again', async () => {
    blogServiceSpy.getBlogs.mockResolvedValue([makeBlog({ id: 1 })]);
    await service.loadBlogs();
    expect(service.blogCount()).toBe(1);

    blogServiceSpy.getBlogs.mockResolvedValue([]);
    await service.loadBlogs();
    expect(service.blogCount()).toBe(0);
  });

  it('should set an error message when loading blogs fails', async () => {
    blogServiceSpy.getBlogs.mockRejectedValue(new Error('network error'));

    await service.loadBlogs();

    expect(service.error()).toBe('Die Blogs konnten nicht geladen werden.');
    expect(service.loading()).toBe(false);
  });

  it('should persist the selected author to localStorage via its effect', async () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');

    service.setAuthor('Fabio');
    await TestBed.inject(ApplicationRef).whenStable();

    expect(setItemSpy).toHaveBeenCalledWith('selectedAuthor', 'Fabio');
  });

  it('should return an empty authors list when there are no blogs', () => {
    expect(service.authors()).toEqual([]);
    expect(service.filteredBlogs()).toEqual([]);
  });
});
