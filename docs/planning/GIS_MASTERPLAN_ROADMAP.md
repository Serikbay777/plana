# GIS Masterplan Roadmap

Дата: 2026-06-11
Статус: актуальный продуктовый и технический план после pull `feat/posadka-cost-mvp`

## 1. Короткая идея

Plana переходит от сценария "пользователь вручную вводит участок" к сценарию "пользователь выбирает реальный участок на карте".

Это правильный фундамент продукта: участок, ограничения, красные линии, соседи, функциональная зона и нормы должны приходить из реального контекста, а не из абстрактной формы. Дальше поверх этого можно строить интерактивную посадку, генерацию вариантов, смету и проектную историю.

Целевая формула продукта:

```text
GIS участок -> контекст участка -> editable masterplan -> нормы -> стоимость -> экспорт/проект
```

## 2. Что появилось в последнем пуше

### Карта участков

Появилась страница `/map`:

- карта на MapLibre + OpenStreetMap;
- загрузка участков по bbox;
- отображение соседних зданий;
- отображение красных линий;
- выбор участка кликом;
- right panel с характеристиками выбранного участка.

Основной файл:

- `src/app/map/page.tsx`

### GIS helper на frontend

Файл `src/lib/gis.ts` отвечает за:

- извлечение внешнего кольца участка из GeoJSON;
- перевод WGS84 координат в локальные метры;
- классификацию назначения участка по названию;
- базовые типы bbox / purpose.

Это нужно, чтобы карта могла передать участок в engine не как lat/lon-географию, а как локальную расчетную геометрию.

### Backend GIS proxy

Файл `engine/plana_engine/importers/site_context.py` отвечает за server-side доступ к GIS Saulet / ArcGIS:

- участки;
- соседние здания;
- проезды / дороги;
- красные линии;
- функциональная зона.

Важно: запросы идут через backend, а не напрямую из браузера. Это правильно, потому что браузер может упираться в CORS/SSL, а backend может нормализовать данные и скрыть источник от UI.

### Новые endpoints

В `engine/plana_engine/api/main.py` появились или расширились endpoints:

- `GET /gis/parcels`
- `GET /gis/neighbors`
- `GET /gis/redlines`
- `POST /import/site-context`
- `POST /validate/project`
- `POST /cost/aggregate`

### Нормативная база для посадки

Файл `engine/plana_engine/norms.py` собирает нормы и коэффициенты в одном месте:

- класс жилья;
- parking ratio;
- sellable ratio;
- процент озеленения;
- типовые площади квартир;
- климатические и обеспеченностные константы.

Часть коэффициентов помечена как draft / calibration-based. Это важно показывать пользователю как источник и уровень доверия.

### Новые валидаторы

Добавлены проверки:

- `validators/far.py` - КИТ / FAR;
- `validators/red_lines.py` - пересечение красных линий;
- `validators/neighbor_gap.py` - расстояние до соседних зданий;
- `validators/zoning.py` - соответствие функциональной зоне;
- `validators/runner.py` - подключение новых валидаторов в общий runner.

## 3. Реальный flow сейчас

Текущий flow после последнего пуша:

1. Пользователь открывает `/map`.
2. Приближает карту по Астане.
3. Frontend запрашивает участки, соседей и красные линии.
4. Пользователь кликает участок.
5. Backend подтягивает контекст участка:
   - контур участка;
   - соседние здания;
   - красные линии;
   - функциональную зону.
6. Frontend переводит геометрию участка в локальные метры.
7. Пользователь меняет параметры:
   - класс жилья;
   - этажность;
   - лимит процента застройки.
8. Engine пересчитывает:
   - площадь участка;
   - пятно застройки;
   - процент застройки;
   - строительный объем;
   - GFA;
   - КИТ / FAR;
   - озеленение;
   - ошибки и предупреждения по нормам.

## 4. Что уже работает

Сейчас уже есть рабочий MVP-вход через GIS:

- можно открыть карту;
- можно увидеть участки;
- можно выбрать участок;
- можно получить базовый контекст;
- можно менять несколько параметров;
- можно видеть пересчет ТЭП;
- можно видеть нормоконтроль;
- можно видеть источник цифр через бейджи `GIS`, `расчет`, `норма`.

