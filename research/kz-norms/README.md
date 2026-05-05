# Строительные нормы Республики Казахстан — ресерч-база

База знаний по нормативам строительства РК для использования в промптах
и валидационных правилах Plana. Каждый файл — отдельная предметная
область с актуальными СН РК / СП РК, числовыми требованиями и ссылками
на источники.

Всего 12 разделов, ~2000 строк, собрано параллельно через 12 ресерч-агентов
с WebSearch.

## Содержание

| Файл | Тема | Строк |
|---|---|---|
| [structure.md](structure.md) | Структура нормативной базы РК (СН РК / СП РК, иерархия, переход с СНиП) | 102 |
| [residential.md](residential.md) | Жилые здания: квартиры, помещения, объёмно-планировочные требования | 233 |
| [fire-safety.md](fire-safety.md) | Пожарная безопасность: эвакуация, противопожарные отсеки, СОУЭ | 156 |
| [insolation.md](insolation.md) | Инсоляция и естественное освещение (СанПиН) | 150 |
| [stairs-lifts.md](stairs-lifts.md) | Лестнично-лифтовые узлы: количество, размеры, нормы | 174 |
| [parking.md](parking.md) | Паркинг и стоянки автомобилей: машино-места, проезды | 164 |
| [public-buildings.md](public-buildings.md) | Общественные здания: гостиницы, офисы, ТРЦ | 208 |
| [seismic.md](seismic.md) | Сейсмостойкое строительство РК | 138 |
| [thermal.md](thermal.md) | Тепловая защита и энергоэффективность | 137 |
| [accessibility.md](accessibility.md) | Доступная среда (МГН) | 166 |
| [urban-planning.md](urban-planning.md) | Градостроительство, ГПЗУ, отступы, плотность застройки | 187 |
| [engineering-systems.md](engineering-systems.md) | Инженерные системы: ОВК, ВК, электрика, мусороудаление | 223 |

## Применение в Plana

- **Промпты**: ключевые числовые требования (ширина коридора 1.4 м,
  эвакуационный путь ≤ 25 м, и т.д.) попадают в `marketing_prompt.py`
  через `MarketingInputs`. AI-чертежи рисуются с учётом СН РК.
- **ГПЗУ-импорт** ([`importers/gpzu.py`](../../engine/plana_engine/importers/gpzu.py)):
  правила извлечения опираются на знание о структуре ГПЗУ из
  [urban-planning.md](urban-planning.md).
- **Vision-анализ контура** ([`importers/contour.py`](../../engine/plana_engine/importers/contour.py)):
  рекомендации модели на русском соответствуют категориям из
  [insolation.md](insolation.md), [fire-safety.md](fire-safety.md),
  [accessibility.md](accessibility.md).
- **Edit-mode**: при правке плана через `editAiPlan` контекстный
  промпт можно обогатить ссылками на конкретные пункты СН РК.

## Карта зависимостей по purpose

| purpose | Релевантные разделы |
|---|---|
| `residential` | residential, fire-safety, insolation, stairs-lifts, accessibility, thermal |
| `commercial`  | public-buildings, fire-safety, parking, accessibility, thermal |
| `mixed_use`   | residential + public-buildings + parking + fire-safety (с разделением отсеков) |
| `hotel`       | public-buildings, fire-safety, insolation, accessibility |

Сейсмика и градостроительство применимы ко всем `purpose`.

## Дисклеймер

Ресерч собран автоматически через WebSearch на 2026-05-05. Перед
использованием в реальных проектах **обязательно** ревью
квалифицированного архитектора и сверка с актуальными редакциями
СН РК / СП РК на [adilet.zan.kz](https://adilet.zan.kz/) и
[stroyrazvitie.kz](https://stroyrazvitie.kz/).

Регуляторные документы регулярно обновляются — особенно после
сейсмических событий и реформ технического регулирования.
