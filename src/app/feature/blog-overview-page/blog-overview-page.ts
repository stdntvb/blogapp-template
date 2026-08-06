import { Component, inject, signal } from '@angular/core';

import { BlogCard } from '../../blog-card/blog-card';
import { Blog } from '../../models/blog.model';
import { BlogService } from '../blog/blog';

@Component({
  selector: 'app-blog-overview-page',
  imports: [BlogCard],
  templateUrl: './blog-overview-page.html',
  styleUrl: './blog-overview-page.scss',
})
export class BlogOverviewPage {
  private readonly blogService = inject(BlogService);

  readonly blogs = signal<Blog[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    void this.loadBlogs();
  }

  async loadBlogs() {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const blogs = await this.blogService.getBlogs();

      this.blogs.set(blogs);
    } catch (error) {
      console.error('Fehler beim Laden der Blogs:', error);
      this.errorMessage.set('Die Blogs konnten nicht geladen werden.');
    } finally {
      this.loading.set(false);
    }
  }

  toggleLike(id: number) {
    this.blogs.update((blogs) =>
      blogs.map((blog) => {
        if (blog.id !== id) {
          return blog;
        }

        blog.likedByMe = !blog.likedByMe;
        blog.likes = blog.likedByMe ? blog.likes + 1 : blog.likes - 1;

        return blog;
      }),
    );
  }
}
