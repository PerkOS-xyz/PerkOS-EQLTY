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

  const objective = page.getByLabel("Investment objective");
  await page.getByRole("button", { name: "Conservative income" }).click();
  await expect(objective).toHaveValue(/lowest risk stock token/i);
  await expect(
    page.getByRole("button", { name: "Conservative income" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "3 USDG", exact: true }).click();
  await expect(page.getByLabel("Goal budget in USDG")).toHaveValue("3");

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

test("publishes safe 1Claw readiness", async ({ request }) => {
  const apiUrl = process.env.EQLTY_E2E_API_URL ?? "http://localhost:4021";
  const response = await request.get(`${apiUrl}/api/config`);

  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    integrationHealth?: {
      oneclaw?: {
        configured: boolean;
        platformApi: boolean;
        status: string;
      };
    };
  };
  expect(["ready", "degraded", "pending"]).toContain(
    body.integrationHealth?.oneclaw?.status,
  );
  expect(JSON.stringify(body.integrationHealth?.oneclaw)).not.toMatch(
    /1ck_|plt_|ocv_|email/i,
  );
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
