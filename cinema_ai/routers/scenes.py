"""Saved scenes (legacy captions + storyboard packs)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from cinema_ai import domain as d
from cinema_ai import scene_pack as sp
from cinema_ai.file_response import file_response

router = APIRouter(tags=["scenes"])


@router.get("/api/scenes")
def list_scenes():
    return {"items": d.scenes_list(slim=True)}


@router.get("/api/scenes/{scene_id}")
def get_scene(
    scene_id: str,
    request: Request,
    thumb: str | None = Query(None),
    frame: str | None = Query(None),
    index: int | None = Query(None),
):
    try:
        meta = d.scene_meta(scene_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    if thumb is not None:
        path = d.scene_thumb_path(scene_id)
        if not path.is_file():
            raise HTTPException(404, "Not found")
        return file_response(path, "image/jpeg", request)
    if frame in ("first", "last") and index is not None:
        if not d.scene_is_pack(scene_id):
            raise HTTPException(404, "This scene has no editable frames.")
        try:
            path = sp.frame_path(scene_id, index, frame)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        ctype = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        return file_response(path, ctype, request)
    return d.scene_public(meta, slim=False)


@router.post("/api/scenes/save")
async def save_scene(request: Request):
    data = await request.json()
    output_id = str(data.get("outputId") or data.get("id") or "")
    name = str(data.get("name") or "")
    try:
        return d.scene_from_output(output_id, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(400, str(exc) or "Could not write the scene.") from exc


@router.post("/api/scenes/rename")
async def rename_scene(request: Request):
    data = await request.json()
    try:
        return d.scene_rename(str(data.get("id") or ""), str(data.get("name") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/delete")
async def delete_scene(request: Request):
    data = await request.json()
    sid = str(data.get("id") or data.get("family") or "")
    if data.get("familyOnly") or data.get("deleteFamily"):
        parsed = sp.parse_pack_id(sid)
        family = str(data.get("family") or (parsed[0] if parsed else sid))
        if family:
            sp.delete_family(family)
        return {"ok": True}
    d.scene_delete(sid)
    return {"ok": True}


@router.post("/api/scenes/fork")
async def fork_scene(request: Request):
    data = await request.json()
    try:
        return sp.fork_version(str(data.get("source") or data.get("id") or ""), str(data.get("title") or data.get("name") or "") or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(400, str(exc) or "Could not create that version.") from exc


@router.post("/api/scenes/{scene_id}/segment")
async def patch_segment(scene_id: str, request: Request):
    data = await request.json()
    try:
        index = int(data.get("index"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Segment index required.") from exc
    if not d.scene_is_pack(scene_id):
        raise HTTPException(400, "Only storyboard scenes support segment editing.")
    try:
        return sp.patch_segment(scene_id, index, str(data.get("description") or data.get("prompt") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/{scene_id}/frame")
async def set_frame(scene_id: str, request: Request):
    data = await request.json()
    if not d.scene_is_pack(scene_id):
        raise HTTPException(400, "Only storyboard scenes support frame edits.")
    try:
        index = int(data.get("index"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Segment index required.") from exc
    which = str(data.get("which") or data.get("frame") or "")
    image_id = str(data.get("image") or data.get("imageId") or "")
    try:
        return sp.set_frame(scene_id, index, which, image_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/{scene_id}/rewrite")
async def rewrite_scene(scene_id: str, request: Request):
    data = await request.json()
    if not d.scene_is_pack(scene_id):
        raise HTTPException(400, "Only storyboard scenes support prompt rewrite.")
    try:
        return sp.rewrite_prompts(scene_id, str(data.get("note") or data.get("promptNote") or ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/scenes/generate")
async def generate_scene(request: Request):
    data = await request.json()
    try:
        job = sp.scene_video_job(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return d.public_job(d.add_job(job))
