from __future__ import annotations

import json

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..auth.db import (
    create_asset, create_project, create_run, delete_project,
    get_project, get_project_counts, get_project_thumbnails,
    list_assets, list_projects, list_run_assets, list_runs,
    update_project,
)
from .storage import delete_project_assets, save_asset

router = APIRouter(prefix="/projects", tags=["projects"])


def _asset_url(file_path: str) -> str:
    return f"/api/static/{file_path}"


def _project_out(p: dict, *, include_counts: bool = True) -> dict:
    thumbnails = get_project_thumbnails(p["id"], limit=4)
    out = {
        **p,
        "thumbnail_url": _asset_url(thumbnails[0]) if thumbnails else None,
        "thumbnails": [_asset_url(fp) for fp in thumbnails],
    }
    if include_counts:
        out.update(get_project_counts(p["id"]))
    return out


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
    run_id: str = Form(""),
    image: UploadFile = File(...),
) -> dict:
    user = request.state.user
    p = get_project(project_id, user["sub"])
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")

    image_bytes = await image.read()
    file_path = save_asset(project_id, tab, variant_key, image_bytes, floor)
    asset = create_asset(
        project_id, tab, variant_key, file_path,
        model_used or None, floor, run_id or None,
    )
    return {**asset, "url": _asset_url(file_path)}


# ---------------------------------------------------------------------------
# Generation runs
# ---------------------------------------------------------------------------

class CreateRunRequest(BaseModel):
    tab: str = "ai_plans"
    floor: int = 1
    params_snapshot: dict = {}


@router.post("/{project_id}/runs", status_code=201)
def create_run_endpoint(project_id: str, req: CreateRunRequest, request: Request) -> dict:
    user = request.state.user
    p = get_project(project_id, user["sub"])
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")
    run = create_run(
        project_id, user["sub"], req.tab, req.floor,
        json.dumps(req.params_snapshot, ensure_ascii=False),
    )
    return run


@router.get("/{project_id}/runs")
def list_runs_endpoint(project_id: str, request: Request) -> list[dict]:
    user = request.state.user
    p = get_project(project_id, user["sub"])
    if not p:
        raise HTTPException(status_code=404, detail="Проект не найден")
    runs = list_runs(project_id)
    result = []
    for run in runs:
        assets = list_run_assets(run["id"])
        # parse params_snapshot back to dict for frontend
        try:
            params = json.loads(run.get("params_snapshot") or "{}")
        except Exception:
            params = {}
        result.append({
            **run,
            "params_snapshot": params,
            "assets": [{**a, "url": _asset_url(a["file_path"])} for a in assets],
        })
    return result
