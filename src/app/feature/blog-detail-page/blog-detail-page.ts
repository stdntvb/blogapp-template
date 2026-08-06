import { Component, computed, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

import { BlogDetail } from '../../models/blog.model';

@Component({
  selector: 'app-blog-detail-page',
  imports: [RouterLink, MatButtonModule],
  templateUrl: './blog-detail-page.html',
  styleUrl: './blog-detail-page.scss',
})
export class BlogDetailPage {
  private route = inject(ActivatedRoute);

  blog = computed(() => this.route.snapshot.data['blog'] as BlogDetail | undefined);
}
