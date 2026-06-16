---
name: revit-markup-generator
description: >
  Generate СПДС markup (annotation) for a Revit architectural floor plan as a structured, validated
  JSON file. Use this skill whenever the user wants to «оформить», «промаркировать», tag, or annotate
  an existing Revit floor plan to КЗ/СПДС standard: room name+area tags, apartment marks (1к/2к/3к with
  living/total/coefficient areas), opening marks (ОК windows, Д doors, ПД window sills, ВВ vents),
  level marks, schedules (экспликация полов / ведомость отделки / спецификация заполнения / ведомость
  вытяжек) and the title block (штамп). Trigger on «маркировка», «оформление чертежей», «расставить
  марки», «теги помещений», «ведомости», or when the user supplies a Revit-derived room/opening
  dataset (or a plan image) and asks to produce the «После» markup. This skill outputs a validated
  JSON that a C# executor (Revit add-in / MCP server) applies to the EXISTING model — it does NOT
  create geometry.
---

# Revit Markup Generator (СПДС оформление АР)

You produce the **markup layer** for an architectural floor plan: the textual/annotation data that
turns a clean plan («До») into a documented sheet («После»). The geometry already exists — your job
is to decide names, areas, marks, numbering, schedules and the title block, and emit a **validated
JSON** that a C# executor applies in Revit (room tags, ОК/Д/ПД/ВВ tags, schedules, штамп).

## Before Generating Anything

Read `references/markup-schema.json` for the full output contract. Read `references/example-markup.json`
for a complete worked example (one corner apartment of a typical floor).

Hard rule: **do not invent the firm's conventions.** Numbering of ОК/Д/ПД/ВВ, the room-name wording,
the area coefficients and the title-block fields come from the Must Team profile (`convention_id`).
If a value is unknown, use the schema default and add a line to `_TODO`.

## Input Detection

**Model-data path (primary):** The user supplies a JSON/list of Revit rooms (id, name, area, boundary)
and openings (id, kind, host wall, dims), optionally apartments. This is the normal case — the model
exists, you only mark it. Use the data as-is; do not re-estimate geometry.

**Image path (fallback, low confidence):** The user uploads only a plan image (e.g. a PDF page). You
may infer rooms/openings from the raster, but mark every inferred value with lower confidence and list
assumptions in `_TODO`. Areas read from a raster are approximate — prefer model data.

---

## Generation Rules

### Room tags (`room_tags`)
- `name` — map the room to the Must Team naming dictionary (Гостиная, Спальня, Кухня / Кухня-ниша,
  С/у, Прихожая, Коридор, Лифтовой холл, Межквартирный коридор, Тамбур, Помещение уборочного
  инвентаря, Гардероб…). If the model Room.Name is already standard, keep it.
- `area_m2` — take from the model (computed Room area). Round to 2 decimals.
- `tag_point` — the room centroid, so tags don't overlap walls/each other. One tag per room.

### Apartment marks (`apartments`)
- `type` — studio/1k/2k/3k/4k from room composition (count of living rooms).
- `living_m2` — sum of living rooms (Гостиная + Спальни).
- `total_m2` — sum of all apartment rooms (no coefficient).
- `total_coeff_m2` — total where balcony/loggia/terrace areas are multiplied by `coefficients`
  (default balcony 0.3, loggia 0.5, terrace 0.3 — confirm with Must Team). Example: лоджия 2.41 м²
  contributes 2.41 × 0.5 = 1.21 м².

### Opening marks (`openings`) — the linchpin
- `kind` → prefix: window→**ОК**, door→**Д**, sill→**ПД**, vent→**ВВ**.
- `mark` — assign per the Must Team numbering convention. Default convention until confirmed:
  group identical openings (same kind + width × height) under one mark number; number sequentially
  per prefix in reading order (top-left → right, then down). Identical openings reuse the same mark
  (e.g. two 1500×1500 windows both `ОК-1`). Marks are the **keys** into the schedules, so they MUST
  be consistent across the plan and the ведомости.

### Level marks (`level_marks`)
- One elevation mark per relevant zone, `elevation_m` from the Revit Level (e.g. +4.200).

### Schedules (`schedules`)
- Always emit the four АР schedules as stubs: floors / finish / fill / vent, with their sheet refs
  (АР-012 / АР-013 / АР-014 / АР-016 by default; the executor builds the actual ViewSchedule).

### Title block (`titleblock`)
- Fill from the Must Team profile: project_name, block, stage (РП), sheet_number, format (А3А),
  gip / normcontrol / executor, company (Must Team).

---

## After Generating

### Validate the JSON
Run `scripts/validate_markup.py path/to/output.json`. Fix every reported error before presenting the
result. The JSON must conform to `markup-schema.json` (required fields, `mark` pattern `^(ОК|Д|ПД|ВВ)-\d+$`).

### Present a plain-language summary
List counts: N помещений промаркировано, M квартир, K проёмов (ОК/Д/ПД/ВВ), какие ведомости, штамп.
Call out anything in `_TODO` (unconfirmed convention / coefficients).

### Invite iteration
The user reviews and corrects (redline). Apply corrections and re-validate.

## What to Skip (v1)
КЖ/ОВ/ВК/ЭОМ marks, разрезы, кладочные планы, geometry creation. АР typical floor only.

## Reference Files
- `references/markup-schema.json` — output contract (read first).
- `references/example-markup.json` — worked example (one apartment).
- `scripts/validate_markup.py` — validator (run before presenting).
