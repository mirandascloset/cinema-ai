"""Status API."""

from __future__ import annotations

from fastapi import APIRouter

import captioner
import engine
import workflows
from cinema_ai import domain as d
from image_studio import domain as studio

router = APIRouter(tags=["status"])


@router.get("/api/status")
def api_status():
    h3 = workflows.VIDEO_MODELS["h3"]
    return {
        "captioner": captioner.available(),
        "ffmpeg": bool(d.FFMPEG and d.FFPROBE),
        "video": {
            "label": h3["label"],
            "ready": studio.video_ready("h3"),
            "maxLoras": studio.MAX_VIDEO_LORAS,
            "h3": {
                "loras": studio.h3_loras(),
                "models": studio.h3_models(),
                "steps": list(studio.H3_STEPS),
            },
            "models": {
                "h3": {
                    "label": h3["label"],
                    "ready": studio.video_ready("h3"),
                    "audio": h3.get("audio", True),
                    "estimates": {
                        f"720-{s}": studio.estimate(studio.video_time_key("h3", "720", s))
                        for s in studio.VIDEO_SECONDS
                    },
                },
            },
        },
        "engine": {
            "installed": engine.COMFY_PY.is_file(),
            "healthy": engine.healthy(),
        },
    }