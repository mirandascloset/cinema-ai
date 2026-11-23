import { useSyncExternalStore } from "react";
import { storeGet, storeSet } from "./api";
import type { VideoLoraChoice } from "./types";

export type Settings = {
  videoSeconds: number;
  h3Loras: VideoLoraChoice[];
  useRefAudio: boolean;
  videoSound: boolean;
  h3Model: string;
  h3Steps: number;
  selectedSceneId: string;
};

const DEFAULTS: Settings = {
  videoSeconds: 10,
  h3Loras: [],
  useRefAudio: true,
  videoSound: true,
  h3Model: "",
  h3Steps: 8,
  selectedSceneId: "",
};

let bag: Settings = normalize(storeGet<Settings>("settings", DEFAULTS));
const listeners = new Set<() => void>();

function normalize(raw: Partial<Settings>): Settings {
  const merged = { ...DEFAULTS, ...raw };
  if (![3, 5, 8, 10].includes(merged.videoSeconds)) merged.videoSeconds = 10;
  if (!Array.isArray(merged.h3Loras)) merged.h3Loras = [];
  if (typeof merged.h3Model !== "string") merged.h3Model = "";
  if (typeof merged.h3Steps !== "number") merged.h3Steps = 8;
  merged.h3Steps = Math.max(4, Math.min(30, Math.round(merged.h3Steps)));
  if (typeof merged.videoSound !== "boolean") merged.videoSound = true;
  if (typeof merged.useRefAudio !== "boolean") merged.useRefAudio = true;
  if (typeof merged.selectedSceneId !== "string") merged.selectedSceneId = "";
  return merged;
}

function emit() {
  listeners.forEach((l) => l());
}

export function getSettings(): Settings {
  return bag;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  bag = normalize({ ...bag, ...patch });
  storeSet("settings", bag);
  emit();
  return bag;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}