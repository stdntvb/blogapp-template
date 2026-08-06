import { Routes } from '@angular/router';

import { BlogOverviewPage } from './feature/blog-overview-page/blog-overview-page';
import { blogResolver } from './feature/blog/blog-resolver';

export const routes: Routes = [
  { path: '', component: BlogOverviewPage },
  {
    path: 'blog/:id',
    loadComponent: () =>
      import('./feature/blog-detail-page/blog-detail-page').then((m) => m.BlogDetailPage),
    resolve: {
      blog: blogResolver,
    },
  },
  {
    path: 'about',
    loadComponent: () => import('./feature/about-page/about-page').then((m) => m.AboutPage),
  },
  {
    path: '**',
    loadComponent: () => import('./feature/not-found/not-found').then((m) => m.NotFound),
  },
];
