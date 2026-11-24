import { useCallback, useEffect, useState } from "react";
import { api, fmtTime, pollJob } from "../api";
import { Icon } from "../icons";
import { getSettings, updateSettings, useSettings } from "../settings";
import type { Job, SceneItem, SceneSegment, Status, UploadMeta } from "../types";
import { ToggleCard } from "./ToggleCard";
import { useSourcePicker } from "./SourcePicker";
import { VideoLoraCard } from "./VideoLoraCard";

const LENGTHS = [
  { seconds: 3, note: "Faster" },
  { seconds: 5, note: "Balanced" },
  { seconds: 8, note: "Longer" },
  { seconds: 10, note: "Max slice" },
] as const;

export function SceneView({
  active,
  status,
  busy,
  setBusy,
  onJob,
  onToast,
  onDone,
  onUseCreate,
}: {
  active: boolean;
  status: Status | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onJob: (job: Job) => void;
  onToast: (msg: string) => void;
  onDone?: () => void;
  onUseCreate: () => void;
}) {
  const settings = useSettings();
  const { openPicker } = useSourcePicker();
  const [items, setItems] = useState<SceneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SceneItem | null>(null);
  const [rewriteNote, setRewriteNote] = useState("");
  const [err, setErr] = useState("");
  const [frameKey, setFrameKey] = useState(0);

  const videoMeta = status?.video;
  const h3Meta = videoMeta?.h3 || { loras: [], models: [], steps: [4, 30] };
  const modelReady = videoMeta?.models?.h3?.ready ?? videoMeta?.ready ?? false;
  const modelLabel = videoMeta?.label || "MiniMax H3";
  const estKey = `720-${settings.videoSeconds}`;
  const est = videoMeta?.models?.h3?.estimates?.[estKey];

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ items: SceneItem[] }>("/api/scenes");
      setItems(data.items || []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load scenes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (!active) setEditing(null);
  }, [active]);

  async function openScene(id: string) {
    try {
      const row = await api<SceneItem>(`/api/scenes/${id}`);
      setEditing(row);
      setRewriteNote("");
      setFrameKey((k) => k + 1);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't open scene");
    }
  }

  async function saveSegment(seg: SceneSegment, description: string) {
    if (!editing) return;
    try {
      const row = await api<SceneItem>(`/api/scenes/${editing.id}/segment`, {
        index: seg.index,
        description,
      });
      setEditing(row);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't save segment");
    }
  }

  function changeFrame(seg: SceneSegment, which: "first" | "last") {
    if (!editing || busy) return;
    openPicker({
      kind: "image",
      title: `Replace ${which} frame`,
      onToast,
      onImage: (meta: UploadMeta) => {
        void (async () => {
          try {
            const row = await api<SceneItem>(`/api/scenes/${editing.id}/frame`, {
              index: seg.index,
              which,
              image: meta.id,
            });
            setEditing(row);
            setFrameKey((k) => k + 1);
            onToast(`Updated ${which} frame`);
          } catch (e) {
            onToast(e instanceof Error ? e.message : "Couldn't update frame");
          }
        })();
      },
    });
  }

  async function applyRewrite() {
    if (!editing || !rewriteNote.trim()) {
      onToast("Enter a prompt note to update all descriptions");
      return;
    }
    setBusy(true);
    try {
      const row = await api<SceneItem>(`/api/scenes/${editing.id}/rewrite`, { note: rewriteNote.trim() });
      setEditing(row);
      onToast("Updated all segment descriptions");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't rewrite prompts");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!editing) return;
    if (editing.kind !== "pack") {
      onToast("Open a storyboard scene to generate from frames");
      return;
    }
    if (!modelReady) {
      setErr(`${modelLabel} is still downloading.`);
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const job = await api<Job>("/api/scenes/generate", {
        scene: editing.id,
        seconds: settings.videoSeconds,
        loras: settings.h3Loras,
        h3Model: settings.h3Model,
        h3Steps: settings.h3Steps,
        sound: settings.videoSound,
        useRefAudio: settings.useRefAudio,
      });
      onJob(job);
      onToast("Generating dual-frame clips from this scene…");
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

  function useOnCreate(scene: SceneItem) {
    updateSettings({ selectedSceneId: scene.id });
    setEditing(null);
    onToast(`Using “${scene.name}” — add a photo on Create.`);
    onUseCreate();
  }

  async function remove(scene: SceneItem) {
    try {
      await api("/api/scenes/delete", { id: scene.id });
      setItems((prev) => prev.filter((x) => x.id !== scene.id));
      if (getSettings().selectedSceneId === scene.id) updateSettings({ selectedSceneId: "" });
      if (editing?.id === scene.id) setEditing(null);
      onToast("Scene deleted");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed");
    }
  }

  if (editing) {
    const isPack = editing.kind === "pack";
    const segments = editing.segments || [];
    return (
      <section className="pane" id="sceneEditor">
        <div className="rowgap">
          <button type="button" className="ghost" onClick={() => setEditing(null)}>
            <Icon name="back" />
            All scenes
          </button>
          <b className="grow">{editing.name}</b>
          <button type="button" className="ghost" disabled={busy} onClick={() => void remove(editing)}>
            <Icon name="trash" />
          </button>
        </div>
        <p className="hint dim">
          {isPack
            ? `${editing.segments_total || segments.length} parts · swap any first/last still, edit text, then generate`
            : "Legacy caption pack — use on Create with a photo, or make a new storyboard scene for frame editing."}
        </p>

        {!isPack ? (
          <button type="button" className="primary go" onClick={() => useOnCreate(editing)}>
            <Icon name="wand" />
            <span>Use on Create</span>
          </button>
        ) : (
          <>
            <div className="card prompt">
              <div className="label">
                <span>Update all descriptions</span>
                <span>Optional</span>
              </div>
              <p className="hint dim">Rewrites every segment prompt (keeps motion, updates appearance notes).</p>
              <div className="box">
                <textarea
                  rows={3}
                  value={rewriteNote}
                  onChange={(e) => setRewriteNote(e.target.value)}
                  placeholder="e.g. Blonde hair, red sundress, soft daylight."
                  maxLength={2000}
                />
              </div>
              <button type="button" disabled={busy || !rewriteNote.trim()} onClick={() => void applyRewrite()}>
                <Icon name="text" />
                Apply to all segments
              </button>
            </div>

            <div className="seglist">
              {segments.map((seg) => (
                <SegmentCard
                  key={`${editing.id}-${seg.index}-${frameKey}`}
                  sceneId={editing.id}
                  seg={seg}
                  frameKey={frameKey}
                  disabled={busy}
                  onSave={(text) => void saveSegment(seg, text)}
                  onChangeFrame={(which) => changeFrame(seg, which)}
                />
              ))}
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

            <VideoLoraCard
              modelId="h3"
              modelLabel={modelLabel}
              avail={h3Meta.loras || []}
              max={videoMeta?.maxLoras || 3}
              onToast={onToast}
            />
            <ToggleCard
              title="Reference audio"
              note="Uses the soundtrack saved with this scene."
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
              disabled={busy || !modelReady || !segments.length}
              onClick={() => void generate()}
            >
              <Icon name="wand" />
              <span>{modelReady ? "Create video" : "Downloading…"}</span>
            </button>
            <p className="hint">
              Each part uses that segment&apos;s first + last frame (dual-frame i2v)
              {est ? ` · ~${fmtTime(est)} per slice` : ""}.
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="pane">
      {err && <p className="err">{err}</p>}
      <p className="hint">
        Storyboard scenes include first/last frames, descriptions, and audio. Open one to edit and create a video.
        Legacy gallery scenes still work on Create.
      </p>
      <div className="grid">
        {items.map((it) => (
          <button key={it.id} type="button" className="tile" onClick={() => void openScene(it.id)}>
            <img loading="lazy" src={`/api/scenes/${it.id}?thumb=1`} alt="" />
            <span>
              {it.name}
              {it.kind === "pack" ? "" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="empty" hidden={loading || items.length > 0}>
        <div className="avatar">
          <Icon name="cast" />
        </div>
        No scenes yet. Analyze a video on Storyboard, or save one from Gallery.
      </div>
    </section>
  );
}

function SegmentCard({
  sceneId,
  seg,
  frameKey,
  disabled,
  onSave,
  onChangeFrame,
}: {
  sceneId: string;
  seg: SceneSegment;
  frameKey: number;
  disabled: boolean;
  onSave: (text: string) => void;
  onChangeFrame: (which: "first" | "last") => void;
}) {
  const [text, setText] = useState(seg.description || seg.prompt || "");
  useEffect(() => setText(seg.description || seg.prompt || ""), [seg.description, seg.prompt]);

  return (
    <div className="card segcard">
      <div className="label">
        <span>
          Segment {(seg.index ?? 0) + 1} · {Math.round(seg.duration || 0)}s
        </span>
        <span>@{Math.round(seg.start || 0)}s</span>
      </div>
      <div className="segframes">
        {(["first", "last"] as const).map((which) => (
          <div key={which} className="qaframe">
            <img
              src={`/api/scenes/${sceneId}?frame=${which}&index=${seg.index}&v=${frameKey}`}
              alt={`${which} frame`}
            />
            <button type="button" disabled={disabled} onClick={() => onChangeFrame(which)}>
              Change {which}
            </button>
          </div>
        ))}
      </div>
      <div className="box">
        <textarea
          rows={4}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const next = text.trim();
            const prev = (seg.description || seg.prompt || "").trim();
            if (next && next !== prev) onSave(next);
          }}
          maxLength={4000}
        />
      </div>
    </div>
  );
}
