# IFC server-side stack — `ifcopenshell` vs `web-ifc` (и что ещё)

> Дата: 2026-05-14. Контекст: plana, Next.js 16 + Python 3.11 FastAPI engine с `ezdxf`.
> ТЗ требует **импорт И экспорт IFC** на проде. Этот документ выбирает серверный IFC-процессор и опционально клиентский preview.

---

## TL;DR

**Брать `ifcopenshell` 0.8.5 (Python, LGPL-3.0) как основной серверный IFC-движок.** Это единственный зрелый opensource-стек, который умеет **читать И записывать** IFC с высокоуровневым API (`ifcopenshell.api.*`) на Python — а наш engine именно на Python. LGPL-3.0 при импорте через `pip install ifcopenshell` (dynamic linking) совместим с закрытым SaaS-backend'ом при стандартных мерах: не править форк, не вкомпиливать статически, выдать пользователю возможность подменить версию библиотеки + дать `LICENSE`.

**Клиентский preview — `web-ifc` (WASM, MPL-2.0) внутри `@thatopen/components`**, если/когда понадобится 3D-вьюер в браузере. На сервере не использовать — Node + WASM в FastAPI стеке — лишний контур.

**`xbim` (.NET) не берём** — другая платформа, нужен side-car сервис, выигрыш по скорости есть, но операционные затраты не окупаются на старте. Возвращаемся к нему, только если упрёмся в perf на файлах >200 МБ.

**Архитектурно:** IFC I/O живёт рядом с `ezdxf` в `engine/plana_engine/io/ifc/`. Wheel `ifcopenshell` ставится одной командой `pip install` (manylinux 2.31), OpenCascade тянет внутри wheel'а, отдельных system deps не нужно. Docker образ — `python:3.11-slim` (НЕ alpine: musl ломает OCCT).

---

## Decision matrix

| Критерий | `ifcopenshell` 0.8.5 (Python) | `web-ifc` 0.77 (Node) | `xbim` 6.x (.NET) | `IFC++` (C++) |
|---|---|---|---|---|
| Лицензия | **LGPL-3.0** (file-level / lib-level copyleft) | **MPL-2.0** (file-level copyleft) | CDDL / Apache-2.0 (зависит от пакета) | MIT |
| Read IFC | 2x3, 4, 4x1, 4x2, **4.3 Add2** | 2x3, 4, 4.3 (через web-ifc-api) | 2x3, 4, 4.3 | 2x3, 4 |
| Write IFC | **2x3, 4, 4.3** (full) | **2x3, 4, 4.3** (через WriteLine) | 2x3, 4 (4.3 ограничено) | 2x3, 4 |
| Высокоуровневый API (create wall etc.) | **Да — `ifcopenshell.api.*`** | Нет, только raw entities + WriteLine | Частично (EntityFactory) | Нет |
| Geometry kernel | OpenCascade (OCCT) — встроен в wheel | Свой (tape reader, без BREP) | Свой + опц. OCCT | OCCT |
| Native Python | **Да, first-class** | Нет (Node/WASM) | Через REST/IPC к .NET | Нет (биндингов нет на 2026) |
| FastAPI integration | **Native import** | sidecar (Node) | sidecar (.NET) | C++ bindings писать самим |
| Производительность парсинга | ~20 МБ/с (Python overhead заметен на >200 МБ) | ~50–100 МБ/с (tape reader) | **Самый быстрый**, до 10× быстрее ifcopenshell | Быстрый, многопоточный |
| Docker base | `python:3.11-slim` (manylinux 2.31 wheel) | `node:20-bookworm` | `mcr.microsoft.com/dotnet/runtime:8.0` | сборка из исходников |
| Образ ~МБ | ~250–300 (вместе с OCCT) | ~150 | ~300 | ~200 (надо собирать) |
| GitHub stars | **2.5k** | 955 | XbimEssentials ~700 | ~400 |
| Активность | релиз 2026-04-13 (`0.8.5`) | релиз 2026-03-06 (`0.77`) | релиз 2026-04 (6.x) | вялый, последний коммит 2025 |
| Кто использует | Bonsai (ex-BlenderBIM), FreeCAD, IfcDiff, IfcConvert, академия | @thatopen/components, IFC.js viewer экосистема | Government BIM tools UK | мелкие C++ проекты |

