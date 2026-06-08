import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { jsPDF } from "jspdf";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6j8AAAAASUVORK5CYII=",
  "base64",
);

type AuthSession = {
  token: string;
  email: string;
  name: string;
};

async function register(request: APIRequestContext): Promise<AuthSession> {
  const email = `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@plana.test`;
  const response = await request.post("/api/auth/register", {
    data: { email, password: "reliability-test-password" },
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

async function createProject(request: APIRequestContext, auth: AuthSession): Promise<string> {
  const response = await request.post("/api/projects", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { name: "Reliability E2E", params: {} },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).id;
}

async function createRunWithAsset(
  request: APIRequestContext,
  auth: AuthSession,
  projectId: string,
  tab: string,
  variantKey: string,
): Promise<string> {
  const runResponse = await request.post(`/api/projects/${projectId}/runs`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: { tab, floor: 1, params_snapshot: {} },
  });
  expect(runResponse.ok()).toBeTruthy();
  const runId = (await runResponse.json()).id;

  const assetResponse = await request.post(`/api/projects/${projectId}/assets`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    multipart: {
      tab,
      variant_key: variantKey,
      floor: "1",
      model_used: "e2e-model",
      run_id: runId,
      image: {
        name: `${variantKey}.png`,
        mimeType: "image/png",
        buffer: ONE_PIXEL_PNG,
      },
    },
  });
  expect(assetResponse.ok()).toBeTruthy();
  return runId;
}

test("history categories switch and saved result opens as a gallery", async ({ page, request }) => {
  const auth = await register(request);
  const projectId = await createProject(request, auth);
  const aiRunId = await createRunWithAsset(request, auth, projectId, "ai_plans", "max_useful_area");
  const exteriorRunId = await createRunWithAsset(request, auth, projectId, "viz_exterior", "exterior_aerial");
  const floorRunId = await createRunWithAsset(request, auth, projectId, "viz_floor", "floor");
  const siteRunId = await createRunWithAsset(request, auth, projectId, "site", "placement");
  const pdfRunId = await createRunWithAsset(request, auth, projectId, "pdf_viz", "p01_title_hero_C");
  const archRunId = await createRunWithAsset(request, auth, projectId, "arch_drawings", "floorplan_viz");
  const placementRunId = await createRunWithAsset(request, auth, projectId, "placement", "balanced");
  const interiorRunId = await createRunWithAsset(request, auth, projectId, "viz_interior", "studio");
  await authenticatePage(page, auth);

  await page.goto(`/app?project=${projectId}`);
  await expect(page.getByText("Reliability E2E", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "История" }).click();

  await page.getByTestId("history-tab-ai_plans").click();
  await page.getByTestId(`history-open-${aiRunId}`).click();
  await expect(page.locator('section img[src*="max_useful_area"]')).toBeVisible();

  await page.getByTestId("history-tab-viz").click();
  await page.getByTestId(`history-open-${exteriorRunId}`).click();
  await expect(page.locator('section img[src*="exterior_aerial"]')).toBeVisible();
  await page.getByTestId(`history-open-${floorRunId}`).click();
  await expect(page.locator('section img[src*="viz_floor__floor"]')).toBeVisible();

  await page.getByTestId("history-tab-site").click();
  await page.getByTestId(`history-open-${siteRunId}`).click();
  await expect(page.locator('section img[src*="site__placement"]')).toBeVisible();

  await page.getByTestId("history-tab-pdf_viz").click();
  await expect(page.getByTestId(`history-run-${pdfRunId}`)).toBeVisible();
  await page.getByTestId(`history-open-${pdfRunId}`).click();
  await expect(page.getByTestId("saved-run-gallery")).toContainText("p01_title_hero_C");

  await page.getByRole("button", { name: "Вернуться в рабочую область" }).click();
  await page.getByTestId("history-tab-arch_drawings").click();
  await expect(page.getByTestId(`history-run-${archRunId}`)).toBeVisible();

  await page.getByTestId("history-tab-placement").click();
  await page.getByTestId(`history-open-${placementRunId}`).click();
  await expect(page.getByTestId("saved-run-gallery")).toContainText("balanced");

  await page.getByRole("button", { name: "Вернуться в рабочую область" }).click();
  await page.getByTestId("history-tab-viz").click();
  await page.getByTestId(`history-open-${interiorRunId}`).click();
  await expect(page.getByTestId("saved-run-gallery")).toContainText("studio");
});

test("PDF workspace survives section switches", async ({ page, request }) => {
  const auth = await register(request);
  await authenticatePage(page, auth);
  await page.route("**/pdf/render-pages", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        pages: [{ index: 0, jpeg_b64: ONE_PIXEL_PNG.toString("base64"), width: 1, height: 1 }],
        truncated: false,
      }),
    });
  });

  const pdfPath = join(tmpdir(), `plana-reliability-${Date.now()}.pdf`);
  const pdf = new jsPDF();
  pdf.text("Plana reliability test", 20, 20);
  await writeFile(pdfPath, Buffer.from(pdf.output("arraybuffer")));

  await page.goto("/app");
  await page.getByTestId("top-tab-pdf_viz").click();
  await page.getByTestId("pdf-upload-input").setInputFiles(pdfPath);
  await expect(page.getByText("Рендерим страницы PDF…", { exact: true })).toBeVisible();
  await expect(page.getByText(pdfPath.split(/[\\/]/).pop()!, { exact: true })).toBeVisible();

  await page.getByTestId("top-tab-ai_plans").click();
  await page.getByTestId("top-tab-pdf_viz").click();
  await expect(page.getByText(pdfPath.split(/[\\/]/).pop()!, { exact: true })).toBeVisible();
  await expect(page.getByText("Рендерим страницы PDF…", { exact: true })).toBeVisible();
});

test("save failures are visible instead of looking successful", async ({ page, request }) => {
  const auth = await register(request);
  await authenticatePage(page, auth);
  await page.route("**/projects", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "E2E save failure" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Не сохранено: E2E save failure", { exact: true })).toBeVisible();
});

test("history load failures show a retry action", async ({ page, request }) => {
  const auth = await register(request);
  const projectId = await createProject(request, auth);
  await authenticatePage(page, auth);
  await page.route(`**/projects/${projectId}/runs`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "E2E history failure" }),
    });
  });

  await page.goto(`/app?project=${projectId}`);
  await page.getByRole("button", { name: "История" }).click();
  await expect(page.getByText("E2E history failure", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
});

test("delete failures keep the project card and show an error", async ({ page, request }) => {
  const auth = await register(request);
  const projectId = await createProject(request, auth);
  await authenticatePage(page, auth);
  await page.route(`**/projects/${projectId}`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "E2E delete failure" }),
      });
      return;
    }
    await route.continue();
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/projects");
  await expect(page.getByTestId(`project-card-${projectId}`)).toBeVisible();
  await page.getByTestId(`project-delete-${projectId}`).click();
  await expect(page.getByText("E2E delete failure", { exact: true })).toBeVisible();
  await expect(page.getByTestId(`project-card-${projectId}`)).toBeVisible();
});
