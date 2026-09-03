import { expect, test } from "@playwright/test";

test("explains the agent decision workflow", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Ask four agents/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Presentation" })).toHaveAttribute(
    "href",
    "/deck",
  );
  await expect(
    page.getByRole("heading", { name: "Your Financial Assistant Fleet" }),
  ).toBeVisible();
  await expect(page.getByText(/Describe the outcome you want/)).toBeVisible();
  await expect(page.getByText(/test alternatives against live evidence/)).toBeVisible();
  await expect(page.getByText(/the case for doing nothing/)).toBeVisible();
  await expect(
    page.getByText(/fee is requested only/i),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Set up your agent consultation" }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Start guided consultation" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Set up your agent consultation" }),
  ).toBeVisible();
  await expect(page.getByText("Step 1 of 2", { exact: true })).toBeVisible();

  const wizardContent = page.locator(".goalWizardModal > .goalWorkspace");
  await expect
    .poll(() => wizardContent.evaluate((element) => getComputedStyle(element).overflowY))
    .toBe("auto");

  await page.getByText("Fees and safeguards", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "EQLTY revenue model" }),
  ).toContainText("Users pay for verified decisions");
  await expect
    .poll(() =>
      wizardContent.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      }),
    )
    .toBeGreaterThan(0);

  const objective = page.getByLabel("Investment objective");
  await page.getByRole("button", { name: "Learn first" }).click();
  await expect(objective).toHaveValue(/without preparing a purchase/i);
  await expect(
    page.getByRole("button", { name: "Learn first" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Financial goal purpose")).toHaveValue("learn");
  await expect(page.getByLabel("Financial goal risk comfort")).toHaveValue("low");

  await page.getByRole("button", { name: "Continue · Set budget" }).click();
  await expect(page.getByText("Step 2 of 2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Potential purchase amount", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Analysis time", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet to begin" }),
  ).toBeVisible();
  await expect(page.getByText(/Onboarding cannot move funds/)).toBeVisible();
  await expect(page.getByText("ENS Rules", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1Claw Spend Control", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Uniswap Route", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The Graph Evidence", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "3 USDG", exact: true }).click();
  await expect(
    page.getByLabel("Potential purchase amount in USDG"),
  ).toHaveValue("3");

  const [analysisTimeBox, wizardActionsBox] = await Promise.all([
    page.getByLabel("Autonomous analysis window").boundingBox(),
    page.locator(".goalWizardActions").boundingBox(),
  ]);
  expect(analysisTimeBox).not.toBeNull();
  expect(wizardActionsBox).not.toBeNull();
  expect(analysisTimeBox!.y + analysisTimeBox!.height).toBeLessThanOrEqual(
    wizardActionsBox!.y,
  );

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("Step 1 of 2", { exact: true })).toBeVisible();

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
  await expect(
    page.getByRole("button", { name: "Uniswap market" }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Uniswap market" }).click();
  await expect(page.locator(".marketCard").first()).toContainText("Uniswap");

  await expectNoPageOverflow(page);
});

test("presents the product story with live proof", async ({ page }) => {
  await page.goto("/deck");

  await expect(
    page.getByRole("heading", { name: /Buying is solved/ }),
  ).toBeVisible();
  await expect(page.getByText("Talk to the fleet", { exact: true })).toBeAttached();
  await expect(page.getByText("Every sponsor is load-bearing.")).toBeAttached();
  await expect(page.getByText("AI-assisted investing.")).toBeAttached();
  await expect(page.getByText("Start direct.")).toBeAttached();
  await expect(page.getByText("Pay for verified work.")).toBeAttached();
  await expect(page.getByText("Prove value first.")).toBeAttached();
  await expect(page.getByText("Platform cost drivers")).toBeAttached();
  await expect(page.getByText("LatAm and Africa")).toBeAttached();
  await expect(page.getByRole("link", { name: "Open product" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("link", { name: "Contact us" })).toHaveAttribute(
    "href",
    "mailto:contact@perko.xyz",
  );

  const coverage = page.getByLabel("Live product coverage");
  await expect
    .poll(async () => coverage.locator("b").first().innerText(), {
      timeout: 45_000,
    })
    .toMatch(/^\d+$/);
  await expect(coverage).toContainText(/Graph ready|Graph degraded|Graph pending/);

  await page.keyboard.press("End");
  await expect(
    page.getByRole("heading", { name: /Ask\. Challenge/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Run live demo" })).toHaveAttribute(
    "href",
    "/#consultation",
  );

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
