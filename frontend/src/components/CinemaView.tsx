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
  const sceneNote = sceneId ? settings.scenePromptNotes[sceneId] || "" : "";

  function setSceneNote(text: string) {
    if (!sceneId) return;
    updateSettings({ scenePromptNotes: { ...settings.scenePromptNotes, [sceneId]: text } });
  }

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
    if (hit) setActiveScene(hit);
    void api<SceneItem>(`/api/scenes/${sceneId}`)
      .then((row) => {
        setActiveScene(row);
        updateSettings({
          h3Loras: row.loras || [],
          h3Model: row.h3_model || "",
          h3Steps: row.h3_steps ?? 8,
          videoSound: row.sound !== false,
          useRefAudio: row.use_ref_audio !== false,
        });
      })
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
        ...(usingScene && sceneNote.trim()
          ? { scenePromptNote: sceneNote.trim() }
          : !usingScene && settings.cinemaPromptNote.trim()
            ? { cinemaPromptNote: settings.cinemaPromptNote.trim() }
            : {}),
      });
      onJob(job);
      const hasNote = usingScene ? !!sceneNote.trim() : !!settings.cinemaPromptNote.trim();
      onToast(
        usingScene
          ? hasNote
            ? "Updating captions for your photo, then generating…"
            : "Using saved captions — generating…"
          : hasNote
            ? "Studying the reference, matching your photo, then generating…"
            : "Studying the reference, then generating…",
      );
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

      <div className="card prompt">
        <div className="label">
          <span>{usingScene ? "Caption update" : "Photo notes"}</span>
          <span>Optional</span>
        </div>
        <p className="hint dim">
          {usingScene
            ? "Motion stays from the scene; describe what changed in your photo so each slice's prompt matches."
            : "After the clip is studied, these notes update each slice so motion follows the reference but appearance matches your photo."}
        </p>
        {usingScene && activeScene?.preview_prompt ? (
          <details>
            <summary className="dim">Saved caption (part 1)</summary>
            <p className="dim" style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: "8px 0 0" }}>
              {activeScene.preview_prompt}
            </p>
          </details>
        ) : null}
        <div className="box">
          <textarea
            rows={3}
            value={usingScene ? sceneNote : settings.cinemaPromptNote}
            onChange={(e) =>
              usingScene ? setSceneNote(e.target.value) : updateSettings({ cinemaPromptNote: e.target.value })
            }
            placeholder="e.g. She has blonde hair and a red sundress."
            maxLength={2000}
          />
        </div>
      </div>

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