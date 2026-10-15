import { expect, test } from '@playwright/test';

// Akzeptanzkriterien: Navigation
// 1. Die Toolbar-Navigation zeigt Links zu "Blog" und "About" an.
// 2. Ein Klick auf "About" navigiert zur About-Seite und zeigt deren Inhalt.
// 3. Der "About"-Link wird dabei als aktiv markiert (routerLinkActive).
// 4. Ein Klick auf "Blog" navigiert zurück zur Blog-Übersicht mit den Blog-Karten.

test.describe('Navigation', () => {
  test('shows links to Blog and About in the toolbar', async ({ page }) => {
    await page.goto('/');

    const nav = page.locator('nav.nav--toolbar');

    await expect(nav.getByRole('link', { name: 'Blog' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'About' })).toBeVisible();
  });

  test('navigates to the About page and marks the link active', async ({ page }) => {
    await page.goto('/');

    const nav = page.locator('nav.nav--toolbar');
    await nav.getByRole('link', { name: 'About' }).click();

    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByText('Die Seite funktioniert! :)')).toBeVisible();
    await expect(nav.getByRole('link', { name: 'About' })).toHaveClass(/active-link/);
  });

  test('navigates back to the blog overview from About', async ({ page }) => {
    await page.goto('/about');

    const nav = page.locator('nav.nav--toolbar');
    await nav.getByRole('link', { name: 'Blog' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.locator('app-blog-card').first()).toBeVisible();
  });
});
