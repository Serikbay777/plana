import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
  const aiExtractionMock = {
    source: "openai",
    model_used: "gpt-5.5",
    extraction: {
      region: "Astana",
      object_type: "multifamily residential",
      building_class: "business",
      site_width_m: 90,
      site_depth_m: 110,
      setback_front_m: 7,
      setback_side_m: 5,
      setback_rear_m: 7,
      gfa_above_ground_m2: 26000,
      gfa_underground_m2: 5000,
      efficiency_ratio: 0.81,
      market_price_per_sellable_m2: 760000,
      floors_above: 16,
      floors_below: 1,
      footprint_width_m: 52,
      footprint_depth_m: 34,
      parking_mode: "mixed",
      parking_spots: 420,
      complex_soil: null,
      complex_slope: false,
      missing_data_warnings: ["No geotechnical data"],
      assumptions_notes: ["Brief says business class"],
      confidence_level: "medium",
    },
  };
  await page.route("**/cost/extract-inputs", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiExtractionMock) });
  });
  await page.route("**/api/cost/extract-inputs", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(aiExtractionMock) });
  });
  const visionAnalysisMock = {
    source: "openai_vision",
    model_used: "gpt-5.5",
    analysis: {
      apparent_slope: true,
      road_access: "limited",
      dense_context: true,
      visible_constraints: ["Retaining wall visible"],
      risk_flags: [
        {
          key: "apparent_slope",
          label: "Apparent slope",
          severity: "medium",
          suggested_value: true,
          reason: "Terrain edge and retaining wall suggest uneven ground.",
        },
        {
          key: "limited_road_access",
          label: "Limited road access",
          severity: "medium",
          suggested_value: true,
          reason: "Access road is not clearly visible.",
        },
      ],
      missing_data_warnings: [
        "Image analysis is non-authoritative and requires user confirmation",
        "No official topographic/geotechnical survey attached",
      ],
      notes: ["Screening only"],
      confidence_level: "medium",
    },
  };
  await page.route("**/cost/analyze-site-image", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(visionAnalysisMock) });
  });
  await page.route("**/api/cost/analyze-site-image", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(visionAnalysisMock) });
  });
  const analystExplanationMock = {
    source: "openai",
    model_used: "gpt-5.5",
    explanation: {
      summary: "Screening estimate is driven by construction hard costs, site risk flags, and low-confidence source data.",
      key_drivers: ["Construction hard costs dominate the Class 5 total.", "Client uploaded rates changed the baseline."],
      risk_notes: ["Vision-confirmed apparent slope may increase site works risk."],
      missing_data: ["No geotechnical report attached.", "No official topographic survey attached."],
      next_documents: ["Topographic survey", "Geotechnical report", "Official Kazakhstan estimate source"],
      confidence_level: "medium",
    },
  };
  await page.route("**/cost/explain-snapshot", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analystExplanationMock) });
  });
  await page.route("**/api/cost/explain-snapshot", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(analystExplanationMock) });
  });

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
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("G) Source Registry");
  await expect(page.getByTestId("cost-source-registry")).toContainText("placeholder");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Missing Data Warnings");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Placeholder rates are used");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("VAT");
  await expect(page.getByTestId("cost-rate-base-above")).toBeVisible();

  await page.getByTestId("cost-ai-brief").fill("Business-class residential tower in Astana, 90x110 m site, 26,000 m2 GFA, 16 floors, mixed parking.");
  await page.getByTestId("cost-ai-analyze").click();
  await expect(page.getByTestId("cost-ai-preview")).toBeVisible();
  await expect(page.getByTestId("cost-ai-preview")).toContainText("gpt-5.5");
  await expect(page.getByTestId("cost-ai-preview")).toContainText("Astana");
  await expect(page.getByTestId("cost-ai-preview")).toContainText("Current");
  await expect(page.getByTestId("cost-ai-field-region")).toContainText("Almaty");
  await expect(page.getByTestId("cost-ai-field-region")).toContainText("Astana");
  await page.getByTestId("cost-ai-clear-selection").click();
  await expect(page.getByTestId("cost-ai-apply")).toBeDisabled();
  await page.getByTestId("cost-ai-field-region").click();
  await page.getByTestId("cost-ai-apply").click();
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("AI extraction");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("gpt-5.5");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("AI-rejected fields");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Region: ai_extracted");
  await expect(page.getByTestId("cost-source-registry")).toContainText("GPT brief extraction");
  await expect(page.getByTestId("cost-source-registry")).toContainText("ai_extracted");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("AI extraction: No geotechnical data");
  await page.getByTestId("cost-vision-upload").setInputFiles({
    name: "site.png",
    mimeType: "image/png",
    buffer: Buffer.from("site-image"),
  });
  await expect(page.getByTestId("cost-vision-preview")).toBeVisible();
  await expect(page.getByTestId("cost-vision-preview")).toContainText("Apparent slope");
  await expect(page.getByTestId("cost-vision-preview")).toContainText("Limited road access");
  await page.getByTestId("cost-vision-apply").click();
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Vision analysis");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Vision-applied flags");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Apparent slope");
  await expect(page.getByTestId("cost-source-registry")).toContainText("Vision site risk analysis");
  await expect(page.getByTestId("cost-source-registry")).toContainText("vision_extracted");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Vision: Image analysis is non-authoritative");
  await page.getByTestId("cost-geo-address").fill("Алматы, Бостандыкский район");
  await expect(page.getByTestId("cost-geo-suggestion")).toContainText("Almaty");
  await expect(page.getByTestId("cost-geo-suggestion")).toContainText("medium confidence");
  await page.getByTestId("cost-geo-apply").click();
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Geo confidence");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Geo: Address matching is keyword-based");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("Geo region confirmation: manual");
  await expect(page.getByTestId("cost-source-registry")).toContainText("Geo region confirmation");

  const totalBefore = await page.getByTestId("cost-placement-total").textContent();
  await page.getByTestId("cost-placement-variant-l_shape").click();
  await expect(page.getByTestId("cost-placement-total")).not.toHaveText(totalBefore ?? "");
  await expect(page.getByTestId("cost-placement-leveling")).toContainText("L-shape");

  const spinbuttons = page.getByRole("spinbutton");
  const gfaAboveInput = spinbuttons.nth(7);
  const efficiencyInput = spinbuttons.nth(9);
  const marketPriceInput = spinbuttons.nth(10);

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
  await expect(page.getByTestId("cost-source-registry")).toContainText("Client uploaded rate inputs");
  await expect(page.getByTestId("cost-source-registry")).toContainText("client_uploaded");
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/630\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/770\s*000/);
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText(/GO|CAUTION|NO-GO/);
  await expect(page.getByTestId("cost-placement-cost-structure")).toContainText("KZT");
  await page.getByTestId("cost-analyst-generate").click();
  await expect(page.getByTestId("cost-analyst-explanation")).toContainText("Screening estimate is driven");
  await expect(page.getByTestId("cost-analyst-explanation")).toContainText("Key drivers");
  await expect(page.getByTestId("cost-analyst-explanation")).toContainText("Topographic survey");
  const totalBeforeCalibration = await page.getByTestId("cost-placement-total").textContent();
  await page.getByTestId("cost-calibration-upload").setInputFiles({
    name: "historical-costs.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([
      "project_id,project_name,region,object_type,building_class,gfa_above_ground_m2,gfa_underground_m2,floors_above,floors_below,parking_mode,parking_spots,complex_soil,complex_slope,actual_total_cost_kzt,actual_cost_year,source_name,verification_status,notes",
      "KZ-ALM-001,Almaty benchmark,Almaty,multifamily residential,comfort,18000,3200,12,1,mixed,320,false,true,4300000000,2026,Verified closeout,draft,Future calibration row",
    ].join("\n")),
  });
  await expect(page.getByTestId("cost-calibration-status")).toContainText("1 historical row");
  await expect(page.getByTestId("cost-calibration-status")).toContainText("No predictive ML model is trained");
  await expect(page.getByTestId("cost-calibration-assumptions")).toContainText("Required fields");
  await expect(page.getByTestId("cost-source-registry")).toContainText("Historical outcome dataset");
  await expect(page.getByTestId("cost-placement-total")).toHaveText(totalBeforeCalibration ?? "");
  const reportDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("cost-report-export-csv").click();
  const reportDownload = await reportDownloadPromise;
  expect(reportDownload.suggestedFilename()).toContain("plana-cost-report");
  const reportPath = await reportDownload.path();
  expect(reportPath).toBeTruthy();
  const reportContent = await readFile(reportPath!, "utf8");
  expect(reportContent).toContain("Screening estimate, not official Kazakhstan estimate documentation");
  expect(reportContent).toContain("Class 5 Range");
  expect(reportContent).toContain("Source Registry");
  expect(reportContent).toContain("AI Extraction");
  expect(reportContent).toContain("Calibration Dataset");
  expect(reportContent).toContain("No predictive ML model is trained");

  await page.getByTestId("top-tab-site").click();
  await page.getByTestId("top-tab-cost_placement").click();
  await expect(gfaAboveInput).toHaveValue("24000");
  await expect(efficiencyInput).toHaveValue("0.8");
  await expect(marketPriceInput).toHaveValue("700000");
  await expect(page.getByTestId("cost-placement-total")).toContainText(/[0-9]/);
  await expect(page.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(page.getByTestId("cost-placement-revenue-scenarios")).toContainText(/630\s*000/);
  await expect(page.getByTestId("cost-placement-feasibility-score")).toContainText("Score");
  await expect(page.getByTestId("cost-assumptions-panel")).toContainText("gpt-5.5");

  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("button", { name: "Сохранено" })).toBeVisible();
  await expect(page).toHaveURL(/project=/);
  const savedUrl = page.url();

  const restored = await page.context().newPage();
  await authenticatePage(restored, auth);
  await restored.goto(savedUrl);
  await restored.getByTestId("top-tab-cost_placement").click();

  const restoredSpinbuttons = restored.getByRole("spinbutton");
  await expect(restoredSpinbuttons.nth(7)).toHaveValue("24000");
  await expect(restoredSpinbuttons.nth(9)).toHaveValue("0.8");
  await expect(restoredSpinbuttons.nth(10)).toHaveValue("700000");
  await expect(restored.getByTestId("cost-rate-base-above")).toHaveValue("180000");
  await expect(restored.getByTestId("cost-rate-upload-status")).toContainText("client-rates.csv");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded screening rates are used");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Client uploaded June screening rates");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("AI extraction");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("gpt-5.5");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Geo confidence");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("Vision analysis");
  await expect(restored.getByTestId("cost-analyst-explanation")).toContainText("Screening estimate is driven");
  await expect(restored.getByTestId("cost-calibration-status")).toContainText("1 historical row");
  await expect(restored.getByTestId("cost-calibration-assumptions")).toContainText("Almaty benchmark");
  await expect(restored.getByTestId("cost-assumptions-panel")).toContainText("G) Source Registry");
  await expect(restored.getByTestId("cost-source-registry")).toContainText("client_uploaded");
  await expect(restored.getByTestId("cost-source-registry")).toContainText("ai_extracted");
  await expect(restored.getByTestId("cost-source-registry")).toContainText("vision_extracted");
  await expect(restored.getByTestId("cost-source-registry")).toContainText("market_calibrated");
  await expect(restored.getByTestId("cost-placement-revenue-check")).toContainText(/700\s*000/);
  await expect(restored.getByTestId("cost-placement-feasibility-score")).toContainText(/GO|CAUTION|NO-GO/);
  await restored.close();
});
