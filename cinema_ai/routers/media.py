"""Uploads and outputs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from cinema_ai import domain as d
from cinema_ai.file_response import file_response
from image_studio import domain as studio

router = APIRouter(tags=["media"])


@router.post("/api/upload")
async def upload_image(request: Request):
    body = await request.body()
    if len(body) > d.MAX_UPLOAD:
        raise ValueError("That image is too large (40 MB max).")
    return d.save_upload(body)


@router.post("/api/upload-video")
async def upload_video(request: Request, name: str = Query("")):
    body = await request.body()
    if len(body) > d.MAX_VIDEO_UPLOAD:
        raise ValueError("That video is too large (500 MB max).")
    return d.save_video(body, name or "video.mp4")


@router.get("/api/upload/{item}")
def upload_image_item(item: str, request: Request):
    if not d.ID_RE.match(item):
        raise HTTPException(404, "Not found")
    path = d.UPLOADS / f"{item}.jpg"
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return file_response(path, "image/jpeg", request)


@router.get("/api/video/{item}")
def uploaded_video(item: str, request: Request):
    if not d.ID_RE.match(item):
        raise HTTPException(404, "Not found")
    meta = d.video_meta(item)
    path = d.VIDEO_UPLOADS / f"{item}{meta['ext']}"
    return file_response(path, "video/mp4", request)


@router.get("/api/output/{item}.mp4")
def output_mp4(item: str, request: Request):
    if not d.ID_RE.match(item):
        raise HTTPException(404, "Not found")
    path = d.OUTPUTS / f"{item}.mp4"
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return file_response(path, "video/mp4", request)


@router.get("/api/output/{item}")
def output_poster(item: str, request: Request, thumb: str | None = Query(None)):
    if not d.ID_RE.match(item):
        raise HTTPException(404, "Not found")
    path = d.OUTPUTS / f"{item}.png"
    if thumb is not None and path.is_file():
        tpath = studio.thumb(path, f"output-{item}", 480)
        return file_response(tpath, "image/jpeg", request)
    if not path.is_file():
        raise HTTPException(404, "Not found")
    return file_response(path, "image/png", request)