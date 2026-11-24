"""Storyboard scene packs under scenes/<name>/ — frames, descriptions, audio, Create-style video."""

from __future__ import annotations

import re
import shutil
import subprocess
import time
from pathlib import Path

import captioner
from image_studio import domain as studio

from cinema_ai import domain as d
from cinema_ai import vision

_SCENE_AUDIO_EXT = ".wav"
_WIN_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def scene_folder_name(name: str) -> str:
    """Turn the user's scene name into a unique Windows-safe folder under scenes/."""
    label = _WIN_BAD.sub("", (name or "").strip())
    label = re.sub(r"\s+", " ", label).strip(" .")
    if not label:
        label = f"Scene {d.new_id()[:6]}"
    label = label[:100]
    # Reserved device names on Windows.
    if label.upper().split(".")[0] in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "LPT1",
        "LPT2",
        "LPT3",
    }:
        label = f"Scene {label}"
    base = label
    n = 2
    while (d.SCENES / label).exists() or (d.SCENES / f"{label}.json").is_file():
        suffix = f" ({n})"
        label = (base[: max(1, 100 - len(suffix))] + suffix).strip(" .")
        n += 1
        if n > 500:
            label = f"{base[:80]}-{d.new_id()[:6]}"
            break
    return label


def pack_root(sid: str) -> Path:
    return d.SCENES / sid


def pack_manifest_path(sid: str) -> Path:
    return pack_root(sid) / "manifest.json"


def pack_thumb_path(sid: str) -> Path:
    return pack_root(sid) / "thumb.jpg"


def pack_audio_path(sid: str) -> Path:
    return pack_root(sid) / "audio.wav"


def frame_rel(index: int, which: str) -> str:
    """Flat organizing names: 00-first.jpg, 00-last.jpg, 01-first.jpg, …"""
    key = "first" if which == "first" else "last"
    return f"{int(index):02d}-{key}.jpg"


def desc_rel(index: int) -> str:
    return f"{int(index):02d}-description.txt"


def desc_path(sid: str, index: int) -> Path:
    """Prefer flat 00-description.txt; fall back to older segments/00/description.txt."""
    flat = pack_root(sid) / desc_rel(index)
    if flat.is_file():
        return flat
    legacy = pack_root(sid) / "segments" / f"{int(index):02d}" / "description.txt"
    return flat if not legacy.is_file() else legacy


def is_pack(sid: str) -> bool:
    return pack_manifest_path(sid).is_file()


def load_pack(sid: str) -> dict:
    if not d.valid_scene_id(sid):
        raise ValueError("That scene is gone.")
    meta = d.read_json(pack_manifest_path(sid), None)
    if not meta or not isinstance(meta.get("segments"), list) or not meta["segments"]:
        raise ValueError("That scene is gone.")
    return meta


