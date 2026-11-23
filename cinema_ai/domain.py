"""Cinema AI — match a reference video's motion using your photo + Image Studio's video engine."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import queue
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps

IS_ROOT = Path(__file__).resolve().parent.parent.parent / "image-studio"
if str(IS_ROOT) not in sys.path:
    sys.path.insert(0, str(IS_ROOT))

import captioner  # noqa: E402
import engine  # noqa: E402
import workflows  # noqa: E402
from image_studio import domain as studio  # noqa: E402

from cinema_ai import vision  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
RUNTIME = HERE / "runtime"
UPLOADS = RUNTIME / "uploads"
VIDEO_UPLOADS = RUNTIME / "video"
OUTPUTS = HERE / "outputs"
THUMBS = RUNTIME / "thumbs"
FAVORITES = HERE / "favorites"
SCENES = HERE / "scenes"
HOST, PORT = "127.0.0.1", int(os.environ.get("CINEMA_AI_PORT", "8798"))
MAX_UPLOAD = 40 * 1024 * 1024
MAX_VIDEO_UPLOAD = 500 * 1024 * 1024
ID_RE = re.compile(r"^[a-f0-9]{12}$")
SEGMENT_MAX = 10.0
MIN_SEGMENT_TAIL = 1.0
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".wmv"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

JOBS: dict[str, dict] = {}
JOB_ORDER: list[str] = []
WORK: queue.Queue = queue.Queue()
LOCK = threading.Lock()


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(path)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def save_upload(data: bytes) -> dict:
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    except Exception as exc:
        raise ValueError("That file isn't an image I can read.") from exc
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = img.convert("RGB")
    img.thumbnail((2048, 2048), Image.LANCZOS)
    uid = new_id()
    UPLOADS.mkdir(parents=True, exist_ok=True)
    img.save(UPLOADS / f"{uid}.jpg", quality=95)
    meta = {"id": uid, "width": img.width, "height": img.height, "checked": True}
    write_json(UPLOADS / f"{uid}.json", meta)
    return meta


def upload_meta(uid: str) -> dict:
    if not ID_RE.match(uid or ""):
        raise ValueError("That photo is gone.")
    meta = read_json(UPLOADS / f"{uid}.json", None)
    if not meta or not (UPLOADS / f"{uid}.jpg").is_file():
        raise ValueError("That photo is gone.")
    return meta


def save_video(data: bytes, name: str = "") -> dict:
    ext = Path(name or "clip.mp4").suffix.lower()
    if ext not in VIDEO_EXT:
        head = data[:12]
        if head[4:8] == b"ftyp":
            ext = ".mp4"
        elif data[:4] == b"\x1aE\xdf\xa3":
            ext = ".mkv"
        else:
            ext = ".mp4"
    uid = new_id()
    VIDEO_UPLOADS.mkdir(parents=True, exist_ok=True)
    path = VIDEO_UPLOADS / f"{uid}{ext}"
    path.write_bytes(data)
    duration = probe_duration(path)
    if duration <= 0.1:
        path.unlink(missing_ok=True)
        raise ValueError("That video file couldn't be read.")
    meta = {"id": uid, "name": (name or f"video{ext}")[:120], "ext": ext, "duration": round(duration, 2)}
    write_json(VIDEO_UPLOADS / f"{uid}.json", meta)
    return meta


def video_meta(uid: str) -> dict:
    if not ID_RE.match(uid or ""):
        raise ValueError("That video is gone.")
    meta = read_json(VIDEO_UPLOADS / f"{uid}.json", None)
    if not meta:
        raise ValueError("That video is gone.")
    path = VIDEO_UPLOADS / f"{uid}{meta['ext']}"
    if not path.is_file():
        raise ValueError("That video is gone.")
    return {**meta, "path": str(path)}


def video_has_audio(path: Path) -> bool:
    if not FFPROBE:
        return False
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
        creationflags=NO_WINDOW,
    )
    return "audio" in (out.stdout or "").lower()


def import_reference_audio(video_path: Path) -> str | None:
    """Extract the reference video's soundtrack for H3 audio-guided generation (ffmpeg only, no Comfy Py)."""
    if not FFMPEG or not video_has_audio(video_path):
        return None
    studio.AUDIO_UPLOADS.mkdir(parents=True, exist_ok=True)
    uid = new_id()
    dest = studio.AUDIO_UPLOADS / f"{uid}.wav"
    try:
        subprocess.run(
            [
                FFMPEG,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(video_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "48000",
                str(dest),
            ],
            check=True,
            timeout=600,
            creationflags=NO_WINDOW,
        )
        if not dest.is_file() or dest.stat().st_size < 200:
            dest.unlink(missing_ok=True)
            return None
        duration = probe_duration(dest)
        if duration <= 0.1:
            dest.unlink(missing_ok=True)
            return None
        write_json(
            studio.AUDIO_UPLOADS / f"{uid}.json",
            {"id": uid, "name": "reference.wav", "ext": ".wav", "duration": round(duration, 2)},
        )
        return uid
    except (OSError, subprocess.CalledProcessError, ValueError):
        dest.unlink(missing_ok=True)
        return None


def prepare_gpu() -> None:
    captioner.release()
    studio.unload_ollama()
    try:
        engine.free_memory()
    except OSError:
        pass


def run_h3_video(parent: dict, inner: dict, part_label: str) -> None:
    parent["stage"] = part_label
    inner["cancel"] = parent.get("cancel")
    parent["stage"] = f"{part_label} · Loading the video model"
    studio.run_video(inner)
    parent["stage"] = inner.get("stage") or f"{part_label} · Done"


def mux_reference_audio(out_mp4: Path, audio_id: str, duration: float) -> None:
    if not FFMPEG or not out_mp4.is_file():
        return
    meta = studio.audio_meta(audio_id)
    audio_src = studio.AUDIO_UPLOADS / f"{meta['id']}{meta['ext']}"
    if not audio_src.is_file():
        return
    tmp = out_mp4.with_suffix(".mux.mp4")
    try:
        subprocess.run(
            [
                FFMPEG,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(out_mp4),
                "-i",
                str(audio_src),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                f"{max(0.5, duration):.3f}",
                str(tmp),
            ],
            check=True,
            timeout=600,
            creationflags=NO_WINDOW,
        )
        tmp.replace(out_mp4)
    except (OSError, subprocess.CalledProcessError):
        tmp.unlink(missing_ok=True)


def probe_duration(path: Path) -> float:
    if not FFPROBE:
        raise ValueError("ffmpeg isn't installed on this PC.")
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
        timeout=60,
        creationflags=NO_WINDOW,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def segment_plan(duration: float) -> list[dict]:
    """Split a reference clip into ≤10s vision slices; never leave a useless tail slice."""
    if duration <= SEGMENT_MAX + 0.05:
        return [{"start": 0.0, "duration": round(duration, 3)}]
    spans, start = [], 0.0
    while start < duration - 0.05:
        remaining = duration - start
        dur = min(SEGMENT_MAX, remaining)
        tail = remaining - dur
        if dur >= SEGMENT_MAX and 0 < tail < MIN_SEGMENT_TAIL:
            dur = remaining
        spans.append({"start": round(start, 3), "duration": round(dur, 3)})
        start += dur
    return spans or [{"start": 0.0, "duration": round(duration, 3)}]


def pick_seconds(dur: float, cap: int | None = None) -> int:
    """Map a segment length to H3's allowed clip lengths."""
    target = min(SEGMENT_MAX, max(0.5, dur))
    if cap is not None:
        target = min(target, float(cap))
    for s in studio.VIDEO_SECONDS:
        if s >= target - 0.05:
            return s
    return cap or 10


def segment_seconds(seg: dict, job: dict) -> int:
    return pick_seconds(seg["duration"], job.get("seconds"))


def video_gen_payload(job: dict, seg: dict) -> dict:
    """POST body for Image Studio video_job / extend_job (always H3 @ 720p)."""
    use_ref = job.get("use_ref_audio") and job.get("ref_audio")
    payload = {
        "images": [job["image"]],
        "prompt": seg["prompt"],
        "writer": False,
        "model": "h3",
        "quality": "720",
        "seconds": segment_seconds(seg, job),
        "count": 1,
        "loras": job.get("loras") or [],
        "h3Model": job.get("h3_model") or "",
        "h3Steps": job.get("h3_steps") or 8,
        "sound": True,
    }
    if use_ref:
        payload["audio"] = job["ref_audio"]
        payload["audioStart"] = max(0.0, float(seg["start"]))
    else:
        payload["sound"] = job.get("sound") is not False
    return payload


def cinema_run_extend(inner: dict) -> None:
    """Extend like Image Studio, but pass reference audio so H3 can mimic speech/motion."""
    item = read_json(OUTPUTS / f"{inner['extend']}.json", None)
    if not item or not (OUTPUTS / f"{inner['extend']}.mp4").is_file():
        raise ValueError("That video is gone.")
    prompt = inner["prompt"] or inner.get("request") or ""
    if inner.get("cancel"):
        raise InterruptedError
    inner["stage"] = "Loading the video model"
    captioner.release()
    studio.unload_ollama()
    engine.INPUT_DIR.mkdir(parents=True, exist_ok=True)
    width, height = item["width"], item["height"]
    video_name = f"{inner['id']}_source.mp4"
    shutil.copyfile(OUTPUTS / f"{inner['extend']}.mp4", engine.INPUT_DIR / video_name)
    model = studio.video_model(inner.get("engine"))
    frames = workflows.video_length(model, inner["seconds"])
    total = studio.video_frames(item) + frames - studio.video_overlap(model)
    fps = workflows.VIDEO_MODELS[model]["fps"]
    audio_name = None
    if inner.get("audio"):
        meta = studio.audio_meta(str(inner["audio"]))
        audio_name = f"{inner['id']}_guide{meta['ext']}"
        shutil.copyfile(studio.AUDIO_UPLOADS / f"{meta['id']}{meta['ext']}", engine.INPUT_DIR / audio_name)
    try:
        if inner.get("cancel"):
            raise InterruptedError
        seed = random.randint(1, 2**31 - 1)
        graph = studio.build_video_graph(
            model,
            None,
            width,
            height,
            frames,
            prompt,
            seed,
            prefix=f"job_{inner['id']}",
            job=inner,
            extend=video_name,
            audio=audio_name,
        )
        fields = {
            **studio.video_extra_fields(model, inner),
            "prompt": prompt,
            "request": inner.get("request") or "",
            "source": item.get("source"),
            "seed": seed,
            "width": width,
            "height": height,
            "video": True,
            "quality": item.get("quality", "720"),
            "frames": total,
            "duration": round((total - 1) / fps, 1),
            "parent": inner["extend"],
            "segments": item.get("segments", 1) + 1,
            "prompts": [*(item.get("prompts") or [item.get("prompt", "")]), prompt],
        }
        if audio_name:
            fields["audio"] = inner["audio"]
            fields["audioStart"] = inner.get("audio_start") or 0
        studio.render(
            inner,
            graph,
            fields,
            time_key=studio.video_time_key(model, item.get("quality", "720"), inner["seconds"]),
        )
    finally:
        (engine.INPUT_DIR / video_name).unlink(missing_ok=True)
        if audio_name:
            (engine.INPUT_DIR / audio_name).unlink(missing_ok=True)


def extract_contact_sheet(path: Path, start: float, duration: float) -> bytes:
    if not FFMPEG:
        raise ValueError("ffmpeg isn't installed on this PC.")
    frames_dir = RUNTIME / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    tag = uuid.uuid4().hex[:8]
    shots = []
    points = [0.0, 0.33, 0.66, 1.0]
    span = max(duration, 0.05)
    for frac in points:
        t = start + span * min(frac, 0.95)
        out = frames_dir / f"{tag}_{len(shots)}.jpg"
        cmd = [
            FFMPEG,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{t:.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(out),
        ]
        subprocess.run(cmd, check=True, timeout=120, creationflags=NO_WINDOW)
        shots.append(out)
    imgs = [Image.open(p).convert("RGB") for p in shots]
    w = max(i.width for i in imgs)
    h = max(i.height for i in imgs)
    cols, rows = 2, 2
    sheet = Image.new("RGB", (w * cols, h * rows), (0, 0, 0))
    for i, im in enumerate(imgs):
        x, y = (i % cols) * w, (i // cols) * h
        if im.width != w or im.height != h:
            im = ImageOps.fit(im, (w, h), Image.LANCZOS)
        sheet.paste(im, (x, y))
    sheet.thumbnail((1536, 1536), Image.LANCZOS)
    buf = io.BytesIO()
    sheet.save(buf, format="JPEG", quality=88)
    for p in shots:
        p.unlink(missing_ok=True)
    return buf.getvalue()


def describe_video(path: Path, job: dict) -> list[dict]:
    duration = probe_duration(path)
    plan = segment_plan(duration)
    total = len(plan)
    job["segments_total"] = total
    studio.prep_captioner()
    out: list[dict] = []
    for i, span in enumerate(plan, 1):
        if job.get("cancel"):
            raise InterruptedError
        job["stage"] = f"Studying clip {i} of {total}"
        jpeg = extract_contact_sheet(path, span["start"], span["duration"])
        prompt = vision.describe_clip(jpeg, i, total)
        studio.check_prompt(prompt)
        out.append({**span, "prompt": prompt})
    captioner.release()
    return out


@contextlib.contextmanager
def studio_paths():
    """Route Image Studio's video renderer to Cinema outputs/uploads for one job."""
    saved = studio.OUTPUTS, studio.UPLOADS, studio.AUDIO_UPLOADS, studio.RUNTIME, studio.THUMBS
    studio.OUTPUTS = OUTPUTS
    studio.UPLOADS = UPLOADS
    studio.AUDIO_UPLOADS = RUNTIME / "audio"
    studio.RUNTIME = RUNTIME
    studio.THUMBS = THUMBS
    try:
        yield
    finally:
        studio.OUTPUTS, studio.UPLOADS, studio.AUDIO_UPLOADS, studio.RUNTIME, studio.THUMBS = saved


def run_cinema(job: dict) -> None:
    upload_meta(job["image"])
    scene_id = job.get("scene") or ""
    if scene_id:
        scene = scene_meta(scene_id)
        job["video"] = scene["video"]
        vid = video_meta(job["video"])
        path = Path(vid["path"])
        segments = [{k: s[k] for k in ("start", "duration", "prompt")} for s in scene["segments"]]
        job["stage"] = f"Using saved scene · {scene.get('name') or scene_id}"
        job["segment_prompts"] = [s["prompt"] for s in segments]
        job["segments_total"] = len(segments)
    else:
        vid = video_meta(job["video"])
        path = Path(vid["path"])
        segments = describe_video(path, job)
        job["segment_prompts"] = [s["prompt"] for s in segments]
    job["cinema_segments"] = segments
    if job.get("cancel"):
        raise InterruptedError
    ref_duration = probe_duration(path)
    with studio_paths():
        job["use_ref_audio"] = job.get("use_ref_audio", True)
        if job["use_ref_audio"]:
            job["stage"] = "Pulling audio from the reference"
            if scene_id:
                job["ref_audio"] = scene_ref_audio_id(scene_id)
                if not job["ref_audio"]:
                    job["ref_audio"] = import_reference_audio(path)
            else:
                job["ref_audio"] = import_reference_audio(path)
            if not job["ref_audio"]:
                job["use_ref_audio"] = False
                job["audio_note"] = "No usable audio track — generating without reference sound."
            else:
                job["audio_note"] = ""
        job["stage"] = "Preparing the video model"
        prepare_gpu()
        total = len(segments)
        for idx, seg in enumerate(segments):
            part = idx + 1
            part_label = f"Generating part {part} of {total}"
            if job.get("cancel"):
                raise InterruptedError
            if idx == 0:
                inner = studio.video_job(video_gen_payload(job, seg))
                inner.update(
                    id=f"{job['id']}_g{part}",
                    results=[],
                    cancel=job.get("cancel"),
                    h3_model=job.get("h3_model") or "",
                    h3_steps=job.get("h3_steps") or 8,
                )
                run_h3_video(job, inner, part_label)
            else:
                parent_id = job["video_id"]
                ext_body = {
                    "extend": parent_id,
                    "prompt": seg["prompt"],
                    "writer": False,
                    "seconds": segment_seconds(seg, job),
                    "count": 1,
                    "model": "h3",
                    "loras": job.get("loras") or [],
                    "h3Model": job.get("h3_model") or "",
                    "h3Steps": job.get("h3_steps") or 8,
                }
                inner = studio.extend_job(ext_body)
                inner.update(
                    id=f"{job['id']}_x{part}",
                    results=[],
                    cancel=job.get("cancel"),
                    h3_model=job.get("h3_model") or "",
                    h3_steps=job.get("h3_steps") or 8,
                )
                if job.get("ref_audio"):
                    inner["audio"] = job["ref_audio"]
                    inner["audio_start"] = max(0.0, float(seg["start"]))
                job["stage"] = f"{part_label} · Loading the video model"
                cinema_run_extend(inner)
                job["stage"] = inner.get("stage") or part_label
            if not inner.get("results"):
                raise ValueError("The video engine finished without a clip.")
            item = inner["results"][0]
            job["video_id"] = item["id"]
            job["result"] = item
            job.setdefault("results", []).append(item)
            _stamp_cinema_meta(job, item["id"])
        final_id = job["video_id"]
        if final_id:
            if job.get("ref_audio"):
                job["stage"] = "Laying down the reference soundtrack"
                mux_reference_audio(OUTPUTS / f"{final_id}.mp4", job["ref_audio"], ref_duration)
            meta = read_json(OUTPUTS / f"{final_id}.json", None)
            if meta:
                _stamp_cinema_meta(job, final_id)
                job["result"] = meta


def public_job(job: dict) -> dict:
    keys = (
        "id",
        "kind",
        "mode",
        "status",
        "stage",
        "error",
        "prompt",
        "result",
        "results",
        "created",
        "elapsed",
        "estimate",
        "position",
        "video",
        "image",
        "scene",
        "segments_total",
        "segment_prompts",
        "video_id",
        "audio_note",
    )
    out = {k: job.get(k) for k in keys}
    if job["status"] == "queued":
        with LOCK:
            waiting = [j for j in JOB_ORDER if JOBS[j]["status"] == "queued"]
        out["position"] = waiting.index(job["id"]) + 1 if job["id"] in waiting else None
    if job["status"] == "running" and job.get("started"):
        out["elapsed"] = round(time.time() - job["started"], 1)
    return out


def add_job(job: dict) -> dict:
    job.update(id=new_id(), status="queued", stage="Waiting", created=time.time(), error="", result=None, results=[])
    with LOCK:
        JOBS[job["id"]] = job
        JOB_ORDER.append(job["id"])
        finished = [j for j in JOB_ORDER if JOBS[j]["status"] not in ("queued", "running")]
        for old in finished[: max(0, len(JOB_ORDER) - 40)]:
            JOBS.pop(old, None)
            JOB_ORDER.remove(old)
    WORK.put(job["id"])
    return job


def cancel_job(job: dict) -> None:
    job["cancel"] = True
    if job["status"] == "queued":
        job.update(status="cancelled", stage="Cancelled")


def cinema_job(data: dict) -> dict:
    scene = str(data.get("scene") or "")
    video = str(data.get("video") or "")
    image = str(data.get("image") or "")
    if not ID_RE.match(image):
        raise ValueError("Choose a photo to animate first.")
    if ID_RE.match(scene):
        sm = scene_meta(scene)
        video = sm["video"]
        segs_count = len(sm["segments"])
        scene_loras = normalize_scene_loras(sm.get("loras"))
        scene_h3 = sm.get("h3_model") if isinstance(sm.get("h3_model"), str) else ""
        scene_steps = sm.get("h3_steps") if isinstance(sm.get("h3_steps"), int) else 8
        scene_sound = sm.get("sound") is not False
        scene_ref_audio = sm.get("use_ref_audio") is not False
    elif ID_RE.match(video):
        segs_count = max(1, len(segment_plan(video_meta(video)["duration"])))
    else:
        raise ValueError("Choose a reference video or a saved scene first.")
    video_meta(video)
    if not studio.video_ready("h3"):
        raise ValueError(f"{workflows.VIDEO_MODELS['h3']['label']} is still downloading. Open Image Studio once to finish.")
    if not scene and not captioner.available():
        raise ValueError("The prompt writer isn't installed. Open Prompt Generator once to download it.")
    h3 = studio.h3_fields(data)
    seconds = studio.video_seconds(data)
    est = segs_count * studio.estimate(studio.video_time_key("h3", "720", seconds))
    loras = data.get("loras") if isinstance(data.get("loras"), list) else []
    if ID_RE.match(scene):
        loras = scene_loras or normalize_scene_loras(loras)
        h3_model = scene_h3 or h3.get("h3_model") or ""
        h3_steps = scene_steps or h3.get("h3_steps") or 8
        sound = scene_sound
        use_ref = scene_ref_audio
    else:
        h3_model = h3.get("h3_model") or ""
        h3_steps = h3.get("h3_steps") or 8
        sound = data.get("sound") is not False
        use_ref = data.get("useRefAudio") is not False
        loras = normalize_scene_loras(loras)
    out = {
        "kind": "generate",
        "mode": "cinema",
        "video": video,
        "image": image,
        "model": "h3",
        "quality": "720",
        "engine": "h3",
        "seconds": seconds,
        "loras": loras,
        "h3_model": h3_model,
        "h3_steps": h3_steps,
        "sound": sound,
        "use_ref_audio": use_ref,
        "estimate": est,
        "segments_total": segs_count,
    }
    if ID_RE.match(scene):
        out["scene"] = scene
    return out


_GALLERY_SLIM_KEYS = (
    "id",
    "mode",
    "created",
    "video",
    "favorite",
    "engine",
    "duration",
    "quality",
    "loras",
    "h3Model",
    "steps",
    "segments",
)


def gallery(limit: int | None = None, offset: int = 0, slim: bool = False) -> list[dict]:
    if not OUTPUTS.is_dir():
        return []
    items = [read_json(p, None) for p in OUTPUTS.glob("*.json")]
    items = sorted(
        (i for i in items if i and (OUTPUTS / f"{i['id']}.png").is_file()),
        key=lambda i: -i.get("created", 0),
    )
    if offset > 0:
        items = items[offset:]
    out: list[dict] = []
    for i in items:
        row = dict(i)
        row["video"] = bool(row.get("video")) and (OUTPUTS / f"{row['id']}.mp4").is_file()
        fav = row.get("favorite")
        ext = ".mp4" if row["video"] else ".png"
        row["favorite"] = bool(fav) and (FAVORITES / f"{fav}{ext}").is_file()
        if slim:
            out.append({k: row.get(k) for k in _GALLERY_SLIM_KEYS})
        else:
            out.append(row)
        if limit is not None and len(out) >= limit:
            break
    return out


def gallery_item(item_id: str) -> dict | None:
    if not ID_RE.match(item_id or ""):
        return None
    item = read_json(OUTPUTS / f"{item_id}.json", None)
    if not item or not (OUTPUTS / f"{item_id}.png").is_file():
        return None
    item = dict(item)
    item["video"] = bool(item.get("video")) and (OUTPUTS / f"{item_id}.mp4").is_file()
    fav = item.get("favorite")
    ext = ".mp4" if item["video"] else ".png"
    item["favorite"] = bool(fav) and (FAVORITES / f"{fav}{ext}").is_file()
    return item


_SCENE_SLIM_KEYS = ("id", "name", "created", "video", "duration", "segments_total", "has_audio")
_SCENE_AUDIO_EXT = ".wav"


def scene_thumb_path(scene_id: str) -> Path:
    return SCENES / f"{scene_id}.jpg"


def scene_audio_path(scene_id: str) -> Path:
    return SCENES / f"{scene_id}{_SCENE_AUDIO_EXT}"


def normalize_scene_loras(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    by_file: dict[str, str] = {}
    for row in studio.h3_loras():
        lid = row.get("id")
        if not lid:
            continue
        for key in ("high", "low", "label"):
            name = row.get(key)
            if isinstance(name, str) and name:
                by_file[Path(name).name] = lid
                by_file[name] = lid
        by_file[lid] = lid
    out: list[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        lid = row.get("id") or row.get("file")
        if isinstance(lid, str) and lid in by_file:
            lid = by_file[lid]
        elif isinstance(lid, str) and "/" in lid:
            lid = Path(lid).stem
        if not lid:
            continue
        try:
            strength = float(row.get("strength", 1.0))
        except (TypeError, ValueError):
            strength = 1.0
        out.append({"id": str(lid), "strength": round(strength, 3)})
    return out


def scene_ref_audio_id(scene_id: str) -> str | None:
    wav = scene_audio_path(scene_id)
    if not wav.is_file() or wav.stat().st_size < 200:
        return None
    with studio_paths():
        studio.AUDIO_UPLOADS.mkdir(parents=True, exist_ok=True)
        aid = new_id()
        dest = studio.AUDIO_UPLOADS / f"{aid}{_SCENE_AUDIO_EXT}"
        shutil.copyfile(wav, dest)
        duration = probe_duration(wav)
        write_json(
            studio.AUDIO_UPLOADS / f"{aid}.json",
            {"id": aid, "name": "scene-reference.wav", "ext": _SCENE_AUDIO_EXT, "duration": round(duration, 2)},
        )
        return aid


def scene_meta(scene_id: str) -> dict:
    if not ID_RE.match(scene_id or ""):
        raise ValueError("That scene is gone.")
    meta = read_json(SCENES / f"{scene_id}.json", None)
    if not meta or not scene_thumb_path(scene_id).is_file():
        raise ValueError("That scene is gone.")
    video_meta(meta["video"])
    if not isinstance(meta.get("segments"), list) or not meta["segments"]:
        raise ValueError("That scene has no saved captions.")
    return meta


def scenes_list(slim: bool = True) -> list[dict]:
    if not SCENES.is_dir():
        return []
    items = []
    for path in SCENES.glob("*.json"):
        meta = read_json(path, None)
        if not meta or not scene_thumb_path(meta["id"]).is_file():
            continue
        row = dict(meta)
        if slim:
            items.append(scene_public(row, slim=True))
        else:
            items.append(scene_public(row, slim=False))
    return sorted(items, key=lambda i: -i.get("created", 0))


def scene_rename(scene_id: str, name: str) -> dict:
    meta = scene_meta(scene_id)
    clean = (name or "").strip()[:120]
    if not clean:
        raise ValueError("Enter a name for this scene.")
    meta["name"] = clean
    write_json(SCENES / f"{scene_id}.json", meta)
    return scene_public(meta, slim=True) | {"name": clean}


def scene_delete(scene_id: str) -> None:
    if not ID_RE.match(scene_id or ""):
        return
    (SCENES / f"{scene_id}.json").unlink(missing_ok=True)
    scene_thumb_path(scene_id).unlink(missing_ok=True)
    scene_audio_path(scene_id).unlink(missing_ok=True)


def scene_public(meta: dict, slim: bool = True) -> dict:
    row = dict(meta)
    row["segments_total"] = len(row.get("segments") or [])
    row["has_audio"] = scene_audio_path(meta["id"]).is_file()
    if not slim:
        return {
            "id": row["id"],
            "name": row.get("name", ""),
            "created": row.get("created"),
            "video": row.get("video"),
            "duration": row.get("duration"),
            "segments_total": row["segments_total"],
            "has_audio": row["has_audio"],
            "loras": row.get("loras") or [],
            "h3_model": row.get("h3_model") or "",
            "h3_steps": row.get("h3_steps") or 8,
            "sound": row.get("sound") is not False,
            "use_ref_audio": row.get("use_ref_audio") is not False,
        }
    return {k: row.get(k) for k in _SCENE_SLIM_KEYS} | {
        "has_audio": row["has_audio"],
        "segments_total": row["segments_total"],
    }


def resolve_ref_video(item: dict) -> str:
    """Find the reference upload id for a Cinema gallery item (older runs omitted ref_video)."""
    ref_video = str(item.get("ref_video") or "")
    if ID_RE.match(ref_video):
        return ref_video
    parent = item.get("parent")
    seen: set[str] = set()
    while parent and parent not in seen:
        seen.add(str(parent))
        pm = read_json(OUTPUTS / f"{parent}.json", None)
        if not pm:
            break
        ref_video = str(pm.get("ref_video") or "")
        if ID_RE.match(ref_video):
            return ref_video
        parent = pm.get("parent")
    cjob = str(item.get("cinema_job") or "")
    with LOCK:
        job = JOBS.get(cjob)
    if job:
        ref_video = str(job.get("video") or "")
        if ID_RE.match(ref_video):
            return ref_video
    ref_aid = str(item.get("ref_audio") or item.get("audio") or "")
    if ID_RE.match(ref_aid):
        am = read_json(RUNTIME / "audio" / f"{ref_aid}.json", None)
        if am:
            adur = float(am.get("duration") or 0)
            if adur >= 0.5:
                best_id, best_gap = "", 1e9
                for meta_path in VIDEO_UPLOADS.glob("*.json"):
                    vm = read_json(meta_path, None)
                    if not vm or not ID_RE.match(str(vm.get("id") or "")):
                        continue
                    vid = str(vm["id"])
                    ext = vm.get("ext") or ".mp4"
                    if not (VIDEO_UPLOADS / f"{vid}{ext}").is_file():
                        continue
                    gap = abs(float(vm.get("duration") or 0) - adur)
                    if gap < best_gap:
                        best_gap, best_id = gap, vid
                if best_id and best_gap <= 0.35:
                    return best_id
    raise ValueError(
        "This result has no reference video on file. Pick the reference again or run a new Cinema job, then save."
    )


def _stamp_cinema_meta(job: dict, out_id: str) -> None:
    meta = read_json(OUTPUTS / f"{out_id}.json", None)
    if not meta:
        return
    meta.update(
        mode="cinema",
        cinema_job=job.get("id"),
        segment_prompts=job.get("segment_prompts"),
        cinema_segments=job.get("cinema_segments"),
        ref_video=job.get("video"),
        scene_source=job.get("scene") or "",
        quality="720",
        engine="h3",
        ref_audio=job.get("ref_audio"),
    )
    write_json(OUTPUTS / f"{out_id}.json", meta)


DEFAULT_SAVE_DIR = "media/Cinema AI"
DEFAULT_GDRIVE_SAVE_DIR = "gdrive:My Drive/Cinema AI"


def save_outputs_to_pc(ids: list, dir_rel: str) -> dict:
    clean = [i for i in dict.fromkeys(str(x) for x in (ids or [])) if ID_RE.match(i)]
    if not clean:
        raise ValueError("Nothing to save yet.")
    folder = studio.pc_path(dir_rel or DEFAULT_SAVE_DIR)
    folder.mkdir(parents=True, exist_ok=True)
    saved = []
    for out_id in clean:
        item = read_json(OUTPUTS / f"{out_id}.json", {}) or {}
        video = bool(item.get("video")) and (OUTPUTS / f"{out_id}.mp4").is_file()
        src = OUTPUTS / (f"{out_id}.mp4" if video else f"{out_id}.png")
        if not src.is_file():
            raise ValueError("That result is gone.")
        dest = studio.unique_pc_file(folder, f"cinema-ai-{out_id}", ".mp4" if video else ".png")
        shutil.copyfile(src, dest)
        saved.append(studio.pc_rel(dest))
    return {"saved": saved, "dir": studio.pc_rel(folder)}


def scene_from_output(output_id: str, name: str = "") -> dict:
    if not ID_RE.match(output_id or ""):
        raise ValueError("That result is gone.")
    item = read_json(OUTPUTS / f"{output_id}.json", None)
    if not item or not (OUTPUTS / f"{output_id}.png").is_file():
        raise ValueError("That result is gone.")
    prompts = item.get("segment_prompts") or item.get("prompts") or []
    segments = item.get("cinema_segments")
    ref_video = resolve_ref_video(item)
    if not segments:
        if not prompts:
            raise ValueError("This result has no saved motion captions.")
        plan = segment_plan(video_meta(ref_video)["duration"])
        segments = []
        for i, prompt in enumerate(prompts):
            span = plan[i] if i < len(plan) else plan[-1]
            segments.append({"start": span["start"], "duration": span["duration"], "prompt": prompt})
    vpath = Path(video_meta(ref_video)["path"])
    uid = new_id()
    SCENES.mkdir(parents=True, exist_ok=True)
    thumb_src = video_thumb_bytes(vpath)
    shutil.copyfile(thumb_src, scene_thumb_path(uid))
    label = (name or "").strip()[:120] or f"Scene {uid[:6]}"
    loras = normalize_scene_loras(item.get("loras"))
    h3_model = str(item.get("h3Model") or item.get("h3_model") or "")
    try:
        h3_steps = int(item.get("steps") or item.get("h3_steps") or 8)
    except (TypeError, ValueError):
        h3_steps = 8
    sound = item.get("sound") is not False
    use_ref_audio = bool(item.get("ref_audio")) or item.get("use_ref_audio") is not False
    ref_aid = str(item.get("ref_audio") or item.get("audio") or "")
    audio_src = None
    if ID_RE.match(ref_aid):
        am = read_json(RUNTIME / "audio" / f"{ref_aid}.json", None)
        if am:
            audio_src = RUNTIME / "audio" / f"{ref_aid}{am.get('ext', _SCENE_AUDIO_EXT)}"
        if not audio_src or not audio_src.is_file():
            audio_src = RUNTIME / "audio" / f"{ref_aid}{_SCENE_AUDIO_EXT}"
    if audio_src and audio_src.is_file():
        shutil.copyfile(audio_src, scene_audio_path(uid))
    elif use_ref_audio:
        with studio_paths():
            pulled = import_reference_audio(vpath)
        if pulled:
            am = studio.audio_meta(pulled)
            src = RUNTIME / "audio" / f"{am['id']}{am.get('ext', _SCENE_AUDIO_EXT)}"
            if src.is_file():
                shutil.copyfile(src, scene_audio_path(uid))
    meta = {
        "id": uid,
        "name": label,
        "created": time.time(),
        "video": ref_video,
        "duration": round(video_meta(ref_video)["duration"], 2),
        "segments": segments,
        "source_output": output_id,
        "loras": loras,
        "h3_model": h3_model,
        "h3_steps": h3_steps,
        "sound": sound,
        "use_ref_audio": use_ref_audio and scene_audio_path(uid).is_file(),
    }
    write_json(SCENES / f"{uid}.json", meta)
    return scene_public(meta, slim=True)


def set_favorite(out_id: str, on: bool) -> dict:
    if not ID_RE.match(out_id or ""):
        raise ValueError("That result is gone.")
    item = read_json(OUTPUTS / f"{out_id}.json", None)
    if not item:
        raise ValueError("That result is gone.")
    video = bool(item.get("video")) and (OUTPUTS / f"{out_id}.mp4").is_file()
    ext = ".mp4" if video else ".png"
    src = OUTPUTS / f"{out_id}{ext}"
    if not src.is_file():
        raise ValueError("That result is gone.")
    FAVORITES.mkdir(parents=True, exist_ok=True)
    fav_path = FAVORITES / f"{out_id}{ext}"
    if on:
        shutil.copyfile(src, fav_path)
        item["favorite"] = out_id
    else:
        fav_path.unlink(missing_ok=True)
        item.pop("favorite", None)
    write_json(OUTPUTS / f"{out_id}.json", item)
    return {"id": out_id, "favorite": on}


def worker() -> None:
    while True:
        job_id = WORK.get()
        with LOCK:
            job = JOBS.get(job_id)
            start = bool(job) and job["status"] == "queued" and not job.get("cancel")
            if start:
                job.update(status="running", started=time.time())
            elif job and job["status"] == "queued":
                job.update(status="cancelled", stage="Cancelled")
        if not start:
            continue
        try:
            run_cinema(job)
            job.update(status="done", stage="Done")
        except InterruptedError:
            job.update(status="cancelled", stage="Cancelled")
        except captioner.MinorRefusal as exc:
            job.update(status="error", stage="Refused", error=str(exc))
        except (captioner.CaptionError, engine.EngineError, engine.EngineCudaError, ValueError, OSError) as exc:
            job.update(status="error", stage="Failed", error=str(exc))
        except Exception as exc:
            job.update(status="error", stage="Failed", error=f"Unexpected error: {exc}")
        job["elapsed"] = round(time.time() - job["started"], 1)


# ---------- PC browse (videos + images) ----------

def pc_list_videos(rel: str, sort: str = "new") -> dict:
    data = studio.pc_list(rel, "images", sort)

    def with_videos(payload: dict) -> dict:
        folder = studio.pc_path(payload["dir"])
        exts = VIDEO_EXT
        files = []
        with os.scandir(folder) as it:
            for entry in it:
                if studio.pc_hidden(entry.name):
                    continue
                try:
                    if entry.is_file() and Path(entry.name).suffix.lower() in exts:
                        files.append(studio.pc_image_entry(entry, payload.get("root_id")))
                except OSError:
                    continue
        studio.pc_sort(files, sort)
        payload = dict(payload)
        payload["kind"] = "video"
        payload["videos"] = files[:400]
        payload["images"] = []
        payload["total"] = len(files)
        payload["more"] = max(0, len(files) - 400)
        return payload

    return with_videos(data)


def pc_search_videos(text: str, sort: str = "new", scope: str = "") -> dict:
    data = studio.pc_search(text, "images", sort, scope)
    terms = text.casefold().split()
    files = [row for row in data.get("images") or [] if Path(row["name"]).suffix.lower() in VIDEO_EXT]
    if terms:
        files = [row for row in files if all(t in row["name"].casefold() for t in terms)]
    studio.pc_sort(files, sort)
    data["kind"] = "video"
    data["videos"] = files
    data["images"] = []
    return data


def pc_import_video(rel_path: str) -> dict:
    path = studio.pc_path(rel_path)
    if path.suffix.lower() not in VIDEO_EXT:
        raise ValueError("That file isn't a video I can use.")
    return save_video(path.read_bytes(), path.name)


def pc_import_image(rel_path: str) -> dict:
    path = studio.pc_image(rel_path)
    return save_upload(path.read_bytes())


def video_thumb_bytes(path: Path) -> Path:
    THUMBS.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:16]
    out = THUMBS / f"vid-{key}.jpg"
    if out.is_file() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    if not FFMPEG:
        raise ValueError("ffmpeg isn't installed on this PC.")
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", str(path), "-frames:v", "1", "-q:v", "4", str(out)],
        check=True,
        timeout=60,
        creationflags=NO_WINDOW,
    )
    return out