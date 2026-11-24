import { useCallback, useEffect, useState } from "react";
import { api, storeGet, storeSet } from "./api";
import { CinemaView } from "./components/CinemaView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GalleryView } from "./components/GalleryView";
import { Header } from "./components/Header";
import { QueueSheet } from "./components/QueueSheet";
import { SceneView } from "./components/SceneView";
import { SourcePickerProvider } from "./components/SourcePicker";
import { StoryboardView } from "./components/StoryboardView";
import type { AppTab } from "./components/Tabs";
import { IconSprite } from "./icons";
import type { Job, Status } from "./types";

const TABS: AppTab[] = ["create", "storyboard", "scenes", "gallery"];

function readTab(): AppTab {
  const saved = storeGet<string>("tab", "create");
  if (TABS.includes(saved as AppTab)) return saved as AppTab;
  return "create";
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(readTab);
  const [status, setStatus] = useState<Status | null>(null);
  const [subtitle, setSubtitle] = useState("Runs on your PC");
  const [warn, setWarn] = useState(false);
  const [queueJobs, setQueueJobs] = useState<Job[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await api<Status>("/api/status");
      setStatus(data);
      const ready = data.video?.models?.h3?.ready ?? data.video?.ready;
      if (!ready) {
        setSubtitle("MiniMax H3 still downloading — open Image Studio");
        setWarn(true);
      } else if (!data.captioner) {
        setSubtitle("Prompt writer not installed");
        setWarn(true);
      } else if (!data.ffmpeg) {
        setSubtitle("ffmpeg not found on this PC");
        setWarn(true);
      } else {
        setSubtitle(`720p · ${data.video?.label || "MiniMax H3"}`);
        setWarn(false);
      }
    } catch {
      setSubtitle("Can't reach the PC");
      setWarn(true);
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const data = await api<{ jobs: Job[]; recent?: Job[] }>("/api/jobs");
      const seen = new Set<string>();
      const merged: Job[] = [];
      for (const j of [...(data.jobs || []), ...(data.recent || [])]) {
        if (seen.has(j.id)) continue;
        seen.add(j.id);
        merged.push(j);
      }
      setQueueJobs(merged);
    } catch {
      /* ignore */
    }
  }, []);

  const upsertJob = useCallback((j: Job) => {
    setQueueJobs((prev) => {
      const rest = prev.filter((x) => x.id !== j.id);
      if (j.status === "queued" || j.status === "running" || j.status === "error") {
        return [...rest, j];
      }
      return rest;
    });
  }, []);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  const goTab = useCallback((next: AppTab) => {
    window.dispatchEvent(new Event("ca:nav"));
    setTab(next);
    storeSet("tab", next);
    const main = document.getElementById("main");
    if (main) main.scrollTop = 0;
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshQueue();
    const t1 = window.setInterval(() => void refreshStatus(), 15000);
    const t2 = window.setInterval(() => void refreshQueue(), 3000);
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
    };
  }, [refreshStatus, refreshQueue]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <ErrorBoundary>
      <SourcePickerProvider>
        <IconSprite />
        <Header
          subtitle={subtitle}
          warn={warn}
          queueCount={queueJobs.length}
          queueOpen={queueOpen}
          tab={tab}
          onTab={goTab}
          onQueue={() => setQueueOpen((o) => !o)}
        />
        <main id="main">
          {tab === "create" ? (
            <CinemaView
              status={status}
              busy={busy}
              setBusy={setBusy}
              onJob={(j) => {
                upsertJob(j);
                void refreshQueue();
              }}
              onToast={showToast}
              onDone={() => goTab("gallery")}
            />
          ) : tab === "storyboard" ? (
            <StoryboardView
              status={status}
              busy={busy}
              setBusy={setBusy}
              onJob={(j) => {
                upsertJob(j);
                void refreshQueue();
              }}
              onToast={showToast}
              onSaved={() => goTab("scenes")}
            />
          ) : tab === "scenes" ? (
            <SceneView
              active={tab === "scenes"}
              status={status}
              busy={busy}
              setBusy={setBusy}
              onJob={(j) => {
                upsertJob(j);
                void refreshQueue();
              }}
              onToast={showToast}
              onDone={() => goTab("gallery")}
              onUseCreate={() => goTab("create")}
            />
          ) : (
            <GalleryView onToast={showToast} active={tab === "gallery"} />
          )}
        </main>
        <QueueSheet
          open={queueOpen}
          jobs={queueJobs}
          status={status}
          onClose={() => setQueueOpen(false)}
          onRefresh={() => void refreshQueue()}
          onToast={showToast}
        />
        {toast && <div id="toast">{toast}</div>}
      </SourcePickerProvider>
    </ErrorBoundary>
  );
}
