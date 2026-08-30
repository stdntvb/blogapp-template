import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  Blog,
  BlogDetail,
  BlogDetailSchema,
  BlogResponseSchema,
  CreateBlog,
} from '../../models/blog.model';

@Injectable({
  providedIn: 'root',
})
export class BlogService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/entries`;

  async getBlogs(): Promise<Blog[]> {
    try {
      const response = await firstValueFrom(this.http.get<unknown>(this.apiUrl));

      const result = BlogResponseSchema.safeParse(response);

      if (!result.success) {
        console.error('Ungültige API-Response:', result.error);
        return [];
      }

      return result.data.data;
    } catch (error) {
      console.error('Blogs konnten nicht geladen werden:', error);
      throw error;
    }
  }

  /**
   * Creates a blog entry. The request goes through the BFF proxy (`POST /api/entries`),
   * which attaches the bearer token server-side — the cookie interceptor only adds
   * `withCredentials` and the CSRF header. Returns the new entry's id when the
   * backend echoes it, otherwise null (caller falls back to the overview).
   */
  async createBlog(input: CreateBlog): Promise<number | null> {
    try {
      const response = await firstValueFrom(this.http.post<unknown>(this.apiUrl, input));
      const result = BlogDetailSchema.safeParse(response);
      return result.success ? result.data.id : null;
    } catch (error) {
      console.error('Blog konnte nicht erstellt werden:', error);
      throw error;
    }
  }

  async getById(id: number): Promise<BlogDetail> {
    try {
      const response = await firstValueFrom(this.http.get<unknown>(`${this.apiUrl}/${id}`));

      const result = BlogDetailSchema.safeParse(response);

      if (!result.success) {
        console.error('Ungültige API-Response:', result.error);
        throw new Error('Ungültige Blog-Daten vom Backend.');
      }

      return result.data;
    } catch (error) {
      console.error(`Blog mit ID ${id} konnte nicht geladen werden:`, error);

      throw error;
    }
  }
}