Это уже сильнее обычной формы, потому что пользователь работает с реальным участком и реальным окружением.

## 5. Чего еще нет по факту

Пока нет полноценного интерактивного masterplan editor.

То есть сейчас есть:

```text
карта + выбор участка + расчетная right panel
```

Но еще нет:

- отдельного workspace выбранного участка;
- ручного добавления нескольких зданий;
- drag/drop корпусов;
- масштабирования / вращения зданий;
- отдельных типов объектов: жилой корпус, школа, детсад, паркинг, коммерция;
- визуального rule-aware feedback прямо на плане;
- сохранения выбранного GIS участка как проекта;
- передачи выбранного участка в cost placement model;
- генерации нескольких вариантов посадки по выбранному участку.

## 6. Целевой продуктовый flow

Целевой flow должен быть таким:

1. Пользователь открывает карту.
2. Выбирает реальный участок.
3. Plana подтягивает GIS context.
4. Пользователь нажимает `Открыть workspace`.
5. Открывается отдельное окно / экран редактирования участка.
6. Контур участка зафиксирован как locked boundary.
7. Пользователь добавляет объекты:
   - жилой корпус;
   - второй жилой корпус;
   - школа;
   - детсад;
   - паркинг;
   - коммерция;
   - двор / озеленение.
8. Пользователь двигает, масштабирует, вращает объекты.
9. Plana в реальном времени проверяет:
   - выход за границы участка;
   - пересечение красных линий;
   - расстояния до соседей;
   - КИТ / FAR;
   - процент застройки;
   - озеленение;
   - паркинг;
   - соответствие функциональной зоне.
10. Пользователь генерирует 2-3 сценария:
    - максимум GFA;
    - balanced courtyard;
    - mixed-use / social infrastructure.
11. Пользователь выбирает сценарий, редактирует его руками.
12. Plana считает стоимость на основе выбранной посадки.
13. Пользователь сохраняет проект и экспортирует отчет.

## 7. Главные продуктовые блоки

### 7.1 Parcel Workspace

После клика по участку нужно открывать не просто right panel, а полноценный workspace.

Цель:

- сделать выбранный участок основой проекта;
- убрать ощущение demo-карты;
- дать пользователю место, где можно проектировать.

Состав экрана:

- карта / контекст слева;
- редактор участка справа или по центру;
- locked boundary участка;
- панель объектов;
- панель ТЭП;
- панель норм;
- панель стоимости.

### 7.2 Multi-building Editor

Нужно добавить объектную модель посадки.

Минимальные сущности:

- residential_building;
- school;
- kindergarten;
- parking;
- commercial;
- courtyard;
- green_area.

Минимальные действия:

- add object;
- move;
- resize;
- rotate;
- duplicate;
- delete;
- change floors;
- change purpose.

Важно: пользователь должен видеть не просто форму, а реальные footprint-объекты внутри участка.

### 7.3 Rule-aware Placement

Редактор должен быть "умным":

- если корпус выходит за boundary, подсветить красным;
- если корпус пересекает красную линию, показать ошибку;
- если расстояние до соседа меньше нормы, показать warning;
- если превышен КИТ, показать error;
- если превышен процент застройки, показать error;
- если не хватает озеленения или паркинга, показать warning;
- если назначение объекта конфликтует с зоной, показать warning/error.

Это должно работать в realtime при редактировании.

### 7.4 Scenario Variants

Нужна кнопка генерации вариантов посадки.

Минимальные сценарии:

- `Max GFA` - максимальная площадь в рамках ограничений;
- `Balanced Courtyard` - двор, инсоляция, нормальная плотность;
- `Mixed Use / Social` - жилье + соцобъекты / коммерция.

Пользователь должен иметь возможность:

- посмотреть 3 варианта;
- сравнить ТЭП;
- сравнить warnings/errors;
- выбрать базовый вариант;
- отредактировать выбранный вариант руками.

### 7.5 Cost Integration

Сейчас cost placement живет отдельно. Следующий сильный шаг - связать его с `/map`.

Данные из карты должны уходить в cost model:

- площадь участка;
- контур участка;
- регион / координаты;
- функциональная зона;
- соседние здания как risk context;
- красные линии как risk context;
- GFA;
- этажность;
- класс жилья;
- площадь паркинга / количество машиномест;
- наличие соцобъектов;
- доля коммерции.

