from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..auth.db import (
    create_asset, create_project, delete_project,
    get_project, get_project_thumbnail, list_assets,
    list_projects, update_project,
)
from .storage import ASSETS_DIR, delete_project_assets, save_asset

router = APIRouter(prefix="/projects", tags=["projects"])


def _asset_url(file_path: str) -> str:
    return f"/api/static/{file_path}"


def _project_out(p: dict) -> dict:
    thumbnail = get_project_thumbnail(p["id"])
    return {
        **p,
        "thumbnail_url": _asset_url(thumbnail) if thumbnail else None,
    }


# ---------------------------------------------------------------------------
# Проекты
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    name: str = "Без названия"
    params: dict = {}


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    params: dict | None = None


@router.post("", status_code=201)
def create(req: CreateProjectRequest, request: Request) -> dict:
    user = request.state.user
    p = create_project(user["sub"], req.name, json.dumps(req.params, ensure_ascii=False))
    return _project_out(p)


@router.get("")
def list_user_projects(request: Request) -> list[dict]:
    user = request.state.user
    projects = list_projects(user["sub"])
    return [_project_out(p) for p in projects]


@router.get("/{project_id}")
def get(project_id: str, request: Request) -> dict:
    user = request.state.user
    p = get_project(project_id, user["sub"])
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")
    assets = list_assets(project_id)
    return {
        **_project_out(p),
        "assets": [
            {**a, "url": _asset_url(a["file_path"])}
            for a in assets
        ],
    }


@router.put("/{project_id}")
def update(project_id: str, req: UpdateProjectRequest, request: Request) -> dict:
    user = request.state.user
    params_json = json.dumps(req.params, ensure_ascii=False) if req.params is not None else None
    ok = update_project(project_id, user["sub"], req.name, params_json)
    if not ok:
        raise HTTPException(status_code=404, detail="Проект не найден")
    p = get_project(project_id, user["sub"])
    return _project_out(p)  # type: ignore[arg-type]


@router.delete("/{project_id}", status_code=204)
def delete(project_id: str, request: Request) -> None:
    user = request.state.user
    ok = delete_project(project_id, user["sub"])
    if not ok:
        raise HTTPException(status_code=404, detail="Проект не найден")
    delete_project_assets(project_id)


# ---------------------------------------------------------------------------
# Ассеты
# ---------------------------------------------------------------------------

@router.post("/{project_id}/assets", status_code=201)
async def upload_asset(
    project_id: str,
    request: Request,
    tab: str = Form(...),
    variant_key: str = Form(...),
    floor: int = Form(1),
    model_used: str = Form(""),
    image: UploadFile = File(...),
) -> dict:
    user = request.state.user
    p = get_project(project_id, user["sub"])
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")

    image_bytes = await image.read()
    file_path = save_asset(project_id, tab, variant_key, image_bytes, floor)
    asset = create_asset(project_id, tab, variant_key, file_path, model_used or None, floor)
    return {**asset, "url": _asset_url(file_path)}
