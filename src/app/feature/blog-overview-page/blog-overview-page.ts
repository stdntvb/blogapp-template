import { Component, inject, OnInit } from '@angular/core';

import { BlogCard } from '../../blog-card/blog-card';
import { BlogStateService } from '../../services/blog-state';

@Component({
  selector: 'app-blog-overview-page',
  imports: [BlogCard],
  templateUrl: './blog-overview-page.html',
  styleUrl: './blog-overview-page.scss',
})
export class BlogOverviewPage implements OnInit {
  readonly state = inject(BlogStateService);

  ngOnInit(): void {
    void this.state.loadBlogs();
  }
}
