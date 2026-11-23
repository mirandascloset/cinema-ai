# Cinema AI

Phone-friendly Cinema workflow that runs on your PC. Pair a **reference video** with a **still photo**, study the clip in short slices, and generate **720p MiniMax H3** video (with optional reference audio and saved **scenes** for re-use).

## Requirements

- Windows PC with the Studio stack: **Image Studio** (Comfy / H3), **Prompt Generator** (vision captions), and **ffmpeg**
- Python 3.14+ (same layout as other Studio apps)
- Node.js (to build the React UI)

Cinema AI reuses Image Studio's video engine via `sys.path`; it does not bundle ComfyUI.

## Run

```bat
start.bat
```

Default port: **8798** (`CINEMA_AI_PORT` overrides). Add the app in **Phone Agent** (`config.json`) to use it from your phone.

## Features

- Reference video → vision captions per ≤10s segment → H3 image-to-video + extend
- Reference audio extract for lip sync; optional scene save to skip re-reading the clip
- Gallery, queue, PC folder picker for videos and images

## Frontend

```bat
cd frontend
npm install
npm run build
```

The server can trigger a dev build on startup if `frontend/dist` is missing.

## Layout

| Path | Purpose |
|------|---------|
| `cinema_ai/` | FastAPI app, domain pipeline, routers |
| `frontend/` | React UI |
| `server.py` | Entrypoint |
| `runtime/` | Uploads, temp frames (gitignored) |
| `outputs/` | Generated videos (gitignored) |
| `scenes/` | Saved scene library (gitignored) |