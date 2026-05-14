# Constraint solvers / optimizers для plana

> Ресерч от 2026-05-14. Контекст: AI-driven архитектурное планирование. Backend Python 3.11+.
> Задача: формализовать "размещение квартир/коридоров/лифтов на этаже" как **constraint satisfaction / optimization** проблему.
> Две роли:
> - **(A) Refinement** — LLM выдаёт "грубую" раскладку → solver "защёлкивает" её в валидное решение (двигает стены, корректирует площади).
> - **(B) Cold-start generation** — solver генерирует раскладку из чистых ограничений, когда LLM слишком "размыта".

Под капотом архитектурная литература называет это **Facility Layout Problem (FLP)** или **Architectural Floor Plan Generation**. Оба варианта **NP-hard**.

---

## TL;DR — рекомендуемый стек

| Слой | Инструмент | Лицензия | Роль |
|---|---|---|---|
| **Combinatorial core** | **`ortools` (CP-SAT)** | Apache-2.0 | Главный движок: размещение квартир/ядра/коридоров на сетке, no-overlap, окна, связность. |
| **Геометрические проверки** | **`shapely` 2.x** | BSD | Полигональные коллизии, площади, intersection/union, distance — пред- и пост-обработка. |
| **Графы (связность)** | **`networkx`** | BSD | Связность коридоров, fire-escape пути, расстояния до лифта, adjacency-граф комнат. |
| **Непрерывный fine-tune** | **`scipy.optimize`** (NLP / DE) | BSD | Дожимать положения стен в continuous пространстве после CP-SAT (минимизация длины стен, площадей-доборов). |
| **Опционально** | `pulp` или `python-mip` | MIT / EPL-2.0 | Если переходим на чистый MIP-формулировку (площадь = LP-переменная). |

**Что НЕ берём в основной стек (и почему):**
- **z3-solver** — мощный для qualitative-геометрии, но плохо масштабируется и не имеет встроенной оптимизации `minimize` на уровне CP-SAT. Запасной вариант.
- **cvxpy** — disciplined convex; combinatorial размещение **не выпукло**. Полезна точечно для подзадач (пропорциональная резка площадей).
- **pyomo** — мощнее python-mip, но overkill: нам не нужен NLP/DAE, нужен MIP+CP.

### Главное архитектурное решение

> **CP-SAT — наш default.** Это единственный open-source solver, который:
> 1. Имеет первоклассный 2D-no-overlap (`AddNoOverlap2D` через `IntervalVar`).
> 2. Поддерживает soft-constraints через penalty-объектив.
> 3. Реально масштабируется на 50–100 прямоугольников (большинство кейсов plana).
> 4. Apache-2.0 — без юридических заноз.

Co-Layout (arXiv 2511.12474, 2026) и серия LLM-floor-plan работ 2024–2026 фактически используют **тот же шаблон**: LLM → структурированные ограничения → IP/CP solver (у них Gurobi; у нас будет CP-SAT, потому что open-source).

---

## Per-tool comparison

### 1. Google OR-Tools (CP-SAT) ⭐ ТОП-КАНДИДАТ

- **Pkg:** `ortools` (PyPI), [`from ortools.sat.python import cp_model`]
- **Лицензия:** Apache-2.0
- **Стек:** C++ ядро + Python/Java/.NET bindings. Активно развивается Google Operations Research.
- **Что умеет:**
  - **CP-SAT** — гибрид CP + SAT + LP. Лучший open-source solver на MiniZinc Challenge 2017–2024.
  - **`AddNoOverlap2D`** — встроенный констрейнт для размещения прямоугольников без перекрытия. Под капотом — `diffn.h`.
  - **`IntervalVar`** + **`OptionalIntervalVar`** (с `is_present` BoolVar) — естественное моделирование "квартира может быть, может не быть".
  - `AddElement`, `AddCircuit`, `AddAllowedAssignments` — табличные ограничения для archetype-каталогов квартир.
  - **Минимизация / максимизация целочисленных линейных выражений**.
  - **Soft-constraints через penalty-объектив** — стандартный паттерн (см. ниже).
  - Параллельный поиск (`num_search_workers`), warmstart через `AddHint` (важно для роли A).
  - **MIP solver** в той же библиотеке (CBC, GLOP, SCIP) — но для нас вторичен.
- **Ограничения:**
  - **Целочисленный мир.** Все координаты — integers. Мы будем работать на сетке (например, 100mm step → 30m фасад = 300 ячеек). Не проблема для плана этажа.
  - CP-SAT хорошо находит feasible, **хуже доказывает infeasibility** на больших инстансах (`d-krupke/cpsat-primer`). Для нас приемлемо: solver-у выдаём дедлайн ~10–30 сек, что не нашли — кидаем обратно в LLM на переформулировку.
  - Resolution influences performance — slovem делаем грубую первую сетку (500mm), потом refine (100mm).
