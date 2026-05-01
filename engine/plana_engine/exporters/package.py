"""Сборка пакета сдачи: 5 DXF + норм-отчёт + параметры в одном ZIP.

Это и есть «инженерный артефакт сдачи» по ТЗ §11 — всё, что нужно архитектору
для приёмки на одном клиенте.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

from .. import __version__
from ..norms import get_norms
from ..types import GenerateRequest, GenerateResponse, Plan
from .dxf import dxf_bytes


def build_delivery_package(
    response: GenerateResponse,
    request: GenerateRequest,
) -> bytes:
    """Собрать ZIP-пакет:

        plan_<preset>.dxf      — каждый из 5 вариантов в DXF
        norms_report.json      — все NormViolation по всем вариантам
        metrics.json           — таблица сравнения метрик
        params.json            — входной запрос (для воспроизводимости)
        norms_used.yaml        — снимок norms.yaml на момент генерации
        README.txt             — короткое описание содержимого
    """
    norms = get_norms()
    norms_path = _norms_yaml_path()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # DXF файлы
        for plan in response.variants:
            z.writestr(
                f"plan_{plan.preset.value}.dxf",
                dxf_bytes(plan),
            )

        # норм-отчёт
        z.writestr(
            "norms_report.json",
            json.dumps(
                {
                    "request_id": response.request_id,
                    "norms_version": norms.version,
                    "variants": [
                        {
                            "preset": p.preset.value,
                            "passed": p.norms.passed,
                            "violations": [v.model_dump() for v in p.norms.violations],
                        }
                        for p in response.variants
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

        # таблица сравнения метрик
        z.writestr(
            "metrics.json",
            json.dumps(
                {
                    "request_id": response.request_id,
                    "elapsed_ms": response.elapsed_ms,
                    "variants": [
                        {
                            "preset": p.preset.value,
                            "metrics": p.metrics.model_dump(),
                        }
                        for p in response.variants
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

        # входной запрос (для повторного запуска)
        z.writestr(
            "params.json",
            json.dumps(
                request.model_dump(mode="json"),
                ensure_ascii=False,
                indent=2,
            ),
        )

        # снимок норм
        if norms_path:
            z.write(norms_path, arcname="norms_used.yaml")

        # README
        readme = _readme(response, norms.version)
        z.writestr("README.txt", readme)

    return buf.getvalue()


def _norms_yaml_path() -> str | None:
    from pathlib import Path
    p = Path(__file__).resolve().parent.parent.parent / "data" / "norms.yaml"
    return str(p) if p.is_file() else None


def _readme(response: GenerateResponse, norms_version: str) -> str:
    lines = [
        "Plana · пакет сдачи поэтажного плана",
        "=" * 56,
        f"Дата:           {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
        f"Engine version: {__version__}",
        f"Norms version:  {norms_version}",
        f"Request id:     {response.request_id}",
        f"Elapsed:        {response.elapsed_ms} ms",
        "",
        "Содержимое пакета:",
        "  plan_<preset>.dxf  — каждый из 5 вариантов в формате DXF (AutoCAD R2018)",
        "  metrics.json       — таблица сравнения по всем вариантам (КИТ, кв., ср.S и т.д.)",
        "  norms_report.json  — нарушения нормативов по каждому варианту",
        "  params.json        — входные параметры (для воспроизводимости)",
        "  norms_used.yaml    — снимок normsконфига на момент генерации",
        "",
        "Слои DXF:",
        "  WALL_BEARING       — наружные несущие стены",
        "  WALL_PARTITION     — внутренние перегородки",
        "  DOOR / WINDOW      — двери / окна",
        "  FIXTURE            — сантехника, кухонные блоки",
        "  ZONE_FILL          — заливка квартирных зон",
        "  TEXT_APT           — подписи КВ № и площадей",
        "  DIM                — размерные линии",
        "",
        "Варианты в этом пакете:",
    ]
    for p in response.variants:
        m = p.metrics
        norms_status = "OK" if p.norms.passed else f"FAIL ({len(p.norms.violations)} наруш.)"
        lines.append(
            f"  {p.preset.value:<18} апт.={m.apt_count:>3}  "
            f"S={m.saleable_area:>6.1f} м²  "
            f"КИТ={m.saleable_ratio*100:>3.0f}%  норм.: {norms_status}"
        )
    return "\n".join(lines) + "\n"
