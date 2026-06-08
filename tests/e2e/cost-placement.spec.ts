import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type AuthSession = {
  token: string;
  email: string;
  name: string;
};

async function register(request: APIRequestContext): Promise<AuthSession> {
  const email = `cost-${Date.now()}-${Math.random().toString(16).slice(2)}@plana.test`;
  const response = await request.post("/api/auth/register", {
    data: { email, password: "cost-placement-test-password" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { token: body.access_token, email: body.email, name: body.name };
}

async function authenticatePage(page: Page, auth: AuthSession): Promise<void> {
  await page.addInitScript((session) => {
    localStorage.setItem("plana.token", session.token);
    localStorage.setItem("plana.session", JSON.stringify({
      email: session.email,
      name: session.name,
      loggedAt: Date.now(),
    }));
  }, auth);
}

test("cost placement tab compares variants and survives section switches", async ({ page, request }) => {
  const auth = await register(request);
  await authenticatePage(page, auth);

  await page.goto("/app");
  await page.getByTestId("top-tab-cost_placement").click();
  await expect(page.getByTestId("cost-placement-variants")).toBeVisible();
  await expect(page.getByTestId("cost-placement-variant-linear_north")).toBeVisible();
  await expect(page.getByTestId("cost-placement-variant-central")).toBeVisible();
  await expect(page.getByTestId("cost-placement-variant-l_shape")).toBeVisible();
  await expect(page.getByTestId("cost-placement-leveling")).toBeVisible();
  await expect(page.getByTestId("cost-placement-leveling")).toContainText("base");
  await expect(page.getByTestId("cost-placement-developer-kpis")).toBeVisible();
  await expect(page.getByTestId("cost-placement-developer-kpis")).toContainText("Site area");
  await expect(page.getByTestId("cost-placement-developer-kpis")).toContainText("FAR / KIT");
  await expect(page.getByTestId("cost-placement-developer-kpis")).toContainText("Sellable area");
  await expect(page.getByTestId("cost-placement-feasibility-score")).toBeVisible();
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText("Feasibility signal");
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText("Score");
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText(/GO|CAUTION|NO-GO/);
  await expect(page.getByTestId("cost-placement-revenue-check")).toBeVisible();
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("Revenue sanity-check");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("Potential revenue");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("Gross margin");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("land / finance");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("Break-even price");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText("Upside to break-even");
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toBeVisible();
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText("Pessimistic");
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText("Base");
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText("Optimistic");
  await expect(page.getByTestId("cost-placement-cost-structure")).toBeVisible();
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("Cost structure");
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("Construction hard costs");
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("Site works allowances");
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("Class 5 contingency");
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("Excluded soft costs");
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("not in total");
  await expect(page.getByTestId("cost-placement-class5-range")).toContainText("Screening estimate");
  await expect(page.getByTestId("cost-assumptions-panel")).toBeVisible();
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("A) Cost Basis");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("B) Rate Assumptions");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("C) Included Items");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("D) Excluded Items");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Missing Data Warnings");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Placeholder rates are used");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("VAT");
  await expect(page.getByTestId("cost-rate-base-above")).toBeVisible();

  const totalBefore = await page.getByTestId("cost-placement-total").textContent();
  await page.getByTestId("cost-placement-variant-l_shape").click();
  await expect(page.getByTestId("cost-placement-total")).not.toHaveText(totalBefore ?? "");
  await expect(page.getByTestId("cost-placement-leveling")).toContainText("L-shape");

  const spinbuttons = page.getByRole("spinbutton");
  const gfaAboveInput = spinbuttons.nth(5);
  const efficiencyInput = spinbuttons.nth(7);
  const marketPriceInput = spinbuttons.nth(8);

  await gfaAboveInput.fill("24000");
  await efficiencyInput.fill("0.8");
  await marketPriceInput.fill("700000");
  await expect(page.getByTestId("cost-placement-total")).toContainText(/[0-9]/);
  const totalBeforeRateEdit = await page.getByTestId("cost-placement-total").textContent();
  await page.getByTestId("cost-rate-base-above").fill("160000");
  await expect(page.getByTestId("cost-placement-total")).not.toHaveText(totalBeforeRateEdit ?? "");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Manual screening rates are used");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("manual");
  await page.getByTestId("cost-rate-upload").setInputFiles({
    name: "client-rates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([
      "key,value",
      "base_rate_kzt_m2,180000",
      "contingency_pct,18",
      "source_name,Client uploaded June screening rates",
      "source_year,2026",
      "confidence_level,medium",
    ].join("\n")),
  });
  await expect(page.getByTestId("cost-rate-base-above")).toHaveValue("180000");
  await expect(page.getByTestId("cost-rate-contingency")).toHaveValue("18");
  await expect(page.getByTestId("cost-rate-upload-status")).toContainText("client-rates.csv");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded screening rates are used");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded June screening rates");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("client-rates.csv");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/630\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/770\s*000/);
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText(/GO|CAUTION|NO-GO/);
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("KZT");

  await page.getByTestId("top-tab-site").click();
  await page.getByTestId("top-tab-cost_placement").click();
  await expect(gfaAboveInput).toHaveValue("24000");
  await expect(efficiencyInput).toHaveValue("0.8");
  await expect(marketPriceInput).toHaveValue("700000");
  await expect(page.getByTestId("cost-placement-total")).toContainText(/[0-9]/);
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/630\s*000/);
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText("Score");

  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: "Сохранено" })).toBeVisible();
  await expect(page).toHaveURL(/project=/);
  const savedUrl = page.url();

  const restored = await page.context().newPage();
  await authenticatePage(restored, auth);
  await restored.goto(savedUrl);
  await restored.getByTestId("top-tab-cost_placement").click();

  const restoredSpinbuttons = restored.getByRole("spinbutton");
  await expect(restoredSpinbuttons.nth(5)).toHaveValue("24000");
  await expect(restoredSpinbuttons.nth(7)).toHaveValue("0.8");
  await expect(restoredSpinbuttons.nth(8)).toHaveValue("700000");
  await expect(restored.getByTestId("cost-rate-base-above")).toHaveValue("180000");
  await expect(restored.getByTestId("cost-rate-upload-status")).toContainText("client-rates.csv");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded screening rates are used");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded June screening rates");
  await expect(restored.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(restored.getByTestId("cost-placement-feasibility-score")).toContainText(/GO|CAUTION|NO-GO/);
  await restored.close();
});
