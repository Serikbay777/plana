# AI-driven floor plan generation — landscape & рекомендация для plana

> Состояние на май 2026. Цель документа: понять, как лучше всего автогенерировать **несколько вариантов планировок жилого этажа** для plana с учётом ТЗ (GPZU, инсоляция, типология, паркинг, пожар) и выдавать **редактируемую векторную модель**, а не только pixels.
>
> Контекст: предыдущий алгоритмический pipeline откатили (`6edf301`), сейчас в проде только `gpt-image` (raster). Хотим вернуть AI-генерацию, но как структурную, не как картинку.

---

## TL;DR — рекомендованный подход

**Двухстадийный hybrid: LLM-планировщик → MIP-решатель на сетке → валидаторы → scorer → top-K.**

Это **прямая адаптация подхода Co-Layout (Nov 2025)** к этажу многоквартирного дома вместо одной квартиры. Co-Layout — единственная свежая работа, которая на наших задачах (room+furniture с topology constraints) комбинирует LLM с **integer programming** и получает валидные result'ы. Все остальные подходы (House-GAN++, HouseDiffusion, Architext, HouseLLM, ChatHouseDiffusion) — про **одиночные квартиры** размером ~10×10м с прямоугольными комнатами; для нашей задачи "квартиры на этаже секции 17×60м" они **не годятся "из коробки"** и требуют переобучения, которого мы себе позволить не можем (нет датасета KZ/RU-типологии).

**Recipe для plana (Phase A — MVP, ~2-3 недели):**

```
[GPZU + site + program] (JSON, наш домен)
       │
       ▼
┌─────────────────────────────────────┐
│ Stage 1: LLM-планировщик (Claude/   │
│ GPT-4o, function calling)            │
│ Tools:                               │
│   - place_core(x, y, type)          │
│   - place_apartment(corner, dims,    │
│     type, orientation)               │
│   - add_corridor(polyline, width)    │
│ Output: high-level grid assignment   │
└──────────┬──────────────────────────┘
           │ structured JSON
           ▼
┌─────────────────────────────────────┐
│ Stage 2: CP-SAT/MIP refinement       │
│ (Python, ortools)                    │
│ Grid: 0.3 м, sized по GPZU envelope │
│ Vars: cell ∈ {apt_i, core, corridor,│
│   void}                              │
│ Constraints (hard):                  │
│   - non-overlap                      │
│   - apt → corridor connectivity     │
│   - core ≤ 25м до любой apt door    │
│   - max apt/core (нормативный лимит)│
│   - insolation: bedrooms на S/E/W   │
│ Objective (soft):                    │
│   - max КИТ (sum apt_area)          │
│   - min corridor area                │
│   - target apt-mix ratio             │
└──────────┬──────────────────────────┘
           │ optimal grid + few sub-optimal
           ▼
┌─────────────────────────────────────┐
│ Stage 3: validators (Python)         │
│   - евакуация: ≤2 выходов с этажа?  │
│   - инсоляция KZ-СНиП               │
│   - вент через окно?                │
│   - площади min/max?                 │
└──────────┬──────────────────────────┘
           │ keep only valid
           ▼
┌─────────────────────────────────────┐
│ Stage 4: scorer + diversity filter   │
│   score = w1·КИТ + w2·apt_mix_match │
│         + w3·insolation_quality     │
│         + w4·corridor_efficiency    │
│   diversity: cluster по apt-mix,    │
│     взять top-1 из каждого кластера │
└──────────┬──────────────────────────┘
           │ top 3-5 вариантов
           ▼
[render to DXF via ezdxf (already in stack)]
```

**Почему именно так:**

1. **LLM делает то, что умеет** — высокоуровневое "куда положить ядро, какой shape секции, какая раскладка квартир по сторонам". Это креативная задача без точной арифметики.
2. **MIP делает то, что умеет** — точная геометрия на сетке с жёсткими constraint'ами. LLM **не способен** к надёжному spatial reasoning (см. FloorplanQA — GPT-4 даёт 7-31% на free-space tasks).
3. **Валидаторы отдельно** — потому что нормы KZ-СНиП у нас уже закодированы в `engine/`. Их можно вызвать как Python-функции до scorer'а.
4. **Multi-variant из коробки** — MIP с lazy-callback'ом выдаст top-K разных решений за один запуск; диверсификация по apt-mix даст пользователю **реально разные** варианты, а не близкие копии.

**Что НЕ берём (и почему):**

- **House-GAN++ / HouseDiffusion / GSDiff** — обучены на RPLAN/Tell2Design, это **одна квартира 256×256 px**, наш кейс — этаж секции. Нельзя обобщить без переобучения, переобучить нечем (нет датасета).
- **ArchiGAN** — Pix2Pix, raster, 2019, не векторный output, кодовая база заброшена.
- **Architext (GPT-J-162M)** — обучен на синтетических квартирах из Grasshopper, очень узкий домен, последнее обновление май 2023.
- **Pure LLM end-to-end** (типа "GPT-4o, дай мне JSON с координатами стен") — пробовал ZURU, accuracy ~50% после fine-tune. На сложных layouts LLM путает координаты, объекты пересекаются. См. FloorplanQA.
- **Spacemaker/Forma/TestFit как API** — закрытые, нет публичного API для генерации layout. Только UI/SaaS.

