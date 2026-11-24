import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtTime, pollJob, sceneApi } from "../api";
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

type FamilyGroup = {
  key: string;
  name: string;
  thumbId: string;
  versions: SceneItem[];
  isPack: boolean;
};

function nextTitle(versions: SceneItem[]): string {
  const used = new Set(
    versions.flatMap((v) => [String(v.version || "").toLowerCase(), String(v.version_title || "").toLowerCase()]),
  );
  let n = 2;
  while (used.has(`v${n}`)) n += 1;
  return `v${n}`;
}

export function SceneView({
  active,
  status,
  busy,
  setBusy,
  onJob,
  onToast,
  onDone,
  onUseCreate,
  focusSceneId,
  onFocusConsumed,
}: {
  active: boolean;
  status: Status | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onJob: (job: Job) => void;
  onToast: (msg: string) => void;
  onDone?: () => void;
  onUseCreate: () => void;
  /** Open this scene/version when arriving from Gallery (or elsewhere). */
  focusSceneId?: string;
  onFocusConsumed?: () => void;
}) {
  const settings = useSettings();
  const { openPicker } = useSourcePicker();
  const [items, setItems] = useState<SceneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SceneItem | null>(null);
  const [rewriteNote, setRewriteNote] = useState("");
  const [versionTitle, setVersionTitle] = useState("");
  const [err, setErr] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [forkTitle, setForkTitle] = useState("");
  const [forkSource, setForkSource] = useState("");

  const videoMeta = status?.video;
  const h3Meta = videoMeta?.h3 || { loras: [], models: [], steps: [4, 30] };
  const modelReady = videoMeta?.models?.h3?.ready ?? videoMeta?.ready ?? false;
  const modelLabel = videoMeta?.label || "MiniMax H3";
  const estKey = `720-${settings.videoSeconds}`;
  const est = videoMeta?.models?.h3?.estimates?.[estKey];

  const families = useMemo(() => {
    const map = new Map<string, FamilyGroup>();
    for (const it of items) {
      if (it.kind === "pack" && it.family) {
        const key = it.family;
        const row = map.get(key) || {
          key,
          name: it.name || key,
          thumbId: it.id,
          versions: [],
          isPack: true,
        };
        row.versions.push(it);
        if (it.version === "v1") row.thumbId = it.id;
        map.set(key, row);
      } else {
        map.set(it.id, {
          key: it.id,
          name: it.name || it.id,
          thumbId: it.id,
          versions: [it],
          isPack: false,
        });
      }
    }
    return Array.from(map.values()).map((f) => ({
      ...f,
      versions: [...f.versions].sort((a, b) => {
        if (a.version === "v1") return -1;
        if (b.version === "v1") return 1;
        return (a.created || 0) - (b.created || 0);
      }),
    }));
  }, [items]);

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
    if (!active) {
      setEditing(null);
      setOpenFamily(null);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !focusSceneId) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await api<SceneItem>(sceneApi(focusSceneId));
        if (cancelled) return;
        setEditing(row);
        setRewriteNote("");
        setOpenFamily(null);
        setFrameKey((k) => k + 1);
        const main = document.getElementById("main");
        if (main) main.scrollTop = 0;
      } catch (e) {
        if (!cancelled) onToast(e instanceof Error ? e.message : "Couldn't open that scene");
      } finally {
        onFocusConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, focusSceneId, onFocusConsumed, onToast]);

  useEffect(() => {
    if (!editing) return;
    setVersionTitle(editing.version_title || editing.version || editing.name || "");
  }, [editing?.id, editing?.version_title, editing?.version, editing?.name]);

  async function openVersion(id: string) {
    try {
      const row = await api<SceneItem>(sceneApi(id));
      setEditing(row);
      setRewriteNote("");
      setOpenFamily(null);
      setFrameKey((k) => k + 1);
      const main = document.getElementById("main");
      if (main) main.scrollTop = 0;
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't open scene");
    }
  }

  function selectFamily(group: FamilyGroup) {
    if (!group.isPack) {
      void openVersion(group.versions[0]?.id || group.key);
      return;
    }
    if (openFamily === group.key) {
      setOpenFamily(null);
      return;
    }
    const source = group.versions.find((v) => v.version === "v1") || group.versions[0];
    setOpenFamily(group.key);
    setForkSource(source?.id || "");
    setForkTitle(nextTitle(group.versions));
  }

  async function createVersion(sourceId: string, title: string) {
    const clean = title.trim();
    if (!clean) {
      onToast("Name this version");
      return;
    }
    setBusy(true);
    try {
      const row = await api<SceneItem>("/api/scenes/fork", { source: sourceId, title: clean });
      await refresh();
      setEditing(row);
      setRewriteNote("");
      setOpenFamily(null);
      setFrameKey((k) => k + 1);
      onToast(`Created “${clean}” — edits save to this version.`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't create version");
    } finally {
      setBusy(false);
    }
  }

  async function saveSegment(seg: SceneSegment, description: string) {
    if (!editing) return;
    try {
      const row = await api<SceneItem>(sceneApi(editing.id, "") + "/segment", {
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
            const row = await api<SceneItem>(sceneApi(editing.id, "") + "/frame", {
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
      const row = await api<SceneItem>(sceneApi(editing.id, "") + "/rewrite", { note: rewriteNote.trim() });
      setEditing(row);
      onToast("Updated all segment descriptions");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't rewrite prompts");
    } finally {
      setBusy(false);
    }
  }

  async function saveVersionTitle() {
    if (!editing) return;
    const clean = versionTitle.trim();
    if (!clean || clean === (editing.version_title || editing.version)) return;
    try {
      const row = await api<SceneItem>("/api/scenes/rename", { id: editing.id, name: clean });
      setEditing(row);
      await refresh();
      onToast("Version title saved");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Couldn't rename");
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
      onToast("Creating video from this version…");
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
    onToast(`Using “${scene.label || scene.name}” — add a photo on Create.`);
    onUseCreate();
  }

  async function removeVersion(scene: SceneItem) {
    try {
      await api("/api/scenes/delete", { id: scene.id });
      setItems((prev) => prev.filter((x) => x.id !== scene.id));
      if (getSettings().selectedSceneId === scene.id) updateSettings({ selectedSceneId: "" });
      if (editing?.id === scene.id) setEditing(null);
      await refresh();
      onToast("Version deleted");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed");
    }
  }

  async function removeFamily(group: FamilyGroup) {
    try {
      await api("/api/scenes/delete", { family: group.key, deleteFamily: true });
      if (editing?.family === group.key) setEditing(null);
      if (openFamily === group.key) setOpenFamily(null);
      await refresh();
      onToast("Scene deleted");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed");
    }
  }

  if (editing) {
    const isPack = editing.kind === "pack";
    const segments = editing.segments || [];
    const siblings = editing.versions || items.filter((x) => x.family && x.family === editing.family);
    const versionLabel = editing.version_title || editing.version || "v1";
    return (
      <section className="pane scene-editor" id="sceneEditor">
        <header className="scene-editor-top">
          <div className="scene-editor-side">
            <button type="button" className="ghost scene-icon-btn" aria-label="All scenes" onClick={() => setEditing(null)}>
              <Icon name="back" />
            </button>
          </div>
          <div className="scene-editor-title">
            <b>{editing.name}</b>
            {isPack && <small>{versionLabel}</small>}
          </div>
          <div className="scene-editor-side end">
            <button
              type="button"
              className="ghost scene-icon-btn"
              disabled={busy}
              aria-label="Delete version"
              onClick={() => void removeVersion(editing)}
            >
              <Icon name="trash" />
            </button>
          </div>
        </header>

        <div className="scene-editor-body">
          {!isPack ? (
            <div className="scene-section">
              <p className="hint dim">Legacy caption pack — use on Create with a photo, or make a new storyboard scene for frame editing.</p>
              <button type="button" className="primary go" onClick={() => useOnCreate(editing)}>
                <Icon name="wand" />
                <span>Use on Create</span>
              </button>
            </div>
          ) : (
            <>
              <div className="scene-section">
                <div className="label">
                  <span>Version</span>
                  <span>{editing.version === "v1" ? "Original analyze" : "Editable copy"}</span>
                </div>
                <div className="box">
                  <input
                    value={versionTitle}
                    disabled={busy}
                    onChange={(e) => setVersionTitle(e.target.value)}
                    onBlur={() => void saveVersionTitle()}
                    maxLength={120}
                    placeholder="e.g. blue jacket"
                  />
                </div>
                {siblings.length > 1 && (
                  <div className="chipwrap scene-versions">
                    {siblings.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={v.id === editing.id ? "on" : ""}
                        disabled={busy}
                        onClick={() => void openVersion(v.id)}
                      >
                        {v.version_title || v.version || v.id}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="ghost scene-fork-btn"
                  disabled={busy}
                  onClick={() => void createVersion(editing.id, nextTitle(siblings))}
                >
                  <Icon name="plus" />
                  New version from this
                </button>
              </div>

              <div className="scene-section">
                <div className="label">
                  <span>Rewrite all prompts</span>
                  <span>Optional</span>
                </div>
                <p className="hint dim">Keeps motion, updates appearance notes on every segment.</p>
                <div className="box">
                  <textarea
                    rows={3}
                    value={rewriteNote}
                    onChange={(e) => setRewriteNote(e.target.value)}
                    placeholder="e.g. Blonde hair, red sundress, soft daylight."
                    maxLength={2000}
                  />
                </div>
                <button
                  type="button"
                  className="scene-secondary"
                  disabled={busy || !rewriteNote.trim()}
                  onClick={() => void applyRewrite()}
                >
                  <Icon name="text" />
                  Apply to all segments
                </button>
              </div>

              <div className="scene-section">
                <div className="label">
                  <span>Segments</span>
                  <span>{segments.length} parts</span>
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
              </div>

              <div className="scene-section scene-generate">
                <div className="label">
                  <span>Create video</span>
                  <span>720p · H3</span>
                </div>
                <div className="chipwrap length-chips">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.seconds}
                      type="button"
                      className={settings.videoSeconds === l.seconds ? "on" : ""}
                      onClick={() => updateSettings({ videoSeconds: l.seconds })}
                    >
                      {l.seconds}s · {l.note}
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
                  Part 1 starts from the first beat, then extends through each part like Create → Action
                  {est ? ` · ~${fmtTime(est)} per slice` : ""}.
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="pane">
      {err && <p className="err">{err}</p>}
      <p className="hint">
        Storyboard analyze saves <b>v1</b>. Tap a scene to name a new version or open an existing one.
      </p>
      <div className="scenelist">
        {families.map((group) => {
          const open = openFamily === group.key;
          return (
            <div key={group.key} className={`scenefamily${open ? " open" : ""}`}>
              <button type="button" className="scenerow" onClick={() => selectFamily(group)}>
                <img loading="lazy" src={sceneApi(group.thumbId, "thumb=1")} alt="" />
                <span className="scenerow-text">
                  <b>{group.name}</b>
                  <small>
                    {group.isPack
                      ? `${group.versions.length} version${group.versions.length === 1 ? "" : "s"}`
                      : "Legacy scene"}
                  </small>
                </span>
                <Icon name="chev" />
              </button>
              {open && group.isPack && (
                <div className="card scenefork">
                  <div className="label">
                    <span>New version</span>
                    <span>Edits save here</span>
                  </div>
                  <div className="box">
                    <input
                      value={forkTitle}
                      onChange={(e) => setForkTitle(e.target.value)}
                      placeholder="Version title"
                      maxLength={120}
                      disabled={busy}
                      autoCapitalize="sentences"
                    />
                  </div>
                  <div className="label">
                    <span>Copy from</span>
                  </div>
                  <div className="chipwrap">
                    {group.versions.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={forkSource === v.id ? "on" : ""}
                        disabled={busy}
                        onClick={() => setForkSource(v.id)}
                      >
                        {v.version_title || v.version}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="primary go"
                    disabled={busy || !forkSource || !forkTitle.trim()}
                    onClick={() => void createVersion(forkSource, forkTitle)}
                  >
                    <Icon name="plus" />
                    Create & edit
                  </button>
                  <div className="label">
                    <span>Open existing</span>
                  </div>
                  <div className="chipwrap">
                    {group.versions.map((v) => (
                      <button key={v.id} type="button" disabled={busy} onClick={() => void openVersion(v.id)}>
                        {v.version_title || v.version}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="ghost" disabled={busy} onClick={() => void removeFamily(group)}>
                    <Icon name="trash" />
                    Delete scene
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="empty" hidden={loading || families.length > 0}>
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
    <article className="card segcard">
      <div className="label">
        <span>
          Part {(seg.index ?? 0) + 1}
          {seg.duration != null ? ` · ${Math.round(seg.duration)}s` : ""}
        </span>
        <span>{seg.start != null ? `@${Math.round(seg.start)}s` : ""}</span>
      </div>
      <div className="segframes">
        {(["first", "last"] as const).map((which) => (
          <div key={which} className="qaframe">
            <img
              src={sceneApi(sceneId, `frame=${which}&index=${seg.index}&v=${frameKey}`)}
              alt={`${which} frame`}
            />
            <button type="button" className="scene-frame-btn" disabled={disabled} onClick={() => onChangeFrame(which)}>
              Change {which}
            </button>
          </div>
        ))}
      </div>
      <div className="box">
        <textarea
          rows={5}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const next = text.trim();
            const prev = (seg.description || seg.prompt || "").trim();
            if (next && next !== prev) onSave(next);
          }}
          maxLength={4000}
          placeholder="Describe this part…"
        />
      </div>
    </article>
  );
}
