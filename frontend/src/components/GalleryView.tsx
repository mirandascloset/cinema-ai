import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Icon } from "../icons";
import { SaveTarget, type SaveItem } from "./SaveTarget";
import type { GalleryItem } from "../types";

const PAGE = 48;

export function GalleryView({ onToast, active }: { onToast: (msg: string) => void; active: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [savingScene, setSavingScene] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [saveItems, setSaveItems] = useState<SaveItem[] | null>(null);
  const [error, setError] = useState("");

  const closeViewer = useCallback(() => {
    setViewing(null);
    setInfoOpen(false);
    setSceneName("");
  }, []);

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
    if (!active) closeViewer();
  }, [active, closeViewer]);

  useEffect(() => {
    if (!viewing) return;
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") closeViewer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, closeViewer]);

  async function toggleFav(it: GalleryItem) {
    try {
      const on = !it.favorite;
      await api("/api/favorite", { id: it.id, on });
      const next = { ...it, favorite: on };
      setItems((prev) => prev.map((x) => (x.id === it.id ? next : x)));
      if (viewing?.id === it.id) setViewing(next);
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
    setViewing(it);
    setInfoOpen(it.mode === "cinema");
    setSceneName("");
    try {
      const full = await api<GalleryItem>(`/api/gallery/${it.id}`);
      setViewing((cur) => (cur?.id === full.id ? { ...cur, ...full } : full));
      setItems((prev) => prev.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not open");
    }
  }

  async function remove(it: GalleryItem) {
    try {
      await api("/api/delete", { id: it.id });
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      if (viewing?.id === it.id) closeViewer();
      onToast("Deleted");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  function infoText(it: GalleryItem) {
    const lines = [
      it.mode === "cinema" ? "Cinema · MiniMax H3" : "Video",
      it.quality ? `${it.quality}p` : null,
      it.duration ? `${it.duration}s` : null,
      it.segments ? `${it.segments} parts` : null,
    ].filter(Boolean);
    return lines.join(" · ");
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

      {viewing &&
        createPortal(
          <div id="viewer" className={`${infoOpen ? "info " : ""}${viewing.video ? "video" : ""}`.trim()}>
            <div className="vstage">
              <div className="vslide">
                {viewing.video ? (
                  <video
                    key={viewing.id}
                    src={`/api/output/${viewing.id}.mp4`}
                    controls
                    playsInline
                    loop
                    poster={`/api/output/${viewing.id}?thumb=1`}
                  />
                ) : (
                  <img key={viewing.id} src={`/api/output/${viewing.id}`} alt="" draggable={false} />
                )}
              </div>
            </div>
            <div className="vbar">
              <button type="button" className="round glass" aria-label="Close" onClick={closeViewer}>
                <Icon name="x" />
              </button>
              <span className="vcount glass">{viewing.mode === "cinema" ? "Cinema" : "Result"}</span>
              <div className="vright">
                <button
                  type="button"
                  className={`round glass${viewing.favorite ? " on" : ""}`}
                  aria-label={viewing.favorite ? "Unfavorite" : "Favorite"}
                  onClick={() => void toggleFav(viewing)}
                >
                  <Icon name="star" />
                </button>
                <button
                  type="button"
                  className={`round glass${infoOpen ? " on" : ""}`}
                  aria-label="Info and actions"
                  onClick={() => setInfoOpen((v) => !v)}
                >
                  <Icon name="info" />
                </button>
              </div>
            </div>
            <div className="vdock glass">
              <div
                className="vhandle"
                role="button"
                tabIndex={0}
                aria-label="Collapse"
                onClick={() => setInfoOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setInfoOpen(false);
                }}
              />
              <p>{infoText(viewing)}</p>
              <div className="row">
                <button type="button" onClick={() => setSaveItems([{ id: viewing.id, video: viewing.video }])}>
                  <Icon name="save" />
                  <span>Save</span>
                </button>
                <button type="button" className={`fav${viewing.favorite ? " on" : ""}`} onClick={() => void toggleFav(viewing)}>
                  <Icon name="star" />
                  <span>{viewing.favorite ? "Favorited" : "Favorite"}</span>
                </button>
                {viewing.mode === "cinema" && (
                  <button type="button" disabled={savingScene} onClick={() => void saveAsScene(viewing)}>
                    <Icon name="save" />
                    <span>{savingScene ? "Saving…" : "Save scene"}</span>
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void remove(viewing)}>
                  <Icon name="trash" />
                  <span>Delete</span>
                </button>
              </div>
              {viewing.mode === "cinema" && infoOpen && (
                <>
                  <div className="box">
                    <input
                      type="text"
                      value={sceneName}
                      onChange={(e) => setSceneName(e.target.value)}
                      placeholder="Scene name (optional)"
                      maxLength={120}
                    />
                  </div>
                  <p className="dim">Scene saves motion captions, LoRAs, and reference audio for quick re-runs.</p>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
      {createPortal(
        <SaveTarget items={saveItems} onClose={() => setSaveItems(null)} onToast={onToast} />,
        document.body,
      )}
    </section>
  );
}