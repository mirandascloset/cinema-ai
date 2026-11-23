import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, pollJob } from "../api";
import { updateSettings, useSettings } from "../settings";
import { Icon } from "../icons";
import type { Job, SceneItem, Status, UploadMeta, VideoMeta } from "../types";
import { PhotoBox } from "./PhotoBox";
import { ToggleCard } from "./ToggleCard";
import { VideoBox } from "./VideoBox";
import { VideoLoraCard } from "./VideoLoraCard";

const LENGTHS = [
  { seconds: 3, note: "Faster" },
  { seconds: 5, note: "Balanced" },
  { seconds: 8, note: "Longer" },
  { seconds: 10, note: "Max slice" },
] as const;

export function CinemaView({
  status,
  busy,
  setBusy,
  onJob,
  onToast,
  onDone,
}: {
  status: Status | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onJob: (job: Job) => void;
  onToast: (msg: string) => void;
  onDone?: () => void;
}) {
  const settings = useSettings();
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [image, setImage] = useState<UploadMeta | null>(null);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [activeScene, setActiveScene] = useState<SceneItem | null>(null);
  const [err, setErr] = useState("");

  const sceneId = settings.selectedSceneId;
  const usingScene = !!sceneId;

  const loadScenes = useCallback(async () => {
    try {
      const data = await api<{ items: SceneItem[] }>("/api/scenes");
      setScenes(data.items || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  useEffect(() => {
    if (!sceneId) {
      setActiveScene(null);
      return;
    }
    const hit = scenes.find((s) => s.id === sceneId);
    if (hit) {
      setActiveScene(hit);
      return;
    }
    void api<SceneItem>(`/api/scenes/${sceneId}`)
      .then((row) => setActiveScene(row))
      .catch(() => {
        updateSettings({ selectedSceneId: "" });
        setActiveScene(null);
      });
  }, [sceneId, scenes]);

  const videoMeta = status?.video;
  const h3Meta = videoMeta?.h3 || { loras: [], models: [], steps: [4, 30] };
  const modelReady = videoMeta?.models?.h3?.ready ?? videoMeta?.ready ?? false;
  const modelLabel = videoMeta?.label || "MiniMax H3";
  const avail = h3Meta.loras || [];
  const estKey = `720-${settings.videoSeconds}`;
  const est = videoMeta?.models?.h3?.estimates?.[estKey];

  useEffect(() => {
    const models = h3Meta.models || [];
    if (models.length && !models.some((m) => m.id === settings.h3Model)) {
      updateSettings({ h3Model: "" });
    }
  }, [(h3Meta.models || []).map((m) => m.id).join("|"), settings.h3Model]);

  const showH3Models = (h3Meta.models || []).length > 1;

  async function run() {
    if (!usingScene && !video) {
      onToast("Choose a reference video or a saved scene");
      return;
    }
    if (usingScene && !activeScene) {
      onToast("That scene is gone — pick another on Scenes");
      return;
    }
    if (!image) {
      onToast("Choose a photo to animate");
      return;
    }
    if (!modelReady) {
      setErr(`${modelLabel} is still downloading on the PC.`);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const job = await api<Job>("/api/action", {
        ...(usingScene ? { scene: sceneId } : { video: video!.id }),
        image: image.id,
        model: "h3",
        quality: "720",
        seconds: settings.videoSeconds,
        loras: settings.h3Loras,
        h3Model: settings.h3Model,
        h3Steps: settings.h3Steps,
        sound: settings.videoSound,
        useRefAudio: settings.useRefAudio,
      });
      onJob(job);
      onToast(usingScene ? "Using saved captions — generating…" : "Studying the reference, then generating…");
      const final = await pollJob(job.id, (tick) => onJob(tick));
      onJob(final);
      if (final.status === "done") {
        onToast(final.audio_note || "Done — open Gallery for the video.");
        onDone?.();
      } else if (final.status === "error") {
        setErr(final.error || "Generation failed.");
        onToast(final.error || "Generation failed.");
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

  const hint = !modelReady
    ? `${modelLabel} is still downloading. This page updates when it's ready.`
    : est
      ? `Each 720p slice is about ${fmtTime(est)} on your GPU. With reference audio on, H3 matches lip sync per slice, then the original soundtrack is muxed in.`
      : "720p · MiniMax H3 · reference audio drives lip sync when enabled.";

  return (
    <div className="pane" id="cinemaPane">
      {scenes.length > 0 && (
        <>
          <div className="label">
            <span>Saved scenes</span>
            <span>Scroll</span>
          </div>
          <div className="scenestrip">
            <button
              type="button"
              className={`scenechip${!usingScene ? " on" : ""}`}
              onClick={() => updateSettings({ selectedSceneId: "" })}
            >
              <span className="scenechip-new">
                <Icon name="film" />
              </span>
              <span>New video</span>
            </button>
            {scenes.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`scenechip${sceneId === s.id ? " on" : ""}`}
                onClick={() => updateSettings({ selectedSceneId: s.id })}
              >
                <img src={`/api/scenes/${s.id}?thumb=1`} alt="" />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {usingScene && activeScene ? (
        <>
          <div className="label">
            <span>Scene</span>
            <span>{activeScene.segments_total || "?"} parts</span>
          </div>
          <div className="photo has sm">
            <img src={`/api/scenes/${activeScene.id}?thumb=1`} alt="" className="preview" />
            <div className="over">
              <button type="button" onClick={() => updateSettings({ selectedSceneId: "" })}>
                Use a new video
              </button>
            </div>
          </div>
          <p className="hint dim">
            <b>{activeScene.name}</b> — captions are saved. Only your photo changes; reference audio still comes from the original clip.
          </p>
        </>
      ) : (
        <>
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
              updateSettings({ selectedSceneId: "" });
            }}
          />
        </>
      )}
      <div className="label">
        <span>Your photo</span>
        <span>720p · H3</span>
      </div>
      <PhotoBox
        image={image}
        picking={pickingImage}
        onToast={onToast}
        onPicked={(meta) => {
          setImage(meta);
          setPickingImage(false);
        }}
      />

      <div className="label">
        <span>Clip length per slice</span>
        <span>720p</span>
      </div>
      <div className="who sm">
        {LENGTHS.map((l) => (
          <button
            key={l.seconds}
            type="button"
            className={settings.videoSeconds === l.seconds ? "on" : ""}
            onClick={() => updateSettings({ videoSeconds: l.seconds })}
          >
            {l.seconds}s
            <small>{l.note}</small>
          </button>
        ))}
      </div>

      {showH3Models && (
        <>
          <div className="label">
            <span>H3 model</span>
          </div>
          <div className="poses">
            {(h3Meta.models || []).map((m) => (
              <button
                key={m.id || "fasth3"}
                type="button"
                className={settings.h3Model === m.id ? "on" : ""}
                onClick={() => updateSettings({ h3Model: m.id })}
              >
                <Icon name="check" />
                {m.label}
              </button>
            ))}
          </div>
          {!!settings.h3Model && (
            <div className="card">
              <div className="slider">
                <span>Steps</span>
                <input
                  type="range"
                  min={h3Meta.steps?.[0] ?? 4}
                  max={h3Meta.steps?.[1] ?? 30}
                  step={1}
                  value={settings.h3Steps}
                  onChange={(e) => updateSettings({ h3Steps: +e.target.value })}
                />
                <output>{settings.h3Steps}</output>
              </div>
            </div>
          )}
        </>
      )}

      <VideoLoraCard modelId="h3" modelLabel={modelLabel} avail={avail} max={videoMeta?.maxLoras || 3} onToast={onToast} />

      <ToggleCard
        title="Reference audio"
        note="Uses the soundtrack from your reference video. H3 matches lip sync and timing; the final MP4 keeps that audio."
        checked={settings.useRefAudio}
        onChange={(on) => updateSettings({ useRefAudio: on })}
      />
      <ToggleCard
        title="Generated ambience"
        note="When reference audio is off (or missing), H3 can still invent a soundtrack."
        checked={settings.videoSound}
        onChange={(on) => updateSettings({ videoSound: on })}
      />

      {err && <div className="err">{err}</div>}

      <button
        type="button"
        className="primary go"
        disabled={busy || (!usingScene && !video) || (usingScene && !activeScene) || !image || !modelReady}
        onClick={() => void run()}
      >
        <Icon name="wand" />
        <span>{modelReady ? "Action" : "Downloading…"}</span>
      </button>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}