- **Производительность на 50–100 квартирах:**
  - 100-item knapsack у Krupke считает за 0.01 с. Чистый no-overlap на 50–100 прямоугольниках с базовыми констрейнтами — **секунды** на ноутбуке (на основе бенчмарков `cpsat-primer` и обсуждений на `or-tools-discuss`).
  - При добавлении adjacency/window/corridor — **десятки секунд**. Для нашего флоу (генерация раз в минуту, не realtime) — OK.
  - Coarse-to-fine стратегия (как в Co-Layout) даёт +1–2 порядка ускорения: сначала на 500mm-сетке найти топологию, потом на 100mm refine только пограничные клетки.
- **Реальные применения, аналогичные нашему:**
  - **2D bin-packing** — каноничный пример CP-SAT (`yetanothermathprogrammingconsultant.blogspot.com`).
  - **Facility Layout Problem** — стандартный учебный пример.
  - **Co-Layout (2026)** — LLM→IP пайплайн для интерьерной раскладки (используют Gurobi, но модель транслируется в CP-SAT 1-в-1).
- **Когда брать:** **всегда первым делом**, кроме нишевых случаев ниже.

### 2. `cvxpy`

- **Pkg:** `cvxpy`. Лицензия Apache-2.0.
- **Парадигма:** **disciplined convex programming** — выражения должны быть выпуклыми по DCP-правилам.
- **Где работает для нас:**
  - "Растянуть пропорционально комнаты внутри фиксированной топологии" — это LP/QP, выпукло.
  - Минимизировать суммарную длину стен при фиксированной структуре — может быть выпуклой подзадачей.
  - "Округлить" continuous-результат CP-SAT под нормативы площадей.
- **Где НЕ работает:**
  - **Размещение прямоугольников без перекрытия** — НЕ выпукло (disjunctive constraints). Можно через MIQP-расширение, но это уже MIP, не cvxpy "по-духу".
  - Любая комбинаторика (какая квартира где) — за пределами cvxpy.
- **Когда брать:** **точечно**, как пост-обработчик CP-SAT для continuous resize этапа. Не как основной solver.

### 3. `python-mip` (COIN-OR)

- **Pkg:** `mip`. Лицензия EPL-2.0.
- **Стек:** обёртка над CBC (default, opensource) и Gurobi (commercial).
- **Что хорошо:**
  - Быстрое моделирование MIP, синтаксис ближе к математике (`x + y <= 10`).
  - Lazy constraints, cut generation, MIP starts, solution pools.
  - Быстрее, чем PuLP, по созданию модели (до 25x — см. `python-mip` docs).
  - Lazy constraints важны для нас, если переходим к "constraint generation" паттерну (классика для FLP).
- **Что плохо:**
  - **`No no-overlap-2D`** из коробки. Надо моделировать вручную через **disjunctive big-M**: для каждой пары `(i,j)` ввести 4 BoolVar (i слева/справа/над/под j) + big-M линеаризация. На 100 квартирах это **9900 BoolVar и 19800 неравенств** — реально, но тяжело.
  - CBC сильно медленнее коммерческих солверов на больших задачах.
- **Когда брать:** если CP-SAT упирается в потолок на специфичных задачах (например, "минимизировать стоимость квартир при дробных площадях"), переписать в MIP. **Не первый выбор.**

### 4. `pyomo`

- **Pkg:** `pyomo`. Лицензия BSD-3-Clause.
- **Стек:** язык моделирования, не solver. Бэкенды: CBC, GLPK, IPOPT, BARON, CPLEX, Gurobi, HiGHS.
- **Что хорошо:**
  - **Самый универсальный** Python-DSL для оптимизации. LP, MIP, NLP, DAE, MPEC.
  - Удобно, если в будущем подключим NLP-solver для "честных" continuous-нелинейных задач (insolation, daylight как функция геометрии).
  - Pyomo превосходит cvxpy для LP/MIP по выразительности (см. solvermax.com).
- **Что плохо:**
  - Steeper learning curve. Overkill для combinatorial layout, который CP-SAT решает идиоматичнее.
  - Без CP-семантики. Нет встроенного `no-overlap`.
- **Когда брать:** **резервный вариант** для NLP-подзадач (если scipy.optimize не хватает). Не как основной.

### 5. `z3-solver`

- **Pkg:** `z3-solver`. MIT. От Microsoft Research.
- **Парадигма:** SMT (Satisfiability Modulo Theories). Поддерживает Int, Real, Bool, BitVec, Array — и **смешанные** теории.
- **Где интересно:**
  - **Qualitative geometric constraints** — "квартира A севернее квартиры B", "окно квартиры C смотрит на юг" — выражаются естественно в FOL.
  - Решает над **Real** (а не только Int) — нет необходимости в гриде.
  - Optimize-расширение (`z3.Optimize`) — `minimize`/`maximize` поддерживается, но слабее чем CP-SAT.
- **Где плохо:**
  - **Плохо масштабируется** для FLP. SMT-решатели не специализированы на arithmetic-тяжёлых задачах с большим числом BoolVar (`pycircuit/issues/3` — обсуждение Z3 для placement, осторожный энтузиазм автора).
  - Quantifier-free fragment приходится использовать осторожно.
  - На 50+ квартир Z3 либо упрётся в timeout, либо вернёт subobtimal без гарантий.
