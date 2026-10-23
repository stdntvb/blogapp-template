import { expect, test } from '@playwright/test';

// Akzeptanzkriterien: Blog-Liste
// 1. Wenn die Seite geladen wird, werden Blog-Einträge angezeigt.
// 2. Jeder Blog-Eintrag zeigt einen Titel und eine Zusammenfassung.
// 3. Ein Klick auf einen Blog-Eintrag navigiert zur Detailseite dieses Blogs.

test.describe('Blog-Liste', () => {
  test('should display the blog overview page', async ({ page }) => {
    await page.goto('/');

    const blogCards = page.locator('app-blog-card');

    await expect(blogCards.first()).toBeVisible();
    await expect(blogCards).not.toHaveCount(0);
  });

  test('each blog entry shows a title and a summary', async ({ page }) => {
    await page.goto('/');

    const firstCard = page.locator('app-blog-card').first();

    await expect(firstCard.locator('mat-card-title')).not.toBeEmpty();
    await expect(firstCard.locator('mat-card-content p')).not.toBeEmpty();
  });

  test('clicking a blog entry navigates to its detail page', async ({ page }) => {
    await page.goto('/');

    const firstCard = page.locator('app-blog-card').first();
    const title = await firstCard.locator('mat-card-title').innerText();

    await firstCard.click();

    await expect(page).toHaveURL(/\/blog\/\d+$/);
    await expect(page.getByText(title)).toBeVisible();
  });
});
