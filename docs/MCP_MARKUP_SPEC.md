# ТЗ: MCP-сервер авто-маркировки Revit (ДО → ПОСЛЕ)

> Статус: спецификация (не реализовано). Модуль отдельный от движка посадки.
> Последнее обновление: 2026-06-15.

## 0. Можем ли? — ДА. Доказательства (не с нуля)

| Что | Уже существует (open source) | Роль у нас |
|---|---|---|
| MCP-каркас | [`modelcontextprotocol/python-sdk`](https://github.com/modelcontextprotocol/python-sdk) (FastMCP) | каркас нашего MCP-сервера |
| Локальный исполнитель Revit | [`pyRevit`](https://github.com/pyrevitlabs/pyRevit) + **Routes** (HTTP-API внутри Revit, порт 48884) | гонять Revit API локально, бесплатно |
| Готовый Revit-MCP (форк-база) | [`Demolinator/revit-mcp-server`](https://github.com/Demolinator/revit-mcp-server) (pyRevit, 48 тулов вкл. documentation) · [`LuDattilo/revit-mcp-server`](https://github.com/LuDattilo/revit-mcp-server) (80+ тулов) | стартовая база, добавляем СПДС-тулы |
| Облачный MCP (прод) | [`autodesk-platform-services/aps-sample-mcp-server-revit-automation`](https://github.com/autodesk-platform-services/aps-sample-mcp-server-revit-automation) (SSA, работает с Claude) | форк под облачный «загрузил→скачал» |
| Облачный исполнитель | [`autodesk-platform-services/aps-sample-revit-mcp-tools-bundle`](https://github.com/autodesk-platform-services/aps-sample-revit-mcp-tools-bundle) (AppBundle, Revit 2026) | headless-Revit в облаке APS |
| Revit API примеры | [`jeremytammik/RevitSdkSamples`](https://github.com/jeremytammik/RevitSdkSamples) | образцы тегов/ведомостей/листов |
| Паттерн Skill→JSON→add-in | [archsmarter](https://www.archsmarter.com/blog/ai-sketch-to-revit-model) | переиспользуем JSON-контракт + review-viewer |

**Вывод:** свой MCP делаем = форк одного из community-серверов (локально, pyRevit) + надстройка наших СПДС-тулов; для облака — форк официальных APS-сэмплов. Своё пишем только **СПДС-логику маркировки + конвенцию нумерации + штамп**.

---

## 1. Цель и scope

**Вход:** RVT (до) — раздел **АР, типовой этаж**, с размещёнными помещениями и проёмами.
**Выход:** RVT (после) + PDF — с маркировкой как в эталоне `docs/Files MUST TEAM/Оформление/После.pdf`.

**В scope MVP:**
- теги помещений (наименование + площадь);
- марки квартир (тип + таблица площадей жилая/общая/с коэф.);
- марки проёмов: **ОК-N** (окна), **Д-N** (двери), **ПД-N** (подоконная доска), **ВВ-N** (вытяжки);
- площади лоджий/балконов с КЗ-коэффициентом;
- отметки уровня пола;
- ведомости: экспликация полов, ведомость внутр. отделки, спецификация заполнения проёмов, ведомость вытяжек;
- заполнение штампа; экспорт PDF.

**НЕ в scope (позже):** КЖ/ОВ/ВК/ЭОМ маркировка, разрезы, кладочные планы, СОЗДАНИЕ геометрии (стены/окна — это пункт 2 / эскиз→модель).

---

## 2. Архитектура (один MCP, два исполнителя)

```
Гермес / Claude  ──►  НАШ MCP-сервер (FastMCP, Python)
                         │   tools: markup_revit + гранулярные
                         ├──►  [DEV]  pyRevit Routes  ──► локальный Revit ──► RVT после
                         └──►  [PROD] APS Design Automation ──► headless-Revit (облако) ──► RVT после
```

- **DEV / Фаза 0–1:** pyRevit Routes на машине Must Team (бесплатно, есть Revit + ревитчик).
- **PROD / Фаза 2:** APS Design Automation — облачный «загрузил RVT → скачал RVT», без локального Revit (оплата кредитами).
- **Один и тот же набор СПДС-тулов** за обоими исполнителями (абстракция executor).

Состояние: DEV — долгоживущая Revit-сессия (пошаговое агентное редактирование); PROD — stateless WorkItem на вызов.

---

## 3. Спецификация MCP-тулов

### 3.1 Высокоуровневый (one-shot, детерминированный — 85%)
```
markup_revit(input_rvt: file|url, options: MarkupOptions) -> MarkupResult
  MarkupOptions = {
    convention_id: str,          # профиль нумерации/штампа (Must Team)
    stage: "RP",                 # стадия
    sheets: ["AR_typical"],      # что оформлять
    export_pdf: bool = true,
    review: bool = true          # вернуть на ревью перед финалом
  }
  MarkupResult = {
    output_rvt: url, pdf: url,
    report: { rooms_tagged, openings_numbered, schedules_built,
              unresolved: [ {element_id, reason} ] },   # ~15% на ревью
    diff: url   # до/после превью
  }
```

### 3.2 Гранулярные (агентные — добивка ~15%)
| Тул | Вход | Выход |
|---|---|---|
| `open_model` | rvt | session_id |
| `list_rooms` | session | [{id, name, area, boundary, level}] |
| `list_openings` | session | [{id, kind:window\|door, host, width, height, mark}] |
| `list_apartments` | session | [{number, type, rooms[], areas}] |
| `classify_room` | room_id, hint | {name, kind} (AI, если имя пустое) |
| `number_openings` | session, convention_id | {ОК:[...], Д:[...], ПД:[...], ВВ:[...]} |
| `tag_rooms` | session, layout_rules | placed_tags[] |
| `tag_openings` | session | placed_tags[] |
| `set_level_marks` | session | placed[] |
| `build_schedule` | session, kind:"floors\|finish\|fill\|vent" | schedule_view_id |
| `fill_titleblock` | session, titleblock_data | ok |
| `place_on_sheet` | session, sheet_template | sheet_id |
| `export_pdf` | session, sheet_id | pdf_url |
| `save_model` | session | output_rvt |
| `diff_before_after` | input_rvt, output_rvt | diff_url |

Контракт данных между шагами — **JSON** (как в archsmarter): `revitmodel.json` (что прочитали) + `toolinputs.json` (что применяем). Это же отдаётся в **review-viewer** (Next) перед финальным `save_model`.

---

## 4. Маркировочный движок (внутренности, детерминированно)

**Чтение модели:** Rooms (Name, Area, boundary, Level), окна/двери (FamilyInstance + host + габариты + параметр Mark), группировка квартир.

**Вычисление марок:**
- ярлык помещения = `Name + " " + round(Area, 2)`;
- марка квартиры = `тип (1к/2к/3к/студия) + таблица [жилая / общая / с коэф.]`;
- коэффициенты площадей (КЗ) — модуль норм: балкон/лоджия/терраса (подтвердить по СНиП РК);
- нумерация ОК/Д/ПД/ВВ — по `convention_id` (порядок обхода, префиксы) → марка = **ключ в ведомость**;
- отметка уровня = из Level.

**Применение (Revit API):** `IndependentTag.Create` для помещений/проёмов; запись параметра `Mark`; `ViewSchedule.CreateSchedule` для ведомостей; запись параметров штампа; размещение на листе; `ExportPDF`.

**Модуль СПДС-правил** (наш IP): префиксы марок, порядок нумерации, словарь наименований помещений, коэффициенты площадей, шаблон штампа, правила читаемого размещения тегов (анти-наложение).

---

## 5. Пайплайн ДО → ПОСЛЕ (шаги)

1. Приём RVT → валидация (версия Revit; помещения размещены?; семейства несут Mark?).
2. `open_model`.
3. `classify_room` для безымянных (AI-ассист).
4. `number_openings(convention)`.
5. `tag_rooms` + `tag_openings` + `set_level_marks`.
6. `build_schedule` ×4 (полы / отделка / заполнение / вытяжки).
7. `fill_titleblock`.
8. `place_on_sheet` → `export_pdf`.
9. `save_model` → RVT после; `diff_before_after`.
10. (Опц.) review-viewer: показать до/после, принять/подвинуть ~15% → пере-`save`.

---

## 6. Что нужно от Must Team (вход-блокеры)

1. **Конвенция нумерации** ОК/Д/ПД/ВВ (порядок, префиксы) — линчпин (марки = ключи ведомостей).
2. **Шаблон штампа** (семейство + параметры) + правило именования листов (`696_…_AR01_01`).
3. **Словарь наименований помещений** (стандарт/сокращения).
4. **КЗ-коэффициенты площадей** (балкон/лоджия/терраса) — подтвердить по СНиП.
5. **2–3 пары ДО/После** как golden-тесты (есть `696_…_AR.rvt` + `После.pdf`).
6. **Версия Revit** их моделей.

---

## 7. Инфраструктура / аккаунты / люди

- **DEV:** Windows + Revit (нужной версии) + pyRevit (с включёнными Routes). Есть у Must Team.
- **PROD:** аккаунт **Autodesk Platform Services (APS)** + кредиты Design Automation; OSS-бакеты; OAuth/SSA.
- **Языки:** Python (FastMCP, наш MCP + pyRevit-скрипты); .NET/C# (AppBundle для APS).
- **Люди:** Гермес пишет add-in/скрипты; ревитчик Must Team валидирует против эталона.

**Auth/security:** pyRevit Routes — без auth → только localhost + токен. APS — SSA (service-to-service). Наш MCP — API-ключ; облачный путь крутится в нашей FastAPI-инфре.

---

## 8. Фазы и критерии готовности (DoD)

| Фаза | Что | DoD |
|---|---|---|
| **0. Логика** | pyRevit-скрипт маркировки на `696_…_AR.rvt` (без MCP) | выход визуально совпадает с `После.pdf` (теги/нумерация/ведомости/штамп) на golden-паре |
| **1. MCP локально** | обернуть логику в наш MCP (FastMCP) поверх pyRevit Routes; форк `Demolinator/revit-mcp-server` | Гермес вызывает `markup_revit` → получает RVT после локально; гранулярные тулы работают |
| **2. Облако** | executor → APS Design Automation; web upload→download; review-viewer | пользователь грузит RVT в браузере → скачивает RVT+PDF после; ~85% без правок, ~15% через ревью |

---

## 9. Риски

- **RVT version lock** — Revit не открывает более новые версии; APS поддерживает набор движков → спрашивать/апгрейдить.
- **Помещения не размещены / семейства без Mark** → тегу нечего читать (частичный результат). У Must Team модель ОК.
- **Наложение тегов** → нужен геометрический анти-overlap (читаемость, «без осей»).
- **Стоимость APS** (кредиты за WorkItem).
- **pyRevit Routes — draft, без auth** → свой токен/изоляция.
- **Лицензирование:** APS Design Automation = санкционированный headless-Revit (десктопный Revit headless на серверах нарушает EULA).

---

## 10. Первые шаги (actionable)

1. Запросить у Must Team 6 пунктов из §6.
2. Поднять DEV: Revit + pyRevit + Routes (порт 48884); форкнуть `Demolinator/revit-mcp-server`, прогнать дефолтные тулы.
3. Зарегистрировать APS-аккаунт (бесплатно), изучить `aps-sample-mcp-server-revit-automation` + `aps-sample-revit-mcp-tools-bundle`.
4. Гермес: Фаза 0 — скрипт маркировки на `696_…_AR.rvt`, сверка с `После.pdf`.
