"""Saved scenes (reusable motion captions)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from cinema_ai import domain as d
from cinema_ai.file_response import file_response

router = APIRouter(tags=["scenes"])


@router.get("/api/scenes")
def list_scenes():
    return {"items": d.scenes_list(slim=True)}


@router.get("/api/scenes/{scene_id}")
def get_scene(scene_id: str, request: Request, thumb: str | None = Query(None)):
    if thumb is not None:
        try:
            d.scene_meta(scene_id)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        path = d.scene_thumb_path(scene_id)
        if not path.is_file():
            raise HTTPException(404, "Not found")
        return file_response(path, "image/jpeg", request)
    try:
        meta = d.scene_meta(scene_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    out = {k: meta.get(k) for k in ("id", "name", "created", "video", "duration")}
    out["segments_total"] = len(meta.get("segments") or [])
    return out


@router.post("/api/scenes/save")
async def save_scene(request: Request):
    data = await request.json()
    output_id = str(data.get("outputId") or data.get("id") or "")
    name = str(data.get("name") or "")
    try:
        return d.scene_from_output(output_id, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/rename")
async def rename_scene(request: Request):
    data = await request.json()
    scene_id = str(data.get("id") or "")
    name = str(data.get("name") or "")
    try:
        return d.scene_rename(scene_id, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/delete")
async def delete_scene(request: Request):
    data = await request.json()
    scene_id = str(data.get("id") or "")
    d.scene_delete(scene_id)
    return {"ok": True}