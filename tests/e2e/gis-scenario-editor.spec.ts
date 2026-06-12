import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type AuthSession = {
  token: string;
  email: string;
  name: string;
};

async function register(request: APIRequestContext): Promise<AuthSession> {
  const email = `gis-editor-${Date.now()}-${Math.random().toString(16).slice(2)}@plana.test`;
  const response = await request.post("/api/auth/register", {
    data: { email, password: "gis-editor-test-password" },
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

function gisProjectParams() {
  const handoff = {
    source: "gis_multi_parcel_map",
    createdAt: new Date().toISOString(),
    parcels: [
      {
        id: "p1",
        name: "Тестовый участок",
        designation: "Многоквартирный жилой комплекс",
        functionalZone: "Жилая зона",
        isSocial: false,
        areaM2: 12000,
        width: 120,
        height: 100,
        ringWgs84: [
          [71.4, 51.1],
          [71.401, 51.1],
          [71.401, 51.101],
          [71.4, 51.101],
        ],
        local: [
          [0, 0],
          [120, 0],
          [120, 100],
          [0, 100],
        ],
        ctx: {},
        params: {
          housing_class: "comfort",
          purpose: "residential",
          max_coverage_pct: 45,
          floors: 9,
        },
      },
    ],
    summary: {
      parcelsCount: 1,
      totalAreaM2: 12000,
      maxWidthM: 120,
      maxDepthM: 100,
      avgFloors: 9,
      functionalZones: ["Жилая зона"],
      hasSocialParcel: false,
    },
  };
  const response = {
    source: "openai",
    model_used: "gpt-5.5",
    scenarios: [
      {
        key: "balanced",
        title: "Balanced courtyard",
        strategy: "Тестовый двор с одним корпусом и паркингом.",
        warnings: [],
        rule_notes: ["Проверить красные линии после официального ГПЗУ."],
        objects: [
          {
            id: "b1",
            parcel_id: "p1",
            type: "residential_block",
            name: "Жилой корпус",
            x: 60,
            y: 20,
            width: 80,
            depth: 20,
            rotationDeg: 0,
            floors: 8,
            rationale: "Основной объем вдоль границы участка.",
          },
          {
            id: "yard1",
            parcel_id: "p1",
            type: "yard",
            name: "Двор",
            x: 34,
            y: 48,
            width: 52,
            depth: 30,
            rotationDeg: 0,
            floors: 0,
            rationale: "Общая зеленая зона.",
          },
        ],
      },
    ],
  };

  return {
    site_width_m: 120,
    site_depth_m: 100,
    building_width_m: 80,
    building_depth_m: 20,
    floors: 8,
    max_height_m: 27,
    max_coverage_pct: 45,
    "__plana_gis_masterplan": {
      handoff,
      response,
      selectedScenarioKey: "balanced",
      strategyHint: "Сделать жилой дворовый сценарий.",
      updatedAt: new Date().toISOString(),
    },
  };
}

test("GIS scenario control deck lets user edit generated objects", async ({ page, request }) => {
  const auth = await register(request);
  const createResponse = await request.post("/api/projects", {
    headers: { Authorization: `Bearer ${auth.token}` },
    data: {
      name: "GIS editable scenario",
      params: gisProjectParams(),
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const project = await createResponse.json();

  await authenticatePage(page, auth);
  await page.goto(`http://localhost:3000/app?project=${project.id}&tab=site`);
  const deck = page.getByTestId("gis-scenario-control-deck");
  await expect(deck).toBeVisible();
  await expect(page.getByTestId("gis-rule-checks")).toBeVisible();
  await expect(deck.getByText("12 800 м²").first()).toBeVisible();

  await page.getByTestId("gis-object-width-b1").fill("100");
  await expect(page.getByTestId("gis-object-width-b1")).toHaveValue("100");
  await expect(deck.getByText("16 000 м²").first()).toBeVisible();

  await page.getByTestId("gis-object-width-b1").fill("140");
  await expect(page.getByTestId("gis-object-width-b1")).toHaveValue("140");
  await expect(page.getByTestId("gis-rule-checks")).toContainText("Выход за границу участка");

  await page.getByTestId("gis-object-type-yard1").selectOption("parking");
  await expect(page.getByTestId("gis-object-floors-yard1")).toHaveValue("1");
});
