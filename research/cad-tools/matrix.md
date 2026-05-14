# Comparison Matrix

## Сравнение по основной матрице: формат × операция × лицензия

Легенда:
- **R** — read/import
- **W** — write/export
- **V** — view (render)
- **E** — interactive edit
- ✓ — полная поддержка, ◐ — частичная/в roadmap, ✗ — нет

### Браузерные библиотеки

| Tool | DXF R | DXF W | DXF V | DXF E | DWG R | DWG W | IFC | License | Framework | Maturity |
|---|---|---|---|---|---|---|---|---|---|---|
| **@mlightcad/cad-viewer** | ✓ | ◐ (roadmap) | ✓ | ◐ basic | ✓ (LibreDWG WASM, частично) | ✗ | ✗ | MIT | Vue 3 (core agnostic) | Active, v1.5.0 |
| **dxf-viewer (vagran)** | ✓ | ✗ | ✓✓ | ✗ | ✗ | ✗ | ✗ | MPL-2.0 | three.js | Active, 37K/mo |
| **dxf-parser** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | MIT | none | Stable |
| **dxf-writer / @tarikjabiri/dxf** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | MIT | Node/browser | Stable |
| **three-dxf / loader / viewer** | через parser | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | MIT | three.js | Stable |
| **makerjs** | ✗ | ✓ (+SVG/PDF/STL) | ◐ (SVG) | ✗ | ✗ | ✗ | ✗ | Apache-2.0 | Node/browser | Stable (MS) |
| **JSCAD** | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | MIT | code-CAD | Active, V3 WIP |
| **OpenCascade.js** | ✗ | ✗ | ✓ via three | code-only | ✗ | ✗ | ✗ | LGPL-2.1 | WASM | Active |
| **Replicad** | ✗ | ✓ STEP only | ✓ | code-only | ✗ | ✗ | ✗ | MIT | wraps OCC.js | Active |
| **react-planner** | ✗ (своим JSON) | ✗ | ✓ 2D+3D | ✓✓ | ✗ | ✗ | ✗ | MIT | React 16+ | 1500+ commits |
| **arcada** | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | MIT | React+Pixi | Younger |
| **Konva.js** | через parser | через writer | ✓ | строим сами | ✗ | ✗ | ✗ | MIT | Canvas (any FW) | Mature |
| **JSketcher** | ✗ | ✓ DWG/SVG/STL | ✓ | ✓✓ | ✗ | ✓ | ✗ | (view license) | Standalone | Active |
| **web-ifc** | — | — | — | — | — | — | R/W ✓ | MIT | WASM | Active |
| **@thatopen/components** | — | ✓ (DXF export) | — | — | — | — | ✓ V+E (basic) | MIT | three.js | v3.4.0 |
| **xeokit-sdk** | — | — | — | — | — | — | ✓ V | AGPLv3 / Commercial | three-like | Active |

### Серверные (Python/CLI)

| Tool | DXF R | DXF W | DXF Render | DWG R | DWG W | License | Notes |
|---|---|---|---|---|---|---|---|
| **ezdxf** | ✓ | ✓ | ✓ (SVG/PNG/PDF) | ✗ direct | ✗ direct | MIT | Уже в plana |
| **LibreDWG** | через DXF | через DXF | ✗ | ✓ (частично) | ✓ | GPLv3 | CLI `dwg2dxf` |
| **ODA File Converter** | ✓ | ✓ | ✗ | ✓ | ✓ | Proprietary, free | Golden standard для DWG↔DXF |
| **FreeCAD headless** | ✓ | ✓ | ✓ | через ODA/LibreDWG | через ODA/LibreDWG | LGPL-2.0 | Тяжёлый (~700MB) |
| **Aspose.CAD** | ✓ | ✓ | ✓ | ✓ | ✓ | Commercial | Платный |

---

## Сравнение по сценариям ("какая комбинация подходит")