**Вывод:** для plana единственный реалистичный выбор серверного движка — `ifcopenshell`. Альтернативы либо требуют чужого runtime (xbim/.NET, web-ifc/Node), либо сильно беднее по API (IFC++).

---

## Что НЕ выбираем — короткий черновик с обоснованиями

- **`web-ifc` на Node как серверный движок.** Минусы:
  - Привносим Node-runtime ради одной библиотеки → расширяем поверхность атаки и CI/CD.
  - WASM на сервере резервирует ~10 ГБ виртуальной памяти (известное поведение V8) — на shared-хостинге может падать.
  - High-level API скудный: для записи нужно вручную собирать STEP-строки через `WriteLine(modelID, entity)`. Нет аналога `ifcopenshell.api.geometry.add_wall_representation`.
- **`xbim` (.NET).** Быстрее на больших файлах в 10× и более. Но это полноценный side-car сервис на C# с собственным жизненным циклом. Operate сложнее. Берём в резерв — если ifcopenshell не справится с типичными размерами файлов клиентов.
- **`IFC++`.** Нет официальных Python-биндингов на 2026 (issue [#189](https://github.com/ifcquery/ifcplusplus/issues/189) открыт). Слишком сырой.
- **`Bonsai` (ex-BlenderBIM).** Это **Blender add-on**, не сервер. Использует тот же `ifcopenshell` под капотом — нам и так нужен он. Полезно для UI-патернов, не для serverside.
- **Кастомный парсер.** STEP формат IFC живёт с 1996. Парсер с нуля = годы работы.

---

## Лицензионный анализ — детально

### `ifcopenshell` — LGPL-3.0

**LGPL-3.0** допускает использование библиотеки в проприетарном/SaaS-софте при условиях:
1. Пользователь должен иметь возможность **подменить версию библиотеки** на свою (это и есть смысл LGPL). На Python это легко — установка через `pip` уже даёт dynamic linking-эквивалент: библиотека лежит отдельным пакетом в `site-packages`, её можно перебилдить.
2. Если правим исходники `ifcopenshell` — обязаны опубликовать патчи под LGPL. Мы **не правим** — просто импортируем.
3. Текст лицензии должен быть доступен пользователю. Кладём в наш `THIRD_PARTY_LICENSES.md`.

**SaaS-нюанс:** LGPL-3.0 (в отличие от AGPL) **НЕ требует** раскрывать исходники сервиса, к которому юзер обращается по сети. SaaS-вызовы не считаются distribution в смысле GPL/LGPL. Это подтверждается стандартной интерпретацией FSF: copyleft срабатывает при передаче бинарей, не при предоставлении сетевого сервиса. Если бы лицензия была AGPL — было бы катастрофой; LGPL — допустимо.

**Сомнительный момент — Python `import` vs dynamic linking.** В сообществе нет 100% юридической определённости, считается ли `import ifcopenshell` "linking" в смысле LGPL. **Консервативное чтение:** да, это эквивалент dynamic linking — потому что `ifcopenshell` лежит как отдельный wheel в `site-packages`, наш код не модифицирует его, юзер может заменить версию. Это позиция большинства Python-проектов, использующих LGPL-зависимости (PyQt5 был LGPL долгие годы, и его юзали в SaaS).

**Что делаем на практике:**
- Не модифицируем `ifcopenshell`. Если нужны фичи — pull request в upstream или wrapper-уровень в нашем коде.
- В `pyproject.toml` зависимость пишется как `ifcopenshell>=0.8.5,<0.9`.
- В footer `/legal` страницы и в `THIRD_PARTY_LICENSES.md` указываем LGPL-3.0 + ссылку на исходники.
- В Docker образе оставляем wheel установленным через pip (не статически слинкованным).

**Needs verification:** проконсультироваться с юристом по KZ-юрисдикции перед коммерческим запуском. Стандартная Python-практика говорит "ОК", но юр-валидация не повредит.

### `web-ifc` — MPL-2.0

**Mozilla Public License 2.0** — file-level weak copyleft. Если мы **правим файлы** `web-ifc` — обязаны опубликовать изменения этих файлов. Если просто импортируем npm-пакет и пишем свой код в **отдельных файлах** — ничего раскрывать не надо. Совместима с проприетарным SaaS из коробки.

MPL-2.0 проще, чем LGPL: нет дискуссии про "linking", только "modified file = share modifications".

### `xbim` — смешанная

XbimEssentials под Apache-2.0 (permissive), но некоторые компоненты Toolkit (Geometry engine на основе OCCT) исторически были под CDDL. Нужно проверять каждый sub-пакет отдельно. Для нашего use case (sidecar по REST) лицензия sub-пакетов не критична, потому что мы не линкуем их в наш код.

---

## Покрытие IFC-схем — что важно

| Схема | ifcopenshell | web-ifc | Комментарий |
|---|---|---|---|
| IFC2x3 TC1 | read+write+geometry | read+write | legacy, всё ещё доминирует на проде |
| IFC4 Add2 TC1 | read+write+geometry | read+write | основной target для современных проектов |
| IFC4x1 | read+write (parsing) | read | infra extension |
| IFC4x2 | read+write (parsing) | read | bridge extension |
| **IFC4.3 Add2** | **read+write+geometry** | read+write | финал, ISO 16739-1:2024 |
| IFC5 alpha | ❌ | ❌ | в альфе, не для прода |

Для plana важны **IFC2x3 + IFC4** как минимум (это 95% реальных файлов клиентов). IFC4.3 нужен для инфраструктурных проектов, можем планировать на v2.

---

## Код-снippets — создание минимального IFC

### ifcopenshell 0.8 — high-level API

```python
# engine/plana_engine/io/ifc/writer.py
import ifcopenshell
import ifcopenshell.api.project
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.api.context
import ifcopenshell.api.aggregate
import ifcopenshell.api.spatial
import ifcopenshell.api.geometry


def create_minimal_ifc(path: str, schema: str = "IFC4") -> None:
    """Создаёт IFC-файл с 1 проектом, 1 зданием, 1 этажом, 1 пространством, 1 стеной."""
    # 1. Пустая модель
    model = ifcopenshell.api.project.create_file(version=schema)

    # 2. Корневой IfcProject
    project = ifcopenshell.api.root.create_entity(
        model, ifc_class="IfcProject", name="plana-generated"
    )

    # 3. Единицы (метры по умолчанию — критично!)
    ifcopenshell.api.unit.assign_unit(model)

    # 4. GeometricRepresentationContext (без него геометрия не запишется)
    model_ctx = ifcopenshell.api.context.add_context(model, context_type="Model")
    body = ifcopenshell.api.context.add_context(
        model,
        context_type="Model",
        context_identifier="Body",
        target_view="MODEL_VIEW",
        parent=model_ctx,
    )

    # 5. Spatial hierarchy: Site → Building → Storey → Space
    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Astana plot")
    building = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuilding", name="ZhK A1")
    storey = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuildingStorey", name="Floor 1")
    space = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSpace", name="Living room")

    ifcopenshell.api.aggregate.assign_object(model, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(model, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(model, relating_object=building, products=[storey])
    ifcopenshell.api.aggregate.assign_object(model, relating_object=storey, products=[space])

    # 6. Стена
    wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWall", name="W-001")
    ifcopenshell.api.geometry.edit_object_placement(model, product=wall)
    wall_repr = ifcopenshell.api.geometry.add_wall_representation(
        model, context=body, length=5.0, height=3.0, thickness=0.2
    )
    ifcopenshell.api.geometry.assign_representation(model, product=wall, representation=wall_repr)
    ifcopenshell.api.spatial.assign_container(
        model, relating_structure=storey, products=[wall]
    )

    # 7. Запись (GUID-ы генерируются автоматически)
    model.write(path)
```

**Что тут важного:**
- `assign_unit(model)` без аргументов даёт SI/metric — это default для большинства KZ-проектов.
- `add_context` обязателен **до** создания любой геометрии — иначе `IfcShapeRepresentation` упадёт на validate.
- `add_wall_representation` — это **новый high-level helper из 0.8.x**. В 0.7 надо было руками собирать `IfcExtrudedAreaSolid`. Это и есть основная причина брать 0.8.
- GUID-ы генерируются модулем `ifcopenshell.guid` автоматически (22-символьная base64 IFC GUID, не raw UUID4).

### web-ifc — low-level (для сравнения)

```javascript
// Эквивалент на web-ifc в Node — гораздо больше boilerplate
import { IfcAPI, IFCWALL, IFCPROJECT } from "web-ifc";

const api = new IfcAPI();
await api.Init();

const modelID = api.CreateModel({ schema: "IFC4" });

// Каждая сущность — это вручную собранный массив параметров.
// Нет helpers а-ля add_wall_representation, всё руками.
const wallID = api.WriteLine(modelID, {
  type: IFCWALL,
  GlobalId: { type: 1, value: "0YvMmDvJj8AeRT$F9C9OxV" }, // надо генерить руками
  OwnerHistory: null,
  Name: { type: 1, value: "W-001" },
  // ...все 8 атрибутов IfcWall руками...
});

// Запись:
const ifcBuffer = api.SaveModel(modelID);
await fs.writeFile("out.ifc", Buffer.from(ifcBuffer));
api.CloseModel(modelID);
```

**Разница в эргономике колоссальная.** На web-ifc для wall+space с геометрией — это ~150 строк руками собранных STEP-сущностей. На ifcopenshell — 30 строк декларативно.

---

## Performance — что известно

### ifcopenshell

- Бейзлайн: ~20 МБ/с на парсинг (developer's own claim).
- Issue [#6712](https://github.com/IfcOpenShell/IfcOpenShell/issues/6712) показывает медленность на больших файлах: 12 МБ за 222 сек (но это явно баг или edge case, цифры выпадают из тренда; стандартный 50 МБ файл откроется за 5-15 сек).
- Issue [#569](https://github.com/IfcOpenShell/IfcOpenShell/issues/569) — для файлов с 100k+ элементов начинаются заметные проблемы.
- На наших ожидаемых нагрузках (квартирные планы, 5-50 МБ) — должно хватать с запасом.
- Память: для 200 МБ IFC ожидается ~1-2 ГБ RAM при полном парсинге с геометрией. Без геометрии (только метаданные) — меньше.

### web-ifc

- Official benchmark (на M1, 8GB): 70 МБ файл с 3.3M сущностей — 448 мс на parse. **Существенно быстрее** ifcopenshell по чистому парсингу.
- Использует "tape reader": не строит полный AST в памяти, читает по запросу. Низкий memory footprint.
- На сервере (Node) — те же цифры, что в браузере (тот же WASM).

### xbim

- Самый быстрый из тройки. Issue [#6712](https://github.com/IfcOpenShell/IfcOpenShell/issues/6712) (от автора xbim, biased!): 12 МБ — 2 сек, 80 МБ — 3 сек, 700 МБ — 46 сек.
- В резерве, если ifcopenshell не вытянет.

### Стратегия для plana

1. На MVP стартуем с `ifcopenshell` synchronous в FastAPI endpoint. Если файлы клиентов >50 МБ становятся типичны — заворачиваем в **background task** (Celery / RQ / FastAPI BackgroundTasks).
2. Если в продакшене упрёмся в latency — поднимаем `xbim` sidecar на gRPC.
3. **Кэшируем парсинг**: загруженный IFC хешируем (SHA-256), сериализуем `ifcopenshell.file` в pickle или экспортируем в IFCJSON (`ifcopenshell.api.serialize.ifcjson`), храним в Redis.

---

## Common pitfalls (`ifcopenshell` edition)

### 1. Единицы (UNITS)

- IFC хранит координаты в **project units**. Если в файле миллиметры, а ты ожидаешь метры — геометрия будет 1000× не той.
- `ifcopenshell.api.unit.assign_unit(model)` без аргументов = метры. Это default. Если получаешь файл от пользователя — **обязательно** прочитать `model.by_type("IfcProject")[0].UnitsInContext` и нормализовать.
- Внутри `ifcopenshell.geom` всегда возвращает метры независимо от project units — это исключение из правила.

### 2. GUID

- IFC GUID — это **не** UUID4. Это 22-символьная base64-кодировка 128-битного UUID.
- Используй `ifcopenshell.guid.new()` для генерации, `ifcopenshell.guid.compress(uuid)` / `expand(ifc_guid)` для конверсии.
- При создании через `ifcopenshell.api.root.create_entity` GUID назначается автоматически. Через low-level `model.create_entity` — НЕТ, нужно передать руками.

### 3. GeometricRepresentationContext

- Без `Model` context'а с identifier `Body` — большинство IFC viewer'ов не покажут геометрию.
- Каждый `IfcShapeRepresentation` ссылается на контекст. Контекстов в файле минимум 1 (Model), часто 2 (Model + Plan для 2D).
- `add_wall_representation` принимает `context=body` — это и есть тот самый Body context. Не путать с parent Model context.

### 4. Encoding

- IFC файлы — это STEP (ISO 10303-21), текстовый формат с **ISO-8859-1** или **UTF-8** в современных файлах.
- Spec говорит ISO-8859-1, но фактически 99% современных файлов в UTF-8.
- `ifcopenshell` справляется автоматически. Если что-то странное в кириллице — проверь header в первой строке файла: `HEADER; FILE_DESCRIPTION ((...), '2;1');`.
- При сериализации имён с кириллицей IFC использует X-encoding: `\X2\041F043B0430043D\X0\` для "План". `ifcopenshell` это делает прозрачно.

### 5. Placement hierarchy

- Каждый IFC product имеет `ObjectPlacement` — позицию относительно родителя.
- Иерархия: Wall.ObjectPlacement → Storey.ObjectPlacement → Building.ObjectPlacement → Site.ObjectPlacement → World.
- Если положить wall с absolute placement без правильного родителя — другие тулзы будут рисовать в неправильном месте.
- `ifcopenshell.api.geometry.edit_object_placement` по умолчанию вешает на storey, всё нормально.

### 6. OwnerHistory (legacy)

- В IFC2x3 каждая сущность ОБЯЗАНА иметь `OwnerHistory`. В IFC4 это `OPTIONAL`, но многие тулзы всё ещё его ожидают.
- `ifcopenshell.api.owner.create_owner_history` создаёт корректный history. Если опускаешь — будет `$` в STEP, и старые viewers (Solibri ≤2020) могут ругаться.

---

## Integration recipe — FastAPI

### Структура файлов

```
engine/plana_engine/
├── io/
│   ├── dxf/                    # уже есть, ezdxf
│   └── ifc/                    # новое
│       ├── __init__.py
│       ├── reader.py           # IFC → plana internal model
│       ├── writer.py           # plana internal model → IFC
│       ├── validators.py       # схема, единицы, GUID
│       └── conversions.py      # dxf <-> ifc bridge (опционально)
├── api/
│   └── routes/
│       └── ifc.py              # FastAPI endpoints
└── tests/
    └── ifc/
        ├── samples/            # маленькие IFC fixtures
        └── test_roundtrip.py
```

### `pyproject.toml`

```toml
[project]
dependencies = [
    "fastapi>=0.115",
    "ezdxf>=1.3",
    "ifcopenshell>=0.8.5,<0.9",   # LGPL-3.0, см. THIRD_PARTY_LICENSES.md
]
```

### FastAPI endpoint (схема)

```python
# engine/plana_engine/api/routes/ifc.py
from fastapi import APIRouter, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
import ifcopenshell
import io

from plana_engine.io.ifc import reader, writer

router = APIRouter(prefix="/ifc", tags=["ifc"])


@router.post("/import")
async def import_ifc(file: UploadFile):
    """Загрузка IFC, парсинг в plana internal model."""
    data = await file.read()
    try:
        model = ifcopenshell.file.from_string(data.decode("utf-8", errors="replace"))
    except Exception as e:
        raise HTTPException(400, f"Invalid IFC: {e}")

    project = reader.to_plana_project(model)  # наш маппинг
    return {"id": project.id, "schema": model.schema}


@router.post("/export")
async def export_ifc(project_id: str):
    """Экспорт plana project → IFC4."""
    project = ...  # достаём из БД
    model = writer.from_plana_project(project, schema="IFC4")

    # ifcopenshell пишет в файл — используем tmp или BytesIO
    buf = io.BytesIO()
    model.write(buf)  # 0.8.x умеет писать в file-like
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/x-step",
        headers={"Content-Disposition": f'attachment; filename="{project.name}.ifc"'},
    )
```

### Dockerfile

```dockerfile
# engine/Dockerfile
FROM python:3.11-slim-bookworm AS base

# ifcopenshell wheel содержит OCCT внутри, дополнительных system deps НЕТ.
# Но slim не содержит libgomp/libstdc++ — нужны для OCCT.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen

COPY engine/ ./engine/
CMD ["uvicorn", "engine.plana_engine.main:app", "--host", "0.0.0.0"]
```

**ВАЖНО — НЕ используй alpine:** `ifcopenshell` wheel'ы собраны под `manylinux_2_31` (glibc). Alpine на musl libc — wheel НЕ установится, придётся компилировать из исходников (а это OCCT + boost + CGAL — несколько часов сборки и >2 ГБ образ). Slim Debian — правильный выбор.

### `THIRD_PARTY_LICENSES.md`

В корне репо добавить блок:

```markdown
## ifcopenshell

- Лицензия: GNU LGPL-3.0
- Версия: 0.8.5
- Исходники: https://github.com/IfcOpenShell/IfcOpenShell
- Использование: динамическое (через `pip install`), без модификаций.
- Полный текст лицензии: см. node_modules/ifcopenshell/LICENSE или
  https://www.gnu.org/licenses/lgpl-3.0.html
```

---

## web-ifc на Node — стоит ли вообще?

Кратко: **на сервере НЕ нужен**, потому что у нас уже есть Python + ifcopenshell. Но как **client-side preview** в Next.js — отличный выбор.

**Если бы у нас был Node-backend** (которого нет):

Pros:
- MPL-2.0 проще LGPL юридически.
- Парсинг быстрее ifcopenshell.
- Одна экосистема с фронтом — TypeScript shared models.

Cons:
- Низкоуровневое API — писать через `WriteLine` каждую сущность вручную.
- WASM memory footprint в Node (10GB virtual reserve может ломаться на тонких VPS).
- Нет geometry engine уровня OCCT — нельзя сделать boolean операции на BREP, нельзя экспортировать в STEP.
- Меньше community-ресурсов и примеров.

### Использование web-ifc на клиенте (Phase 2)

Когда понадобится показать 3D-preview IFC прямо в браузере, без скачивания:

```typescript
// frontend/src/components/IfcPreview.tsx
'use client';
import { useEffect, useRef } from 'react';
import * as OBC from '@thatopen/components';

export function IfcPreview({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create();
    // ... setup three.js scene под капотом @thatopen/components
    const fragmentIfcLoader = components.get(OBC.IfcLoader);
    fragmentIfcLoader.load(url).then(model => world.scene.three.add(model));

    return () => components.dispose();
  }, [url]);

  return <div ref={ref} />;
}
```

Это **полностью клиентский** код. Сервер отдаёт `.ifc` файл, браузер парсит через WASM. Подходит для preview, не для editing.

---

## Альтернативы — реалистичная карта 2026

| Tool | Когда брать | Сейчас? |
|---|---|---|
| **`ifcopenshell` (Python)** | Серверный движок IFC в Python-стеке | **ДА — основной** |
| **`web-ifc` (WASM)** | Клиентский preview в браузере | **ДА — для preview, Phase 2** |
| **`@thatopen/components`** | UI-обёртка над web-ifc (Three.js viewer) | **ДА — для Phase 2 viewer** |
| `xbim` (.NET) | Если perf ifcopenshell не хватит | резерв |
| `IfcOpenShell-bonsai` (ex-BlenderBIM) | UI-патерны IFC authoring | референс, не зависимость |
| `IFC++` (C++) | Нативный C++ проект | не наш кейс |
| `IFCSharp` | Если бы был .NET-стек | не наш кейс |
| `IFC2JSON` CLI | Простая конверсия IFC → JSON для микросервиса | не нужно, ifcopenshell умеет |
| `geometry-gym` | Commercial .NET | нет |

### Про IFC5

`IFC5` сейчас (2026-05) в **alpha**. Полное переосмысление структуры данных, базируется на USD/Pixar. На прод не выходит, оба наших кандидата (ifcopenshell и web-ifc) **его не поддерживают**. Не закладываемся.

---

## Контрольные точки внедрения

1. **MVP IFC import** — POC endpoint `/ifc/import`, читает любой IFC2x3/IFC4, возвращает список комнат + стен. Время: 3-5 дней.
2. **MVP IFC export** — endpoint `/ifc/export`, создаёт IFC из plana project (с walls + spaces + storey). Roundtrip test. Время: 5-7 дней.
3. **Validation layer** — `ifcopenshell.validate` + наши KZ-специфичные проверки (метры обязательны, IfcSpace.Name → имя комнаты на ru/kk). Время: 2-3 дня.
4. **DXF ↔ IFC bridge** — opcional, можно конвертировать DXF (от Phase 1) в IFC. Через `engine/plana_engine/io/conversions.py`. Время: 5-10 дней (нетривиально).
5. **3D preview** — `@thatopen/components` в Next.js. Время: 2-3 дня (для базового viewer'а).

---

## Источники

- [IfcOpenShell — GitHub](https://github.com/IfcOpenShell/IfcOpenShell) — 2.5k stars, LGPL-3.0
- [IfcOpenShell — PyPI 0.8.5 (Apr 2026)](https://pypi.org/project/ifcopenshell/) — wheels для py3.10-3.14, manylinux 2.31
- [IfcOpenShell 0.8.5 docs — code examples](https://docs.ifcopenshell.org/ifcopenshell-python/code_examples.html)
- [IfcOpenShell installation](https://docs.ifcopenshell.org/ifcopenshell-python/installation.html)
- [`ifcopenshell.api.spatial.assign_container`](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/spatial/assign_container/index.html)
- [`ifcopenshell.api.root.create_entity`](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/root/create_entity/index.html)
- [ifcopenshell perf vs xbim — issue #6712](https://github.com/IfcOpenShell/IfcOpenShell/issues/6712)
- [ifcopenshell large file perf — issue #569](https://github.com/IfcOpenShell/IfcOpenShell/issues/569)
- [ifcopenshell — IfcOpenHouse tutorial (OSArch)](https://community.osarch.org/discussion/1471/ifcopenhouse-step-by-step-tutorial-with-the-ifcopenshell-python-api)
- [ThatOpen/engine_web-ifc — GitHub](https://github.com/ThatOpen/engine_web-ifc) — 955 stars, MPL-2.0
- [web-ifc benchmark.md](https://github.com/IFCjs/web-ifc/blob/main/benchmark.md) — M1, 70 МБ за 448 мс
- [That Open docs — IfcLoader tutorial](https://docs.thatopen.com/Tutorials/Components/Core/IfcLoader)
- [web-ifc npm](https://www.npmjs.com/package/web-ifc) — v0.77
- [buildingSMART IFC schemas](https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/)
- [buildingSMART IFC5-development](https://github.com/buildingSMART/IFC5-development) — alpha
- [Mozilla Public License 2.0 (FOSSA explainer)](https://fossa.com/blog/open-source-software-licenses-101-mozilla-public-license-2-0/)
- [LGPL-3.0 commercial use (FOSSA explainer)](https://fossa.com/blog/open-source-software-licenses-101-lgpl-license/)
- [LGPL and Python dynamic linking](https://licensecheck.io/blog/lgpl-dynamic-linking)
- [xbim Toolkit](https://docs.xbim.net/) — XbimEssentials 6.x supports .net8.0
- [Xbim with Python](https://xbim.net/xbim-with-python-ifc/) — IPC pattern
- [Bonsai (ex-BlenderBIM)](https://bonsaibim.org/) — built on ifcopenshell
- [ifcplusplus — GitHub](https://github.com/ifcquery/ifcplusplus) — C++, no Python bindings yet
- [IfcOpenShell Optimizer tutorial](https://academy.ifcopenshell.org/posts/ifcopenshell-optimizer-tutorial/)
- [IfcOpenShell Docker images repo](https://github.com/IfcOpenShell/Dockerfile)
- [Wasm in Node memory issue #56596](https://github.com/nodejs/node/issues/56596) — 10GB virtual reserve
