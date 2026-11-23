"""Range-capable file responses."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import Request
from fastapi.responses import Response, StreamingResponse


def file_response(path: Path, content_type: str, request: Request, headers: dict | None = None) -> Response:
    size = path.stat().st_size
    start, end = 0, size - 1
    status = 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", (request.headers.get("range") or "").strip())
    if match and size and (match.group(1) or match.group(2)):
        if match.group(1):
            start = int(match.group(1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
        else:
            start = max(0, size - int(match.group(2)))
        if start > end or start >= size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}", "Content-Length": "0"})
        status = 206

    length = end - start + 1 if size else 0
    out_headers = {"Accept-Ranges": "bytes", "Content-Length": str(length)}
    if status == 206:
        out_headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    for key, value in (headers or {}).items():
        out_headers[key] = value

    if not size:
        return Response(b"", status_code=status, media_type=content_type, headers=out_headers)

    def chunks():
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(chunks(), status_code=status, media_type=content_type, headers=out_headers)