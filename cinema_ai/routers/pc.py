"""PC folder browse / import."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request

from cinema_ai import domain as d
from cinema_ai.file_response import file_response
from image_studio import domain as studio

router = APIRouter(tags=["pc"])


@router.get("/api/pc/list")
def pc_list(dir: str = Query(""), kind: str = Query("images"), sort: str = Query("new")):
    if kind == "video":
        return d.pc_list_videos(dir, sort)
    if kind == "audio":
        return studio.pc_list(dir, "audio", sort)
    return studio.pc_list(dir, "images", sort)


@router.get("/api/pc/search")
def pc_search(q: str = Query(""), kind: str = Query("images"), sort: str = Query("new"), scope: str = Query("")):
    if kind == "video":
        return d.pc_search_videos(q, sort, scope)
    if kind == "audio":
        return studio.pc_search(q, "audio", sort, scope)
    return studio.pc_search(q, "images", sort, scope)


@router.get("/api/pc/thumb")
def pc_thumb(request: Request, path: str = Query("")):
    src = studio.pc_image(path)
    return file_response(studio.thumb(src, f"pc-{uuid.uuid5(uuid.NAMESPACE_URL, str(src)).hex[:16]}", 360), "image/jpeg", request)


@router.get("/api/pc/video-thumb")
def pc_video_thumb(request: Request, path: str = Query("")):
    src = studio.pc_path(path)
    if src.suffix.lower() not in d.VIDEO_EXT:
        raise ValueError("That isn't a video file.")
    return file_response(d.video_thumb_bytes(src), "image/jpeg", request)


@router.post("/api/pc/import")
async def pc_import(request: Request):
    data = await request.json()
    return d.pc_import_image(str(data.get("path") or ""))


@router.post("/api/pc/import-video")
async def pc_import_video(request: Request):
    data = await request.json()
    return d.pc_import_video(str(data.get("path") or ""))


@router.post("/api/pc/mkdir")
async def pc_mkdir(request: Request):
    data = await request.json()
    return studio.pc_mkdir(str(data.get("dir") or ""), str(data.get("name") or ""))


@router.post("/api/save")
async def api_save(request: Request):
    data = await request.json()
    return d.save_outputs_to_pc(data.get("ids") or [], str(data.get("dir") or ""))