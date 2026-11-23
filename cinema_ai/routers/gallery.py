"""Gallery."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from cinema_ai import domain as d

router = APIRouter(tags=["gallery"])


@router.get("/api/gallery")
def api_gallery(
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    slim: bool = Query(False),
):
    fetch = (limit + 1) if limit is not None else None
    items = d.gallery(limit=fetch, offset=offset, slim=slim)
    has_more = False
    if limit is not None and len(items) > limit:
        has_more = True
        items = items[:limit]
    return {"items": items, "hasMore": has_more}


@router.get("/api/gallery/{item_id}")
def api_gallery_item(item_id: str):
    item = d.gallery_item(item_id)
    if not item:
        raise HTTPException(404, "That result is gone.")
    return item


@router.post("/api/favorite")
async def favorite(request: Request):
    data = await request.json()
    return d.set_favorite(str(data.get("id", "")), data.get("on") is True)


@router.post("/api/delete")
async def delete_item(request: Request):
    data = await request.json()
    item = str(data.get("id") or "")
    if d.ID_RE.match(item):
        for p in (
            d.OUTPUTS / f"{item}.png",
            d.OUTPUTS / f"{item}.mp4",
            d.OUTPUTS / f"{item}.json",
            d.THUMBS / f"output-{item}-480.jpg",
        ):
            p.unlink(missing_ok=True)
    return {"ok": True}