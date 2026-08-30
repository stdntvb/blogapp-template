import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { AuthStore } from '../../core/auth/auth-store';
import { BlogService } from '../blog/blog';

@Component({
  selector: 'app-add-blog-page',
  imports: [MatButtonModule],
  templateUrl: './add-blog-page.html',
  styleUrl: './add-blog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddBlogPage {
  private readonly authStore = inject(AuthStore);
  private readonly blogService = inject(BlogService);
  private readonly router = inject(Router);

  protected readonly user = this.authStore.user;

  protected readonly title = signal('');
  protected readonly content = signal('');
  protected readonly headerImageUrl = signal('');

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canSubmit = computed(
    () => this.title().trim().length > 0 && this.content().trim().length > 0 && !this.submitting(),
  );

  protected update(field: 'title' | 'content' | 'headerImageUrl', event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this[field].set(value);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.error.set(null);

    try {
      const image = this.headerImageUrl().trim();
      const id = await this.blogService.createBlog({
        title: this.title().trim(),
        content: this.content().trim(),
        ...(image ? { headerImageUrl: image } : {}),
      });

      await this.router.navigate(id ? ['/blog', id] : ['/']);
    } catch {
      this.error.set('Der Beitrag konnte nicht gespeichert werden. Bitte versuche es erneut.');
    } finally {
      this.submitting.set(false);
    }
  }
}

export default AddBlogPage;
