import type { Job, UploadMeta, VideoMeta } from "./types";

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit =
    body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
  const res = await fetch(path, opts);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/** Scene pack ids may include spaces and `family~version` — always encode the id segment. */
export function sceneApi(id: string, query = ""): string {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `/api/scenes/${encodeURIComponent(id)}${q}`;
}

export async function pcImport(path: string): Promise<UploadMeta> {
  return api<UploadMeta>("/api/pc/import", { path });
}

export async function pcImportVideo(path: string): Promise<VideoMeta> {
  return api<VideoMeta>("/api/pc/import-video", { path });
}

export async function uploadImage(file: File): Promise<UploadMeta> {
  const res = await fetch("/api/upload", {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  const data = (await res.json().catch(() => ({}))) as UploadMeta & { error?: string };
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

export async function uploadVideo(file: File): Promise<VideoMeta> {
  const res = await fetch(`/api/upload-video?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  const data = (await res.json().catch(() => ({}))) as VideoMeta & { error?: string };
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

export function storeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("ca." + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function storeSet(key: string, value: unknown): void {
  localStorage.setItem("ca." + key, JSON.stringify(value));
}

/** Save gallery results via Web Share or download. */
export async function saveResults(items: Array<{ id: string; video?: boolean }>): Promise<void> {
  const files = await Promise.all(
    items.map(async (it) => {
      const video = !!it.video;
      const blob = await (await fetch(`/api/output/${it.id}${video ? ".mp4" : ""}`)).blob();
      return new File([blob], `cinema-ai-${it.id}.${video ? "mp4" : "png"}`, {
        type: video ? "video/mp4" : "image/png",
      });
    }),
  );
  if (navigator.canShare && navigator.canShare({ files })) {
    await navigator.share({ files });
    return;
  }
  for (const file of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}

export function fmtTime(s: number): string {
  return s < 90 ? `${Math.max(1, Math.round(s))}s` : `${Math.round(s / 60)} min`;
}

/** Poll /api/jobs/:id until done, error, or cancelled. */
export async function pollJob(id: string, onTick?: (job: Job) => void): Promise<Job> {
  for (let fails = 0; ; ) {
    let job: Job;
    try {
      job = await api<Job>(`/api/jobs/${id}`);
      fails = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(msg)) throw err;
      fails++;
      await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * fails)));
      continue;
    }
    onTick?.(job);
    if (["done", "error", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
}