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