- **Когда брать:** **прототипирование sanity-проверок** ("проверить, что данная конфигурация удовлетворяет качественным constraint'ам"), spec-style верификация раскладки. **Не для генерации.**

### 6. `pulp`

- **Pkg:** `pulp`. MIT. От COIN-OR.
- **Стек:** обёртка над CBC, GLPK, CPLEX, Gurobi, HiGHS, XPRESS.
- **Краткое сравнение с python-mip:** PuLP популярнее (проще API, больше туториалов), python-mip быстрее и фичастее. По функционалу пересекаются на 80%.
- **Когда брать:** если в команде уже есть опыт с PuLP — можно. Технически идентично python-mip для наших задач. **Не приоритет.**

### 7. Specialty libraries

#### 7.1 `networkx` ⭐ нужен в стеке

- MIT. Лицензия безопасная.
- **Где используем:**
  - **Adjacency graph** — узлы = квартиры/комнаты/коридоры/ядро; рёбра = "имеют общую стену", "связаны дверью". Constraint-нода ввода для CP-SAT.
  - **Корридор как граф** — построить граф `corridor_graph`, проверить `is_connected` (каждая квартира имеет path до лифта).
  - **Fire escape paths** — `shortest_path_length` от каждой квартиры до 2-х ближайших лестниц; ограничение на максимум.
  - **Lift coverage** — `single_source_dijkstra` от лифта; "каждая квартира на расстоянии ≤ N метров".
- **Производительность:** для 100 узлов и десятков рёбер — миллисекунды. Не узкое место.
- **Альтернативы:** `igraph` (быстрее на 10–100x для больших графов), `graph-tool` (ещё быстрее, но C++ deps). Для наших ~100 узлов **networkx достаточно.**

#### 7.2 `scipy.optimize` ⭐ нужен для post-refinement

- BSD. Уже de-facto в Python-стеке.
- **Где используем:**
  - **`differential_evolution`** — глобальный поиск для непрерывного refine (положения внутренних стен, размеры окон). Не градиентный, переваривает non-smooth constraints через Lampinen-метод.
  - **`minimize(method='SLSQP')`** — для smooth NLP с равенствами/неравенствами (баланс площадей при фиксированной топологии).
  - **`linprog`** — встроенный LP, для тривиальных подзадач.
- **Паттерн:** CP-SAT даёт топологию (которая квартира где) + дискретные размеры; scipy "сдвигает" стены на ±N мм для финальной красоты/норматива.

#### 7.3 `shapely` ⭐ нужен в стеке

- BSD. Обёртка над GEOS (зрелая C++ библиотека).
- **Где используем:**
  - Полигоны квартир (не только прямоугольники — L-shape, T-shape).
  - `intersects` / `intersection` для проверок коллизий (предвалидация LLM-выхода до подачи в CP-SAT).
  - `buffer` для зон коридоров, sanitary-зон.
  - `union` для агрегата площадей.
  - `distance` для проверки fire-escape distance.
- **Перфоманс:** оптимизированный. Перед `intersection` всегда сначала `intersects` (примерно на порядок дешевле).

#### 7.4 Floor-plan специализированные solver'ы

Краткий обзор того, что есть в публикациях/коде:

| Solver/paper | Подход | Открытый код? | Для нас |
|---|---|---|---|
| **Para & Guerrero, ICCV 2021** "Generative Layout Modeling using Constraint Graphs" | Граф→layout через transformer | Частично (PyTorch) | Reference; не плагин |
| **Z. Wu et al. 2020** "Mixed CP + GA for apartment layout" (ScienceDirect S0926580520310712) | CP на сетке + GA для refine | Нет | **Шаблон 1-в-1 наш**: CP для координат, метаэвристика — для нюансов |
| **GenPlan (OpenReview 2024)** | Autoencoder + Transformer-GNN с constraint inputs | Частично | Reference, не наш стек |
| **Co-Layout (arXiv 2511.12474, 2026)** | **LLM → constraints → Gurobi IP, coarse-to-fine** | Не публичный | **Идейный родитель плана**. Мы делаем то же на CP-SAT |
| **HouseLLM / HouseTune (arXiv 2411.12279)** | LLM → diffusion для refinement | Частично | Альтернатива: refinement не solver-ом, а diffusion-моделью. Дорого, требует обучения |
| **DStruct2Design (OpenReview)** | Data-structure driven generation | — | Reference |
| **G2PLAN** (graph-theoretic + LP, дата ниже 2010) | Топология → LP сетка | Нет | Reference |
| **`rectpack`** (Python, MIT) | Heuristic 2D bin packing: Skyline / Maxrects / Guillotine | Да | **Быстрый прототип** для роли B (cold-start). Без soft-constraints. Не основной |
| **`rectangle-packing-solver`** | Sequence-pair representation | Да | Полезно для seed-генерации |

**Вывод:** готового "архитектурного solver-фреймворка" для нашего юзкейса **нет**. Все упомянутые работы — research code, не библиотеки. План: **строим свой layer поверх OR-Tools + NetworkX + Shapely**, по шаблону Co-Layout / Wu et al. 2020.

---

## Algorithm patterns: что когда применять (decision tree)

