import { expect, test } from "@playwright/test";

test("home renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Leadfinder" })).toBeVisible();
});

test("login link works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Zaloguj" }).click();
  await expect(page.getByRole("heading", { name: "Logowanie" })).toBeVisible();
});
