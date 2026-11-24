"""Show-on-PC cast API."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from cinema_ai import domain as d

router = APIRouter(tags=["cast"])


@router.get("/api/cast")
def get_cast(wait: str = Query("")):
    if wait.lstrip("-").isdigit():
        d.cast_wait(int(wait))
    return d.cast_state()


@router.post("/api/cast")
async def post_cast(request: Request):
    data = await request.json()
    return d.cast_show(str(data.get("id") or ""))


@router.post("/api/cast/stop")
def post_cast_stop():
    return d.cast_stop()


@router.post("/api/cast/view")
async def post_cast_view(request: Request):
    data = await request.json()
    return d.cast_view(data)
