"""CLI обёртка над движком (для отладки и приёмки этапа 1 ТЗ §10).

    plana-engine generate --width 60 --depth 40 --floors 9
    plana-engine generate --dxf path/to/floor.dxf
    plana-engine catalog
    plana-engine norms
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .algo import generate_all_variants
from .catalog import get_catalog
from .norms import get_norms
from .parser import parse_dxf, parse_rect
from .types import GenerateRequest, TargetMix


def _cmd_generate(args: argparse.Namespace) -> int:
    if args.dxf:
        contour = parse_dxf(args.dxf)
        source = f"dxf:{Path(args.dxf).name}"
    else:
        contour = parse_rect(args.width, args.depth)
        source = f"rect:{args.width}×{args.depth}m"

    target_mix = None
    if args.mix:
        try:
            studio, k1, k2, k3 = (float(x) for x in args.mix.split(","))
            target_mix = TargetMix(studio=studio, k1=k1, k2=k2, k3=k3)
        except ValueError:
            print(f"!! invalid --mix {args.mix!r}, expected 'studio,k1,k2,k3' percentages",
                  file=sys.stderr)
            return 2

    req = GenerateRequest(
        floor_polygon=contour,
        floors=args.floors,
        target_mix=target_mix,
    )
    plans, ms = generate_all_variants(req)

    if args.json:
        # серилизация Plan через model_dump
        payload = {
            "source": source,
            "elapsed_ms": ms,
            "variants": [p.model_dump(mode="json") for p in plans],
        }
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    print(f"source: {source}")
    print(f"floors: {args.floors}")
    print(f"variants: {len(plans)}  elapsed: {ms} ms")
    print()
    print(f"  {'preset':<18} {'apts':>4} {'saleable':>10} {'ratio':>6} {'avg':>6} {'south':>6} {'norms':<8} {'mix'}")
    print("  " + "-" * 100)
    for p in plans:
        m = p.metrics
        by_type = "+".join(f"{k.value}:{v}" for k, v in m.apt_by_type.items())
        print(
            f"  {p.preset.value:<18} {m.apt_count:>4d} {m.saleable_area:>9.1f}m² "
            f"{m.saleable_ratio:>6.2f} {m.avg_apt_area:>5.1f}m² "
            f"{m.south_oriented_share*100:>4.0f}%  "
            f"{'OK ' if p.norms.passed else 'FAIL':<8}{by_type}"
        )
        for v in p.norms.violations:
            print(f"      {v.severity.upper():7s} [{v.rule_id}] {v.message}")
    return 0


def _cmd_catalog(args: argparse.Namespace) -> int:
    cat = get_catalog()
    print(f"catalog: {len(cat)} tiles")
    print(f"  {'code':<8} {'type':<7} {'area':>6} {'width':>6} {'depth':>6} {'zones':>6}  label")
    print("  " + "-" * 70)
    for t in cat:
        print(
            f"  {t.code:<8} {t.apt_type.value:<7} {t.area:>5.1f}m² "
            f"{t.width:>5.1f}m {t.depth:>5.1f}m {len(t.zones):>5}  {t.label}"
        )
    return 0


def _cmd_norms(args: argparse.Namespace) -> int:
    n = get_norms()
    print(f"norms version: {n.version}  region: {n.region}")
    if n.last_review:
        print(f"last review: {n.last_review} by {n.reviewer}")
    else:
        print("⚠  norms have NOT been reviewed by an architect (см. ТЗ §7.4)")
    print()
    print(f"  corridor.min_width: {n.corridor.min_width_m} m")
    print(f"  corridor.max_evacuation_length: {n.corridor.max_evacuation_length_m} m")
    print(f"  rooms.living_room.min_area: {n.rooms.living_room.min_area_sqm} m²")
    print(f"  rooms.kitchen.min_area: {n.rooms.kitchen.min_area_sqm} m²")
    print(f"  rooms.bathroom.min_area: {n.rooms.bathroom.min_area_sqm} m²")
    print(f"  insolation.min_hours: {n.insolation.min_hours_per_day}")
    print(f"  tile.tolerance: ±{n.tile.size_tolerance*100:.0f}%")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="plana-engine",
        description=f"Plana — алгоритмическое ядро генерации планировок (v{__version__})",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    pg = sub.add_parser("generate", help="Сгенерировать 5 вариантов планировок")
    pg.add_argument("--width", type=float, default=60.0, help="ширина прямоугольного контура, м")
    pg.add_argument("--depth", type=float, default=40.0, help="глубина прямоугольного контура, м")
    pg.add_argument("--dxf", type=str, default=None, help="DXF-файл с контуром (вместо rect)")
    pg.add_argument("--floors", type=int, default=1, help="число этажей (для итогов)")
    pg.add_argument("--mix", type=str, default=None,
                    help="целевая квартирография: studio,k1,k2,k3 (доли 0..1)")
    pg.add_argument("--json", action="store_true", help="JSON в stdout вместо таблицы")
    pg.set_defaults(func=_cmd_generate)

    pc = sub.add_parser("catalog", help="Показать каталог тайлов")
    pc.set_defaults(func=_cmd_catalog)

    pn = sub.add_parser("norms", help="Показать загруженные нормы")
    pn.set_defaults(func=_cmd_norms)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
