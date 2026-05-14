# Geometry — Shapely 2.x как ядро 2D-операций plana

> **Цель:** выбрать 2D-геометрический движок для backend (`engine/`) под доменную модель
> `Project → Site → Building → Floor → Apartment → Room → Wall + Cores + Shafts`.
> Координаты — миллиметры (float/int), без проекций (это **не** GIS).
> Дата: 2026-05-14.

---

## TL;DR

**Берём `Shapely 2.1.x`** (BSD-3, GEOS под капотом) как **единственный** общий движок для:
intersection / union / difference, buffer (positive/negative — для отступов/setback),
`area`, `centroid`, `contains`, `is_valid` / `make_valid`, MultiPolygon, STRtree (spatial index),
prepared geometry. Pydantic-интеграция — через **кастомный `__get_pydantic_core_schema__`**
с WKT-сериализацией (своими руками, 30 строк; `pydantic-shapely` v1.0.0a6 — `alpha`,
не берём как dependency, но идею крадём).

**Вторая линия** — `pyclipper` (MIT, обёртка Clipper2). Включаем **только если** в реальном
сценарии Shapely-буфер начнёт давать `make_valid`-патологии на сильно вогнутых стенах
с малым offset, или если профайлер покажет узкое место именно в clip/offset. Сейчас —
**не подключаем**, лишняя зависимость.

`CGAL Python bindings`, `euclid3`, ручной numpy — **отклонены** (см. таблицу ниже).

---

## 1. Shapely в 2026 — статус

