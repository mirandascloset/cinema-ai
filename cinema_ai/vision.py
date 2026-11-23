"""Vision helpers — describe short video clips for image-to-video prompts."""

from __future__ import annotations

import sys
from pathlib import Path

IS_ROOT = Path(__file__).resolve().parent.parent.parent / "image-studio"
if str(IS_ROOT) not in sys.path:
    sys.path.insert(0, str(IS_ROOT))

import captioner  # noqa: E402

CLIP_SYSTEM = """You study ordered frames sampled from a short slice of a reference video. Write one paragraph of 70 to 130 words describing the motion in that slice for MiniMax H3 image-to-video at 720p. The user's still photo is the first frame; H3 will also hear this slice of the original soundtrack and should match lip sync, speech gestures, and rhythm when someone is talking or singing. Describe motion only: gestures, facial expression and mouth movement, hair and clothing, props, background motion, and camera (static, pan, push-in, handheld). Do not redescribe a static portrait. Use plain, specific words. Output only the prompt, with no title and no explanation."""

REFUSAL = "That clip can't be used for generation."


def describe_clip(jpeg: bytes, segment: int, total: int) -> str:
    text = (
        f"These frames are chronological samples from segment {segment} of {total} of the reference video. "
        "Write the video motion prompt for this segment only."
    )
    return captioner._ask(CLIP_SYSTEM, text, jpeg, 450, REFUSAL)  # noqa: SLF001


PATCH_SYSTEM = """You revise an existing MiniMax H3 image-to-video motion prompt so it matches the user's new still photo. Keep the same motion beats, timing, lip sync, speech gestures, camera behavior, and background motion from the original prompt. Update only appearance details (hair, face, skin, outfit, accessories, props) to reflect the user's notes and photo when provided. Use plain, specific words. Output one paragraph of 70 to 130 words with no title and no explanation."""


def patch_scene_prompt(
    base: str,
    note: str,
    segment: int,
    total: int,
    photo_jpeg: bytes | None = None,
) -> str:
    note = (note or "").strip()
    if not note:
        return base
    text = (
        f"Segment {segment} of {total}.\n\n"
        f"Original motion prompt:\n\n{base.strip()}\n\n"
        f"Changes for the new photo:\n{note}"
    )
    return captioner._ask(PATCH_SYSTEM, text, photo_jpeg, 450, REFUSAL)  # noqa: SLF001