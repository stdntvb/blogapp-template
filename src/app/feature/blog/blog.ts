import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Blog, BlogDetail, BlogDetailSchema, BlogResponseSchema } from '../../models/blog.model';

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

      return [];
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

  async createBlog(blog: Blog): Promise<Blog> {
    try {
      return await firstValueFrom(this.http.post<Blog>(this.apiUrl, blog));
    } catch (error) {
      console.error('Blog konnte nicht erstellt werden:', error);
      throw error;
    }
  }

  async updateBlog(id: number, blog: Blog): Promise<Blog> {
    try {
      return await firstValueFrom(this.http.put<Blog>(`${this.apiUrl}/${id}`, blog));
    } catch (error) {
      console.error(`Blog mit ID ${id} konnte nicht aktualisiert werden:`, error);
      throw error;
    }
  }

  async deleteBlog(id: number): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<void>(`${this.apiUrl}/${id}`));
    } catch (error) {
      console.error(`Blog mit ID ${id} konnte nicht gelöscht werden:`, error);
      throw error;
    }
  }
}