| Поле | Значение |
|---|---|
| Latest stable | **2.1.2** (24 сен 2025) — wheels для Python 3.14 |
| Предыдущий минор | 2.1.1 (19 мая 2025), 2.1.0 (3 апр 2025) |
| Лицензия | BSD-3-Clause |
| Python | ≥ 3.10 (мы на 3.11+, ОК) |
| GEOS (в wheel'ах PyPI) | 3.13.1 |
| NumPy | required dependency, ≥ 1.21 |
| Активность | Sean Gillies + core team, регулярные минор-релизы |

**Breaking changes 1.x → 2.x (мы стартуем чисто на 2.x, проблемы НЕ актуальны, но к сведению):**

- Все геометрии теперь **immutable + hashable**. Раньше у `LineString` можно было поменять
  `coords` in-place — теперь нет. Для нас это **плюс**: можно класть в `set`, в `dict`-ключ,
  в `lru_cache`.
- `MultiPolygon` больше **не итерируемая sequence**. Вместо `for p in mp:` пишем
  `for p in mp.geoms:`. Аналогично для `MultiLineString`, `GeometryCollection`.
- Geometry больше не реализует `__array_interface__` напрямую — для координат теперь
  `np.asarray(geom.coords)`.
- **Vectorized API** (`shapely.intersection(arr1, arr2)`, `shapely.area(arr)`, ...) реализован
  как numpy ufunc'и, в C, с release GIL → реальные многопотоки и x4–x100 ускорение на
  батчах относительно 1.x с Python-циклом.

> Источник скорости: <https://shapely.readthedocs.io/en/stable/release/2.x.html>,
> [DeepWiki Vectorized Operations](https://deepwiki.com/shapely/shapely/7-vectorized-operations).

---

## 2. API quickstart — наши кейсы

```python
from shapely import Polygon, MultiPolygon, Point, LineString, STRtree
from shapely.ops import unary_union, nearest_points
from shapely.validation import make_valid, explain_validity
```

### 2.1. Создание Polygon из координат

```python
# Простой контур (в миллиметрах — Shapely unit-agnostic, единицы решаем мы):
room = Polygon([(0, 0), (3500, 0), (3500, 2800), (0, 2800)])

# С отверстием (например, шахта внутри floor plate):
shell = [(0, 0), (40_000, 0), (40_000, 25_000), (0, 25_000)]
shaft_hole = [(18_000, 11_000), (22_000, 11_000), (22_000, 14_000), (18_000, 14_000)]
floor_slab = Polygon(shell, [shaft_hole])
```

### 2.2. Boolean: intersection / union / difference

```python
a = Polygon([(0, 0), (4000, 0), (4000, 3000), (0, 3000)])
b = Polygon([(3000, 1000), (7000, 1000), (7000, 4000), (3000, 4000)])

overlap   = a.intersection(b)   # или: a & b
combined  = a.union(b)          # или: a | b
a_minus_b = a.difference(b)     # или: a - b

# Union целого списка квартир (граница этажа):
floor_outline = unary_union([apt.polygon for apt in apartments])
```

### 2.3. Buffer (отступы / setbacks / коридоры)

```python
# Setback от границы участка внутрь — отрицательный буфер:
site_setback_zone = site_polygon.buffer(-3000)   # -3 м от границы участка
ok_footprint = site_setback_zone.contains(building_footprint)

# "Толстая" линия из axis-line стены (для конструктивной модели):
wall_axis = LineString([(0, 0), (5000, 0)])
wall_solid = wall_axis.buffer(100, cap_style="flat", join_style="mitre")  # стена 200 мм

# join_style: 'mitre' / 'round' / 'bevel' — для архитектурных углов 'mitre' естественней.
```

> **Гочча на буфере:** при negative buffer полигон может **исчезнуть** (стать пустым)
> или развалиться на `MultiPolygon`. Всегда проверяем `result.is_empty`
> и `isinstance(result, MultiPolygon)`.

### 2.4. Метрики: area / centroid / contains

```python
room.area        # float, в мм² (мы единицы сами решили)
room.centroid    # Point(x, y)
room.contains(Point(1000, 1000))  # bool

# Точка строго внутри (для постановки лейбла комнаты на плане):
label_pt = room.representative_point()  # гарантированно внутри, даже если полигон вогнутый
```

### 2.5. Validity / make_valid (для импорта CAD)

```python
from shapely.validation import make_valid, explain_validity

if not poly.is_valid:
    reason = explain_validity(poly)    # человекочитаемая причина
    poly_fixed = make_valid(poly)      # может вернуть Polygon / MultiPolygon / GeometryCollection
    # Если результат — GeometryCollection, берём только полигональные части:
    if poly_fixed.geom_type == "GeometryCollection":
        poly_fixed = MultiPolygon([g for g in poly_fixed.geoms if g.geom_type == "Polygon"])
```

**Типичные причины invalid после импорта DXF:**

- Self-intersection (LWPOLYLINE замкнулся через сам себя — баг чертёжника).
- Дублирующиеся вершины (DXF часто содержит точки с микро-расстоянием — погрешность экспорта из AutoCAD).
- Полигон с дыркой, которая касается внешнего контура в одной точке.

### 2.6. MultiPolygon — неконтиguous квартиры

```python
# Квартира с лоджией, которая геометрически отделена тонкой стеной (полузакрытое пространство):
apt = MultiPolygon([room_polygon, loggia_polygon])

apt.area               # сумма частей
for part in apt.geoms:  # 2.x: iterable через .geoms
    print(part.area)

# Соединить, если части на самом деле касаются:
joined = unary_union([room_polygon, loggia_polygon])
```

---

## 3. Pydantic-интеграция (наш паттерн)

Мы не тащим `pydantic-shapely` (он `1.0.0a6`, alpha). Пишем мини-адаптер сами — 40 строк.
Сериализуем **в WKT** (читаемо в JSON-ответе API; для бинарной плотности есть WKB,
но он base64-encoded в JSON — менее удобен для отладки).

```python
# engine/domain/geometry_field.py
from typing import Annotated, Any
import shapely
from shapely import Polygon, MultiPolygon
from shapely.geometry.base import BaseGeometry
from pydantic import GetJsonSchemaHandler
from pydantic_core import core_schema


class _ShapelyAdapter:
    """Pydantic v2 adapter for Shapely geometries via WKT."""

    def __init__(self, geom_cls: type[BaseGeometry]):
        self.geom_cls = geom_cls

    def __get_pydantic_core_schema__(self, source_type, handler) -> core_schema.CoreSchema:
        def validate(value: Any) -> BaseGeometry:
            if isinstance(value, self.geom_cls):
                return value
            if isinstance(value, str):
                g = shapely.from_wkt(value)
                if not isinstance(g, self.geom_cls):
                    raise TypeError(f"WKT parsed as {type(g).__name__}, expected {self.geom_cls.__name__}")
                return g
            if isinstance(value, dict):
                # GeoJSON-подобный dict (нашей мини-схемой)
                return shapely.geometry.shape(value)
            raise TypeError(f"Cannot coerce {type(value).__name__} to {self.geom_cls.__name__}")

        return core_schema.no_info_plain_validator_function(
            validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda g: shapely.to_wkt(g, rounding_precision=3),
                return_schema=core_schema.str_schema(),
                when_used="json",
            ),
        )

    def __get_pydantic_json_schema__(self, schema, handler: GetJsonSchemaHandler):
        return {"type": "string", "format": "wkt", "title": self.geom_cls.__name__}


PolygonField = Annotated[Polygon, _ShapelyAdapter(Polygon)]
MultiPolygonField = Annotated[MultiPolygon, _ShapelyAdapter(MultiPolygon)]
```

**Использование в доменке:**

```python
# engine/domain/models.py
from pydantic import BaseModel, Field, field_validator
from .geometry_field import PolygonField, MultiPolygonField


class Room(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    id: str
    kind: str  # "living" / "kitchen" / "bath" / "corridor" / ...
    polygon: PolygonField

    @field_validator("polygon")
    @classmethod
    def _must_be_valid(cls, v):
        if not v.is_valid:
            raise ValueError(f"Invalid polygon: {shapely.explain_validity(v)}")
        if v.area < 1.0:  # < 1 мм²  — явно ошибка
            raise ValueError("Polygon area is degenerate (< 1 mm²)")
        return v

    @property
    def area_m2(self) -> float:
        return self.polygon.area / 1_000_000.0  # мм² → м²


class Apartment(BaseModel):
    model_config = {"arbitrary_types_allowed": True}
    id: str
    rooms: list[Room]
    polygon: MultiPolygonField   # квартира может состоять из частей (квартира + лоджия)

    @property
    def living_area_m2(self) -> float:
        return sum(r.area_m2 for r in self.rooms if r.kind == "living")
```

**Альтернативные форматы сериализации (если позже понадобится):**

| Формат | Плюсы | Минусы | Когда |
|---|---|---|---|
| **WKT** (наш дефолт) | Читаемо в JSON, текстовое, дебажится глазами | Объём ~2x от бинарного | API-ответы, БД где не нужна индексация |
| **WKB hex** | Компактно, точно (round-trip без потери) | Не читается | Стораджевый кэш, диск |
| **GeoJSON dict** | Совместим с фронтом (Mapbox/Leaflet/D3) | Многословно, нет MultiPolygon-с-дырками без массы вложенности | Если frontend ест GeoJSON напрямую |
| **Coordinate list** (свой JSON) | Полный контроль | Сами пишем сериализатор и не получаем стандарт | Если ничего из вышеперечисленного не подходит |

> Решение: **WKT по умолчанию**, WKB для кэша, GeoJSON — опциональный экспортный метод
> на модели (`apartment.to_geojson()`), не основная сериализация.

---

## 4. Performance — наша масштаб (~100 полигонов на этаж)

Для нашего масштаба Shapely 2.x **не будет узким местом**. Грубые оценки на современном
ноутбучном CPU (Intel/AMD ~2024, single core, GEOS 3.13):

| Операция | Скейл | Время (ориентир) |
|---|---|---|
| `Polygon.area`, `.centroid`, `.is_valid` | один | < 1 µs |
| `polygon.intersection(other)` | один | 10–100 µs (зависит от вершин) |
| `polygon.buffer(d)` | один | 50–500 µs |
| Pairwise intersect 100×100 квартир (наивно O(n²) c `intersects`) | 100 polys | ~10–100 ms |
| То же через `STRtree.query(p, predicate='intersects')` | 100 polys | ~1–10 ms |
| Vectorized `shapely.area(np.array(polys))` | 1000 polys | < 1 ms (без Python-loop) |

Ускорения 4×–100× относительно Shapely 1.x приходят на батчах ≥ 100 геометрий, когда
Python-loop overhead начинает доминировать. На одиночных операциях прирост скромнее
(но обычно тоже есть, т.к. C-extension вместо ctypes).

**Когда оптимизировать вообще:**

- Парные пересечения квартир: сразу `STRtree`, не наивный double-loop.
- `contains`-чек большого здания против тысяч точек (например, оконные позиции для
  инсоляции) — `shapely.prepare(building)` + цикл `building.contains(pt)`. Prepared
  geometry окупается уже на ~10–100 запросах.
- Если внутри валидатора нужно сделать одну и ту же операцию над всеми этажами —
  vectorized API на массиве numpy-dtype `object` (Shapely 2.x умеет).

---

## 5. Альтернативы — сравнение

| Либ | Лиц. | Сильные стороны | Слабые | Вердикт |
|---|---|---|---|---|
| **Shapely 2.x** | BSD-3 | Зрелый GEOS, vectorized, STRtree, prepared, валидация, MultiPolygon, экосистема (geopandas, fiona и т.д. — нам не нужны, но есть) | Floating-point GEOS (не строгая robustness), redirect на C-extension значит долгий импорт ~50ms | **Берём как ядро** |
| **pyclipper** (Clipper 6.4.2) | MIT (LGPL обёртки) | Integer coords → robust booleans, очень быстрый offset, дёшев для большой плотности | Целые координаты → нужен scale factor (×1000 для мм-precision), только booleans + offset, нет area/centroid/contains, отдельная экосистема | **Только если буфер Shapely начнёт ломаться на узких offset** |
| **pyclipr** (Clipper2 + pybind11) | BSL-1.0 | То же что pyclipper, но Clipper2 → ещё быстрее и стабильнее на дегенератах | Малая комьюнити, новее | Опция вместо pyclipper, если решим тащить Clipper |
| **CGAL Python bindings** | GPL+commercial / тяжело собрать | Промышленный computational geometry, exact predicates (точные предикаты на rational arithmetic) | GPL lock-in (наш SaaS), сборка C++ deps, SWIG-обёртка (не самая удобная), x10 веса | **Отклоняем** — overkill + license risk |
| **scikit-geometry** | GPL | CGAL через лучшие bindings, mesh operations | GPL, экспериментально | Отклоняем |
| **euclid3 / pure Python** | LGPL | Vector / matrix mathlib | Нет booleans, нет validity, нет STRtree — это **не** geometry-engine | Отклоняем — слишком примитивно |
| **numpy + handwritten** | BSD | Полный контроль | Нужно писать самим: bool ops (Weiler-Atherton / Sutherland-Hodgman), validity, robustness — это **сотни** edge-cases | Отклоняем — мы пишем платформу, не геометрический ресёрч |
| **PyGEOS** | BSD | Был vectorized GEOS — но **влит в Shapely 2.0** | Не существует отдельно | Не релевантно (это **и есть** Shapely 2.x) |

**Pyproj — не нужен**: мы работаем в локальной декартовой системе (мм). Pyproj — это
проекции (lat/lon → UTM и т.п.). Если когда-то понадобится привязать site к OSM/спутнику,
тогда вернёмся.

---

## 6. Use-case mapping (наши валидаторы → Shapely)

### Insolation (инсоляция: луч от окна до солнца)

```python
# Window — отрезок (или Point на середине окна).
# Building set — MultiPolygon всех затеняющих зданий (включая собственное).
def has_sun_at(window: LineString, sun_dir_xy: tuple[float, float],
               shadowers: MultiPolygon, ray_length: float = 1_000_000) -> bool:
    """Returns True if window has line-of-sight along sun_dir."""
    mid = window.interpolate(0.5, normalized=True)
    far = Point(mid.x + sun_dir_xy[0] * ray_length, mid.y + sun_dir_xy[1] * ray_length)
    ray = LineString([mid, far])
    # exterior-only: убираем своё окно (буфер 50 мм вокруг точки)
    obstacles = shadowers.difference(mid.buffer(50))
    return not ray.intersects(obstacles)
```

> Для **всех** окон против **всех** часов солнца — батч через `STRtree`(buildings) +
> per-window query.

### Fire safety — длина эвакуационного пути

Shapely **не** даёт shortest-path-внутри-полигона из коробки. Подход:

1. Построить **visibility graph** через `pyvisgraph` (готовая либа, MIT) — узлы это
   вершины препятствий + start/end, рёбра — все ненарушенные сегменты видимости.
2. Над графом запустить **NetworkX Dijkstra** (`networkx.shortest_path_length`).
3. Сегменты видимости проверяем Shapely-методом `ray.intersects(obstacles)`.

Альтернатива: medial-axis (CenterlineExtraction) — но это уже отдельная задача,
посмотреть `centerline` (PyPI) или `scikit-geometry` straight skeleton, когда дойдём
до этой фичи. Для MVP — visibility graph хватает.

### Setback (отступ от границы участка)

```python
def building_inside_setback(building: Polygon, site: Polygon, setback_m: float) -> bool:
    allowed = site.buffer(-setback_m * 1000)  # мм
    if allowed.is_empty:
        return False  # участок меньше setback — невозможно построить
    return allowed.contains(building)
```

### Площади (living area)

См. `Apartment.living_area_m2` выше. Площадь Shapely даёт в квадратах входных единиц
(мы кладём мм → получаем мм² → делим на 1e6).

### Detect overlapping apartments

```python
def find_overlaps(apartments: list[Apartment]) -> list[tuple[str, str]]:
    polys = [a.polygon for a in apartments]
    tree = STRtree(polys)
    overlaps: list[tuple[str, str]] = []
    for i, a in enumerate(apartments):
        # STRtree.query возвращает индексы из tree.geometries
        for j in tree.query(polys[i], predicate="intersects"):
            if j <= i:
                continue
            inter = polys[i].intersection(polys[j])
            if inter.area > 1.0:   # > 1 мм² — настоящее пересечение, не касание
                overlaps.append((a.id, apartments[j].id))
    return overlaps
```

---

## 7. Common pitfalls / гочи

1. **Floating-point GEOS не exact.** Два соседних треугольника, поделивших ребро,
   при `union` могут оставить hairline gap на 1e-12. Для нашего unit (мм) это видно
   только при `set_precision(grid_size=0.001)`. Если в импортируемом DXF координаты
   уезжают в e-7 мм, кладём `shapely.set_precision(geom, 1.0)` (округление до мм) **перед**
   booleans.

2. **Units — на вас.** Shapely **unit-agnostic**. Мы выбрали мм и **держимся** по всему
   движку. Любая конверсия с фронта/импорта из DXF — единое место (`engine/io/units.py`),
   а не разбросано по моделям. **Никаких метров в одной модели и мм в другой.**

3. **`buffer` с отрицательным радиусом** может вернуть `empty` или `MultiPolygon`. Всегда:

   ```python
   r = poly.buffer(-d)
   if r.is_empty:
       raise ValueError("buffer collapsed")
   if isinstance(r, MultiPolygon):
       # тоненькая стена разломила полигон → решить, что брать
       r = max(r.geoms, key=lambda g: g.area)
   ```

4. **`Polygon.contains(point)`** для точки **на границе** возвращает `False`. Если нужна
   "на границе тоже свой" — используем `intersects` или `covers`. Для архитектуры
   точка на стене обычно считается **внутри** — `covers` корректнее `contains`.

5. **`make_valid` может вернуть GeometryCollection** (смесь Polygon + LineString) после
   починки самопересечения. Всегда фильтруем по `geom_type == 'Polygon'` или приводим
   к MultiPolygon явно.

6. **MultiPolygon итерация в 2.x — через `.geoms`**, не `for p in mp:`. Старый код из
   2018–2021 годов в интернете будет с багом.

7. **STRtree.query возвращает индексы**, не геометрии. До 2.x был callable-режим со
   старым API — забудьте, читайте 2.x документацию.

8. **Prepared geometry** — отдельный объект:

   ```python
   from shapely import prepare
   prepare(building)        # модифицирует кэш на объекте (in-place by side-effect)
   building.contains(pt)    # теперь быстрее, на 5×–50×
   ```

   Prepared полезен **только** для повторяющихся запросов того же `building` против
   многих точек/мелких полигонов. Для одиночного запроса — не нужен.

9. **Импорт Shapely** ~50–100 ms (тащит numpy + GEOS .so). На холодный старт FastAPI это
   незаметно; на лямбдах — учитывать.

10. **`from_wkt` дороже чем `from_wkb`** ~×2. Если в БД храним много геометрий, лучше WKB
    (как hex или bytea).

11. **GEOS меняет результаты между минорами.** `oriented_envelope` поменялся в GEOS 3.12;
    `offset_curve` поменялся в GEOS 3.11. Версию GEOS пинимаем (через `shapely==2.1.*`
    которая везёт 3.13.1 в wheel'е).

12. **Не пишите свой `point-in-polygon`.** Соблазн велик, выглядит просто — на самом деле
    edge cases (точка на ребре, на вершине, ray вдоль ребра) сжирают неделю отладки.
    `shapely.contains` / `covers` / `intersects` уже корректны.

---

## 8. Решение

| Аспект | Решение |
|---|---|
| Геометрия (core) | **Shapely 2.1.x** (`shapely>=2.1,<3`) |
| Pydantic-bridge | Свой `_ShapelyAdapter` (≈40 строк, см. § 3) |
| Сериализация по умолчанию | WKT в JSON, WKB hex для кэша |
| Spatial index | `shapely.STRtree` (встроенный) |
| Shortest path по плану | `pyvisgraph` + `networkx` (отдельный ресёрч, в § 6) |
| Скейл единиц | мм (int/float), глобально по движку |
| Pyclipper / Clipper2 | **не сейчас**, держим в кармане как откат на сложные offset |
| CGAL / scikit-geometry | **отклонено** (GPL, overkill) |

**Размер dependency footprint:** `shapely==2.1.*` тащит numpy (мы и так его захотим
для всего остального) + GEOS shared lib в wheel'е. Никаких system deps на Linux/Mac
(на Windows тоже — wheel самодостаточен). На Alpine придётся ставить `geos-dev` —
лучше использовать `python:3.11-slim` (Debian) как base image.

---

## Sources

### Shapely
- [Shapely 2.1.x release notes](https://shapely.readthedocs.io/en/stable/release/2.x.html)
- [Shapely on PyPI (2.1.2, BSD-3, Python 3.10–3.14)](https://pypi.org/project/shapely/)
- [Shapely User Manual](https://shapely.readthedocs.io/en/stable/manual.html)
- [Migrating 1.x → 2.0](https://shapely.readthedocs.io/en/stable/migration.html)
- [STRtree docs](https://shapely.readthedocs.io/en/stable/strtree.html)
- [`shapely.set_precision`](https://shapely.readthedocs.io/en/2.0.2/reference/shapely.set_precision.html)
- [DeepWiki: Prepared Geometries](https://deepwiki.com/shapely/shapely/6.4-prepared-geometries)
- [DeepWiki: Vectorized Operations](https://deepwiki.com/shapely/shapely/7-vectorized-operations)
- [Shapely Releases on GitHub](https://github.com/shapely/shapely/releases)

### Pydantic integration
- [pydantic-shapely (Peter-van-Tol)](https://github.com/Peter-van-Tol/pydantic-shapely)
- [pydantic-shapely on PyPI](https://pypi.org/project/pydantic-shapely/)
- [scientific_pydantic: shapely](https://psalvaggio.github.io/scientific_pydantic/dev/api/scientific_pydantic/shapely/)
- [Pydantic discussion #8832: custom serializer for WKBElement](https://github.com/pydantic/pydantic/discussions/8832)
- [geojson-pydantic](https://github.com/developmentseed/geojson-pydantic)
- [Frank-Mich: Pydantic model for GIS polygons](https://blog.frank-mich.com/creating-a-pydantic-model-for-gis-polygons/)

### Альтернативы
- [pyclipper on PyPI](https://pypi.org/project/pyclipper/)
- [pyclipper GitHub (fonttools)](https://github.com/fonttools/pyclipper)
- [Deprecating SCALING_FACTOR — pyclipper wiki](https://github.com/fonttools/pyclipper/wiki/Deprecating-SCALING_FACTOR)
- [Clipper2 overview (Angus Johnson)](https://www.angusj.com/clipper2/Docs/Overview.htm)
- [pyclipr (Clipper2 + pybind11)](https://github.com/drlukeparry/pyclipr)
- [Introducing scikit-geometry (Wolf Vollprecht)](https://wolfv.medium.com/introducing-scikit-geometry-ae1dccaad5fd)
- [CGAL Python Bindings paper (arXiv 2202.13889)](https://arxiv.org/pdf/2202.13889)
- [CGAL 2D Regularized Boolean Set-Operations manual](https://doc.cgal.org/latest/Boolean_set_operations_2/index.html)

### Use cases (visibility / shortest path)
- [pyvisgraph (visibility graph + Dijkstra)](https://github.com/TaipanRex/pyvisgraph)
- [Red Blob Games: 2D Visibility](https://www.redblobgames.com/articles/visibility/)
- [Visibility polygon (Wikipedia)](https://en.wikipedia.org/wiki/Visibility_polygon)
- [NetworkX shortest_path](https://networkx.org/documentation/stable/reference/algorithms/shortest_paths.html)

### Производительность GEOS
- [Crunchy Data: Performance Improvements in GEOS](https://www.crunchydata.com/blog/performance-improvements-in-geos)