Тогда стоимость станет не "ручной формой", а расчетом от реального участка и выбранной посадки.

### 7.6 Project Save

Выбранный участок и посадку нужно сохранять как проект.

В проекте должны сохраняться:

- parcel id / source id;
- original GeoJSON;
- локальная геометрия;
- GIS context snapshot;
- список объектов посадки;
- параметры объектов;
- validation result;
- cost result;
- source metadata;
- дата обновления GIS context.

Это нужно, чтобы проект можно было открыть из истории и продолжить, а не терять после refresh.

## 8. Техническая модель данных

Нужна отдельная доменная модель masterplan.

Черновой тип:

```ts
type MasterplanProject = {
  id: string;
  parcel: ParcelContext;
  objects: MasterplanObject[];
  validation: ValidationSnapshot;
  cost: CostSnapshot | null;
  sources: SourceRegistryEntry[];
};

type ParcelContext = {
  source: "gis_saulet";
  sourceParcelId: string | null;
  name: string;
  ringWgs84: [number, number][];
  ringLocalM: [number, number][];
  areaM2: number;
  functionalZone: string;
  redLines: [number, number][][];
  neighbors: [number, number][][];
  roads: [number, number][][];
  fetchedAt: string;
};

type MasterplanObject = {
  id: string;
  type:
    | "residential_building"
    | "school"
    | "kindergarten"
    | "parking"
    | "commercial"
    | "courtyard"
    | "green_area";
  label: string;
  footprint: [number, number][];
  x: number;
  y: number;
  width: number;
  depth: number;
  rotationDeg: number;
  floors: number;
  metadata: Record<string, unknown>;
};
```

## 9. Suggested implementation slices

### Slice 1 - Stabilize `/map`

Цель: сделать текущую карту надежной точкой входа.

Задачи:

- добавить loading/error states для GIS слоев;
- показать, когда пользователь слишком далеко zoomed out;
- добавить нормальные пустые состояния;
- добавить auth-aware обработку 401;
- добавить e2e smoke test `/map`;
- добавить кнопку "Create project from parcel".

Файлы:

- `src/app/map/page.tsx`
- `src/lib/gis.ts`
- `src/lib/engine.ts`
- `tests/e2e/map.spec.ts`

Критерий готовности:

- карта открывается;
- участки загружаются;
- клик по участку дает validation summary;
- ошибки GIS не ломают UI.

### Slice 2 - Parcel Workspace

Цель: превратить выбор участка в начало проекта.

Задачи:

- добавить route `/app/masterplan` или modal/workspace внутри `/map`;
- передавать выбранный parcel context;
- отрисовывать locked boundary участка;
- показывать GIS context layers;
- добавить базовую панель project summary.

Файлы:

- `src/app/map/page.tsx`
- `src/app/app/page.tsx`
- `src/components/MasterplanWorkspace.tsx`
- `src/lib/masterplan.ts`

Критерий готовности:

- пользователь выбирает участок и попадает в workspace;
- контур участка отображается как editable canvas/SVG, но boundary locked;
- исходный GIS context не теряется.

### Slice 3 - Multi-building Editor

Цель: дать пользователю руками собрать посадку.

Задачи:

- добавить object palette;
- добавить residential building object;
- добавить social/commercial/parking objects;
- реализовать move/resize/rotate;
- хранить objects в state;
- пересчитывать summary от списка objects.

Файлы:

- `src/components/MasterplanWorkspace.tsx`
- `src/components/MasterplanCanvas.tsx`
- `src/lib/masterplan.ts`
- `src/lib/masterplan-metrics.ts`

Критерий готовности:

- можно добавить несколько объектов;
- можно двигать и масштабировать объекты;
- ТЭП пересчитывается от фактических объектов.

### Slice 4 - Rule-aware Realtime Validation

Цель: сделать редактор умным, а не просто рисовалкой.

Задачи:

- отправлять masterplan objects в `/validate/project`;
- добавить frontend quick checks для boundary/red lines;
- подсвечивать ошибки прямо на canvas;
- показывать grouped validation panel;
- различать error/warning/info.

Файлы:

- `engine/plana_engine/domain/model.py`
- `engine/plana_engine/domain/bridge.py`
- `engine/plana_engine/validators/*`
- `src/components/MasterplanValidationPanel.tsx`
- `src/lib/engine.ts`

Критерий готовности:

- объект за границей участка подсвечивается;
- пересечение красной линии подсвечивается;
- КИТ/coverage warnings обновляются при движении объектов.

### Slice 5 - Scenario Variants

Цель: дать AI/engine генерировать стартовые посадки.

Задачи:

- реализовать deterministic generator для 3 сценариев;
- добавить кнопку `Generate variants`;
- показать cards сравнения;
- выбрать вариант как editable base;
- запретить AI нарушать hard constraints.

Файлы:

- `engine/plana_engine/masterplan/generator.py`
- `engine/plana_engine/api/main.py`
- `src/components/MasterplanScenarioPanel.tsx`
- `src/lib/engine.ts`

Критерий готовности:

- генерируются 3 валидируемых варианта;
- каждый вариант имеет ТЭП и validation summary;
- выбранный вариант можно редактировать руками.

### Slice 6 - Cost From Map

Цель: соединить карту, посадку и смету.

Задачи:

- создать adapter `masterplan -> cost input`;
- учитывать GFA, underground, parking, site works;
- передавать GIS risk context в cost warnings;
- показывать source metadata;
- экспортировать report от выбранной посадки.

Файлы:

- `src/lib/cost-placement.ts`
- `src/components/CostPlacementTab.tsx`
- `src/lib/masterplan-cost.ts`
- `engine/plana_engine/cost/aggregate_cost.py`

Критерий готовности:

- стоимость считается от выбранной посадки;
- пользователь видит, какие данные пришли из GIS, какие расчетные, какие placeholder;
- report можно экспортировать.

### Slice 7 - Project Persistence

Цель: сохранять GIS участок и masterplan как нормальный проект.

Задачи:

- расширить project params schema;
- сохранять parcel context;
- сохранять objects;
- сохранять validation/cost snapshots;
- открывать проект из истории.

Файлы:

- `src/lib/projects.ts`
- `engine/plana_engine/projects/router.py`
- `src/app/projects/page.tsx`
- `src/app/app/page.tsx`

Критерий готовности:

- выбранный участок и посадка переживают refresh;
- проект открывается из истории;
- пользователь может продолжить редактирование.

## 10. Product risks

### GIS source reliability

GIS может быть недоступен, медленный или менять формат ответа. Нужны:

- graceful fallback;
- cache/snapshot;
- source timestamp;
- понятное предупреждение пользователю.

### Legal/normative correctness

Часть норм пока draft. Нельзя продавать это как официальную экспертизу. Нужно явно писать:

- source type;
- confidence;
- official / draft / calibrated / placeholder;
- что требует проверки по ГПЗУ/ПДП.

### Geometry accuracy

Перевод WGS84 в локальные метры через простую проекцию нормален для MVP и малых участков, но для production нужен более строгий геодезический pipeline.

### Editor complexity

Drag/drop masterplan editor легко разрастется. Нужна простая объектная модель и маленькие slices, иначе UI станет тяжелым и нестабильным.

## 11. Что говорить команде / руководству

Короткая формулировка:

> Мы сделали первый реальный GIS-вход в Plana: пользователь может выбрать участок на карте, система подтягивает контур, соседей, красные линии и функциональную зону, после чего считает базовые ТЭП и прогоняет нормоконтроль. Следующий этап - превратить это в полноценный интерактивный workspace: добавление нескольких зданий и соцобъектов, drag/drop редактирование посадки, realtime проверки норм и расчет стоимости от фактической схемы участка.

Еще короче:

> Plana перестает быть формой с ручными параметрами и становится картографическим инструментом для real-site masterplanning.

## 12. Immediate next decision

Нужно выбрать ближайший product slice:

1. Если цель - быстро показать инвестору: делать `Parcel Workspace + basic multi-building editor`.
2. Если цель - доказать техническую надежность: стабилизировать `/map`, добавить e2e и cache GIS context.
3. Если цель - коммерческая ценность: связать выбранный участок с cost model и export report.

Рекомендация: идти так:

```text
Stabilize /map -> Parcel Workspace -> Multi-building Editor -> Rule-aware Validation -> Cost From Map -> Save Project
```

