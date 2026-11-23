import { useEffect, useRef, useState } from "react";
import { api, storeGet, storeSet } from "../api";
import { Icon } from "../icons";
import { BATCH_MAX, type FolderSel } from "../types";

type PcItem = { path: string; name: string; parent?: string; mtime?: number };

type PcRoot = { id: string; label: string; available: boolean };

type PcSort = "new" | "old" | "name" | "name-desc";

type PcList = {
  dir: string;
  root?: string;
  root_id?: string;
  roots?: PcRoot[];
  total?: number;
  more?: number;
  folders: PcItem[];
  images?: PcItem[];
  videos?: PcItem[];
  audio?: PcItem[];
  recent?: PcItem[];
  kind?: string;
};

type PcSearch = {
  folders: PcItem[];
  images?: PcItem[];
  videos?: PcItem[];
  audio?: PcItem[];
  more?: number;
  root?: string;
  root_id?: string;
};

const DEFAULT_SAVE_DIR = "media/Cinema AI";
const DEFAULT_GDRIVE_SAVE_DIR = "gdrive:My Drive/Cinema AI";
const SORT_OPTS: { id: PcSort; label: string }[] = [
  { id: "new", label: "Newest" },
  { id: "old", label: "Oldest" },
  { id: "name", label: "A–Z" },
  { id: "name-desc", label: "Z–A" },
];

const FALLBACK_ROOTS: PcRoot[] = [
  { id: "studio", label: "Studio", available: true },
  { id: "gdrive", label: "Google Drive", available: true },
];

function rootIdOf(dir: string): string {
  const colon = dir.indexOf(":");
  if (colon > 0 && !dir.slice(0, colon).includes("/")) return dir.slice(0, colon);
  return "studio";
}

function isRootDir(dir: string): boolean {
  return !dir || dir.endsWith(":");
}

function parentDir(dir: string): string {
  if (!dir || isRootDir(dir)) return dir;
  const colon = dir.indexOf(":");
  if (colon > 0 && !dir.slice(0, colon).includes("/")) {
    const root = dir.slice(0, colon + 1);
    const sub = dir.slice(colon + 1);
    if (!sub.includes("/")) return root;
    return root + sub.split("/").slice(0, -1).join("/");
  }
  return dir.split("/").slice(0, -1).join("/");
}

function dirTitle(dir: string, rootLabel: string): string {
  if (isRootDir(dir)) return rootLabel;
  const sub = dir.includes(":") ? dir.slice(dir.indexOf(":") + 1) : dir;
  return sub.split("/").filter(Boolean).pop() || rootLabel;
}

function displayParent(parent: string | undefined, rootLabel: string): string {
  if (!parent || isRootDir(parent)) return rootLabel;
  if (parent.includes(":")) return parent.slice(parent.indexOf(":") + 1) || rootLabel;
  return parent;
}

function rootHome(rootId: string): string {
  return rootId === "studio" ? "" : `${rootId}:`;
}

function defaultSaveFor(rootId: string): string {
  return rootId === "gdrive" ? DEFAULT_GDRIVE_SAVE_DIR : DEFAULT_SAVE_DIR;
}

