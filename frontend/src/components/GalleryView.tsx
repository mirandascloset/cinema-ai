import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import type { GalleryItem } from "../types";

const PAGE = 48;

export function GalleryView({ onToast, active }: { onToast: (msg: string) => void; active: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const [savingScene, setSavingScene] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ items: GalleryItem[]; hasMore?: boolean }>(`/api/gallery?slim=1&limit=${PAGE}&offset=0`);
      setItems(data.items);
      setHasMore(!!data.hasMore);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void refresh();
    const t = window.setInterval(() => {
      if (active) void refresh();
    }, 8000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  useEffect(() => {
    if (!active) setViewing(null);
  }, [active]);

  async function toggleFav(it: GalleryItem) {
    try {
      await api("/api/favorite", { id: it.id, on: !it.favorite });
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, favorite: !it.favorite } : x)));
      if (viewing?.id === it.id) setViewing({ ...it, favorite: !it.favorite });
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  async function saveAsScene(it: GalleryItem) {
    setSavingScene(true);
    try {
      const row = await api<{ id: string; name: string }>("/api/scenes/save", {
        outputId: it.id,
        name: sceneName.trim(),
      });
      onToast(`Saved as “${row.name}”`);
      setSceneName("");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not save scene");
    } finally {
      setSavingScene(false);
    }
  }

  async function openItem(it: GalleryItem) {
    try {
      const full = await api<GalleryItem>(`/api/gallery/${it.id}`);
      setViewing(full);
      setSceneName("");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not open");
    }
  }

  async function remove(it: GalleryItem) {
    try {
      await api("/api/delete", { id: it.id });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      if (viewing?.id === it.id) setViewing(null);
      onToast("Deleted");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <section className="pane">
      {error && <p className="err">{error}</p>}
      <div className="grid">
        {items.map((it) => (
          <button key={it.id} type="button" className="tile" onClick={() => void openItem(it)}>
            <img loading="lazy" src={`/api/output/${it.id}?thumb=1`} alt="" />
            {it.video && (
              <i className="play">
                <Icon name="film" />
              </i>
            )}
            <span>{it.mode === "cinema" ? "Cinema" : "Video"}</span>
            {it.favorite && (
              <i className="star">
                <Icon name="star" />
              </i>
            )}
          </button>
        ))}
      </div>
      {hasMore && !loading && items.length >= PAGE && <p className="hint">Open on PC for the full list.</p>}
      <div className="empty" hidden={loading || items.length > 0}>
        <div className="avatar">
          <Icon name="film" />
        </div>
        Nothing yet. Finished Cinema jobs appear here.
      </div>

      {viewing && (
        <div
          className="sheet on"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("sheet")) setViewing(null);
          }}
        >
          <div className="sbox tall">
            <div className="row">
              <b className="grow">Result</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setViewing(null)}>
                <Icon name="x" />
              </button>
            </div>
            <div className="photo has">
              {viewing.video ? (
                <video src={`/api/output/${viewing.id}.mp4`} controls playsInline autoPlay className="preview" />
              ) : (
                <img src={`/api/output/${viewing.id}`} alt="" />
              )}
            </div>
            {viewing.mode === "cinema" && (
              <>
                <div className="label">
                  <span>Save as scene</span>
                </div>
                <p className="hint dim">Re-use these motion captions with a new photo — no need to study the reference again.</p>
                <div className="box">
                  <input
                    type="text"
                    value={sceneName}
                    onChange={(e) => setSceneName(e.target.value)}
                    placeholder="Scene name (optional)"
                    maxLength={120}
                  />
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={savingScene}
                  onClick={() => void saveAsScene(viewing)}
                >
                  <Icon name="save" />
                  {savingScene ? "Saving…" : "Save as scene"}
                </button>
              </>
            )}
            <div className="row acts">
              <button type="button" onClick={() => void toggleFav(viewing)}>
                <Icon name="star" />
                {viewing.favorite ? "Unfavorite" : "Favorite"}
              </button>
              <button type="button" onClick={() => void remove(viewing)}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}