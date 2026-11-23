import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import { getSettings, updateSettings } from "../settings";
import type { SceneItem } from "../types";

export function SceneView({
  active,
  onToast,
  onUse,
}: {
  active: boolean;
  onToast: (msg: string) => void;
  onUse: () => void;
}) {
  const [items, setItems] = useState<SceneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<SceneItem | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ items: SceneItem[] }>("/api/scenes");
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load scenes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (!active) {
      setViewing(null);
      setRenaming(false);
    }
  }, [active]);

  function useScene(scene: SceneItem) {
    updateSettings({ selectedSceneId: scene.id });
    setViewing(null);
    onToast(`Using “${scene.name}” — add a photo on Create.`);
    onUse();
  }

  function startRename() {
    if (!viewing) return;
    setNameDraft(viewing.name);
    setRenaming(true);
  }

  async function saveRename() {
    if (!viewing) return;
    try {
      const row = await api<SceneItem>("/api/scenes/rename", { id: viewing.id, name: nameDraft });
      setItems((prev) => prev.map((x) => (x.id === row.id ? { ...x, name: row.name } : x)));
      setViewing({ ...viewing, name: row.name });
      setRenaming(false);
      onToast("Renamed");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(scene: SceneItem) {
    try {
      await api("/api/scenes/delete", { id: scene.id });
      setItems((prev) => prev.filter((x) => x.id !== scene.id));
      if (getSettings().selectedSceneId === scene.id) updateSettings({ selectedSceneId: "" });
      setViewing(null);
      onToast("Scene deleted");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <section className="pane">
      {error && <p className="err">{error}</p>}
      <p className="hint">Scenes store motion captions from a reference clip. Pick a scene, add a photo on Create, and Action skips re-reading the video.</p>
      <div className="grid">
        {items.map((it) => (
          <button key={it.id} type="button" className="tile" onClick={() => setViewing(it)}>
            <img loading="lazy" src={`/api/scenes/${it.id}?thumb=1`} alt="" />
            <span>{it.name}</span>
          </button>
        ))}
      </div>
      <div className="empty" hidden={loading || items.length > 0}>
        <div className="avatar">
          <Icon name="cast" />
        </div>
        No scenes yet. In Gallery, open a Cinema result and tap <b>Save as scene</b>.
      </div>

      {viewing && !renaming && (
        <div
          className="sheet on"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("sheet")) setViewing(null);
          }}
        >
          <div className="sbox tall">
            <div className="row">
              <b className="grow">{viewing.name}</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setViewing(null)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="photo has sm">
              <img src={`/api/scenes/${viewing.id}?thumb=1`} alt="" />
            </div>
            <p className="dim">
              {viewing.segments_total || "?"} parts · reference {viewing.duration ? `${Math.round(viewing.duration)}s` : "video"}
            </p>
            <div className="row acts">
              <button type="button" className="primary" onClick={() => useScene(viewing)}>
                <Icon name="wand" />
                Use on Create
              </button>
              <button type="button" onClick={startRename}>
                <Icon name="text" />
                Rename
              </button>
              <button type="button" onClick={() => void remove(viewing)}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && renaming && (
        <div
          className="sheet on"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("sheet")) setRenaming(false);
          }}
        >
          <div className="sbox">
            <div className="row">
              <b className="grow">Rename scene</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setRenaming(false)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="box">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Scene name"
                maxLength={120}
              />
            </div>
            <button type="button" className="primary go" onClick={() => void saveRename()}>
              Save name
            </button>
          </div>
        </div>
      )}
    </section>
  );
}