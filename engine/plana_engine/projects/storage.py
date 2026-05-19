from __future__ import annotations

import os
from pathlib import Path

ASSETS_DIR = Path(os.getenv("ASSETS_DIR", "/data/assets"))


def save_asset(project_id: str, tab: str, variant_key: str, image_bytes: bytes) -> str:
    """Сохраняет PNG на диск, возвращает относительный путь."""
    folder = ASSETS_DIR / project_id
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{tab}__{variant_key}.png"
    (folder / filename).write_bytes(image_bytes)
    return f"{project_id}/{filename}"


def delete_project_assets(project_id: str) -> None:
    folder = ASSETS_DIR / project_id
    if folder.exists():
        import shutil
        shutil.rmtree(folder)
