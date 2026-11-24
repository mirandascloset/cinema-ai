"""Storyboard scene packs: scenes/<family>/<version>/ with v1 from analyze and titled forks."""

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
PACK_SEP = "~"
_RESERVED = {
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
}


def _safe_label(name: str, fallback: str = "Scene") -> str:
    label = _WIN_BAD.sub("", (name or "").strip())
    label = re.sub(r"\s+", " ", label).strip(" .")
    if not label:
        label = f"{fallback} {d.new_id()[:6]}"
    label = label[:100]
    if label.upper().split(".")[0] in _RESERVED:
        label = f"{fallback} {label}"
    return label


def _unique_under(parent: Path, label: str, *, also_json: bool = False) -> str:
    base = label
    n = 2
    while True:
        clash = (parent / label).exists()
        if also_json:
            clash = clash or (parent / f"{label}.json").is_file()
        if not clash:
            return label
        suffix = f" ({n})"
        label = (base[: max(1, 100 - len(suffix))] + suffix).strip(" .")
        n += 1
        if n > 500:
            return f"{base[:80]}-{d.new_id()[:6]}"


def scene_folder_name(name: str) -> str:
    """Unique family folder under scenes/ — always the human scene title, never a bare hex id."""
    label = _safe_label(name)
    # Avoid colliding with legacy hex scene ids / looking like an upload id.
    if d.ID_RE.match(label):
        label = f"Scene {label}"
    return _unique_under(d.SCENES, label, also_json=True)


def version_folder_name(family: str, title: str) -> str:
    """Unique version folder under scenes/<family>/."""
    return _unique_under(family_root(family), _safe_label(title, fallback="v"))


def compose_pack_id(family: str, version: str) -> str:
    return f"{family}{PACK_SEP}{version}"


def parse_pack_id(sid: str) -> tuple[str, str] | None:
    if PACK_SEP not in (sid or ""):
        return None
    family, sep, version = sid.partition(PACK_SEP)
    if not sep or not family or not version or PACK_SEP in version:
        return None
    return family, version


def family_root(family: str) -> Path:
    return d.SCENES / family


def family_meta_path(family: str) -> Path:
    return family_root(family) / "family.json"