def frame_path(sid: str, index: int, which: str) -> Path:
    meta = load_pack(sid)
    segs = meta.get("segments") or []
    if index < 0 or index >= len(segs):
        raise ValueError("That segment isn't in this scene.")
    key = "first" if which == "first" else "last"
    root = pack_root(sid)
    candidates = [
        root / str(segs[index].get(key) or ""),
        root / frame_rel(index, key),
        root / "segments" / f"{int(index):02d}" / f"{key}.jpg",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise ValueError("That frame is gone.")


def public_pack(meta: dict, slim: bool = True) -> dict:
    segs = meta.get("segments") or []
    sid = meta["id"]
    row = {
        "id": sid,
        "name": meta.get("name") or "",
        "created": meta.get("created"),
        "video": meta.get("video"),
        "duration": meta.get("duration"),
        "segments_total": len(segs),
        "has_audio": pack_audio_path(sid).is_file(),
        "kind": "pack",
        "loras": meta.get("loras") or [],
        "h3_model": meta.get("h3_model") or "",
        "h3_steps": meta.get("h3_steps") or 8,
        "sound": meta.get("sound") is not False,
        "use_ref_audio": meta.get("use_ref_audio") is not False,
    }
    if slim:
        return row
    out_segs = []
    for s in segs:
        if not isinstance(s, dict):
            continue
        out_segs.append(
            {
                "index": int(s.get("index", 0)),
                "start": s.get("start"),
                "duration": s.get("duration"),
                "description": s.get("description") or s.get("prompt") or "",
                "prompt": s.get("description") or s.get("prompt") or "",
                "first": s.get("first"),
                "last": s.get("last"),
            }
        )
    preview = out_segs[0]["description"] if out_segs else ""
    return {**row, "segments": out_segs, "preview_prompt": preview, "prompt_note": meta.get("prompt_note") or ""}


def patch_segment(sid: str, index: int, description: str) -> dict:
    meta = load_pack(sid)
    segs = meta["segments"]
    if index < 0 or index >= len(segs):
        raise ValueError("That segment isn't in this scene.")
    text = (description or "").strip()
    if not text:
        raise ValueError("Enter a description for this segment.")
    text = text[:4000]
    segs[index]["description"] = text
    segs[index]["prompt"] = text
    desc = pack_root(sid) / desc_rel(index)
    desc.write_text(text, encoding="utf-8")
    # Drop legacy nested description if present so the flat file is the source of truth.
    legacy = pack_root(sid) / "segments" / f"{index:02d}" / "description.txt"
    legacy.unlink(missing_ok=True)
    d.write_json(pack_manifest_path(sid), meta)
    return public_pack(meta, slim=False)


def set_frame(sid: str, index: int, which: str, image_id: str) -> dict:
    """Replace a segment first/last still with an uploaded image."""
    meta = load_pack(sid)
    segs = meta["segments"]
    if index < 0 or index >= len(segs):
        raise ValueError("That segment isn't in this scene.")
    key = "first" if which == "first" else "last"
    if key not in ("first", "last"):
        raise ValueError("Choose first or last frame.")
    src = d.UPLOADS / f"{d.upload_meta(image_id)['id']}.jpg"
    if not src.is_file():
        raise ValueError("That photo is gone.")
    rel = frame_rel(index, key)
    dest = pack_root(sid) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    segs[index][key] = rel
    d.write_json(pack_manifest_path(sid), meta)
    if index == 0 and key == "first":
        shutil.copyfile(dest, pack_thumb_path(sid))
    return public_pack(meta, slim=False)


def rewrite_prompts(sid: str, note: str) -> dict:
    """Apply a global note to every segment description (keeps motion, updates appearance)."""
    note = (note or "").strip()
    if not note:
        raise ValueError("Enter a prompt note to update the descriptions.")
    meta = load_pack(sid)
    segs = meta["segments"]
    fake = {"prompt_note": note[:2000], "cancel": False}
    patch = [{"prompt": s.get("description") or s.get("prompt") or "", "start": s.get("start"), "duration": s.get("duration")} for s in segs]
    d.apply_photo_prompt_notes(fake, patch)
    for s, p in zip(segs, patch):
        text = p["prompt"]
        idx = int(s["index"])
        s["description"] = text
        s["prompt"] = text
        (pack_root(sid) / desc_rel(idx)).write_text(text, encoding="utf-8")
        legacy = pack_root(sid) / "segments" / f"{idx:02d}" / "description.txt"
        legacy.unlink(missing_ok=True)
    meta["prompt_note"] = note[:2000]
    d.write_json(pack_manifest_path(sid), meta)
    return public_pack(meta, slim=False)


def delete_pack(sid: str) -> None:
    root = pack_root(sid)
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)


def rename_pack(sid: str, name: str) -> dict:
    meta = load_pack(sid)
    clean = (name or "").strip()[:120]
    if not clean:
        raise ValueError("Enter a name for this scene.")
    new_id = scene_folder_name(clean) if clean != sid else sid
    # Avoid scene_folder_name bumping when renaming to the same folder with only case/spacing tweaks.
    if clean == sid or (pack_root(clean).resolve() == pack_root(sid).resolve()):
        new_id = sid
    elif not pack_root(clean).exists() and not (d.SCENES / f"{clean}.json").is_file():
        new_id = _WIN_BAD.sub("", clean)
        new_id = re.sub(r"\s+", " ", new_id).strip(" .")[:100] or sid
    else:
        new_id = scene_folder_name(clean)
        # scene_folder_name skips existing sid; if clean collides with another scene, keep unique name.
    meta["name"] = clean
    meta["id"] = new_id
    if new_id != sid:
        src = pack_root(sid)
        dest = pack_root(new_id)
        if dest.exists():
            raise ValueError("A scene with that folder name already exists.")
        src.rename(dest)
        d.write_json(pack_manifest_path(new_id), meta)
    else:
        d.write_json(pack_manifest_path(sid), meta)
    return public_pack(meta, slim=True)