| Сценарий | Минимальный стек | Время до MVP |
|---|---|---|
| **MVP: загрузил DXF → подвинул объекты → выгрузил** | `@mlightcad/cad-viewer` + ждать или допиливать DXF save | 1-2 недели на интеграцию + допилки |
| **MVP кастомный**: tight контроль над UX | `dxf-parser` + `Konva.js` (или three.js) + `dxf-writer` | 4-8 недель |
| **Полноценный 3D**: BREP/STEP | `Replicad` или `OpenCascade.js` + R3F | 4-12 недель |
| **Архитектурный план "из коробки"** | `react-planner` + кастомный DXF-импорт через `dxf-parser` | 3-6 недель |
| **BIM с IFC** | `@thatopen/components` + `web-ifc` | 4-8 недель |
| **Серверный конвейер**: DWG → DXF → SVG/PNG превью | `ODA File Converter` (sidecar) + `ezdxf` | 1 неделя |

---

## Сравнение по нагрузке на бандл / производительности

| Tool | Bundle (gzip) | DXF parse 10MB | Render quality |
|---|---|---|---|
| `dxf-viewer` (vagran) | ~200KB + three.js | ~2-5s (web-worker) | Отличное, batching/instancing |
| `@mlightcad/cad-viewer` | ~1MB + WASM (LibreDWG) | DXF быстро, DWG ~5-10s | Хорошее |
| `three-dxf-*` | small + three.js | средне | Среднее |
| `react-planner` | большой, тащит Immutable + Redux | n/a (свой формат) | Хорошее для small-medium |
| `OpenCascade.js` (full) | **10-30MB WASM** | n/a | Зависит от профиля |
| `Replicad` | ~10MB WASM (urезанный OCC) | n/a | Хорошее |

---

## Лицензионные риски — короткая шпаргалка

| Лицензия | Можно в коммерческом продукте? | Заразность |
|---|---|---|
| MIT, Apache-2.0, BSD | ✓ свободно | нет |
| MPL-2.0 (`dxf-viewer`) | ✓ | только изменённые файлы должны быть открыты |
| LGPL-2.1 (`OpenCascade.js`) | ✓ при динамической линковке | модификации либы — открыть |
| GPL-3.0 (`LibreDWG` static) | ✗ заразит проект | да |
| GPL-3.0 (`LibreDWG` via CLI sidecar) | ✓ | нет (CLI — это не линковка) |
| AGPL-3.0 (`xeokit-sdk`) | ✗ требует открытия всего сервиса | очень сильная |
| Proprietary free (`ODA File Converter`) | смотри EULA | ⚠ зависит от EULA — для большинства non-volume use бесплатно |

**Вывод по лицензиям для plana:** держаться **MIT/Apache/MPL/LGPL**. `LibreDWG` использовать ТОЛЬКО как CLI sidecar (через subprocess), не линковать.

---

## Activity score (субъективная оценка свежести)

| Tool | Last release | Stars | Commits | Health |
|---|---|---|---|---|
| `@mlightcad/cad-viewer` | 2026-05-09 v1.5.0 | 600 | растёт | 🟢 |
| `dxf-viewer` (vagran) | стабильный | ~1k | стабильный | 🟢 |
| `react-planner` | стабильный, не v2 | ~2k | 1500+ | 🟡 (maintenance) |
| `OpenCascade.js` | v1.1.1 (2020) tag, но 2069 коммитов | 1.4k | активный | 🟡 |
| `Replicad` | активный | 700+ | активный | 🟢 |
| `@thatopen/components` | 2026-04-09 v3.4.0 | 650 | 1583 | 🟢 |
| `JSCAD` | V3 WIP 2026 | 1.7k | активный | 🟢 |
| `ezdxf` | 1.4.x | n/a | очень активный | 🟢 |
| `LibreDWG` | nightly | n/a | активный | 🟢 |

---

См. [`recommendation.md`](recommendation.md) — выбранный для plana стек.