```
Начало: что нужно сделать?
│
├─ "LLM дал layout, надо его починить" → роль (A) Refinement
│  │
│  ├─ Большая перестройка (топология меняется)?
│  │  └─ Да → CP-SAT с MIP-старта через AddHint() (теплый запуск из LLM-выхода)
│  │  └─ Нет (только сдвинуть стены ±N мм) → scipy.optimize.minimize(SLSQP)
│  │
│  └─ Только проверить валидность (yes/no + список нарушений)?
│     └─ Shapely + NetworkX без solver-а; быстрее, нагляднее
│
├─ "LLM не дала ничего, генерируем с нуля" → роль (B) Cold-start
│  │
│  ├─ Малое число квартир (<20), простая форма этажа?
│  │  └─ rectpack (Maxrects) для seed → CP-SAT для дошлифовки
│  │
│  └─ Большой этаж (50–100 квартир)?
│     └─ Coarse-to-fine CP-SAT:
│        1. Grid 1000mm, минимум ограничений, найти feasible
│        2. Grid 250mm, добавить fire-escape/window
│        3. Grid 100mm, финальные размеры
│
├─ "Soft constraints (предпочтение, не жёстко)"
│  └─ Pena­lty-term в objective: `model.minimize(sum(violations))`
│     Не использовать z3 (он optimization второй сорт), не GA если CP-SAT справляется
│
├─ "Connectivity (коридоры, лифт-coverage, fire-escape)"
│  └─ NetworkX: построить граф, проверить is_connected, shortest_path_length
│     Передать рассчитанные dist-bounds как constraint'ы в CP-SAT
│
├─ "Топологическая флексибельность нужна (не прямоугольники, L/T-форма)"
│  └─ Shapely для геометрии + CP-SAT для grid-cell-assignment (как в Wu 2020).
│     Каждая ячейка сетки → каждой квартире (один-hot), area-constraint через sum
│
└─ "Качественные constraint'ы (квартира А севернее В)"
   └─ Кодировать как линейное неравенство в CP-SAT (y_A >= y_B + δ).
      z3 не нужен — CP-SAT справляется и быстрее.
```

### Когда использовать metaheuristics (SA / GA / DE)

- **Только если CP-SAT не сошёлся за разумное время** или объектив существенно нелинеен (например, дневное освещение как функция геометрии).
- Готовый Python: `simanneal` (perrygeo), `DEAP` (genetic), `scipy.optimize.differential_evolution`.
- Wu et al. 2020 явно комбинируют CP + GA: CP даёт скелет, GA крутит ручки. Это рабочий паттерн, но **только когда CP не хватает**, не первым шагом.

### Force-directed layout

- `networkx.spring_layout` или `pygraphviz` (`neato`) — для предварительной топологической раскладки.
- Полезно **только** для визуализации adjacency-графа или как **seed** для CP-SAT (через `AddHint`).
- **Не годится для финального плана** — игнорирует размеры/геометрию.

### Treemap / strip packing

- Для очень быстрого seed-режима (роль B, когда юзеру нужно "просто что-то увидеть").
- `squarify` для treemap.
- Без soft-constraints, без fire-escape — финальной раскладкой не быть.

---

## Worked example: 8 квартир на прямоугольном этаже + коридор (CP-SAT model sketch)

> Цель — продемонстрировать **структуру модели**. Не исполняемый код, скорее псевдо-Python.

