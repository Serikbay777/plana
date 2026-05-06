"""База знаний казахстанских строительных норм для prompt-enhancer'а.

Загружает markdown-файлы из `research/kz-norms/` при импорте и предоставляет:
    • `select_relevant_norms(inputs)` — детерминистский селектор: по `purpose`
       и параметрам формы выбирает 3-6 релевантных разделов из 12.
    • `build_norms_context(inputs)` — собирает текст из выбранных разделов
       в один блок, готовый для скармливания в LLM как system context.

Зачем не LLM-селектор: так дешевле и предсказуемее. Если жилое здание —
точно нужны residential + insolation + fire-safety. Если коммерческое —
public-buildings вместо residential. Это знание зашито в `_PURPOSE_NORMS`
mapping ниже.

Файлы лежат на путях, относительных от корня репозитория:
    research/kz-norms/{name}.md
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


# ── путь к базе ─────────────────────────────────────────────────────────────

# engine/plana_engine/visualizer/kz_norms.py → repo_root/research/kz-norms/
_KZ_NORMS_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent / "research" / "kz-norms"
)


# ── каталог разделов (краткий индекс — для возможного будущего LLM-селектора) ─

@dataclass(frozen=True)
class NormSection:
    """Один раздел базы знаний РК."""
    key: str            # имя файла без .md, e.g. "residential"
    title: str          # человекочитаемое название
    summary: str        # 1-2 предложения о содержимом
    always_include: bool = False  # включать всегда (например, urban-planning)


KZ_NORMS_CATALOG: tuple[NormSection, ...] = (
    NormSection(
        key="urban-planning",
        title="Градостроительство и ГПЗУ",
        summary="Отступы, плотность, КИТ, бытовые разрывы, ориентация. Применимо ВСЕГДА.",
        always_include=True,
    ),
    NormSection(
        key="fire-safety",
        title="Пожарная безопасность",
        summary="Эвакуация ≤ 25 м, тупиковые коридоры ≤ 12 м, "
                "огнестойкость, СОУЭ. Применимо ВСЕГДА.",
        always_include=True,
    ),
    NormSection(
        key="residential",
        title="Жилые здания (СНиП РК 3.02-43-2007 / СН РК 3.02-01-2023)",
        summary="Минимальные площади помещений (гостиная 16 м², спальня 8 м², "
                "кухня 9 м²), ширины коридоров, инсоляция квартир.",
    ),
    NormSection(
        key="insolation",
        title="Инсоляция и естественное освещение",
        summary="Зоны 48° с.ш. (Алматы — южная, 1.5–2 ч; Астана — центральная, 2 ч). "
                "КЕО, СанПиН 2022, ориентация окон.",
    ),
    NormSection(
        key="public-buildings",
        title="Общественные здания (гостиницы, офисы, ТРЦ)",
        summary="Гостиничные номера ≥ 12 м², эвакуация в общественных зданиях, "
                "санузлы по сменности персонала, лифты для МГН.",
    ),
    NormSection(
        key="stairs-lifts",
        title="Лестнично-лифтовые узлы",
        summary="Минимум 2 лифта при ≥ 6 этажей жилья, ширина лестничного "
                "марша ≥ 1.05 м, площадки, габариты кабин.",
    ),
    NormSection(
        key="parking",
        title="Паркинг и стоянки автомобилей",
        summary="0.7-1.0 машино-мест на квартиру, габариты МГН-стоянок 3.6×6.0 м, "
                "отступы парковок от окон жилья ≥ 10 м.",
    ),
    NormSection(
        key="seismic",
        title="Сейсмостойкость (актуально для Алматы, Шымкента)",
        summary="Зоны 7-9 баллов, требования к жёсткости каркаса, "
                "ограничения по этажности при II-III степени огнестойкости.",
    ),
    NormSection(
        key="thermal",
        title="Тепловая защита",
        summary="Сопротивление теплопередаче стен и окон по климат-зонам, "
                "энергоэффективность класса B+ обязательна с 2024.",
    ),
    NormSection(
        key="accessibility",
        title="Доступная среда (МГН)",
        summary="Пандусы 1:12, ширина дверей ≥ 0.9 м, "
                "лифт МГН с кабиной ≥ 1.1×1.4 м, тактильная плитка.",
    ),
    NormSection(
        key="engineering-systems",
        title="Инженерные системы (ОВК, ВК, электрика, мусороудаление)",
        summary="Венткамеры на крыше, мусоропроводы, электрощитовые, "
                "размещение шахт в проектах жилья.",
    ),
    NormSection(
        key="structure",
        title="Структура нормативной базы РК (СН/СП РК)",
        summary="Иерархия документов и их статус. Метаинформация — обычно "
                "не нужна в промпте, добавлять только если запросили обзор.",
    ),
)


# ── детерминистский селектор по purpose + параметрам ────────────────────────

# Mapping purpose → ключи разделов, специфичные для этого назначения
_PURPOSE_NORMS: dict[str, tuple[str, ...]] = {
    "residential": ("residential", "insolation"),
    "mixed_use":   ("residential", "insolation", "public-buildings"),
    "hotel":       ("public-buildings",),
    "commercial":  ("public-buildings",),
}


def select_relevant_norms(
    *,
    purpose: str,
    floors: int,
    lifts_passenger: int = 0,
    parking_spaces_per_apt: float = 0.0,
    seismic_zone: bool = True,  # по умолчанию считаем РК сейсмическим (Алматы)
    include_structure_meta: bool = False,
) -> list[NormSection]:
    """Выбрать релевантные разделы kz-norms по параметрам формы.

    Стратегия:
        • Всегда: разделы с `always_include=True` (urban-planning, fire-safety)
        • По назначению: residential / public-buildings / etc. через _PURPOSE_NORMS
        • Если ≥ 3 этажей или есть пасс. лифты → stairs-lifts
        • Если есть паркинг → parking
        • Если sеismic_zone и многоэтажка → seismic
        • Жилое или общественное с МГН → accessibility
        • include_structure_meta — для редких случаев когда нужен обзор

    Возвращает список NormSection в стабильном порядке (как в каталоге).
    """
    selected: set[str] = set()

    # 1. always_include
    for s in KZ_NORMS_CATALOG:
        if s.always_include:
            selected.add(s.key)

    # 2. по назначению
    selected.update(_PURPOSE_NORMS.get(purpose, ()))

    # 3. лестнично-лифтовые
    if floors >= 3 or lifts_passenger >= 1:
        selected.add("stairs-lifts")

    # 4. паркинг
    if parking_spaces_per_apt > 0.01:
        selected.add("parking")

    # 5. сейсмика — если многоэтажка в сейсмозоне
    if seismic_zone and floors >= 5:
        selected.add("seismic")

    # 6. доступность — для всего, что массово посещается
    if purpose in ("residential", "mixed_use", "hotel", "commercial"):
        selected.add("accessibility")

    # 7. термозащита — для жилья и гостиниц всегда
    if purpose in ("residential", "mixed_use", "hotel"):
        selected.add("thermal")

    # 8. инженерные системы — если многоэтажка
    if floors >= 5:
        selected.add("engineering-systems")

    # 9. structure-meta — опционально
    if include_structure_meta:
        selected.add("structure")

    # стабильный порядок: сохраняем последовательность каталога
    return [s for s in KZ_NORMS_CATALOG if s.key in selected]


# ── чтение файлов ───────────────────────────────────────────────────────────

@lru_cache(maxsize=32)
def _read_norm_file(key: str) -> str:
    """Прочитать markdown-файл одного раздела. Кешируется навсегда."""
    path = _KZ_NORMS_DIR / f"{key}.md"
    if not path.exists():
        return f"# {key}\n\n(файл {path} не найден — пропуск)\n"
    return path.read_text(encoding="utf-8")


def build_norms_context(
    sections: list[NormSection],
    *,
    max_chars_per_section: int = 8000,
) -> str:
    """Собрать текст выбранных разделов в один блок для system prompt'а.

    Каждый раздел обрезается до `max_chars_per_section` символов, чтобы общий
    контекст не разорвал контекст-окно даже на маленьких моделях.
    """
    chunks: list[str] = []
    for s in sections:
        text = _read_norm_file(s.key)
        if len(text) > max_chars_per_section:
            text = text[:max_chars_per_section] + "\n\n[…обрезано…]\n"
        chunks.append(
            f"=== {s.title} (раздел `{s.key}`) ===\n\n{text}\n"
        )
    return "\n\n".join(chunks)


def list_available_sections() -> list[str]:
    """Список всех ключей разделов — для отладки/UI."""
    return [s.key for s in KZ_NORMS_CATALOG]
