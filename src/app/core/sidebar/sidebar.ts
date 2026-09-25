import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';

import { LayoutService } from '../layout/layout-service';
import type { UserInfo } from '../auth/auth-store';

@Component({
  selector: 'app-sidebar',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatSidenavModule,
    MatIconModule,
  ],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  private readonly layout = inject(LayoutService);

  readonly title = input.required<string>();
  readonly authEnabled = input(false);
  readonly isAuthenticated = input(false);
  readonly user = input<UserInfo | null>(null);
  readonly isDarkMode = input(false);

  readonly toggleDarkMode = output<void>();
  readonly signOut = output<void>();

  protected readonly isMobile = this.layout.isMobile;
}
