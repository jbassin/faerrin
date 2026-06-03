import { test, expect } from "@playwright/test";

// Desktop tests: modal flow
test.describe("desktop — faction modal", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop only");
  });

  test("home page loads and shows the hex map", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="hex-map"]')).toBeVisible();
  });

  test("clicking a hex opens the modal with the faction name", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toBeVisible();
  });

  test("pressing Escape closes the modal", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test("clicking the backdrop closes the modal", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    // Click near the top-left of the backdrop, outside the centered card
    await page
      .locator('[data-testid="modal-backdrop"]')
      .click({ position: { x: 10, y: 10 } });
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test("URL remains / after opening and closing the modal", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page).toHaveURL("/");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/");
  });
});

// Mobile tests: faction page navigation
test.describe("mobile — faction page", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile only");
  });

  test("home page loads and shows the hex map", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-testid="hex-map"]')).toBeVisible();
  });

  test("clicking a hex navigates to /factions/{slug}", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page).toHaveURL(/\/factions\/.+/);
  });

  test("the faction page renders the faction name", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page.locator("h2")).toBeVisible();
  });

  test("back button returns to /", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page
      .locator('[data-testid="faction-hex"]')
      .first()
      .click({ force: true });
    await expect(page).toHaveURL(/\/factions\/.+/);
    await page.getByRole("link", { name: /vox-channel close/i }).click();
    await expect(page).toHaveURL(/^.*\/\?seen.*$/);
  });
});
