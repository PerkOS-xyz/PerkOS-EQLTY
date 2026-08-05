import { expect, test } from "@playwright/test";

test("explains the agent decision workflow", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /State the goal/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Financial Assistant Fleet" }),
  ).toBeVisible();
  await expect(page.getByText(/Follow ENS rules/)).toBeVisible();
  await expect(page.getByText(/Approve optional Uniswap execution/)).toBeVisible();
  await expect(page.getByText(/verify it with The Graph/)).toBeVisible();
  await expect(
    page.getByText(/Exact proof fee|decision fee is requested only/i),
  ).toBeVisible();

  await expect
    .poll(() => page.locator(".marketCard").count(), { timeout: 45_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".chartLine").first()).toHaveAttribute("d", /C|L/);

  await expectNoPageOverflow(page);
});

test("discovers real stock-token markets", async ({ page }) => {
  await page.goto("/markets");

  await expect(
    page.getByRole("heading", { name: "Explore stock tokens" }),
  ).toBeVisible();
  await expect(page.getByText("Uniswap V4", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/The Graph/).first()).toBeVisible();
  await expect(
    page.getByLabel("The Graph evidence status"),
  ).toBeVisible();

  await expect
    .poll(() => page.locator(".marketCard").count(), { timeout: 45_000 })
    .toBeGreaterThan(1);

  const search = page.getByRole("searchbox", { name: "Search stock tokens" });
  await search.fill("Netflix");
  await expect(page.locator(".marketCard")).toHaveCount(1);
  await expect(page.locator(".marketCard")).toContainText("NFLX");
  await expect(page.locator(".chartLine")).toHaveAttribute("d", /C|L/);

  await search.fill("");
  await page.getByRole("button", { name: "Uniswap V4" }).click();
  await expect(page.locator(".marketCard").first()).toContainText("V4");

  await expectNoPageOverflow(page);
});

async function expectNoPageOverflow(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}
