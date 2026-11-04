import { test, expect } from "@playwright/test";
const data = {
  timestamp: "2026-10-08T12:00:00Z",
  account: { cash: 100, portfolioValue: 20, equity: 120 },
  pnl: { realized: -4, fees: 1, net: -5, returnPct: -0.05 },
  positions: { count: 1, activeCount: 1, totalExposure: 20, largest: { ticker: "TEST" }, rows: [{ ticker: "TEST", exposure: 20, realizedPnl: -4 }] },
  edge: { wins: 0, losses: 1, winRate: 0, avgWin: 0, avgLoss: 4, expectancy: -4, recentFillCount: 1 },
  risk: { exposureRatio: 1 / 6, concentrationRatio: 1, openRisk: 20, restingOrders: 0 },
};

test("loading, cards, refresh, minute polling, errors, recovery, charts and mobile layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("500")) errors.push(message.text()); });
  // Never let a missed interception call the live account API.
  await page.route("**/api/dashboard", route => route.fulfill({ json: data }));
  await page.clock.install();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  let fail = false;
  await page.route("**/api/dashboard", async route => {
    calls++;
    if (calls === 1) await pending;
    await route.fulfill({ status: fail ? 500 : 200, json: fail ? { error: "Simulated outage" } : data });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Loading", exact: true })).toBeVisible();
  release();
  for (const name of ["P&L & Returns", "Position & Exposure", "Win Rate & Edge", "Risk"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".metric").first()).toHaveText("-$5.00");
  await expect(page.getByText("0.0%", { exact: true })).toBeVisible();
  await expect(page.locator("svg.chart")).toHaveCount(2);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => calls).toBe(2);
  await page.clock.fastForward(60_000);
  await expect.poll(() => calls).toBe(3);
  fail = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Simulated outage")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Simulated outage")).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  expect(errors).toEqual([]);
});
