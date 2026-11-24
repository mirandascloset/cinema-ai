import { useState } from "react";
import { api, pollJob } from "../api";
import { Icon } from "../icons";
import type { Job, Status, VideoMeta } from "../types";
import { VideoBox } from "./VideoBox";

export function StoryboardView({
  status,
  busy,
  setBusy,
  onJob,
  onToast,
  onSaved,
}: {
  status: Status | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onJob: (job: Job) => void;
  onToast: (msg: string) => void;
  onSaved?: () => void;
}) {
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [name, setName] = useState("");
  const [promptNote, setPromptNote] = useState("");
  const [err, setErr] = useState("");

  async function analyze() {
    if (!name.trim()) {
      onToast("Name this storyboard first");
      return;
    }
    if (!video) {
      onToast("Choose a reference video");
      return;
    }
    if (!status?.captioner) {
      setErr("Prompt writer not installed.");
      return;
    }
    if (!status?.ffmpeg) {
      setErr("ffmpeg not found on this PC.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const job = await api<Job>("/api/storyboard/analyze", {
        video: video.id,
        name: name.trim(),
        promptNote: promptNote.trim() || undefined,
      });
      onJob(job);
      onToast("Studying the video and saving a scene…");
      const final = await pollJob(job.id, (tick) => onJob(tick));
      onJob(final);
      if (final.status === "done") {
        onToast(`Saved “${name.trim()}” to Scenes.`);
        onSaved?.();
      } else if (final.status === "error") {
        setErr(final.error || "Analyze failed.");
        onToast(final.error || "Analyze failed.");
      } else if (final.status === "cancelled") {
        onToast("Cancelled.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start");
      onToast(e instanceof Error ? e.message : "Couldn't start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane" id="storyboardPane">
      <div className="card prompt">
        <div className="label">
          <span>Storyboard name</span>
          <span>Required</span>
        </div>
        <div className="box">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen morning take"
            maxLength={120}
          />
        </div>
      </div>

      <div className="label">
        <span>Reference video</span>
        {video?.duration ? <span>{Math.round(video.duration)}s</span> : null}
      </div>
      <VideoBox
        video={video}
        picking={pickingVideo}
        onToast={onToast}
        onPicked={(meta) => {
          setVideo(meta);
          setPickingVideo(false);
        }}
      />

      <div className="card prompt">
        <div className="label">
          <span>Prompt enhancer</span>
          <span>Optional</span>
        </div>
        <p className="hint dim">Applied after each clip is studied — tune appearance notes for every segment.</p>
        <div className="box">
          <textarea
            rows={3}
            value={promptNote}
            onChange={(e) => setPromptNote(e.target.value)}
            placeholder="e.g. Keep wardrobe casual; emphasize soft daylight."
            maxLength={2000}
          />
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <button
        type="button"
        className="primary go"
        disabled={busy || !video || !name.trim()}
        onClick={() => void analyze()}
      >
        <Icon name="spark" />
        <span>{busy ? "Working…" : "Analyze"}</span>
      </button>
      <p className="hint">
        Splits into ≤10s segments with first/last frames, descriptions, and audio — then saves under Scenes for editing
        and video generation.
      </p>
    </div>
  );
}