---

## Landscape — пять подходов

| Подход | Зрелость | Output | Подходит plana? | Почему |
|---|---|---|---|---|
| **GAN-based** (House-GAN++, ArchiGAN, FloorplanGAN) | Заморожен с 2021-2022 | Raster bbox или pixels | Нет | Не векторный, не масштабируется на multi-apt этаж, нет данных |
| **Diffusion-based** (HouseDiffusion, GSDiff, ChatHouseDiffusion) | Активный research 2023-2025 | Vector (junctions+walls) | Частично | Хороший research direction, но trained на single-apt RPLAN. Для нашего sec ~17×60 м нужно переобучение |
| **LLM-only end-to-end** (Architext, HouseLLM L1, ZURU) | Production-ish, но шумный | JSON координат | Нет | FloorplanQA доказывает: LLM не умеет точную spatial арифметику. Невалидно ~50-70% случаев |
| **Constraint programming / MIP** (Wortmann CSP, Co-Layout MIP) | Зрелый, проверенный | Vector grid → vector geometry | **Да** | Гарантирует валидность, многократно проверен на apartment layouts |
| **Hybrid LLM + solver** (Co-Layout, HouseLLM + diffusion, наш recipe) | Свежий (Nov 2024 - Nov 2025) | Vector + structured | **Да** ★ | Единственный путь, который даёт **и креатив, и валидность** |

---

## Per-paper / per-project deep dive

### 1. Co-Layout: LLM-driven Co-optimization for Interior Layout (Nov 2025) ★★★★★

Ближайший аналог нашему recipe. arXiv 2511.12474.

- **Pipeline:** multi-agent LLM workflow → структурированная спецификация (комнаты, мебель, отношения) → integer programming model на сетке → coarse-to-fine solve.
- **LLM output:** НЕ координаты, а constraints ("кухня рядом с гостиной", "кровать минимум 1.5×2 м", "коридор шире 1.2 м").
- **IP model:** каждая ячейка сетки = room/corridor/furniture. Hard constraints: non-overlap, connectivity (flow-based), accessibility. Soft: geometric quality, function.
- **Coarse-to-fine:** сначала 6×5 (комнаты), потом mapping на 12×10 (комнаты+мебель). Warm-start. Снимает экспоненциальный взрыв IP.
- **Что взять:** **весь pipeline и формулировку**. Заменить "комнаты+мебель" на "квартиры+ядра+коридоры", обучающий датасет нам не нужен, потому что LLM достаточно zero-shot/few-shot.
- **Что отличается у нас:** Co-Layout — для одной квартиры (interior). У нас — этаж. Соответственно primal-vars другие: вместо `cell ∈ {kitchen, bedroom, ...}` будет `cell ∈ {apt_1bd, apt_2bd, apt_3bd, core, corridor, void}`.

### 2. Text-to-Layout (Sep 2025) — arxiv 2509.00543 ★★★

LLM (GPT-4o) → JSON walls/doors/windows/furniture → Revit Python.

- **Прямая end-to-end LLM-генерация координат.** Output: `{walls: [{start: [x,y,0], end: [x,y,0]}], doors: [...], ...}`.
- **Greedy Wall Placement Algorithm** для мебели — итеративный nudge к ближайшей валидной точке. Это слабый суррогат полноценного solver'а.
- **Признанные limitations:** только single-story прямоугольные; ручные prompt-template'ы; "greedy struggles with densely populated configs"; нет валидации зданием-нормами; нет эксперт-оценки.
- **Что взять:** **JSON-схему output'а** как образец промежуточной репрезентации между LLM и solver. Greedy не используем, заменяем на CP-SAT.
- **Что НЕ брать:** end-to-end LLM-only генерация — слишком ненадёжно для нашего масштаба.

### 3. HouseLLM / HouseTune (Nov 2024) — arXiv 2411.12279 ★★★

Two-phase: LLM (chain-of-thought) генерирует initial layout как JSON, потом diffusion model его refines.

- **CoT prompt:** "house designer role → step-by-step reasoning → JSON output".
- **JSON-схема:** `{rooms: [{name, style, position:[x,y], size:[w,h], door_direction: "up"|...}]}`.
- **Diffusion** обучен на RPLAN, conditions на LLM JSON в **обоих фазах** (noise add + denoise).
- **Результат:** +28% diversity, +79% compatibility vs HouseDiffusion.
- **Что взять:** CoT-промпт-шаблон, JSON-схему "rooms with corner+size+door_direction".
- **Минус:** diffusion на RPLAN ≠ наш домен. Без replacement diffusion'а HouseLLM Phase 1 (LLM-only) даёт невалидные layouts.

