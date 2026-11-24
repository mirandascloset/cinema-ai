import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";
import { Icon } from "../icons";
import type { Job, Status } from "../types";

const MODE_NAMES: Record<string, string> = {
  cinema: "Cinema",
  scene_video: "Scene video",
  storyboard: "Storyboard",
};

function headLabel(j: Job): string {
  const mode = MODE_NAMES[j.mode || ""] || "Cinema";
  const parts = j.segments_total ? `${j.segments_total} part${j.segments_total === 1 ? "" : "s"}` : "";
  return [mode, parts].filter(Boolean).join(" · ");
}

function enginesLabel(j: Job, status: Status | null): string {
  const label = status?.video?.label || "MiniMax H3";
  return `720p · ${label}`;
}

/** Best-effort part progress from stage text like "Generating part 2 of 4". */
function partProgress(j: Job): { index: number; total: number } | null {
  const total = Math.max(1, Number(j.segments_total) || 0);
  const stage = String(j.stage || "");
  const m = stage.match(/part\s+(\d+)\s+of\s+(\d+)/i);
  if (m) {
    return { index: Math.max(1, parseInt(m[1], 10)), total: Math.max(1, parseInt(m[2], 10)) };
  }
  if (j.status === "running" && total > 1 && Array.isArray(j.results) && j.results.length) {
    return { index: Math.min(j.results.length, total), total };
  }
  return total > 1 ? { index: 1, total } : null;
}

function statusLabel(j: Job): string {
  if (j.status === "error") return j.error || "Failed";
  if (j.status === "done") return j.stage || "Done";
  if (j.status === "cancelled") return "Cancelled";
  if (j.status === "running") {
    const parts = partProgress(j);
    if (parts && j.stage) return j.stage;
    return j.stage || "Running";
  }
  if (j.position && j.position > 1) return `Waiting · #${j.position} in line`;
  return j.stage || "Up next";
}

function progressPct(j: Job): number | null {
  if (j.status !== "running") return null;
  const parts = partProgress(j);
  if (!parts) return null;
  // Prefer completed slices; current part counts as in-progress.
  return Math.min(99, Math.round(((parts.index - 1) / parts.total) * 100));
}

export function QueueSheet({
  open,
  jobs,
  status,
  onClose,
  onRefresh,
  onToast,
}: {
  open: boolean;
  jobs: Job[];
  status: Status | null;
  onClose: () => void;
  onRefresh: () => void;
  onToast: (msg: string) => void;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const est = active.reduce((a, j) => a + (j.estimate || 120), 0);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => onRefresh(), 2000);
    return () => window.clearInterval(t);
  }, [open, onRefresh]);

  if (!open) return null;

  async function cancelOne(id: string) {
    setCancelling(id);
    try {
      await api(`/api/jobs/${id}/cancel`, {});
      onToast("Cancelled");
      onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Couldn't cancel");
    } finally {
      setCancelling(null);
    }
  }

  function summaryText(): string {
    if (active.length) {
      return `${active.length} running · about ${fmtTime(est)} left`;
    }
    if (jobs.some((j) => j.status === "error")) {
      return "Last run failed — see the message below.";
    }
    if (jobs.some((j) => j.status === "done")) {
      return "Recent jobs. New runs show up here while they work.";
    }
    return "Nothing running. Start Create video or Action to queue a job.";
  }

  return (
    <div
      id="queueSheet"
      className="sheet"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === "queueSheet") onClose();
      }}
    >
      <div className="sbox">
        <div className="row">
          <b className="grow">Queue</b>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <small className="dim qsummary">{summaryText()}</small>
        <div id="qList">
          {jobs.map((j) => {
            const running = j.status === "running";
            const queued = j.status === "queued";
            const canCancel = running || queued;
            const pct = progressPct(j);
            const live = running || queued;
            return (
              <div key={j.id} className={`qitem${live ? " run" : ""}${j.status === "error" ? " err" : ""}`}>
                <div className="qthumb">
                  <Icon name={j.mode === "storyboard" ? "spark" : "film"} />
                </div>
                <div className="grow">
                  <b>{headLabel(j)}</b>
                  <small>{enginesLabel(j, status)}</small>
                  <span className={`qstat${j.status === "error" ? " bad" : ""}`}>{statusLabel(j)}</span>
                  {live && (
                    <div className={`bar${pct == null ? " indef" : ""}`}>
                      <i style={pct != null ? { width: `${pct}%` } : undefined} />
                    </div>
                  )}
                  {j.status === "done" && j.elapsed != null && (
                    <small className="qmeta">Finished in {fmtTime(j.elapsed)}</small>
                  )}
                </div>
                {canCancel ? (
                  <button
                    type="button"
                    className="x"
                    aria-label="Cancel"
                    disabled={cancelling === j.id}
                    onClick={() => void cancelOne(j.id)}
                  >
                    <Icon name="x" />
                  </button>
                ) : (
                  <span className="qbadge">{j.status === "error" ? "Failed" : j.status === "done" ? "Done" : j.status}</span>
                )}
              </div>
            );
          })}
        </div>
        {!jobs.length && <p className="hint">The queue is empty.</p>}
      </div>
    </div>
  );
}
