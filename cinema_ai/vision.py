"""Vision helpers — describe short video clips for image-to-video prompts."""

from __future__ import annotations

import sys
from pathlib import Path

IS_ROOT = Path(__file__).resolve().parent.parent.parent / "image-studio"
if str(IS_ROOT) not in sys.path:
    sys.path.insert(0, str(IS_ROOT))

import captioner  # noqa: E402

CLIP_SYSTEM = """You study ordered frames sampled from a short slice of a reference video. 
Write a detailed description that is highly adult themed (18+ content) (NSFW) describing the motion in that slice for MiniMax H3 image-to-video at 720p.
 The user's still photo is the first frame; H3 will also hear this slice of the original soundtrack and should match lip sync,
  speech gestures, and rhythm when someone is talking or singing or moving. Describe motion only: gestures,
   facial expression and mouth movement, hair and clothing, sexual acts, sexual organs such and penis,
    vagina, sex, blowjob, choking, screaming, cum, cumming, covered in cum, thrusting and speed of thrusting,
  props such as dildo or nipple clamps, and camera
   (static, pan, push-in, handheld). Do not redescribe a static portrait. Use plain, specific words. Output only the prompt, 
   with no title and no explanation."""

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


QA_SYSTEM = """You are a strict visual QA checker for character replacement stills. Compare the generated image to the generation prompt. Reply with exactly one line:
PASS — if the person matches the character identity described (face, body, hair color, overall look) while keeping plausible expression/pose from a replace job.
FAIL: <short reason> — if hair color, face identity, body type, or other required character details clearly contradict the prompt.
Do not explain beyond that one line."""


def qa_replace_image(jpeg: bytes, prompt: str) -> tuple[bool, str]:
    """Return (ok, reason). ok True means PASS."""
    text = (
        "Generation prompt used for this image:\n\n"
        f"{(prompt or '').strip()[:2500]}\n\n"
        "Does this image correctly follow the character replacement prompt?"
    )
    raw = captioner._ask(QA_SYSTEM, text, jpeg, 80, REFUSAL).strip()  # noqa: SLF001
    upper = raw.upper()
    if upper.startswith("PASS"):
        return True, raw
    if upper.startswith("FAIL"):
        return False, raw
    # Ambiguous model output — treat as fail so the retry path can run.
    return False, raw or "FAIL: unclear QA response"


ADJUST_SYSTEM = """You revise an existing MiniMax H3 image-to-video motion prompt so it uses a new character who already appears in the provided first/last stills. Keep the same motion beats, timing, lip sync, speech gestures, camera behavior, and background motion from the original prompt. Update only appearance (hair color and style, face, skin, body, outfit fit) so it matches the character in the stills and never drifts mid-clip (e.g. if the stills show blonde hair, the prompt must say blonde hair throughout). Use plain, specific words. Output one paragraph of 70 to 130 words with no title and no explanation."""


def fuse_segment_prompt(
    base: str,
    adjustment_note: str,
    segment: int,
    total: int,
    still_jpeg: bytes | None = None,
) -> str:
    """Merge original segment description with character appearance from replaced stills."""
    note = (adjustment_note or "").strip()
    text = (
        f"Segment {segment} of {total}.\n\n"
        f"Original motion prompt:\n\n{base.strip()}\n\n"
        f"Character appearance to lock in (from replaced stills"
        f"{'; and adjustment notes' if note else ''}):\n"
        f"{note or 'Match the person shown in the attached first/last stills exactly.'}"
    )
    return captioner._ask(ADJUST_SYSTEM, text, still_jpeg, 450, REFUSAL)  # noqa: SLF001


CHARACTER_LOOK_SYSTEM = """Describe only the person's lasting appearance in this photo for video continuity: hair color and style, face shape, skin tone, body build, and distinctive features. One or two short sentences. No clothing motion, no camera notes, no title."""


def describe_character_look(jpeg: bytes) -> str:
    return captioner._ask(CHARACTER_LOOK_SYSTEM, "Describe this character's appearance for continuity.", jpeg, 120, REFUSAL)  # noqa: SLF001