```python
"""
Размещение 8 квартир на этаже 30m x 15m, с центральным коридором (corridor)
шириной 1.5m по оси Y=7.0..8.5m.
Каждая квартира — прямоугольник переменного размера с min/max площадью.
Каждая квартира должна:
  - иметь окно (примыкать к одной из 4 наружных стен)
  - примыкать к коридору хотя бы одной стеной (через "дверь")
  - не перекрываться с другими
  - не пересекать коридор
"""
from ortools.sat.python import cp_model

# === Параметры (все в сантиметрах, чтобы остаться в integers) ===
FLOOR_W, FLOOR_H = 3000, 1500           # 30m x 15m
CORR_Y_LO, CORR_Y_HI = 700, 850         # коридор Y=7.0..8.5m
N_APT = 8
A_MIN_CM2, A_MAX_CM2 = 30_000_00, 100_000_00   # 30..100 м^2 (см^2)
W_MIN, H_MIN = 400, 400                  # минимальная сторона 4m

model = cp_model.CpModel()

# === Переменные: углы и размеры каждой квартиры ===
x  = [model.NewIntVar(0, FLOOR_W, f"x_{i}")  for i in range(N_APT)]
y  = [model.NewIntVar(0, FLOOR_H, f"y_{i}")  for i in range(N_APT)]
w  = [model.NewIntVar(W_MIN, FLOOR_W, f"w_{i}") for i in range(N_APT)]
h  = [model.NewIntVar(H_MIN, FLOOR_H, f"h_{i}") for i in range(N_APT)]

# Концы интервалов — выводимые
xe = [model.NewIntVar(0, FLOOR_W, f"xe_{i}") for i in range(N_APT)]
ye = [model.NewIntVar(0, FLOOR_H, f"ye_{i}") for i in range(N_APT)]
for i in range(N_APT):
    model.Add(xe[i] == x[i] + w[i])
    model.Add(ye[i] == y[i] + h[i])

# === Интервалы для NoOverlap2D ===
xi = [model.NewIntervalVar(x[i], w[i], xe[i], f"xi_{i}") for i in range(N_APT)]
yi = [model.NewIntervalVar(y[i], h[i], ye[i], f"yi_{i}") for i in range(N_APT)]
model.AddNoOverlap2D(xi, yi)

# === Площадь через AddMultiplicationEquality (CP-SAT умеет произведения) ===
area = [model.NewIntVar(A_MIN_CM2, A_MAX_CM2, f"a_{i}") for i in range(N_APT)]
for i in range(N_APT):
    model.AddMultiplicationEquality(area[i], [w[i], h[i]])

# === Не пересекать коридор: квартира либо целиком ниже, либо целиком выше ===
# Используем reified disjunction
below = [model.NewBoolVar(f"below_{i}") for i in range(N_APT)]
above = [model.NewBoolVar(f"above_{i}") for i in range(N_APT)]
for i in range(N_APT):
    model.Add(ye[i] <= CORR_Y_LO).OnlyEnforceIf(below[i])
    model.Add(y[i]  >= CORR_Y_HI).OnlyEnforceIf(above[i])
    model.AddBoolOr([below[i], above[i]])   # одно из двух

# === Каждая квартира имеет окно (= касается одной из 4 наружных стен) ===
win_left  = [model.NewBoolVar(f"wL_{i}") for i in range(N_APT)]
win_right = [model.NewBoolVar(f"wR_{i}") for i in range(N_APT)]
win_top   = [model.NewBoolVar(f"wT_{i}") for i in range(N_APT)]
win_bot   = [model.NewBoolVar(f"wB_{i}") for i in range(N_APT)]
for i in range(N_APT):
    model.Add(x[i]  == 0).OnlyEnforceIf(win_left[i])
    model.Add(xe[i] == FLOOR_W).OnlyEnforceIf(win_right[i])
    model.Add(ye[i] == FLOOR_H).OnlyEnforceIf(win_top[i])
    model.Add(y[i]  == 0).OnlyEnforceIf(win_bot[i])
    model.AddBoolOr([win_left[i], win_right[i], win_top[i], win_bot[i]])

# === Дверь в коридор: квартира касается коридора снизу или сверху ===
door_up   = [model.NewBoolVar(f"dU_{i}") for i in range(N_APT)]
door_down = [model.NewBoolVar(f"dD_{i}") for i in range(N_APT)]
for i in range(N_APT):
    # "снизу" — квартира ниже коридора и её верхняя грань = низ коридора
    model.Add(ye[i] == CORR_Y_LO).OnlyEnforceIf(door_up[i])
    model.Add(below[i] == 1).OnlyEnforceIf(door_up[i])
    # "сверху" — квартира выше коридора и её нижняя грань = верх коридора
    model.Add(y[i]  == CORR_Y_HI).OnlyEnforceIf(door_down[i])
    model.Add(above[i] == 1).OnlyEnforceIf(door_down[i])
    model.AddBoolOr([door_up[i], door_down[i]])

# === Soft objective: минимизировать "пустоту" этажа ===
# Penalty: (общая площадь этажа - сумма площадей квартир)
TOTAL = FLOOR_W * FLOOR_H
used = model.NewIntVar(0, TOTAL, "used")
model.Add(used == sum(area))
model.Maximize(used)
# Альтернатива: добавить штрафы за дисбаланс площадей (равномерность)
# или за длину внутренних стен — отдельным линейным членом.

# === Решаем ===
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 30
solver.parameters.num_search_workers = 8
status = solver.Solve(model)

if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
    for i in range(N_APT):
        print(f"Apt {i}: ({solver.Value(x[i])},{solver.Value(y[i])}) "
              f"{solver.Value(w[i])}x{solver.Value(h[i])} "
              f"area={solver.Value(area[i])/10_000:.1f} m^2")
```

### Что в этом примере намеренно НЕ показано (и где это будет в plana):

- **Fire-escape distance** — добавится через NetworkX-предрасчёт: каждой клетке сетки приписать `dist_to_stairs`; в CP-SAT появится индикатор `cell_i_used_by_apt_k → dist_to_stairs[i] <= MAX`.
- **Lift coverage** — аналогично.
- **L-shape / T-shape квартиры** — моделируются через **несколько `IntervalVar` на квартиру** (по 2–3 прямоугольника, объединённых через `is_present` и общую BoolVar).
- **Каталог архетипов** (1-комн / 2-комн / студия с фиксированным набором габаритов) — `AddAllowedAssignments([w, h], allowed_pairs)` или таблица lookup.
- **Норматив инсоляции** — выносим в pre-compute: считаем sun-mask для каждой клетки сетки и подаём как табличное ограничение.

---

## Performance expectations