def import_frame(sid: str, index: int, which: str) -> dict:
    return d.save_upload(frame_path(sid, index, which).read_bytes())


def audio_to_ref(sid: str) -> str | None:
    """Copy scenes/<sid>/audio.wav into the active AUDIO_UPLOADS (call inside studio_paths)."""
    wav = pack_audio_path(sid)
    if not wav.is_file() or wav.stat().st_size < 200:
        return None
    studio.AUDIO_UPLOADS.mkdir(parents=True, exist_ok=True)
    (d.RUNTIME / "audio").mkdir(parents=True, exist_ok=True)
    aid = d.new_id()
    dest = studio.AUDIO_UPLOADS / f"{aid}{_SCENE_AUDIO_EXT}"
    shutil.copyfile(wav, dest)
    # Mirror into Cinema runtime so mux still finds it after studio_paths exits.
    cinema_dest = d.RUNTIME / "audio" / f"{aid}{_SCENE_AUDIO_EXT}"
    if cinema_dest.resolve() != dest.resolve():
        shutil.copyfile(wav, cinema_dest)
    duration = d.probe_duration(wav)
    meta = {"id": aid, "name": "scene-reference.wav", "ext": _SCENE_AUDIO_EXT, "duration": round(duration, 2), "scene": sid}
    d.write_json(studio.AUDIO_UPLOADS / f"{aid}.json", meta)
    if cinema_dest.resolve() != dest.resolve():
        d.write_json(d.RUNTIME / "audio" / f"{aid}.json", meta)
    return aid


def scene_video_job(data: dict) -> dict:
    sid = str(data.get("scene") or data.get("sceneId") or "")
    meta = load_pack(sid)
    if not studio.video_ready("h3"):
        raise ValueError("MiniMax H3 is still downloading. Open Image Studio once to finish.")
    h3 = studio.h3_fields(data)
    seconds = studio.video_seconds(data)
    loras = d.normalize_scene_loras(data.get("loras") if isinstance(data.get("loras"), list) else []) or d.normalize_scene_loras(
        meta.get("loras")
    )
    segs = meta.get("segments") or []
    est = len(segs) * studio.estimate(studio.video_time_key("h3", "720", seconds))
    return {
        "kind": "generate",
        "mode": "scene_video",
        "scene": sid,
        "seconds": seconds,
        "loras": loras,
        "h3_model": h3.get("h3_model") or meta.get("h3_model") or "",
        "h3_steps": h3.get("h3_steps") or meta.get("h3_steps") or 8,
        "sound": data.get("sound") if "sound" in data else meta.get("sound") is not False,
        "use_ref_audio": data.get("useRefAudio") if "useRefAudio" in data else meta.get("use_ref_audio") is not False,
        "estimate": est,
        "segments_total": len(segs),
        "video": meta.get("video"),
    }


