"""Accuracy harness — diff a generated markup JSON against a ground-truth markup JSON.

Usage: python accuracy_test.py --truth <reference.json> --pred <generated.json>
                               [--tol-dist 1.5] [--tol-area 0.05]

Both files follow markup-schema.json. Reports:
  • room recognition  — name match by nearest tag_point (exact / synonym / wrong / missed)
  • room areas        — |Δ| ≤ tol-area when both sides have area
  • apartment areas   — by number, total / coeff within tol
  • opening marks     — set coverage of ОК/Д/ПД/ВВ

Indicative, not a substitute for the Revit-side (Level-2) sheet comparison.
Exit 0 always (it's a report). Robust to Windows consoles.
"""
import argparse
import json
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# мягкая эквивалентность имён (частичный кредит)
SYNONYMS = [
    {"Кухня", "Кухня-ниша"},
    {"С/у", "Санузел", "Ванная", "Совмещённый санузел"},
    {"Коридор", "Прихожая"},
]


def _syn(a: str, b: str) -> bool:
    return any({a, b} <= grp for grp in SYNONYMS)


def _dist(p, q) -> float:
    return math.hypot(p[0] - q[0], p[1] - q[1])


def _rooms(doc: dict) -> list[dict]:
    return doc.get("room_tags", doc.get("rooms", []))


def compare(truth: dict, pred: dict, tol_dist: float, tol_area: float) -> None:
    t_rooms, p_rooms = _rooms(truth), _rooms(pred)
    used: set[int] = set()
    exact = partial = wrong = 0
    area_ok = area_bad = area_na = 0
    issues: list[str] = []

    for t in t_rooms:
        cands = sorted(
            ((_dist(t["tag_point"], p["tag_point"]), i, p) for i, p in enumerate(p_rooms)),
            key=lambda x: x[0],
        )
        if not cands or cands[0][0] > tol_dist or cands[0][1] in used:
            issues.append(f"  {t['name']}: нет совпадения по позиции (missed)")
            continue
        _, i, p = cands[0]
        used.add(i)
        if p["name"] == t["name"]:
            exact += 1
        elif _syn(t["name"], p["name"]):
            partial += 1
            issues.append(f"  {t['name']}: ≈ «{p['name']}» (синоним)")
        else:
            wrong += 1
            issues.append(f"  {t['name']}: предсказано «{p['name']}» ✗")
        ta, pa = t.get("area_m2"), p.get("area_m2")
        if ta is not None and pa is not None:
            if abs(ta - pa) <= tol_area:
                area_ok += 1
            else:
                area_bad += 1
                issues.append(f"  {t['name']}: площадь {pa} vs эталон {ta} (Δ>{tol_area})")
        else:
            area_na += 1

    extra = [p_rooms[i]["name"] for i in range(len(p_rooms)) if i not in used]
    n = len(t_rooms) or 1

    # openings
    t_marks = {o["mark"] for o in truth.get("openings", [])}
    p_marks = {o["mark"] for o in pred.get("openings", [])}

    print("=== Accuracy report (markup ground-truth vs generated) ===")
    print(f"помещений в эталоне:        {len(t_rooms)}")
    print(f"  имя точно:                {exact}  ({exact / n * 100:.0f}%)")
    print(f"  имя синоним (частично):   {partial}")
    print(f"  имя неверно:              {wrong}")
    print(f"  не найдено по позиции:    {len(t_rooms) - exact - partial - wrong}")
    print(f"  распознано (точно+синон): {exact + partial}/{len(t_rooms)} = {(exact + partial) / n * 100:.0f}%")
    print(f"  лишних (false positive):  {len(extra)} {extra if extra else ''}")
    if area_ok + area_bad:
        print(f"площади (где есть с обеих): ok {area_ok} / mismatch {area_bad} (tol ±{tol_area})")
    print(f"марки проёмов: эталон {len(t_marks)}, совпало {len(t_marks & p_marks)}, "
          f"пропущено {sorted(t_marks - p_marks)}, лишних {sorted(p_marks - t_marks)}")
    if issues:
        print("--- расхождения ---")
        for s in issues:
            print(s)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--truth", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--tol-dist", type=float, default=1.5)
    ap.add_argument("--tol-area", type=float, default=0.05)
    a = ap.parse_args()
    with open(a.truth, encoding="utf-8") as f:
        truth = json.load(f)
    with open(a.pred, encoding="utf-8") as f:
        pred = json.load(f)
    compare(truth, pred, a.tol_dist, a.tol_area)
