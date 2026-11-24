import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Icon } from "../icons";
import { SaveTarget, type SaveItem } from "./SaveTarget";
import type { GalleryItem } from "../types";

const PAGE_SIZE = 48;

const TAGS: Record<string, string> = {
  cinema: "Cinema",
  scene_video: "Scene",
  storyboard: "Storyboard",
};

type Pt = { x: number; y: number };
type Swipe = { x: number; y: number; t: number; axis: "" | "x" | "y" | "none"; dx: number; dy: number; id: number };

type GalleryPage = { items: GalleryItem[]; hasMore?: boolean };

function niceName(file: string): string {
  return file
    .replace(/\.safetensors$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function infoLines(item: GalleryItem): string {
  const lines: string[] = [TAGS[item.mode || ""] || (item.video ? "Video" : "Result")];
  const bits = [
    item.engine === "h3" ? "MiniMax H3" : item.engine || null,
    item.h3Model ? niceName(item.h3Model) : null,
    item.quality ? `${item.quality}p` : null,
    item.duration != null ? `${item.duration}s` : null,
    item.segments ? `${item.segments} parts` : null,
  ].filter(Boolean);
  if (bits.length) lines.push(bits.join(" · "));
  for (const l of item.loras || []) {
    const name = niceName(String(l.file || l.id || ""));
    if (name) lines.push(`LoRA: ${name} (${l.strength ?? 1})`);
  }
  const prompts = item.segment_prompts || (item.prompt ? [item.prompt] : []);
  for (const p of prompts.slice(0, 4)) {
    if (p) lines.push(p);
  }
  if (prompts.length > 4) lines.push(`…${prompts.length - 4} more parts`);
  return lines.join("\n");
}

export function GalleryView({ onToast, active }: { onToast: (msg: string) => void; active: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewing, setViewing] = useState<GalleryItem | null>(null);
  const [viewList, setViewList] = useState<GalleryItem[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [bare, setBare] = useState(false);
  const [savingScene, setSavingScene] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [saveItems, setSaveItems] = useState<SaveItem[] | null>(null);
  const [error, setError] = useState("");

  const slideRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<Swipe | null>(null);
  const pts = useRef(new Map<number, Pt>());
  const viewingRef = useRef(viewing);
  const infoOpenRef = useRef(infoOpen);
  const loadingMoreRef = useRef(false);
  const itemsLenRef = useRef(0);
  const hasMoreRef = useRef(true);
  viewingRef.current = viewing;
  infoOpenRef.current = infoOpen;
  itemsLenRef.current = items.length;
  hasMoreRef.current = hasMore;

  /** Fresh first page: pick up new gens / fav changes without reloading older pages. */
  const refreshHead = useCallback(async () => {
    try {
      const data = await api<GalleryPage>(`/api/gallery?slim=1&limit=${PAGE_SIZE}&offset=0`);
      const head = data.items;
      setItems((prev) => {
        if (!prev.length) return head;
        const headIds = new Set(head.map((it) => it.id));
        const rest = prev.filter((it) => !headIds.has(it.id));
        return [...head, ...rest];
      });
      if (itemsLenRef.current <= PAGE_SIZE) setHasMore(!!data.hasMore);
      setError("");
      setViewing((cur) => {
        if (!cur) return cur;
        const next = head.find((it) => it.id === cur.id);
        return next ? { ...cur, ...next } : cur;
      });
      setViewList((list) => {
        if (!list.length) return list;
        return list.map((it) => head.find((g) => g.id === it.id) || it);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const offset = itemsLenRef.current;
      const data = await api<GalleryPage>(`/api/gallery?slim=1&limit=${PAGE_SIZE}&offset=${offset}`);
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        const added = data.items.filter((it) => !seen.has(it.id));
        return added.length ? [...prev, ...added] : prev;
      });
      setHasMore(!!data.hasMore);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gallery");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refreshHead();
    const id = window.setInterval(() => {
      if (!document.hidden && active) void refreshHead();
    }, 5000);
    const onVis = () => {
      if (!document.hidden && active) void refreshHead();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshHead, active]);

  // Infinite scroll: #main is the overflow scroller, not the window.
  useEffect(() => {
    if (!active || !hasMore) return;
    const el = sentinelRef.current;
    const root = document.getElementById("main");
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active, hasMore, loadMore, items.length, loading]);

  useEffect(() => {
    setBare(false);
    setSceneName("");
  }, [viewing?.id]);

  useEffect(() => {
    if (!active) {
      setViewing(null);
      setInfoOpen(false);
      setBare(false);
      setSceneName("");
    }
  }, [active]);

  useEffect(() => {
    if (!viewing) return;
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.key === "ArrowRight") slideTo(1);
      else if (e.key === "ArrowLeft") slideTo(-1);
      else if (e.key === "Escape") closeViewer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, viewList]);

  function openViewer(it: GalleryItem, list: GalleryItem[]) {
    setViewList(list.includes(it) ? list.slice() : [it]);
    setViewing(it);
    setInfoOpen(false);
    setBare(false);
    setSceneName("");
    void api<GalleryItem>(`/api/gallery/${it.id}`)
      .then((full) => {
        setViewing((cur) => (cur && cur.id === full.id ? { ...cur, ...full } : cur));
        setViewList((vl) => vl.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
        setItems((all) => all.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
      })
      .catch(() => {});
  }

  function closeViewer() {
    setViewing(null);
    setInfoOpen(false);
    setBare(false);
    setSceneName("");
    const slide = slideRef.current;
    if (slide) {
      slide.style.transition = "";
      slide.style.transform = "";
    }
  }

  function slideTo(step: number) {
    if (!viewing) return;
    const i = viewList.findIndex((it) => it.id === viewing.id);
    const next = viewList[i + step];
    const slide = slideRef.current;
    const w = window.innerWidth;
    if (!next) {
      if (slide) {
        slide.style.transition = "transform .25s ease";
        slide.style.transform = "";
      }
      return;
    }
    if (slide) {
      slide.style.transition = "transform .2s ease-in";
      slide.style.transform = `translateX(${-step * w}px)`;
    }
    window.setTimeout(() => {
      setViewing(next);
      setSceneName("");
      void api<GalleryItem>(`/api/gallery/${next.id}`)
        .then((full) => {
          setViewing((cur) => (cur && cur.id === full.id ? { ...cur, ...full } : cur));
          setViewList((vl) => vl.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
          setItems((all) => all.map((x) => (x.id === full.id ? { ...x, ...full } : x)));
        })
        .catch(() => {});
      if (slide) {
        slide.style.transition = "none";
        slide.style.transform = `translateX(${step * w}px)`;
        slide.getBoundingClientRect();
        slide.style.transition = "transform .24s cubic-bezier(.2,.8,.2,1)";
        slide.style.transform = "";
      }
    }, 200);
  }

  async function toggleFav(item: GalleryItem) {
    try {
      const on = !item.favorite;
      await api("/api/favorite", { id: item.id, on });
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, favorite: on } : it)));
      setViewing((cur) => (cur?.id === item.id ? { ...cur, favorite: on } : cur));
      setViewList((list) => list.map((it) => (it.id === item.id ? { ...it, favorite: on } : it)));
      onToast(on ? "Added to favorites" : "Removed from favorites");
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

  async function remove(item: GalleryItem) {
    if (!confirm(`Delete this ${item.video ? "video" : "result"}?`)) return;
    try {
      await api("/api/delete", { id: item.id });
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setViewList((list) => list.filter((it) => it.id !== item.id));
      if (viewing?.id === item.id) closeViewer();
      onToast("Deleted");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed");
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!viewing || infoOpenRef.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const stage = stageRef.current;
    if (viewing.video && stage) {
      const r = stage.getBoundingClientRect();
      if (e.clientY > r.bottom - 90) return;
    }
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size > 1) return;
    swipe.current = { x: e.clientX, y: e.clientY, t: Date.now(), axis: "", dx: 0, dy: 0, id: e.pointerId };
    const slide = slideRef.current;
    if (slide) slide.style.transition = "none";
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = swipe.current;
    if (!s || !viewing || e.pointerId !== s.id) return;
    s.dx = e.clientX - s.x;
    s.dy = e.clientY - s.y;
    if (!s.axis && Math.hypot(s.dx, s.dy) > 10) {
      s.axis = Math.abs(s.dx) > Math.abs(s.dy) ? "x" : s.dy > 0 ? "y" : "none";
    }
    const slide = slideRef.current;
    if (!slide) return;
    if (s.axis === "x") {
      const i = viewList.findIndex((it) => it.id === viewing.id);
      const edge = (s.dx > 0 && i <= 0) || (s.dx < 0 && i >= viewList.length - 1);
      slide.style.transform = `translateX(${edge ? s.dx / 3 : s.dx}px)`;
    } else if (s.axis === "y") {
      slide.style.transform = `translateY(${s.dy}px) scale(${Math.max(0.8, 1 - s.dy / 1500)})`;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pts.current.delete(e.pointerId);
    const s = swipe.current;
    if (!s || !viewing || e.pointerId !== s.id) return;
    swipe.current = null;
    const slide = slideRef.current;
    const ms = Date.now() - s.t;
    if (s.axis === "x") {
      if (Math.abs(s.dx) > window.innerWidth * 0.22 || (Math.abs(s.dx) > 40 && Math.abs(s.dx) / ms > 0.5)) {
        slideTo(s.dx < 0 ? 1 : -1);
      } else if (slide) {
        slide.style.transition = "transform .25s ease";
        slide.style.transform = "";
      }
    } else if (s.axis === "y") {
      if (s.dy > 110) {
        closeViewer();
        return;
      }
      if (slide) {
        slide.style.transition = "transform .25s ease";
        slide.style.transform = "";
      }
    } else if (!s.axis && e.type === "pointerup" && ms < 300) {
      setBare((b) => !b);
    }
  }

  const idx = viewing ? viewList.findIndex((it) => it.id === viewing.id) : -1;
  const countLabel = viewing && viewList.length > 1 ? `${idx + 1} / ${viewList.length}` : "";
  const canSaveScene = viewing?.mode === "cinema" || viewing?.mode === "scene_video";

  return (
    <section className="pane">
      {error && <p className="err">{error}</p>}
      <div className="grid">
        {items.map((it) => (
          <button key={it.id} type="button" className="tile" onClick={() => openViewer(it, items)}>
            <img loading="lazy" src={`/api/output/${it.id}?thumb=1`} alt="" />
            {it.video && (
              <i className="play">
                <Icon name="film" />
              </i>
            )}
            <span>{TAGS[it.mode || ""] || (it.video ? "Video" : "Result")}</span>
            {it.favorite && (
              <i className="star">
                <Icon name="star" />
              </i>
            )}
          </button>
        ))}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="gallery-more" aria-hidden={!loadingMore}>
          {(loading || loadingMore) && <p className="hint">Loading…</p>}
        </div>
      )}
      <div className="empty" hidden={loading || items.length > 0}>
        <div className="avatar">
          <Icon name="film" />
        </div>
        Nothing yet. Finished Cinema jobs appear here.
      </div>

      {viewing &&
        createPortal(
          <div
            id="viewer"
            className={`${infoOpen ? "info " : ""}${bare ? "bare " : ""}${viewing.video ? "video" : ""}`.trim()}
          >
            <div
              className="vstage"
              ref={stageRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="vslide" ref={slideRef}>
                {viewing.video ? (
                  <video
                    key={viewing.id}
                    src={`/api/output/${viewing.id}.mp4`}
                    controls
                    playsInline
                    loop
                    autoPlay
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
              <span className="vcount glass">{countLabel}</span>
              <div className="vright">
                <button
                  type="button"
                  className={`round glass${viewing.favorite ? " on" : ""}`}
                  id="vHeart"
                  aria-label={viewing.favorite ? "Unfavorite" : "Favorite"}
                  onClick={() => void toggleFav(viewing)}
                >
                  <Icon name="heart" />
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
              <p style={{ whiteSpace: "pre-wrap" }}>{infoLines(viewing)}</p>
              <div className="row">
                <button type="button" className={`fav${viewing.favorite ? " on" : ""}`} onClick={() => void toggleFav(viewing)}>
                  <Icon name="star" />
                  <span>{viewing.favorite ? "Favorited" : "Favorite"}</span>
                </button>
                <button type="button" onClick={() => setSaveItems([{ id: viewing.id, video: viewing.video }])}>
                  <Icon name="save" />
                  <span>Save</span>
                </button>
                {canSaveScene && (
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
              {canSaveScene && infoOpen && (
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
