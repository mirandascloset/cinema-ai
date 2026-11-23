import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { pcImport, pcImportVideo, uploadImage, uploadVideo } from "../api";
import { Icon } from "../icons";
import type { UploadMeta, VideoMeta } from "../types";
import { PcBrowser } from "./PcBrowser";

export type SourcePickKind = "image" | "video";

export type SourcePickOptions = {
  kind?: SourcePickKind;
  title?: string;
  onImage?: (meta: UploadMeta) => void;
  onVideo?: (meta: VideoMeta) => void;
  onBusy?: (busy: boolean) => void;
  onToast?: (msg: string) => void;
};

type Ctx = { openPicker: (opts: SourcePickOptions) => void };

const SourcePickerContext = createContext<Ctx | null>(null);

export function useSourcePicker(): Ctx {
  const ctx = useContext(SourcePickerContext);
  if (!ctx) throw new Error("useSourcePicker requires SourcePickerProvider");
  return ctx;
}

export function SourcePickerProvider({ children }: { children: ReactNode }) {
  const [srcOpen, setSrcOpen] = useState(false);
  const [pcOpen, setPcOpen] = useState(false);
  const [opts, setOpts] = useState<SourcePickOptions | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const optsRef = useRef<SourcePickOptions | null>(null);
  optsRef.current = opts;
  const kind: SourcePickKind = opts?.kind === "video" ? "video" : "image";

  const openPicker = useCallback((next: SourcePickOptions) => {
    setOpts(next);
    setSrcOpen(true);
  }, []);

  async function handleFiles(files: File[]) {
    const o = optsRef.current;
    if (!o || !files.length) return;
    setSrcOpen(false);
    o.onBusy?.(true);
    try {
      if (kind === "video") o.onVideo?.(await uploadVideo(files[0]!));
      else o.onImage?.(await uploadImage(files[0]!));
    } catch (err) {
      o.onToast?.(err instanceof Error ? err.message : "Upload failed");
    }
    o.onBusy?.(false);
  }

  async function handlePcPath(path: string) {
    const o = optsRef.current;
    if (!o) return;
    setPcOpen(false);
    o.onBusy?.(true);
    try {
      if (kind === "video") o.onVideo?.(await pcImportVideo(path));
      else o.onImage?.(await pcImport(path));
    } catch (err) {
      o.onToast?.(err instanceof Error ? err.message : "Import failed");
    }
    o.onBusy?.(false);
  }

  const title = opts?.title || (kind === "video" ? "Choose a video" : "Choose a photo");

  return (
    <SourcePickerContext.Provider value={{ openPicker }}>
      {children}
      <input
        ref={fileRef}
        type="file"
        accept={kind === "video" ? "video/*,.mp4,.mov,.mkv,.webm" : "image/*"}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          void handleFiles(files);
        }}
      />
      {srcOpen && (
        <div
          className="sheet"
          id="srcSheet"
          onClick={(e) => {
            if ((e.target as HTMLElement).id === "srcSheet") setSrcOpen(false);
          }}
        >
          <div className="sbox">
            <div className="row">
              <b className="grow">{title}</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setSrcOpen(false)}>
                <Icon name="x" />
              </button>
            </div>
            <button
              type="button"
              className="src"
              onClick={() => {
                setSrcOpen(false);
                fileRef.current?.click();
              }}
            >
              <Icon name={kind === "video" ? "film" : "image"} />
              <div>
                <b>From this phone</b>
                <small>{kind === "video" ? "Videos or downloads" : "Photo library, camera or files"}</small>
              </div>
            </button>
            <button
              type="button"
              className="src"
              onClick={() => {
                setSrcOpen(false);
                setPcOpen(true);
              }}
            >
              <Icon name="folder" />
              <div>
                <b>From the PC</b>
                <small>Browse Studio or Google Drive</small>
              </div>
            </button>
          </div>
        </div>
      )}
      <PcBrowser
        open={pcOpen}
        kind={kind === "video" ? "video" : "images"}
        onClose={() => setPcOpen(false)}
        onImage={handlePcPath}
      />
    </SourcePickerContext.Provider>
  );
}