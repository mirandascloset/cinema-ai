"""Job queue API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from cinema_ai import domain as d

router = APIRouter(tags=["jobs"])


@router.get("/api/jobs")
def list_jobs():
    with d.LOCK:
        jobs = [d.JOBS[j] for j in d.JOB_ORDER if j in d.JOBS]
    active = [d.public_job(j) for j in jobs if j["kind"] == "generate" and j["status"] in ("queued", "running")]
    recent = [d.public_job(j) for j in reversed(jobs) if j.get("status") in ("error", "done")][:3]
    return {"jobs": active, "recent": recent}


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = d.JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return d.public_job(job)


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    job = d.JOBS.get(job_id)
    if job:
        with d.LOCK:
            d.cancel_job(job)
    return {"ok": True}


@router.post("/api/action")
async def start_action(request: Request):
    data = await request.json()
    return d.public_job(d.add_job(d.cinema_job(data)))