### 4. ChatHouseDiffusion (Oct 2024) — arXiv 2410.11908 ★★★

LLM (GPT-4-turbo/Moonshot/Llama3) → JSON → graphormer topology → diffusion. Поддерживает **editing** существующего плана.

- **Editing trick:** фиксируется random seed, сохраняются все cross-attention maps, threshold τ управляет силой правки. Локальные изменения без полной регенерации.
- **Accuracy:** ~94% на room-type recognition; location и size остаются проблемой.
- **Что взять:** **идею editing через attention freeze** для второй фазы plana ("пользователь правит расположение, AI пересчитывает остальное").
- **Минус:** опять — обучен на RPLAN, single-apt.

### 5. Generative Floor Plan Design with LLMs via RLVR (NeurIPS 2025) — OpenReview ZMmDwqjQN9 ★★★

Llama-3.3-70B-Instruct → SFT → RL with verifiable rewards (GRPO).

- **Стадия 1:** SFT на парах (constraints → JSON floor plan).
- **Стадия 2:** RL с rewards по проверяемым метрикам (полигон-overlap, compatibility error). Reward = constraint validators.
- **Результат:** -94% compatibility score.
- **Что взять:** **подход RLVR**, если/когда мы соберём свой датасет KZ-планировок. Для plana **не сейчас** — нужно ≥10k размеченных планов.
- **Намёк:** валидаторы (наши CO-SCRIP'ы по нормам) можно использовать **дважды** — как hard constraints для CP-SAT и как RL-reward для будущего fine-tune'а LLM.

### 6. House-GAN++ (CVPR 2021, Nauata et al.) ★★

Граф-condition GAN, итеративный refinement.

- **GitHub:** `ennauata/houseganpp`, 47 forks, ~5 commits — **проект заморожен**.
- **Input:** bubble diagram (граф adjacency) → output: bounding boxes комнат.
- **Trained on RPLAN.** Только axis-aligned, прямоугольные комнаты, единственная квартира.
- **HouseDiffusion обогнал** по diversity (+67%) и compatibility (+32%) в 2023, GSDiff обогнал HouseDiffusion в 2025.
- **Что взять:** идея graph-conditioning как входа (типология как bubble diagram). Но **сам код использовать не надо** — устарел, заброшен.

### 7. HouseDiffusion (CVPR 2023, Shabani et al.) ★★★

Diffusion с discrete+continuous denoising. arXiv 2211.13287.

- **GitHub:** `aminshabani/house_diffusion`, 225 stars, 3 commits, "code has not been cleaned", dual license (Unknown+GPL-3.0) — **юридический грей-зон, осторожно**.
- **Output:** vector floor plan, room+door coords, **non-Manhattan structures** (важно!), точный контроль углов.
- **Что взять:** доказательство, что diffusion способен на векторный output для floor plans. Сам код не берём (GPL-3 копилефт + сырой).

### 8. GSDiff (AAAI 2025, Hu et al.) ★★★

GitHub `SizheHu/GSDiff`. Лицензия не указана.

- **Подход:** structural graph generation — отдельно wall junctions, отдельно wall segments. Alignment loss + random self-supervision.
- **FID 4.83, KID 2.84** — лучше всех предыдущих.
- **Что взять:** идею разложения "wall graph = junctions + segments". Может быть полезно как промежуточная репрезентация между MIP-grid result'ом и финальным DXF.

### 9. WallPlan (SIGGRAPH 2022) ★★

ACM TOG 41(4). Boundary → WinNet (окна) → GraphNet (стены) → LabelNet (типы комнат).

- **Concept:** wall-oriented, не room-oriented. Граф стен — first-class.
- Использует boundary как input — у нас boundary = footprint секции (GPZU).
- **Что взять:** идею **boundary-conditioned generation**. Это естественно для plana — GPZU всегда даёт нам "коробку".

### 10. Architext (Galanos, Liapis, Yannakakis, 2023) ★★

GPT-J-162M fine-tuned. HuggingFace: `architext/gptj-162M`, Apache 2.0, последний апдейт **май 2023**.

- **Input:** natural language ("house with two bedrooms..."), **output:** геометрия в текстовой репрезентации.
- **Training data:** **синтетически сгенерировано через Rhino/Grasshopper**. Это **критично**: они избежали проблемы датасета именно процедурной генерацией.
- **Accuracy:** 25-80% валидных layouts в зависимости от категории промпта.
- **Что взять:** **идею training data из procedural generator'а**. Если мы хотим однажды fine-tune'нуть свой LLM, лучший путь — написать процедурный генератор валидных KZ-планов на сетке и дистиллировать LLM на нём. Но для phase A — overkill.

### 11. DStruct2Design (NeurIPS 2024, Story et al.) — arXiv 2407.15723 ★★★

GitHub `plstory/DS2D`.

- **Подход:** Llama3-8B-Instruct fine-tuned LoRA на парах (constraints → JSON floor plan).
- **JSON schema:** room с polygon vertices (не bbox!), area, type, id, edge connections.
- **Что взять:** **JSON schema с polygon-вершинами** вместо bbox — это позволяет non-Manhattan комнаты, что критично для реальных KZ-секций.

### 12. Wortmann et al. — Residential complex design as CSP (Automation in Construction 2023) ★★★★

Sherkat, Garmaroodi, Wortmann × 2 (Stuttgart + Tehran). DOI: 10.1016/j.autcon.2023.105024.

- **Pure constraint satisfaction** в Grasshopper plugin. BFS+DFS по дереву решений с CSP-bounding.
- **Output:** 7 валидных альтернатив за 40с (маленький пример), 43 альтернативы за 5.1 мин (больший). **8 floors × 8 apartments** в самом большом тесте — это уже multi-apt building.
- **Constraints:** daylight, privacy, geometric.
- **Что взять:** **proof, что CSP подход работает на multi-apt домене**. Это вне RPLAN/Tell2Design мира. Их формулировка ближе к plana, чем все ML-работы.
- **Минус:** Grasshopper-only, не публичный код, но статья очень детально описывает constraint set.

### 13. Co-Layout vs Wortmann CSP

| | Co-Layout (2025) | Wortmann CSP (2023) |
|---|---|---|
| Tech | LLM + MIP | Pure CSP (BFS/DFS) |
| Scope | One apartment (interior) | Multi-apt residential complex |
| Geometric repr | Grid 12×10 | Geometric objects (no fixed grid) |
| Soft constraints | Yes (weighted obj) | No (только feasibility) |
| Multi-variant | Top-K via objective | Enumerate all feasible |
| Открытый код | Не указано | Нет |

**Гибрид для plana:** scope Wortmann'а (multi-apt) + tech Co-Layout'а (LLM + MIP с soft objectives).

---

## Production / commercial (что используют конкуренты)

### Autodesk Forma (бывш. Spacemaker)

- **Cloud SaaS** для site/urban planning, не для single-floor layout.
- **Pipeline:** site → massing → fast ML/heuristic surrogates для wind/sun/traffic/zoning → "Site Automation" (генерация и оценка вариантов).
- **API:** ограниченный Forma → Revit add-in.
- **Релевантно для plana:** на уровне *концепции* (multi-criteria optimization с suргaes), не как заимствуемая технология. У plana — этаж и квартиры, у Forma — масштаб квартала.

### TestFit

- **НЕ ML**, чисто параметрический оптимизатор. "Generates 3000 layouts in 3 seconds, 160 variables."
- Export: **DXF, SKP, glTF, CSV, PDF** — близко к plana (мы уже делаем DXF).
- **Релевантно:** prove'ит, что **rule-based + быстрый optimizer** даёт production-grade результаты без ML. Поддерживает идею: можно начать с pure MIP + heuristic enumeration, добавить LLM позже.

### Hypar.io

- **Code-driven** generative платформа (Python/C#) в облаке. Не ML.
- Идея "optioneering" — генерировать сотни вариантов через user code.
- **Релевантно:** показывает, что **explicit code как design-language** работает в проде. Это и есть наш `engine/` подход.

### Finch3D

- **Patented graph-based** generation, не diffusion/GAN. "Finch Graph" = граф пространственных отношений.
- Import: Rhino/Revit/Grasshopper massing → layouts → quality metrics (circulation, daylight, area).
- **Релевантно:** graph как первичная репрезентация подтверждается ещё раз. Наш bubble diagram → MIP — это та же идея.

### Archistar

- AI site analysis + zoning + feasibility. Multi-criteria optimization.
- Релевантно мало — у нас на уровне zoning ничего не делаем, мы — *этаж*.

**Общий takeaway по commercial:** **никто** в проде не делает pure ML для генерации layout'а. Все используют **rule-based / graph / parametric** ядро, ML только для surrogates (wind, daylight) и опционально для UX (NL prompts). Это сильный сигнал в пользу нашего hybrid-подхода.

---

## Datasets — что доступно в 2026

| Dataset | Size | Format | License | Подходит plana? |
|---|---|---|---|---|
| **RPLAN** (Wu et al. 2019) | 80k single-apt планов из Азии | Raster 256×256 | Запрос автору, неясно для коммерции | Нет (single-apt, raster, Азия) |
| **Tell2Design** (Leng et al. ACL 2023) | 80k single-apt + текст | Vector + text | Research only | Только если phase B fine-tune |
| **LIFULL HOME's** (Япония) | 5.1M floor plans, 83M images | Raster | **University only**, free | Не для нас (мы коммерческий SaaS) |
| **MSD / Modified Swiss Dwellings** (ECCV 2024) | 5372 multi-apt комплексов, 18.9k квартир | Raster + vector + graph | CC-BY-SA 4.0 (сайт; dataset — проверять) | **Да, наиболее релевантный** — multi-apt, EU-типология, vector |
| **ResPlan** (2025, arXiv 2508.14006) | 17k single-apt | Vector + graph, JSON + NetworkX | Permissive open-source | Хороший supplement; single-apt но vector |
| **MagicPlan** (PuzzleFusion, через AR) | ~меньше | Vector | Research | Альтернатива RPLAN, но узкий объём |

**Вывод:** **MSD** — единственный multi-apt vector dataset с permissive license. ResPlan — лучший single-apt vector. **Ни одного русского/советского/казахстанского датасета не существует.**

### Русская/советская типология

Поиск дал только **исторический материал** (хрущёвки, ГосСтрой 1956 — 23 типа квартир по семейным группам, серии). **Никаких open datasets с КЗ/РФ-планировками.** Это значит:

1. **Невозможно использовать pretrained MLs** напрямую — Asian/EU/US типология сильно отличается (наши коридоры шире, кухни больше, балконы обязательны, инсоляция жёсткая, инженерные стояки в строго определённых местах).
2. **Перспектива:** собрать собственный proprietary dataset из 50-200 высококачественных KZ/RU секций. Это самостоятельный проект на несколько месяцев, но **главное конкурентное преимущество plana**.
3. **На phase A** — обходимся **без датасета**. LLM zero/few-shot + CP-SAT не требуют обучения.

---

## Multi-variant generation + scoring

ТЗ хочет "несколько вариантов на выбор". Recipe:

### Источники multi-variant'а

1. **LLM stochasticity** (`temperature=0.7-1.0`, разные seeds) — даст разные high-level strategies (например, "ядро в центре vs ядро в торце", "галерейный vs секционный тип"). **Это главный источник разнообразия.**
2. **MIP solution pool** — `cp_solver.solve(solution_callback)` с OR-Tools CP-SAT. Hint: SAT-решатели нативно поддерживают enumeration first-k-solutions; для CP-SAT — через `parameters.enumerate_all_solutions = true` или callback.
3. **Random perturbations** в objective weights (e.g., w_compactness ∈ uniform) — даст разные local optima.

### Scoring function

```python
def score(layout: Layout) -> float:
    # все нормированы 0..1
    kit = useful_area(layout) / gross_area(layout)            # 0.7..0.85
    mix = 1.0 - apt_mix_distance(layout, target_mix)          # 1.0 = perfect match
    insol = fraction_of_bedrooms_meeting_kz_insolation(layout)
    corr = 1.0 - corridor_area(layout) / gross_area(layout)
    fire = is_evac_compliant(layout)                          # 0 or 1, kill switch
    return (0.4*kit + 0.25*mix + 0.20*insol + 0.15*corr) * fire
```

Веса вынести в config, дать пользователю слайдеры (как в Forma).

### Diversity filter (избегать near-duplicates)

После top-K по score:
1. Считать **signature** layout'а: `(apt_types_per_floor_side, core_position, corridor_topology)`.
2. Group by signature.
3. Из каждой группы — топ-1.
4. Вернуть top-K разных групп.

Это аналогично diversity-promoting в NMS детектора, но в архитектурном domain'е.

---

## Open questions — что прототипировать первым

1. **LLM tool-use стабильность.** Действительно ли Claude/GPT-4o может надёжно вызывать `place_apartment(corner=[x,y], size=[w,h])` для секции 17×60м с 10-14 квартирами? Что говорит FloorplanQA — на сложных пространственных запросах accuracy 7-31%. **Mitigation:** LLM возвращает **намерения** (apt типы + adjacency граф), не координаты. Координаты вычисляет MIP.

2. **CP-SAT performance на realistic сетке.** Сетка 0.3м × площадь 17×60 = 56×200 = 11200 cells × ~12 категорий = 134k binary vars. Это **на грани** для CP-SAT. Может потребоваться coarse-to-fine (Co-Layout pattern): сначала 1м сетка (17×60=1020 cells × 12 = 12k vars), потом fine 0.3м для refinement.

3. **Validators latency.** Инсоляция KZ-СНиП — это солнечная геометрия + затенение соседями. Если делать честно — секунды на вариант. Нужен fast surrogate (типа SVM на geometric features).

4. **Editing flow.** Когда пользователь двигает стену — пересчитывать весь MIP заново? Кэшировать tree-search state? ChatHouseDiffusion-trick с attention freeze здесь не применим (мы не diffusion).

5. **DXF round-trip.** Грид-MIP даёт ячейки. Нужно конвертировать в **clean DXF** (вершины стен, дверные блоки, штриховки). Уже частично есть в `engine/`, но grid → polyline simplification — отдельная work.

6. **Quality of LLM proposals.** Без датасета KZ — LLM будет фантазировать "американские" планировки (open kitchen, walk-in closet). **Mitigation:** жёсткий system prompt с KZ-нормами + few-shot из 5-10 ручных образцовых планов (это могут составить эксперты-архитекторы за неделю).

---

## Prototype recipe — конкретный код-sketch

### Stage 1 — LLM с function calling

**System prompt outline (RU):**

```
Ты — главный архитектор проекта типового жилья в Казахстане.
Тебе даны:
- Контур секции (полигон, метры)
- Ограничения GPZU: отступы, max этажей
- Программа: целевой mix квартир (например, 20% 1-комн, 50% 2-комн, 30% 3-комн)
- KZ-СНиП нормы (краткая выжимка из 20 пунктов)

Твоя задача — на одном типовом этаже расставить:
- 1 или 2 лестнично-лифтовых ядра (по нормам — не более 25 м от двери квартиры)
- Квартиры с типами 1К/2К/3К
- Коридор/галерея, соединяющий ядро со всеми квартирами

Используй tools: place_core, place_apartment, add_corridor.
Не вычисляй точные координаты — указывай примерное положение
("у северного торца", "северная сторона коридора, индекс 3 слева"),
точные координаты подберёт оптимизатор.

После расстановки — opt: вызови validate_layout, чтобы проверить.

Few-shot examples ниже:
[3-5 ручных примеров от наших архитекторов]
```

**Tool signatures (TypeScript/Python, для function-calling):**

```python
def place_core(
    side: Literal["north","south","east","west","center"],
    position_along_side: Literal["start","middle","end"],
    type: Literal["passenger_only","passenger_fire","passenger_freight"],
) -> CoreRef: ...

def place_apartment(
    side: Literal["north","south"],   # секционный/линейный type
    slot_index: int,                  # позиция в линейке слева
    apt_type: Literal["1K","2K","3K","студия"],
    orientation: Literal["bedroom_outside","kitchen_outside"],  # инсоляция
) -> ApartmentRef: ...

def add_corridor(
    from_core: CoreRef,
    to_apartments: list[ApartmentRef],
    typology: Literal["галерейный","секционный","коридорный"],
) -> CorridorRef: ...

def validate_layout() -> ValidationReport:
    # вызывает наши KZ-СНиП валидаторы, возвращает list of issues
    ...
```

Заметь: tools работают в **дискретном domain**'е (slot index, side), не в координатах. LLM не должен арифметить.

### Stage 2 — MIP в OR-Tools CP-SAT

```python
from ortools.sat.python import cp_model

model = cp_model.CpModel()

# 1) Grid
W, H = footprint_dimensions(section_polygon, grid=0.3)  # ~56×200
N_APTS = 14
N_CATS = N_APTS + 3  # + core, corridor, void

# 2) Vars: cell[w,h,cat] ∈ {0,1}, exactly one cat per cell
cell = {(w,h,c): model.NewBoolVar(f"c_{w}_{h}_{c}")
        for w in range(W) for h in range(H) for c in range(N_CATS)}
for w,h in itertools.product(range(W), range(H)):
    model.Add(sum(cell[w,h,c] for c in range(N_CATS)) == 1)

# 3) Apt rectangularity — каждая apt = bbox
apt_x1, apt_y1 = [model.NewIntVar(0, W-1, f"x1_{i}") for i in range(N_APTS)], ...
# и cell[w,h,apt_i] == 1 iff x1_i ≤ w ≤ x2_i AND ...

# 4) LLM hints → MIP-warm-start (приоритеты, не hard)
# из place_apartment(side=north, slot=3, type=2K) →
# apt_3 ∈ северная половина && area ≈ 60м²

# 5) Hard constraints
#   - non-overlap (уже из exactly-one-cat-per-cell)
#   - corridor connectivity (flow-based, см. Co-Layout §3)
#   - door from apt to corridor (≥1 cell adjacency)
#   - core distance ≤ 25м (manhattan через коридор)

# 6) Soft objective
model.Maximize(
    40*total_apt_area
    - 25*deviation_from_target_mix
    + 20*southern_bedrooms_count
    - 15*corridor_cells
)

solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 30
solver.parameters.num_search_workers = 8

# Solution pool for multi-variant
class TopKCollector(cp_model.CpSolverSolutionCallback):
    def __init__(self, k=10): ...
    def OnSolutionCallback(self): ...

collector = TopKCollector(k=10)
solver.SearchForAllSolutions(model, collector)
```

### Stage 3 — Validators

Уже есть в `engine/` через KZ-СНиП. Подключаются как pure Python функции; результат — `ValidationReport(passed: bool, issues: list[str])`.

### Stage 4 — Scoring + DXF export

```python
ranked = sorted(valid_layouts, key=score, reverse=True)
diverse = diversity_filter(ranked, k=5)
for layout in diverse:
    dxf = ezdxf.new()
    # уже есть код, конвертация Layout → DXF entities
    render_layout_to_dxf(layout, dxf)
    save(dxf, f"variant_{layout.id}.dxf")
```

---

## Сравнительная таблица: что взять, что не брать

| Артефакт | Откуда | Лицензия | Использовать как |
|---|---|---|---|
| **Co-Layout pipeline** | arXiv 2511.12474 | Paper (idea) | Reference architecture |
| **DStruct2Design JSON schema** (room w/ polygon vertices) | GitHub plstory/DS2D | См. репо | Output schema reference |
| **HouseLLM CoT prompt template** | arXiv 2411.12279 | Paper | Prompt engineering reference |
| **OR-Tools CP-SAT** | google/or-tools | Apache 2.0 | Прямая интеграция в `engine/` |
| **ezdxf** | mozman | MIT | Уже в стеке |
| **MSD dataset** | caspervanengelenburg.github.io | CC-BY-SA 4.0 (web) | Future: benchmark/eval только |
| **ResPlan dataset** | arXiv 2508.14006 | Permissive | Future: benchmark/eval |
| House-GAN++ code | ennauata/houseganpp | Open, заброшен | НЕ брать |
| HouseDiffusion code | aminshabani/house_diffusion | Unknown + GPL-3 | НЕ брать (GPL-зараза) |
| Architext gptj-162M | HF architext/gptj-162M | Apache 2.0 | Можно experiment, но узкий домен |
| RPLAN dataset | Tsinghua/USTC | Запрос автору | НЕ брать (не lицензировано для коммерции) |
| LIFULL HOME's | NII Japan | Univ. only | НЕ брать (мы commercial) |

---

## Roadmap для plana

### Phase A (2-3 недели): Hybrid MVP

1. **Tool signatures** — `place_core/place_apartment/add_corridor/validate_layout` (Python, в `engine/`).
2. **LLM-планировщик** — Claude Sonnet через function calling. System prompt + 5 few-shot KZ-планов от архитекторов.
3. **CP-SAT model** — coarse-grid (1м), single objective (KIT), hard constraints (non-overlap, connectivity).
4. **Scorer + diversity** — простой weighted sum, signature-based clustering.
5. **DXF render** — переиспользуем существующий код из `engine/`.
6. **API endpoint** — `POST /api/generate` → `{variants: [Layout, ...]}`.

**Целевая метрика A:** 70% генераций — синтаксически валидные (не пересекаются, есть коридор, ядро в норме).

### Phase B (4-6 недель): Refinement и UX

1. **Fine-grid pass** (0.3м) после coarse, Co-Layout style.
2. **Editing flow** — пользователь двигает квартиру → MIP re-solve с **этой apt frozen** + adjusted neighbors.
3. **Full KZ-СНиП validators** — инсоляция, евакуация, вент.
4. **UI** — выбор top-K вариантов + diff между ними.
5. **Score weights slider** для пользователя.

**Целевая метрика B:** 90% валидных по KZ-СНиП после refinement.

### Phase C (опционально, 2-3 месяца): свой датасет + fine-tune

1. Собрать 100-300 эталонных KZ-планов от архитекторов.
2. Procedural generator на основе MIP → 10k синтетических планов.
3. Fine-tune Llama 3.x / Qwen на этом датасете (RLVR style, см. NeurIPS 2025 paper).
4. Использовать как замену Claude/GPT-4o (cheaper, on-prem option).

---

## Sources

### Papers — LLM + floor plans

- [Co-Layout: LLM-driven Co-optimization for Interior Layout (arXiv 2511.12474, Nov 2025)](https://arxiv.org/html/2511.12474v2)
- [Text-to-Layout: A Generative Workflow for Drafting Architectural Floor Plans Using LLMs (arXiv 2509.00543, Aug 2025)](https://arxiv.org/html/2509.00543v1)
- [Generative Floor Plan Design with LLMs via RLVR (NeurIPS 2025, OpenReview ZMmDwqjQN9)](https://openreview.net/pdf?id=ZMmDwqjQN9)
- [HouseLLM / HouseTune: LLM-Assisted Two-Phase Text-to-Floorplan (arXiv 2411.12279, Nov 2024)](https://arxiv.org/html/2411.12279v1)
- [ChatHouseDiffusion: Prompt-Guided Generation and Editing of Floor Plans (arXiv 2410.11908, Oct 2024)](https://arxiv.org/html/2410.11908v1)
- [DStruct2Design: Data Structure Driven Generative Floor Plan Design (arXiv 2407.15723, NeurIPS 2024)](https://arxiv.org/html/2407.15723v1)
- [FloorplanQA: Benchmark for Spatial Reasoning in LLMs (arXiv 2507.07644, 2025)](https://arxiv.org/html/2507.07644v2)
- [Architext: Language-Driven Generative Architecture Design (arXiv 2303.07519, 2023)](https://arxiv.org/pdf/2303.07519)
- [LayoutGPT: Compositional Visual Planning and Generation with Large Language Models (NeurIPS 2023)](https://layoutgpt.github.io/)

### Papers — GAN / diffusion / graph

- [House-GAN++ (CVPR 2021, Nauata et al.)](https://ennauata.github.io/houseganpp/page.html)
- [HouseDiffusion: Vector Floorplan Generation via Diffusion (CVPR 2023, Shabani et al.)](https://arxiv.org/abs/2211.13287)
- [GSDiff: Synthesizing Vector Floorplans via Geometry-enhanced Structural Graph Generation (AAAI 2025)](https://arxiv.org/abs/2408.16258)
- [WallPlan: synthesizing floorplans by learning to generate wall graphs (SIGGRAPH/TOG 2022)](https://dl.acm.org/doi/10.1145/3528223.3530135)
- [Tell2Design: A Dataset for Language-Guided Floor Plan Generation (ACL 2023)](https://aclanthology.org/2023.acl-long.820/)
- [Graph2Plan: Learning Floorplan Generation from Layout Graphs](https://www.researchgate.net/publication/343625455_Graph2Plan_learning_floorplan_generation_from_layout_graphs)
- [FloorplanGAN: Vector residential floorplan adversarial generation](https://www.sciencedirect.com/science/article/abs/pii/S0926580522003430)
- [ArchiGAN (NVIDIA blog, Chaillou 2019)](https://developer.nvidia.com/blog/archigan-generative-stack-apartment-building-design/)
- [Automated building layout generation using deep learning and graph algorithms (Wang et al. 2023)](https://www.sciencedirect.com/science/article/abs/pii/S0926580523002960)

### Papers — constraint / MIP / CSP

- [Residential complex design as a Constraint Satisfaction Problem (Sherkat, Wortmann et al., Automation in Construction 2023)](https://awortmann.github.io/downloads/paper/Residential_complex_design_as_a_Constraint_Satisfaction_Problem.pdf)
- [Floor plan generation through mixed CP-genetic optimization (Automation in Construction 2020)](https://www.sciencedirect.com/science/article/abs/pii/S0926580520310712)
- [OR-Tools CP-SAT documentation](https://developers.google.com/optimization/cp)
- [CP-SAT Primer (Krupke)](https://github.com/d-krupke/cpsat-primer)

### Datasets

- [MSD: A Benchmark Dataset for Floor Plan Generation of Building Complexes (ECCV 2024)](https://caspervanengelenburg.github.io/msd-eccv24-page/)
- [ResPlan: A Large-Scale Vector-Graph Dataset (arXiv 2508.14006, 2025)](https://arxiv.org/abs/2508.14006)
- [RPLAN dataset (DeepLayout, USTC)](http://staff.ustc.edu.cn/~fuxm/projects/DeepLayout/index.html)
- [LIFULL HOME's Dataset (NII Japan)](https://www.nii.ac.jp/dsc/idr/en/lifull/)

### Commercial / production

- [Autodesk Forma (Spacemaker)](https://www.autodesk.com/eu/campaigns/spacemaker)
- [Finch3D: graph-based generative](https://www.finch3d.com/)
- [TestFit Generative Design](https://www.testfit.io/news/testfit-launches-groundbreaking-generative-design-for-better-building-optimization)
- [Hypar.io](https://hypar.io/)
- [Archistar](https://www.archistar.ai/generative-design/)

### Surveys / reviews

- [Computer-Aided Layout Generation for Building Design: A Review (arXiv 2504.09694, 2025)](https://arxiv.org/html/2504.09694v1)
- [Floor plan generation: The interplay among data, machine, and designer (Mostafavi et al. 2025)](https://journals.sagepub.com/doi/10.1177/14780771241290649)
- [Generative design for architectural spatial layouts: a review (Tandfonline 2025)](https://www.tandfonline.com/doi/full/10.1080/13467581.2025.2512235)

### GitHub repos

- [ennauata/houseganpp (House-GAN++)](https://github.com/ennauata/houseganpp)
- [aminshabani/house_diffusion (HouseDiffusion)](https://github.com/aminshabani/house_diffusion)
- [SizheHu/GSDiff (GSDiff)](https://github.com/SizheHu/GSDiff)
- [ChatHouseDiffusion/chathousediffusion](https://github.com/ChatHouseDiffusion/chathousediffusion)
- [LengSicong/Tell2Design](https://github.com/LengSicong/Tell2Design)
- [weixi-feng/LayoutGPT](https://github.com/weixi-feng/LayoutGPT)
- [lufengWong/GeLayout](https://github.com/lufengWong/GeLayout)
- [google/or-tools](https://github.com/google/or-tools)
- [architext/gptj-162M (HuggingFace)](https://huggingface.co/architext/gptj-162M)