def write_family_meta(family: str, *, name: str, video: str | None = None, created: float | None = None) -> dict:
    path = family_meta_path(family)
    prev = d.read_json(path, {}) or {}
    meta = {
        "id": family,
        "name": name or prev.get("name") or family,
        "created": created or prev.get("created") or time.time(),
        "video": video if video is not None else prev.get("video"),
        "kind": "family",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    d.write_json(path, meta)
    return meta


def migrate_flat_pack(family: str) -> None:
    """Move scenes/<family>/manifest.json layout into scenes/<family>/v1/."""
    root = family_root(family)
    old_man = root / "manifest.json"
    if not old_man.is_file():
        return
    v1 = root / "v1"
    v1.mkdir(parents=True, exist_ok=True)
    for child in list(root.iterdir()):
        if child.name in ("v1", "family.json"):
            continue
        dest = v1 / child.name
        if dest.exists():
            continue
        try:
            child.rename(dest)
        except OSError:
            if child.is_file():
                shutil.copyfile(child, dest)
                child.unlink(missing_ok=True)
            elif child.is_dir():
                shutil.copytree(child, dest, dirs_exist_ok=True)
                shutil.rmtree(child, ignore_errors=True)
    meta = d.read_json(v1 / "manifest.json", None) or {}
    if not meta:
        return
    name = str(meta.get("name") or family)
    meta["id"] = compose_pack_id(family, "v1")
    meta["family"] = family
    meta["version"] = "v1"
    meta["version_title"] = "v1"
    meta["name"] = name
    meta["kind"] = "pack"
    d.write_json(v1 / "manifest.json", meta)
    write_family_meta(family, name=name, video=meta.get("video"), created=meta.get("created"))


def retitle_hex_family(family: str) -> str:
    """Rename a hex-id pack folder to the titled scene name from its manifest."""
    if not d.ID_RE.match(family or ""):
        return family
    root = family_root(family)
    if not root.is_dir():
        return family
    migrate_flat_pack(family)
    fam_meta = d.read_json(family_meta_path(family), {}) or {}
    v1_meta = d.read_json(root / "v1" / "manifest.json", {}) or {}
    # After migrate_flat_pack, root may have moved contents into v1 — re-resolve.
    root = family_root(family)
    v1_meta = d.read_json(root / "v1" / "manifest.json", {}) or v1_meta
    name = str(fam_meta.get("name") or v1_meta.get("name") or "").strip()
    if not name:
        return family
    desired = _safe_label(name)
    if d.ID_RE.match(desired):
        desired = f"Scene {desired}"
    new_family = desired
    n = 2
    while (d.SCENES / new_family).exists() and new_family != family:
        suffix = f" ({n})"
        new_family = (desired[: max(1, 100 - len(suffix))] + suffix).strip(" .")
        n += 1
        if n > 500:
            new_family = f"{desired[:80]}-{d.new_id()[:6]}"
            break
    if new_family == family:
        return family
    dest = family_root(new_family)
    if dest.exists():
        return family
    root.rename(dest)
    write_family_meta(
        new_family,
        name=name,
        video=v1_meta.get("video") or fam_meta.get("video"),
        created=v1_meta.get("created") or fam_meta.get("created"),
    )
    for ver_dir in dest.iterdir():
        if not ver_dir.is_dir():
            continue
        man = ver_dir / "manifest.json"
        if not man.is_file():
            continue
        meta = d.read_json(man, None)
        if not meta:
            continue
        ver = str(meta.get("version") or ver_dir.name)
        meta["family"] = new_family
        meta["name"] = name
        meta["version"] = ver
        meta["version_title"] = meta.get("version_title") or ver
        meta["id"] = compose_pack_id(new_family, ver)
        meta["legacy_id"] = family
        meta["kind"] = "pack"
        d.write_json(man, meta)
    return new_family


def migrate_all_flat_packs() -> None:
    if not d.SCENES.is_dir():
        return
    for path in list(d.SCENES.iterdir()):
        if path.is_dir() and (path / "manifest.json").is_file():
            migrate_flat_pack(path.name)
    # Hex folder names from early storyboard builds → titled folders (e.g. "Dildo Ride").
    for path in list(d.SCENES.iterdir()):
        if path.is_dir() and d.ID_RE.match(path.name):
            if (path / "manifest.json").is_file() or (path / "v1" / "manifest.json").is_file():
                retitle_hex_family(path.name)


def pack_root(sid: str) -> Path:
    parsed = parse_pack_id(sid)
    if parsed:
        family, version = parsed
        migrate_flat_pack(family)
        return family_root(family) / version
    # Legacy unversioned id: migrate then point at v1 when present.
    if (d.SCENES / sid / "manifest.json").is_file():
        migrate_flat_pack(sid)
    v1 = family_root(sid) / "v1"
    if (v1 / "manifest.json").is_file():
        return v1
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


def resolve_pack_id(sid: str) -> str:
    """Normalize legacy family-only ids to family~v1 after migration."""
    if not d.valid_scene_id(sid):
        raise ValueError("That scene is gone.")
    if parse_pack_id(sid):
        migrate_flat_pack(parse_pack_id(sid)[0])
        return sid
    if (d.SCENES / sid / "manifest.json").is_file() or (family_root(sid) / "v1" / "manifest.json").is_file():
        migrate_flat_pack(sid)
        return compose_pack_id(sid, "v1")
    return sid


def is_pack(sid: str) -> bool:
    try:
        sid = resolve_pack_id(sid)
    except ValueError:
        return False
    return pack_manifest_path(sid).is_file()


def load_pack(sid: str) -> dict:
    sid = resolve_pack_id(sid)
    meta = d.read_json(pack_manifest_path(sid), None)
    if not meta or not isinstance(meta.get("segments"), list) or not meta["segments"]:
        raise ValueError("That scene is gone.")
    # Keep id canonical.
    if meta.get("id") != sid:
        meta["id"] = sid
    return meta


def list_family_versions(family: str) -> list[dict]:
    migrate_flat_pack(family)
    root = family_root(family)
    if not root.is_dir():
        return []
    rows = []
    for path in root.iterdir():
        if not path.is_dir():
            continue
        man = path / "manifest.json"
        if not man.is_file():
            continue
        meta = d.read_json(man, None)
        if not meta:
            continue
        rows.append(public_pack(meta, slim=True))
    return sorted(rows, key=lambda r: (0 if r.get("version") == "v1" else 1, float(r.get("created") or 0)))


def next_version_title(family: str) -> str:
    rows = list_family_versions(family)
    used = {str(v.get("version") or "").lower() for v in rows}
    used |= {str(v.get("version_title") or "").lower() for v in rows}
    n = 2
    while f"v{n}" in used:
        n += 1
    return f"v{n}"


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
    sid = str(meta.get("id") or "")
    parsed = parse_pack_id(sid)
    family = meta.get("family") or (parsed[0] if parsed else "")
    version = meta.get("version") or (parsed[1] if parsed else "")
    version_title = meta.get("version_title") or version or "v1"
    family_name = meta.get("name") or family or ""
    row = {
        "id": sid,
        "name": family_name,
        "family": family,
        "version": version,
        "version_title": version_title,
        "label": f"{family_name} · {version_title}" if family_name else version_title,
        "created": meta.get("created"),
        "video": meta.get("video"),
        "duration": meta.get("duration"),
        "segments_total": len(segs),
        "has_audio": pack_audio_path(sid).is_file() if sid else False,
        "kind": "pack",
        "loras": meta.get("loras") or [],
        "h3_model": meta.get("h3_model") or "",
        "h3_steps": meta.get("h3_steps") or 8,
        "sound": meta.get("sound") is not False,
        "use_ref_audio": meta.get("use_ref_audio") is not False,
        "parent_version": meta.get("parent_version") or "",
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
    siblings = list_family_versions(family) if family else []
    return {
        **row,
        "segments": out_segs,
        "preview_prompt": preview,
        "prompt_note": meta.get("prompt_note") or "",
        "versions": siblings,
    }


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
    sid = resolve_pack_id(sid)
    parsed = parse_pack_id(sid)
    root = pack_root(sid)
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
    if not parsed:
        return
    family, _ = parsed
    # Drop empty family folder once the last version is gone.
    remaining = list_family_versions(family)
    if remaining:
        return
    fam = family_root(family)
    if fam.is_dir():
        shutil.rmtree(fam, ignore_errors=True)


def delete_family(family: str) -> None:
    migrate_flat_pack(family)
    root = family_root(family)
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)


def rename_pack(sid: str, name: str) -> dict:
    """Rename this version's title (folder slug updates except for v1)."""
    sid = resolve_pack_id(sid)
    meta = load_pack(sid)
    clean = (name or "").strip()[:120]
    if not clean:
        raise ValueError("Enter a title for this version.")
    parsed = parse_pack_id(sid)
    if not parsed:
        meta["name"] = clean
        meta["version_title"] = clean
        d.write_json(pack_manifest_path(sid), meta)
        return public_pack(meta, slim=True)
    family, version = parsed
    meta["version_title"] = clean
    # Keep the analyze original on disk as v1; only the display title changes.
    if version == "v1" or clean == version:
        d.write_json(pack_manifest_path(sid), meta)
        return public_pack(meta, slim=False)
    new_ver = version_folder_name(family, clean)
    new_id = compose_pack_id(family, new_ver)
    meta["version"] = new_ver
    meta["id"] = new_id
    src = pack_root(sid)
    dest = family_root(family) / new_ver
    if dest.exists():
        raise ValueError("A version with that name already exists.")
    src.rename(dest)
    d.write_json(pack_manifest_path(new_id), meta)
    return public_pack(meta, slim=False)


def fork_version(source_sid: str, title: str | None = None) -> dict:
    """Copy a version into a new titled variation under the same family."""
    source_sid = resolve_pack_id(source_sid)
    meta = load_pack(source_sid)
    parsed = parse_pack_id(source_sid)
    if not parsed:
        raise ValueError("Only storyboard scenes support versions.")
    family, src_ver = parsed
    title_clean = (title or "").strip()[:120] or next_version_title(family)
    new_ver = version_folder_name(family, title_clean)
    src = pack_root(source_sid)
    dest = family_root(family) / new_ver
    if dest.exists():
        raise ValueError("A version with that name already exists.")
    shutil.copytree(src, dest)
    new_id = compose_pack_id(family, new_ver)
    new_meta = dict(meta)
    new_meta.update(
        {
            "id": new_id,
            "family": family,
            "version": new_ver,
            "version_title": title_clean,
            "parent_version": src_ver,
            "created": time.time(),
            "kind": "pack",
        }
    )
    d.write_json(dest / "manifest.json", new_meta)
    write_family_meta(family, name=str(new_meta.get("name") or family), video=new_meta.get("video"))
    return public_pack(new_meta, slim=False)


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
    sid = resolve_pack_id(str(data.get("scene") or data.get("sceneId") or ""))
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
    """Analyze reference video and save scenes/<family>/v1/."""
    vid = d.video_meta(job["video"])
    path = Path(vid["path"])
    duration = float(vid["duration"])
    plan = d.segment_plan(duration)
    total = len(plan)
    job["segments_total"] = total
    label = (job.get("name") or "").strip()[:120]
    if not label:
        raise ValueError("Name this storyboard before analyzing.")
    family = scene_folder_name(label)
    sid = compose_pack_id(family, "v1")
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

    created = time.time()
    meta = {
        "id": sid,
        "name": label,
        "family": family,
        "version": "v1",
        "version_title": "v1",
        "created": created,
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
    write_family_meta(family, name=label, video=job["video"], created=created)
    job["scene"] = sid
    job["storyboard_id"] = sid
    job["result"] = public_pack(meta, slim=False)
    job["stage"] = "Done"