| Сценарий | Размер | CP-SAT time (ноут, 8 ядер) | Стратегия |
|---|---|---|---|
| **Smoke test** | 5 квартир, базовые constraint'ы | <1 сек | Прямой запуск |
| **MVP** | 8–20 квартир, + corridor + windows | 1–10 сек | Прямой запуск, `max_time=30s` |
| **Реальный этаж** | 30–60 квартир, + fire-escape + lift | 10–60 сек | **Coarse-to-fine** (2 этапа) обязательно |
| **Большой этаж** | 80–120 квартир (редко) | 1–10 мин | Coarse-to-fine (3 этапа) + warm-start от LLM (`AddHint`) |
| **Refinement из LLM-seed (роль A)** | 30–60 квартир, LLM дал близкое решение | 2–20 сек | `AddHint(x_i, llm_x_i)` существенно ускоряет |

**Базовые источники цифр:**
- `cpsat-primer` (knapsack 100 items = 0.01 c — baseline для "лёгких" задач).
- Обсуждения performance на `or-tools-discuss` и `github.com/google/or-tools/discussions/3177` — packing problems улучшились с v9.2.
- Wu et al. 2020 — на 12–18 комнат CP+GA даёт решения за минуты.
- Co-Layout 2026 — на интерьерных задачах с ~30–50 элементов Gurobi сходится за секунды-минуты в coarse-to-fine; CP-SAT будет в том же порядке.

**Неопределённость:** все цифры выше — экспертная оценка по литературе и бенчмаркам **смежных** задач. Реальную сходимость измерим на первом MVP с реальными нормативными ограничениями (КЗ-нормы добавят 10–20 дополнительных констрейнтов на квартиру — это может сильно сдвинуть таймы).

---

## Integration with LLM pipeline

### Паттерн "LLM → constraints → solver" (наш план)

```
┌──────────────────┐
│ Пользователь:    │
│ "Этаж 30x15м,    │
│  8 квартир,      │
│  студии и 2-к"   │
└────────┬─────────┘
         │
   ┌─────▼──────────────────────────┐
   │ LLM Stage 1: parse → structured│
   │   JSON: floor box, count,      │
   │   types, kz-norm refs          │
   └─────┬──────────────────────────┘
         │
   ┌─────▼──────────────────────────┐
   │ LLM Stage 2: ROUGH layout      │
   │   приближённые координаты      │
   │   квартир (как seed)           │
   └─────┬──────────────────────────┘
         │
   ┌─────▼──────────────────────────┐
   │ Python adapter: JSON → CP-SAT  │
   │   - shapely валидация          │
   │   - networkx граф связности    │
   │   - построить cp_model         │
   │   - AddHint() из rough layout  │
   └─────┬──────────────────────────┘
         │
   ┌─────▼──────────────────────────┐
   │ CP-SAT solve (coarse-to-fine)  │
   └─────┬──────────────────────────┘
         │
   ┌─────▼──────────────────────────┐
   │ scipy.optimize fine-tune       │
   │ (continuous-сдвиги ±N мм)      │
   └─────┬──────────────────────────┘
         │
   ┌─────▼──────────────────────────┐
   │ ezdxf экспорт в DXF            │
   │ + LLM Stage 3: human report    │
   └─────┬──────────────────────────┘
         ▼
       Юзер видит план
```

### Конкретные публичные референсы этого шаблона

- **Co-Layout** (Xiang et al. 2026, arXiv 2511.12474) — почти 1-в-1 наш план для interior design. LLM → spatial constraints → Gurobi IP → coarse-to-fine. Главное отличие: они используют Gurobi (платный), мы — CP-SAT (бесплатный, того же класса для нашей шкалы).
- **Text-to-Layout** (arXiv 2509.00543, 2025) — LLM (GPT-4o) → JSON → greedy geometry adjustment + Revit. Уровень solver-а скромнее (greedy), но шаблон тот же.
- **HouseLLM / HouseTune** (arXiv 2411.12279) — LLM → diffusion model для refinement. **Альтернативный путь** (заменить solver на ML-refiner). Требует обучения, для нас на старте overkill.
- **"LLM-based framework for automated floor plan design"** (ScienceDirect, 2025, S0926580525005527) — статья ровно о нашем кейсе. Не читали платный full-text, но абстракт подтверждает шаблон.
- **Wu et al. 2020** "Floor plan generation through a mixed constraint programming–genetic optimization approach" (S0926580520310712) — pre-LLM, но **конкретно про apartment layout**. CP на сетке для топологии, GA для refine. Шаблон, который мы клонируем в CP-SAT-only.

### Что мы НЕ делаем

- **Diffusion-based refinement** — отдельный исследовательский проект, обучение GAN/diffusion на корпусе российских/казахских планов. Не сейчас.
- **End-to-end LLM "от запроса до плана"** — без solver. Это галлюцинации на geometry. Все статьи 2024–2026 сходятся: LLM **должна** быть с solver-фильтром.
- **Pure metaheuristic (SA/GA)** без CP-SAT — медленнее на feasibility, нет оптимальности.

---

## Что точно НЕ делать

