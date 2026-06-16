"""Validate a markup JSON against markup-schema.json.

Usage: python validate_markup.py <output.json>

Uses jsonschema if available (full Draft-07 validation); otherwise falls back to
lightweight required-field + mark-pattern checks so it still runs anywhere.
Exit code 0 = valid, 1 = errors (printed).
"""
import json
import os
import re
import sys

try:  # чтобы ✅/кириллица печатались в любой консоли (Windows cp1251)
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, "..", "references", "markup-schema.json")
_MARK = re.compile(r"^(ОК|Д|ПД|ВВ)-\d+$")


def _fallback(data: dict) -> list[str]:
    errs: list[str] = []
    for key in ("metadata", "units", "room_tags", "apartments", "openings", "titleblock"):
        if key not in data:
            errs.append(f"missing top-level key: {key}")
    for i, o in enumerate(data.get("openings", [])):
        m = o.get("mark", "")
        if not _MARK.match(str(m)):
            errs.append(f"openings[{i}].mark «{m}» не по шаблону ОК/Д/ПД/ВВ-N")
        if o.get("kind") not in ("window", "door", "sill", "vent"):
            errs.append(f"openings[{i}].kind invalid: {o.get('kind')}")
    for i, r in enumerate(data.get("room_tags", [])):
        for k in ("room_id", "name", "area_m2", "tag_point"):
            if k not in r:
                errs.append(f"room_tags[{i}] missing {k}")
    tb = data.get("titleblock", {})
    for k in ("project_name", "stage", "sheet_number"):
        if k not in tb:
            errs.append(f"titleblock missing {k}")
    return errs


def validate(path: str) -> list[str]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    try:
        import jsonschema  # type: ignore
        with open(SCHEMA, encoding="utf-8") as f:
            schema = json.load(f)
        v = jsonschema.Draft7Validator(schema)
        return [f"{list(e.path)}: {e.message}" for e in v.iter_errors(data)]
    except ImportError:
        return _fallback(data)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python validate_markup.py <output.json>")
        sys.exit(2)
    errors = validate(sys.argv[1])
    if errors:
        print(f"❌ {len(errors)} ошибок:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("✅ valid — соответствует markup-schema.json")
    sys.exit(0)