def run_scene_video(job: dict) -> None:
    """Same combine path as Create → Action: part 1 i2v, then H3 extend for each next segment."""
    sid = job["scene"]
    meta = load_pack(sid)
    segs = meta.get("segments") or []
    total = len(segs)
    job["segments_total"] = total
    job["video"] = meta.get("video")

    scene_wav = pack_audio_path(sid)
    want_audio = bool(job.get("use_ref_audio", True)) and scene_wav.is_file() and scene_wav.stat().st_size >= 200
    if job.get("use_ref_audio", True) and not want_audio:
        job["use_ref_audio"] = False
        job["audio_note"] = "No scene audio — generating without reference sound."
    else:
        job["audio_note"] = ""

    fused = []
    for seg in segs:
        if job.get("cancel"):
            raise InterruptedError
        idx = int(seg["index"])
        first = import_frame(sid, idx, "first")
        last = import_frame(sid, idx, "last")
        prompt = str(seg.get("description") or seg.get("prompt") or "").strip()
        if not prompt:
            raise ValueError(f"Segment {idx + 1} needs a description.")
        studio.check_prompt(prompt)
        fused.append(
            {
                "index": idx,
                "start": seg.get("start", 0),
                "duration": seg.get("duration", 10),
                "prompt": prompt,
                "first_image": first["id"],
                "end_image": last["id"],
            }
        )

    job["segment_prompts"] = [s["prompt"] for s in fused]
    job["cinema_segments"] = [{k: s[k] for k in ("start", "duration", "prompt")} for s in fused]
    ref_duration = float(meta.get("duration") or 0) or sum(float(s.get("duration") or 0) for s in fused)

    with d.studio_paths():
        # Always re-copy from the scene pack so lip-sync + mux never depend on a stale upload id.
        if want_audio:
            job["stage"] = "Preparing audio"
            job["ref_audio"] = audio_to_ref(sid)
            if not job["ref_audio"]:
                job["use_ref_audio"] = False
                want_audio = False
                job["audio_note"] = "No scene audio — generating without reference sound."
        job["stage"] = "Preparing the video model"
        d.prepare_gpu()
        for i, seg in enumerate(fused):
            if job.get("cancel"):
                raise InterruptedError
            part = i + 1
            part_label = f"Generating part {part} of {total}"
            if i == 0:
                # First segment: dual-frame i2v from that beat's first → last still (same as Create start).
                payload = d.video_gen_payload(
                    {**job, "image": seg["first_image"], "end_image": seg["end_image"]},
                    seg,
                )
                inner = studio.video_job(payload)
                inner.update(
                    id=f"{job['id']}_g{part}",
                    results=[],
                    cancel=job.get("cancel"),
                    h3_model=job.get("h3_model") or "",
                    h3_steps=job.get("h3_steps") or 8,
                )
                d.run_h3_video(job, inner, part_label)
            else:
                # Later segments: extend the running master clip — same as Create → Action.
                parent_id = job["video_id"]
                ext_body = {
                    "extend": parent_id,
                    "prompt": seg["prompt"],
                    "writer": False,
                    "seconds": d.segment_seconds(seg, job),
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
                d.cinema_run_extend(inner)
                job["stage"] = inner.get("stage") or part_label
            if not inner.get("results"):
                raise ValueError("The video engine finished without a clip.")
            item = inner["results"][0]
            job["video_id"] = item["id"]
            job["result"] = item
            job.setdefault("results", []).append(item)
            d._stamp_cinema_meta(job, item["id"])

        final_id = job["video_id"]
        if not final_id:
            raise ValueError("The video engine finished without a clip.")
        final_mp4 = d.OUTPUTS / f"{final_id}.mp4"
        if want_audio and scene_wav.is_file():
            job["stage"] = "Laying down the reference soundtrack"
            d.mux_reference_audio(final_mp4, job.get("ref_audio") or "", ref_duration, audio_path=scene_wav)
        out_meta = d.read_json(d.OUTPUTS / f"{final_id}.json", None) or job.get("result") or {}
        out_meta.update(
            {
                "id": final_id,
                "mode": "scene_video",
                "video": True,
                "duration": round(ref_duration or d.probe_duration(final_mp4), 2),
                "prompt": job["segment_prompts"][0] if job["segment_prompts"] else "",
                "prompts": job["segment_prompts"],
                "segment_prompts": job["segment_prompts"],
                "cinema_segments": job["cinema_segments"],
                "segments": total,
                "cinema_job": job["id"],
                "scene_source": sid,
                "ref_video": meta.get("video"),
                "ref_audio": job.get("ref_audio"),
            }
        )
        d.write_json(d.OUTPUTS / f"{final_id}.json", out_meta)
        d._stamp_cinema_meta(job, final_id)
        job["result"] = out_meta
        job["stage"] = "Done"


def extract_segment_ends(path: Path, start: float, duration: float) -> tuple[bytes, bytes]:
    if not d.FFMPEG:
        raise ValueError("ffmpeg isn't installed on this PC.")
    frames_dir = d.RUNTIME / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    tag = d.new_id()
    span = max(duration, 0.05)
    first_t = max(0.0, start)
    last_t = max(first_t, start + span * 0.98)
    outs: list[Path] = []
    for label, t in (("first", first_t), ("last", last_t)):
        out = frames_dir / f"{tag}_{label}.jpg"
        subprocess.run(
            [
                d.FFMPEG,
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
            ],
            check=True,
            timeout=120,
            creationflags=d.NO_WINDOW,
        )
        outs.append(out)
    first_bytes, last_bytes = outs[0].read_bytes(), outs[1].read_bytes()
    for p in outs:
        p.unlink(missing_ok=True)
    return first_bytes, last_bytes


def storyboard_analyze_job(data: dict) -> dict:
    video = str(data.get("video") or "")
    if not d.ID_RE.match(video):
        raise ValueError("Choose a reference video first.")
    name = str(data.get("name") or "").strip()[:120]
    if not name:
        raise ValueError("Name this storyboard before analyzing.")
    vid = d.video_meta(video)
    if not captioner.available():
        raise ValueError("The prompt writer isn't installed. Open Prompt Generator once to download it.")
    if not d.FFMPEG or not d.FFPROBE:
        raise ValueError("ffmpeg isn't installed on this PC.")
    note = str(data.get("promptNote") or data.get("cinemaPromptNote") or "").strip()[:2000]
    segs_count = max(1, len(d.segment_plan(vid["duration"])))
    return {
        "kind": "generate",
        "mode": "storyboard",
        "video": video,
        "prompt_note": note,
        "name": name,
        "estimate": segs_count * 8,
        "segments_total": segs_count,
    }


def run_storyboard_analyze(job: dict) -> None:
    """Analyze reference video and save a scene pack under scenes/<id>/."""
    vid = d.video_meta(job["video"])
    path = Path(vid["path"])
    duration = float(vid["duration"])
    plan = d.segment_plan(duration)
    total = len(plan)
    job["segments_total"] = total
    label = (job.get("name") or "").strip()[:120]
    if not label:
        raise ValueError("Name this storyboard before analyzing.")
    sid = scene_folder_name(label)
    root = pack_root(sid)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)

    studio.prep_captioner()
    segments: list[dict] = []
    try:
        for i, span in enumerate(plan):
            if job.get("cancel"):
                raise InterruptedError
            part = i + 1
            job["stage"] = f"Studying clip {part} of {total}"
            jpeg = d.extract_contact_sheet(path, span["start"], span["duration"])
            prompt = vision.describe_clip(jpeg, part, total)
            studio.check_prompt(prompt)
            job["stage"] = f"Saving frames {part} of {total}"
            first_b, last_b = extract_segment_ends(path, span["start"], span["duration"])
            first_name = frame_rel(i, "first")
            last_name = frame_rel(i, "last")
            (root / first_name).write_bytes(first_b)
            (root / last_name).write_bytes(last_b)
            (root / desc_rel(i)).write_text(prompt, encoding="utf-8")
            segments.append(
                {
                    "index": i,
                    "start": span["start"],
                    "duration": span["duration"],
                    "description": prompt,
                    "prompt": prompt,
                    "first": first_name,
                    "last": last_name,
                }
            )
    finally:
        captioner.release()

    note = str(job.get("prompt_note") or "").strip()
    if note:
        job["stage"] = "Applying prompt notes"
        fake_job = {"prompt_note": note, "cancel": job.get("cancel")}
        patch_segs = [{"prompt": s["description"], "start": s["start"], "duration": s["duration"]} for s in segments]
        d.apply_photo_prompt_notes(fake_job, patch_segs)
        for s, patched in zip(segments, patch_segs):
            s["description"] = patched["prompt"]
            s["prompt"] = patched["prompt"]
            (root / desc_rel(s["index"])).write_text(s["description"], encoding="utf-8")

    job["stage"] = "Saving reference audio"
    has_audio = False
    with d.studio_paths():
        audio_id = d.import_reference_audio(path)
    if audio_id:
        am = d.read_json(d.RUNTIME / "audio" / f"{audio_id}.json", {}) or {}
        src = d.RUNTIME / "audio" / f"{audio_id}{am.get('ext', '.wav')}"
        if src.is_file():
            shutil.copyfile(src, pack_audio_path(sid))
            has_audio = True

    # Thumb from first segment first frame
    shutil.copyfile(root / segments[0]["first"], pack_thumb_path(sid))

    meta = {
        "id": sid,
        "name": label,
        "created": time.time(),
        "video": job["video"],
        "duration": round(duration, 2),
        "kind": "pack",
        "prompt_note": note,
        "has_audio": has_audio,
        "use_ref_audio": has_audio,
        "sound": True,
        "loras": [],
        "h3_model": "",
        "h3_steps": 8,
        "segments": segments,
    }
    d.write_json(pack_manifest_path(sid), meta)
    job["scene"] = sid
    job["storyboard_id"] = sid
    job["result"] = public_pack(meta, slim=False)
    job["stage"] = "Done"