1. **Не использовать LLM как finальный slovem.** Любая LLM-only раскладка нарушит no-overlap и КЗ-нормы. Solver обязателен.
2. **Не строить FLP на чистом MIP (python-mip / pulp + CBC) первой итерацией.** CP-SAT моделирует no-overlap-2D на 2 строки; MIP — на ~30. CP-SAT быстрее на нашей шкале.
3. **Не делать z3-генерацию.** Z3 — для верификации, не для production-генерации FLP.
4. **Не пилить свой solver.** OR-Tools покрывает 95% нашего юзкейса; specialty-libs — точечно.
5. **Не использовать cvxpy для combinatorial-части.** Это disciplined-convex, размещение не выпукло.
6. **Не запускать CP-SAT без `max_time_in_seconds`.** На сложных инстансах он может молотить часами без видимой пользы. Дедлайн всегда: 30s → coarse-to-fine.
7. **Не игнорировать AddHint().** Это критический мост LLM↔solver: дискретные подсказки из LLM-seed дают 2–10x ускорения. Wu 2020 и Co-Layout 2026 оба этим пользуются.

---

## Open questions / неопределённости

- **КЗ-нормы количественно** — пока в нашей knowledge-base (research/kz-norms) описаны качественно. Прежде чем кодировать в CP-SAT, нужно вытащить **числа** (минимальные ширины коридоров, max-distance до лестниц, минимальные площади по типу). Это **отдельный** под-таск.
- **Сетка дискретизации** — 100mm vs 50mm — компромисс точность/скорость. Стартуем с 100mm, fine-tune через scipy.optimize.
- **L-shape / non-rectangular** — поддержка через composite IntervalVar возможна, но усложняет модель в ~2x по числу переменных. Пилотируем сначала на чистых прямоугольниках, потом расширяем.
- **Лицензия Gurobi vs CP-SAT** — если в будущем понадобится коммерческий MIP, Gurobi Free Academic не подходит для SaaS, придётся платить. CP-SAT (Apache-2.0) — стратегический выбор.

---

## Конкретные следующие шаги

1. **Pin OR-Tools версию** в `engine/pyproject.toml` (текущая stable — `ortools>=9.10`).
2. **Скетч 8-квартирной модели** (см. выше) — превратить в реальный test в `engine/tests/test_layout_smoke.py`. **Цель: time-to-solution <5 сек на нашем dev-ноутбуке**.
3. **Сформировать `LayoutConstraints` dataclass** — единое представление, в которое мапится и LLM-выход, и CP-SAT-модель.
4. **Адаптер `LayoutConstraints → cp_model.CpModel`** — отдельный модуль `engine/layout/cpsat_model.py`.
5. **Pre/post-валидаторы на shapely+networkx** — `engine/layout/validators.py`.
6. **Бенчмарк-скрипт** — 5/20/50/100 квартир с базовым набором constraint'ов; зафиксировать таймы на baseline-железе.
7. **Coarse-to-fine стратегия** — добавить после того, как базовая 50-квартирная модель не уложится в 30 сек.
8. **Интеграция AddHint()** из LLM-seed — после того, как LLM-pipeline отдаёт `LayoutConstraints` (см. roadmap LLM).

---

## Sources

