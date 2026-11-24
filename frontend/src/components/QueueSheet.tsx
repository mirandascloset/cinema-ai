import { useEffect } from "react";
import { api, fmtTime } from "../api";
import { Icon } from "../icons";
import type { Job, Status } from "../types";

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
  const est = jobs.reduce((a, j) => a + (j.estimate || 120), 0);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => onRefresh(), 2000);
    return () => window.clearInterval(t);
  }, [open, onRefresh]);

  if (!open) return null;

  async function cancel(id: string) {
    try {
      await api(`/api/jobs/${id}/cancel`, {});
      onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Couldn't cancel");
    }
  }

  return (
    <div
      id="queueSheet"
      className="sheet"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === "queueSheet") onClose();
      }}
    >
      <div className="sbox tall">
        <div className="row">
          <b className="grow">Queue</b>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="dim">
          {jobs.some((j) => j.status === "queued" || j.status === "running")
            ? `${jobs.filter((j) => j.status === "queued" || j.status === "running").length} running · about ${fmtTime(est)} left`
            : jobs.some((j) => j.status === "error")
              ? "Last run failed — see the message below."
              : "Nothing running. Tap Action on the main screen to start."}
        </p>
        <div className="qlist">
          {jobs.map((j) => (
            <div key={j.id} className="card">
              <div className="grow">
                <b>Cinema · {j.segments_total || "?"} parts</b>
                <small>
                  {j.status === "error" && j.error
                    ? j.error
                    : `${j.stage || j.status}${status?.video?.label ? ` · 720p · ${status.video.label}` : ""}`}
                </small>
              </div>
              <button type="button" onClick={() => void cancel(j.id)}>
                Cancel
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}