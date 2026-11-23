"""FastAPI host for Cinema AI."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

IS_ROOT = Path(__file__).resolve().parent.parent.parent / "image-studio"
if str(IS_ROOT) not in sys.path:
    sys.path.insert(0, str(IS_ROOT))

import captioner  # noqa: E402
import engine  # noqa: E402
from cinema_ai import domain as d  # noqa: E402
from cinema_ai.routers import gallery, jobs, media, pc, scenes, status  # noqa: E402

DIST = d.HERE / "frontend" / "dist"
DIST_INDEX = DIST / "index.html"

_FRONTEND_BUILDING = False
_FRONTEND_BUILD_ERROR = ""
_FRONTEND_LOCK = threading.Lock()

BUILDING_HTML = b"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="refresh" content="3"/>
<title>Cinema AI</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.4 system-ui,sans-serif;
       background:#121214;color:#f2f2f4}
  main{max-width:28rem;padding:2rem;text-align:center}
  p{color:#a8a8b0}
</style></head>
<body><main>
  <h1>Cinema AI</h1>
  <p>Building the phone UI&hellip; this page refreshes when it is ready.</p>
</main></body>
"""

app = FastAPI(title="Cinema AI", docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    detail = exc.detail
    body = {"error": detail if isinstance(detail, str) else str(detail)}
    return JSONResponse(body, status_code=exc.status_code)


@app.exception_handler(ValueError)
async def value_error(request: Request, exc: ValueError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(captioner.MinorRefusal)
async def minor_refusal(request: Request, exc: captioner.MinorRefusal):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(captioner.CaptionError)
async def caption_error(request: Request, exc: captioner.CaptionError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(engine.EngineError)
async def engine_error(request: Request, exc: engine.EngineError):
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": "Request was not valid."}, status_code=400)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    return JSONResponse({"error": str(exc) or "Something went wrong."}, status_code=500)


class NoStoreStatic(StaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store"
        return response


def shell_bytes() -> bytes:
    if DIST_INDEX.is_file():
        return DIST_INDEX.read_bytes()
    with _FRONTEND_LOCK:
        building, err = _FRONTEND_BUILDING, _FRONTEND_BUILD_ERROR
    if building:
        return BUILDING_HTML
    if err:
        raise HTTPException(503, f"Frontend build failed: {err}. Run npm run build in frontend/.")
    raise HTTPException(503, "Frontend missing. Run npm run build in frontend/ or use start.bat.")


@app.get("/api/health")
def api_health():
    with _FRONTEND_LOCK:
        building, err = _FRONTEND_BUILDING, _FRONTEND_BUILD_ERROR
    return {
        "ok": True,
        "frontend": DIST_INDEX.is_file(),
        "frontendBuilding": building and not DIST_INDEX.is_file(),
        "frontendError": err or None,
        "engineInstalled": engine.COMFY_PY.is_file(),
        "engineHealthy": engine.healthy(),
    }


@app.get("/")
def index():
    return Response(shell_bytes(), media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})


app.include_router(status.router)
app.include_router(jobs.router)
app.include_router(pc.router)
app.include_router(media.router)
app.include_router(gallery.router)
app.include_router(scenes.router)


def mount_dist_assets() -> None:
    assets = DIST / "assets"
    if not assets.is_dir():
        return
    for route in app.router.routes:
        if getattr(route, "name", None) == "assets":
            return
    app.mount("/assets", NoStoreStatic(directory=str(assets), html=False), name="assets")


mount_dist_assets()


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    head = full_path.split("/", 1)[0]
    if head in ("api", "assets"):
        raise HTTPException(404, "Not found")
    return Response(shell_bytes(), media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})


def ensure_frontend_build() -> None:
    global _FRONTEND_BUILDING, _FRONTEND_BUILD_ERROR
    if DIST_INDEX.is_file():
        return
    frontend = d.HERE / "frontend"
    if not (frontend / "package.json").is_file():
        return
    npm = "npm.cmd" if os.name == "nt" else "npm"
    with _FRONTEND_LOCK:
        _FRONTEND_BUILDING = True
        _FRONTEND_BUILD_ERROR = ""
    try:
        if not (frontend / "node_modules").is_dir():
            subprocess.check_call([npm, "install"], cwd=frontend)
        subprocess.check_call([npm, "run", "build"], cwd=frontend)
    except (OSError, subprocess.CalledProcessError) as exc:
        with _FRONTEND_LOCK:
            _FRONTEND_BUILDING = False
            _FRONTEND_BUILD_ERROR = str(exc)
        return
    with _FRONTEND_LOCK:
        _FRONTEND_BUILDING = False
    if DIST_INDEX.is_file():
        mount_dist_assets()


def main() -> None:
    if not DIST_INDEX.is_file():
        threading.Thread(target=ensure_frontend_build, daemon=True, name="frontend-build").start()
    for folder in (d.UPLOADS, d.VIDEO_UPLOADS, d.OUTPUTS, d.THUMBS):
        folder.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=d.worker, daemon=True, name="cinema-worker").start()
    print(f"Cinema AI on http://{d.HOST}:{d.PORT}", flush=True)
    try:
        uvicorn.run(app, host=d.HOST, port=d.PORT, log_level="warning", access_log=False)
    finally:
        engine.stop()
        captioner.release()


if __name__ == "__main__":
    main()