### Core OR-Tools / CP-SAT
- [Google OR-Tools — CP-SAT Solver docs](https://developers.google.com/optimization/cp/cp_solver)
- [ortools.sat.python.cp_model API](https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html)
- [The CP-SAT Primer (D. Krupke)](https://d-krupke.github.io/cpsat-primer/)
- [CP-SAT Primer — Advanced Modeling (no_overlap_2d)](https://d-krupke.github.io/cpsat-primer/04B_advanced_modelling.html)
- [CP-SAT Primer — Benchmarking your Model](https://d-krupke.github.io/cpsat-primer/08_benchmarking.html)
- [google/or-tools (GitHub)](https://github.com/google/or-tools)
- [or-tools/sat/docs/README](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/README.md)
- [2D bin packing with OR-Tools CP-SAT (Yet Another MP Consultant)](http://yetanothermathprogrammingconsultant.blogspot.com/2021/02/2d-bin-packing-with-google-or-tools-cp.html)
- [Discussion: NoOverlap2D, Cumulative parameters](https://github.com/google/or-tools/discussions/3107)
- [Discussion: Performance of packing problems](https://github.com/google/or-tools/discussions/3177)
- [Issue: Splitting noOverlap improves performance](https://github.com/google/or-tools/issues/2423)
- [Laurent Perron — CP-SAT and OR-Tools slides (CMU EWO)](https://egon.cheme.cmu.edu/ewo/docs/CP-SAT%20and%20OR-Tools.pdf)
- [A practical introduction to CP-SAT (pganalyze blog)](https://pganalyze.com/blog/a-practical-introduction-to-constraint-programming-using-cp-sat)

### Other Python optimization stacks
- [cvxpy.org](https://www.cvxpy.org/)
- [cvxpy examples](https://www.cvxpy.org/examples/)
- [Python-MIP docs](https://www.python-mip.com/)
- [Python-MIP Benchmarks](https://python-mip.readthedocs.io/en/latest/bench.html)
- [coin-or/python-mip (GitHub)](https://github.com/coin-or/python-mip)
- [PuLP on PyPI](https://pypi.org/project/PuLP/)
- [Pyomo home](https://www.pyomo.org/)
- [Pyomo Related Projects](https://www.pyomo.org/related-projects)
- [Z3 Theorem Prover (Wikipedia)](https://en.wikipedia.org/wiki/Z3_Theorem_Prover)
- [Programming Z3 (Stanford)](https://theory.stanford.edu/~nikolaj/programmingz3.html)
- [Z3 Online Guide](https://microsoft.github.io/z3guide/)
- [pycircuit Issue #3 — Use Z3 for placement constraints](https://github.com/dvc94ch/pycircuit/issues/3)
- [Benchmarking Six Python Optimization Frameworks (Medium)](https://medium.com/@kyle-t-jones/benchmarking-six-python-optimization-frameworks-in-a-head-to-head-performance-test-4836c61a65a1)
- [SolverMax — Optimization modelling in Python](https://www.solvermax.com/resources/links/optimization-modelling-in-python)
- [MIP Solvers Unleashed (Medium, beginner guide)](https://medium.com/operations-research-bit/mip-solvers-unleashed-a-beginners-guide-to-pulp-cplex-gurobi-google-or-tools-and-pyomo-0150d4bd3999)
- [Comparison of optimization software (Wikipedia)](https://en.wikipedia.org/wiki/Comparison_of_optimization_software)

### Specialty libraries
- [networkx — Shortest Paths](https://networkx.org/documentation/stable/reference/algorithms/shortest_paths.html)
- [networkx — Tutorial](https://networkx.org/documentation/stable/tutorial.html)
- [scipy.optimize.differential_evolution](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.differential_evolution.html)
- [scipy.optimize index](https://docs.scipy.org/doc/scipy/reference/optimize.html)
- [Shapely User Manual](https://shapely.readthedocs.io/en/stable/manual.html)
- [shapely.intersection](https://shapely.readthedocs.io/en/stable/reference/shapely.intersection.html)
- [shapely.overlaps](https://shapely.readthedocs.io/en/stable/reference/shapely.overlaps.html)
- [secnot/rectpack (GitHub)](https://github.com/secnot/rectpack)
- [rectpack on PyPI](https://pypi.org/project/rectpack/)
- [rectangle-packing-solver on PyPI](https://pypi.org/project/rectangle-packing-solver/)
- [perrygeo/simanneal](https://github.com/perrygeo/simanneal)
- [DEAP framework](https://github.com/DEAP/deap)

### Architectural floor-plan literature
- [Generative Layout Modeling using Constraint Graphs (Para & Guerrero, ICCV 2021)](https://openaccess.thecvf.com/content/ICCV2021/papers/Para_Generative_Layout_Modeling_Using_Constraint_Graphs_ICCV_2021_paper.pdf)
- [Floor plan design using block algebra and constraint satisfaction (ScienceDirect S1474034612000031)](https://www.sciencedirect.com/science/article/abs/pii/S1474034612000031)
- [Floor plan generation through mixed CP-GA (Wu et al. 2020, S0926580520310712)](https://www.sciencedirect.com/science/article/abs/pii/S0926580520310712)
- [Automated floorplan generation review (ScienceDirect S0926580522002588)](https://www.sciencedirect.com/science/article/abs/pii/S0926580522002588)
- [The constraints satisfaction problem in design of an architectural object (Zawidzki, PAN)](https://rcin.org.pl/Content/182825/WA727_217325_Zawidzki-The-constraints.pdf)
- [GenPlan: Automated Floor Plan Generation (OpenReview)](https://openreview.net/forum?id=kA5egaJjya)
- [DStruct2Design (OpenReview)](https://openreview.net/forum?id=ERyuDrxsGH)
- [Deep architectural floor plan generation (ASCAAD 2023)](https://papers.cumincad.org/data/works/att/ascaad2023_055.pdf)
- [Automated Generation of Dimensioned Rectangular Floorplans (arXiv 1910.00081)](https://arxiv.org/pdf/1910.00081/1000)
- [Simulated Annealing and Genetic Algorithms for FLP — survey (Springer)](https://link.springer.com/article/10.1023/A:1008623913524)
- [Automatic generation of architectural layouts using genetic (SciSpace)](https://scispace.com/pdf/automatic-generation-of-architectural-layouts-using-genetic-2z6744uhww.pdf)

### LLM + solver pipelines
- [Co-Layout: LLM-driven Co-optimization for Interior Layout (arXiv 2511.12474, 2026)](https://arxiv.org/html/2511.12474v2)
- [Text-to-Layout: Generative Workflow for Drafting Floor Plans Using LLMs (arXiv 2509.00543, 2025)](https://arxiv.org/html/2509.00543v1)
- [HouseLLM / HouseTune: Two-Stage Floorplan Generation (arXiv 2411.12279)](https://arxiv.org/abs/2411.12279)
- [LLM-based framework for automated floor plan design (ScienceDirect S0926580525005527)](https://www.sciencedirect.com/science/article/abs/pii/S0926580525005527)
- [Generative Floor Plan Design with LLMs via RL (OpenReview / NeurIPS 2025)](https://openreview.net/pdf?id=ZMmDwqjQN9)
- [FloorplanQA: Benchmark for Spatial Reasoning (arXiv 2507.07644)](https://arxiv.org/html/2507.07644v2)
