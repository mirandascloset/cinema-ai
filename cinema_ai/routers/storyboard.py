"""Storyboard analyze — saves a named scene pack under scenes/."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from cinema_ai import domain as d
from cinema_ai import scene_pack as sp

router = APIRouter(tags=["storyboard"])


@router.post("/api/storyboard/analyze")
async def analyze_storyboard(request: Request):
    data = await request.json()
    try:
        job = sp.storyboard_analyze_job(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return d.public_job(d.add_job(job))