export function PcBrowser({
  open,
  kind = "images",
  mode = "pick",
  allowFolder,
  onClose,
  onImage,
  onFolder,
  onPickFolder,
  onToast,
}: {
  open: boolean;
  kind?: "images" | "audio" | "video";
  /** "folder" = save destination picker (Save here / New folder). */
  mode?: "pick" | "folder";
  allowFolder?: boolean;
  onClose: () => void;
  onImage?: (path: string) => void | Promise<void>;
  onFolder?: (folder: FolderSel) => void;
  onPickFolder?: (dir: string) => void | Promise<void>;
  onToast?: (msg: string) => void;
}) {
  const audioMode = kind === "audio";
  const videoMode = kind === "video";
  const saveMode = mode === "folder";
  const [dir, setDir] = useState(() => storeGet<string>(saveMode ? "saveDir" : "pcDir", saveMode ? DEFAULT_SAVE_DIR : ""));
  const [title, setTitle] = useState("Studio");
  const [rootLabel, setRootLabel] = useState("Studio");
  const [rootId, setRootId] = useState(() => rootIdOf(storeGet<string>(saveMode ? "saveDir" : "pcDir", "")));
  const [roots, setRoots] = useState<PcRoot[]>(FALLBACK_ROOTS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [folders, setFolders] = useState<PcItem[]>([]);
  const [files, setFiles] = useState<PcItem[]>([]);
  const [recent, setRecent] = useState<PcItem[]>([]);
  const [more, setMore] = useState(0);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [sortBy, setSortBy] = useState<PcSort>(() => {
    const saved = storeGet<string>("pcSort", "new");
    return SORT_OPTS.some((o) => o.id === saved) ? (saved as PcSort) : "new";
  });
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const start = saveMode
      ? storeGet<string>("saveDir", DEFAULT_SAVE_DIR)
      : storeGet<string>("pcDir", "");
    void (async () => {
      // First-run save picker: make sure the default Cinema AI folder exists.
      if (saveMode) {
        const rid = rootIdOf(start);
        const def = defaultSaveFor(rid);
        if (start === def || start === DEFAULT_SAVE_DIR || start === DEFAULT_GDRIVE_SAVE_DIR) {
          try {
            if (rid === "gdrive") {
              await api("/api/pc/mkdir", { dir: "gdrive:My Drive", name: "Cinema AI" });
            } else {
              await api("/api/pc/mkdir", { dir: "media", name: "Cinema AI" });
            }
          } catch {
            /* ignore — loadDir will fall back */
          }
        }
      }
      await loadDir(start);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, mode]);

  async function loadDir(next: string, sort = sortBy) {
    const my = ++seq.current;
    setLoading(true);
    setError("");
    setSearching(false);
    try {
      const data = await api<PcList>(
        `/api/pc/list?dir=${encodeURIComponent(next)}&kind=${encodeURIComponent(kind)}&sort=${encodeURIComponent(sort)}`,
      );
      if (my !== seq.current) return;
      setDir(data.dir);
      storeSet(saveMode ? "saveDir" : "pcDir", data.dir);
      const label = data.root || "Studio";
      const rid = data.root_id || rootIdOf(data.dir);
      setRootLabel(label);
      setRootId(rid);
      if (data.roots?.length) setRoots(data.roots);
      setTitle(dirTitle(data.dir, label));
      setTotal(data.total || 0);
      setFolders(data.folders || []);
      setFiles(videoMode ? data.videos || [] : audioMode ? data.audio || [] : data.images || []);
      setRecent(saveMode || audioMode ? [] : data.recent || []);
      setMore(data.more || 0);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    } catch (err) {
      if (my !== seq.current) return;
      if (next && !isRootDir(next)) {
        void loadDir(rootHome(rootIdOf(next)), sort);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't browse the PC");
      setFolders([]);
      setFiles([]);
      setRecent([]);
    }
    setLoading(false);
  }

  async function switchRoot(nextId: string) {
    if (nextId === rootId) return;
    const info = roots.find((r) => r.id === nextId);
    if (info && !info.available) {
      onToast?.(`${info.label} isn't available right now.`);
      return;
    }
    setQ("");
    if (saveMode) {
      const target = defaultSaveFor(nextId);
      if (nextId === "gdrive") {
        try {
          await api("/api/pc/mkdir", { dir: "gdrive:My Drive", name: "Cinema AI" });
        } catch {
          /* fall through */
        }
      } else if (nextId === "studio") {
        try {
          await api("/api/pc/mkdir", { dir: "media", name: "Cinema AI" });
        } catch {
          /* fall through */
        }
      }
      await loadDir(target);
      return;
    }
    await loadDir(rootHome(nextId));
  }

  async function runSearch(text: string, sort = sortBy) {
    text = text.trim();
    const my = ++seq.current;
    if (!text) {
      void loadDir(dir, sort);
      return;
    }
    setLoading(true);
    setSearching(true);
    setError("");
    try {
      const r = await api<PcSearch>(
        `/api/pc/search?q=${encodeURIComponent(text)}&kind=${encodeURIComponent(kind)}&sort=${encodeURIComponent(sort)}&scope=${encodeURIComponent(dir || rootHome(rootId))}`,
      );
      if (my !== seq.current) return;
      setFolders(r.folders || []);
      // Save mode: folders only — hide image/audio hits.
      setFiles(saveMode ? [] : videoMode ? r.videos || [] : audioMode ? r.audio || [] : r.images || []);
      setRecent([]);
      setMore(r.more || 0);
      setTotal(0);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    } catch (err) {
      if (my !== seq.current) return;
      setError(err instanceof Error ? err.message : "Search failed");
      setFolders([]);
      setFiles([]);
    }
    setLoading(false);
  }

  function pickSort(next: PcSort) {
    if (next === sortBy) return;
    setSortBy(next);
    storeSet("pcSort", next);
    const text = q.trim();
    if (text) void runSearch(text, next);
    else void loadDir(dir, next);
  }

  function onQuery(text: string) {
    setQ(text);
    if (timer.current) window.clearTimeout(timer.current);
    const trimmed = text.trim();
    if (!trimmed) {
      void runSearch("");
      return;
    }
    if (trimmed.length >= 2) {
      timer.current = window.setTimeout(() => void runSearch(trimmed), 400);
    }
  }

  async function newFolder() {
    const name = window.prompt("New folder name:");
    if (!name || !name.trim()) return;
    try {
      const data = await api<PcList>("/api/pc/mkdir", { dir, name: name.trim() });
      void loadDir(data.dir);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : "Couldn't create folder");
    }
  }

  async function saveHere() {
    storeSet("saveDir", dir);
    try {
      await onPickFolder?.(dir);
    } finally {
      onClose();
    }
  }

  if (!open) return null;

  const fileLabel = audioMode ? "Audio" : "Images";
  const emptyHint = saveMode
    ? "No folders here."
    : audioMode
      ? "No audio files or folders here."
      : "No images or folders here.";
  const searchEmpty = saveMode
    ? `No folders match “${q.trim()}”.`
    : audioMode
      ? `No folders or audio match “${q.trim()}”.`
      : `No folders or images match “${q.trim()}”.`;
  const showFiles = !saveMode && !!files.length;
  const showRecent = !saveMode && !!recent.length;
  const canGoUp = !isRootDir(dir) && !searching;

  return (
    <div
      className="sheet"
      id="pcSheet"
      onClick={(e) => {
        if ((e.target as HTMLElement).id === "pcSheet") onClose();
      }}
    >
      <div className={`sbox${saveMode ? " pcfolderonly" : ""}`} ref={bodyRef}>
        <div className="pchead">
          <div className="row">
            <button
              type="button"
              className="x"
              aria-label="Back"
              style={{ visibility: canGoUp ? "visible" : "hidden" }}
              onClick={() => void loadDir(parentDir(dir))}
            >
              <Icon name="back" />
            </button>
            <b className="grow" id="pcTitle">
              {title}
            </b>
            <button type="button" className="x" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>

          <div className="pcsort pcroots" role="group" aria-label="Location">
            <span>Place</span>
            {roots.map((r) => (
              <button
                key={r.id}
                type="button"
                className={rootId === r.id ? "on" : undefined}
                disabled={!r.available && rootId !== r.id}
                onClick={() => void switchRoot(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <form
            className="pcsearch"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(q);
            }}
          >
            <Icon name="search" />
            <input
              type="search"
              enterKeyHint="search"
              placeholder={
                saveMode ? "Search folders" : audioMode ? "Search folders & audio" : "Search folders & images"
              }
              maxLength={100}
              value={q}
              onChange={(e) => onQuery(e.target.value)}
            />
            {!!q.trim() && (
              <button
                type="button"
                className="x"
                aria-label="Clear"
                onClick={() => {
                  setQ("");
                  void runSearch("");
                }}
              >
                <Icon name="x" />
              </button>
            )}
          </form>

          <div className="pcsort" role="group" aria-label="Sort">
            <span>Sort</span>
            {SORT_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={sortBy === o.id ? "on" : undefined}
                onClick={() => pickSort(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div id="pcBody">
          {loading ? (
            <div className="bar indef">
              <i />
            </div>
          ) : error ? (
            <small className="dim">{error}</small>
          ) : (
            <>
              {saveMode && !searching && (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <button type="button" className="pcuse primary grow" onClick={() => void saveHere()}>
                    <Icon name="save" />
                    <span>Save here</span>
                  </button>
                  <button type="button" className="pcuse" onClick={() => void newFolder()}>
                    <Icon name="plus" />
                    <span>New folder</span>
                  </button>
                </div>
              )}
              {allowFolder && !saveMode && !audioMode && !searching && !!total && onFolder && (
                <button
                  type="button"
                  className="pcuse primary"
                  onClick={() => {
                    onFolder({
                      dir,
                      name: isRootDir(dir) ? rootLabel : dirTitle(dir, rootLabel),
                      recursive: false,
                      count: Math.min(total, BATCH_MAX),
                    });
                    onClose();
                  }}
                >
                  <Icon name="folder" />
                  <span>
                    Use all {total} image{total === 1 ? "" : "s"} in this folder
                    {total > BATCH_MAX ? ` (first ${BATCH_MAX})` : ""}
                  </span>
                </button>
              )}
              {showRecent && (
                <>
                  <div className="label">
                    <span>Recent images</span>
                  </div>
                  <PcGrid items={recent} onPick={(path) => void onImage?.(path)} />
                </>
              )}
              {!!folders.length && (
                <>
                  <div className="label">
                    <span>
                      Folders{searching ? ` · ${folders.length}` : ""}
                    </span>
                  </div>
                  <div className="pcfolders">
                    {folders.map((f) => (
                      <button key={f.path} type="button" onClick={() => void loadDir(f.path)}>
                        <Icon name="folder" />
                        <span>
                          {f.name}
                          {searching ? <small>{displayParent(f.parent, rootLabel)}</small> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {showFiles && (
                <>
                  <div className="label">
                    <span>
                      {fileLabel}
                      {searching ? ` · ${files.length}` : ""}
                    </span>
                  </div>
                  {audioMode ? (
                    <div className="pcfolders">
                      {files.map((f) => (
                        <button key={f.path} type="button" onClick={() => void onImage?.(f.path)}>
                          <Icon name="film" />
                          <span>
                            {f.name}
                            {searching ? <small>{displayParent(f.parent, rootLabel)}</small> : null}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <PcGrid items={files} video={videoMode} onPick={(path) => void onImage?.(path)} />
                  )}
                </>
              )}
              {!!more && !saveMode && (
                <small className="dim">
                  {searching
                    ? "Showing the first matches. Add another word to narrow it down."
                    : `${more} more ${audioMode ? "audio files" : videoMode ? "videos" : "images"} not shown.`}
                </small>
              )}
              {!folders.length && !showFiles && !showRecent && (
                <small className="dim">{searching ? searchEmpty : emptyHint}</small>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PcGrid({ items, video, onPick }: { items: PcItem[]; video?: boolean; onPick: (path: string) => void }) {
  return (
    <div className="pcgrid">
      {items.map((i) => (
        <button key={i.path} type="button" onClick={() => onPick(i.path)}>
          <img
            loading="lazy"
            src={
              video
                ? `/api/pc/video-thumb?path=${encodeURIComponent(i.path)}`
                : `/api/pc/thumb?path=${encodeURIComponent(i.path)}`
            }
            alt=""
          />
          <span>{i.name}</span>
        </button>
      ))}
    </div>
  );
}
