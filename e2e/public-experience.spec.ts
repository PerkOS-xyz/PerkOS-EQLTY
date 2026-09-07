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
  await expect(page.locator(".goalPolicyHint")).toContainText(
    /Stock Token markets are available.*ENS policy/i,
  );
  await expect(
    page.getByRole("button", {
      name: /Connect wallet to begin|Evidence unavailable · refresh/,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Onboarding cannot move funds/)).toBeVisible();
  await expect(page.getByText("ENS Rules", { exact: true })).toBeVisible();
  await expect(
    page.getByText("1Claw Spend Control", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Uniswap Route", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Onchain Evidence", { exact: true }),
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
  await expect(page.getByText(/Onchain evidence/).first()).toBeVisible();
  await expect(
    page.getByLabel("Onchain evidence status"),
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
  await expect(page.getByText("Every proof layer is load-bearing.")).toBeAttached();
  await expect(
    page.getByText(/These are not logos around a trading screen/),
  ).toBeAttached();
  const sponsorPath = page.getByLabel("Sponsor decision path");
  await expect(sponsorPath).toContainText("Constrain the agents");
  await expect(sponsorPath).toContainText("Prove market evidence");
  await expect(sponsorPath).toContainText("Prepare execution");
  await expect(sponsorPath.getByText("Judge verification")).toHaveCount(3);
  await expect(page.getByText("EQLTY Vault enforcement")).toBeAttached();
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
  await expect(coverage).toContainText(/Onchain RPC (ready|degraded|pending)|The Graph (ready|degraded|pending)/);

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

test("shows verified workflow costs in a purchase receipt", async ({ page }) => {
  const hash = `0x${"ab".repeat(32)}`;
  const address = `0x${"12".repeat(20)}`;
  const poolId = `0x${"34".repeat(32)}`;
  await page.route("**/api/audits/*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        schema: "urn:eqlty:purchase-audit:v1",
        bundleHash: `0x${"56".repeat(32)}`,
        recordedAt: "2026-09-07T20:00:00.000Z",
        owner: address,
        ticker: "NVDA",
        transactionHash: hash,
        strategy: {
          appId: "strategy-22",
          onchainId: "22",
          agent: address,
          vault: address,
          inputToken: address,
          outputToken: address,
          router: address,
          amountIn: "1000000",
          maxSlippageBps: 100,
          expiresAt: "2026-09-08T20:00:00.000Z",
          setupTransactions: {
            creation: hash,
            approval: hash,
            funding: hash,
          },
        },
        ens: { status: "verified", manifestHash: poolId },
        graph: {
          request: {
            method: "eth_getLogs",
            endpoint: "rpc.example",
            authorization: "Server managed",
            body: { ticker: "NVDA", chainId: "eip155:4663" },
          },
          response: {
            source: "robinhood-rpc",
            evidenceScope: "pre-trade-market",
            evidenceBlock: "57171900",
            checkpointBlock: "57171900",
            headBlock: "57171901",
            lagBlocks: 1,
            poolManager: address,
            poolId,
            eventTopic: poolId,
            capturedAt: "2026-09-07T19:59:55.000Z",
          },
        },
        uniswap: {
          routing: "CLASSIC",
          requestId: "quote-22",
          quotedAmountOut: "4303000000000000",
          router: address,
          poolManager: address,
          poolId,
          poolMatchedGraphEvidence: true,
          graphPoolRelationship: "same-pool",
        },
        proofs: {
          signalHash: poolId,
          quoteHash: poolId,
          handoffs: [],
        },
        receipt: {
          chainId: 4663,
          status: "success",
          blockNumber: "57171919",
          blockHash: poolId,
          from: address,
          to: address,
          gasUsed: "302495",
          effectiveGasPrice: "301744000",
          tradeLogIndex: 10,
          swapLogIndex: 11,
        },
        costs: {
          status: "verified",
          investment: { amount: "1000000", symbol: "USDG" },
          decisionFee: { amount: "200000", symbol: "USDG", transactionHash: hash },
          ownerGasWei: "100771723092000",
          sponsoredGasWei: "97543585280000",
          decisionSettlementGasWei: "25463242980000",
          totalNetworkGasWei: "223778551352000",
          workingBalanceTargetWei: "2000000000000000",
          items: [
            {
              id: "strategy",
              label: "Strategy creation",
              payer: "owner",
              transactionHash: hash,
              gasUsed: "212855",
              gasPriceWei: "295642000",
              gasCostWei: "62928877910000",
            },
            {
              id: "execution",
              label: "Uniswap execution",
              payer: "eqlty",
              transactionHash: hash,
              gasUsed: "302495",
              gasPriceWei: "301744000",
              gasCostWei: "91276051280000",
            },
          ],
        },
        transfers: [],
        workflow: { steps: [], handoffs: [], oneclaw: { required: false, linked: false, minimumAmount: "3000000", executionAuthorized: true } },
      },
    });
  });

  await page.goto(`/history/${hash}`);
  await expect(page.getByRole("heading", { name: "NVDA purchase proof" })).toBeVisible();
  await expect(page.getByText("Actual workflow cost", { exact: true })).toBeVisible();
  await expect(page.locator(".actualCosts")).toContainText("0.2 USDG");
  await expect(page.locator(".actualCosts")).toContainText("Owner network gas");
  await expect(page.locator(".actualCosts")).toContainText("EQLTY-sponsored gas");
  await expect(page.locator(".actualCostReceipts a")).toHaveCount(2);
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

test("blocks paid consultation before compute when onchain evidence is stale", async ({
  page,
}) => {
  await page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        decisionFee: {
          mode: "live",
          scheme: "exact",
          maximumAmount: "250000",
          completeAmount: "200000",
          noCandidateAmount: "50000",
          decimals: 6,
          symbol: "USDG",
        },
        integrationHealth: {
          oneclaw: {
            configured: true,
            status: "ready",
            checkedAt: "2026-09-06T13:29:20.125Z",
            platformApi: true,
          },
          marketEvidence: {
            configured: true,
            status: "degraded",
            checkedAt: "2026-09-06T13:29:20.059Z",
            evidenceProvider: "robinhood-rpc",
            running: false,
            lagBlocks: 1_246_836,
            reason: "quota-exhausted",
            recovery: {
              state: "action-required",
              action: "renew-quota",
              automatic: false,
              message: "Provider quota is exhausted.",
            },
          },
        },
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Start guided consultation" }).click();
  await page.getByRole("button", { name: "Continue · Set budget" }).click();

  const preflight = page
    .getByRole("dialog", { name: "Set up your agent consultation" })
    .locator(".goalEvidenceReadiness");
  await expect(preflight).toContainText("Agent decisions are paused");
  await expect(preflight).toContainText("No compute or decision fee");
  await expect(
    page.getByRole("button", { name: "Evidence unavailable · refresh" }),
  ).toBeDisabled();
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
