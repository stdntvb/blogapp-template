import { computed, effect, inject, Injectable, signal } from '@angular/core';

import { Blog } from '../models/blog.model';
import { BlogService } from '../feature/blog/blog';

interface BlogState {
  blogs: Blog[];
  loading: boolean;
  error: string | null;
  selectedAuthor: string;
}

@Injectable({
  providedIn: 'root',
})
export class BlogStateService {
  private readonly blogService = inject(BlogService);

  readonly #state = signal<BlogState>({
    blogs: [],
    loading: false,
    error: null,
    selectedAuthor: localStorage.getItem('selectedAuthor') ?? 'all',
  });

  readonly blogs = computed(() => this.#state().blogs);
  readonly loading = computed(() => this.#state().loading);
  readonly error = computed(() => this.#state().error);
  readonly selectedAuthor = computed(() => this.#state().selectedAuthor);

  readonly blogCount = computed(() => this.blogs().length);

  readonly authors = computed(() => [...new Set(this.blogs().map((blog) => blog.author))]);

  readonly filteredBlogs = computed(() => {
    const author = this.selectedAuthor();

    if (author === 'all') {
      return this.blogs();
    }

    return this.blogs().filter((blog) => blog.author === author);
  });

  constructor() {
    effect(() => {
      localStorage.setItem('selectedAuthor', this.selectedAuthor());
    });
  }

  async loadBlogs(): Promise<void> {
    this.#loadStarted();

    try {
      const blogs = await this.blogService.getBlogs();
      this.#loadSucceeded(blogs);
    } catch {
      this.#loadFailed('Die Blogs konnten nicht geladen werden.');
    }
  }

  setAuthor(author: string): void {
    this.#authorSelected(author);
  }

  toggleLike(id: number): void {
    this.#likeToggled(id);
  }

  #loadStarted(): void {
    this.#state.update((state) => ({
      ...state,
      loading: true,
      error: null,
    }));
  }

  #loadSucceeded(blogs: Blog[]): void {
    this.#state.update((state) => ({
      ...state,
      blogs,
      loading: false,
    }));
  }

  #loadFailed(message: string): void {
    this.#state.update((state) => ({
      ...state,
      error: message,
      loading: false,
    }));
  }

  #authorSelected(author: string): void {
    this.#state.update((state) => ({
      ...state,
      selectedAuthor: author,
    }));
  }

  #likeToggled(id: number): void {
    this.#state.update((state) => ({
      ...state,
      blogs: state.blogs.map((blog) => {
        if (blog.id !== id) {
          return blog;
        }

        const likedByMe = !blog.likedByMe;

        return {
          ...blog,
          likedByMe,
          likes: likedByMe ? blog.likes + 1 : blog.likes - 1,
        };
      }),
    }));
  }
}
