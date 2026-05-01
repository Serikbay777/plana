"""Алгоритмическое ядро согласно ТЗ §5.

Пайплайн (6 шагов):
  1. Парсинг контура — модуль `parser`
  2. Размещение ядра (лифт+лестница+шахта) — `algo.core`
  3. Прокладка коридоров — `algo.corridor`
  4. Нарезка фасадных зон на слоты — `geometry.slots`
  5. Укладка тайлов в слоты по целевой функции — `algo.tile` + `presets`
  6. Нормоконтроль — `validator`

Главный вход: `algo.pipeline.generate_variant`.
"""

from .pipeline import generate_all_variants, generate_variant

__all__ = ["generate_all_variants", "generate_variant"]
