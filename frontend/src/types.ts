export const BATCH_MAX = 400;

export type FolderSel = { dir: string; count: number; name?: string; recursive?: boolean };

export type UploadMeta = { id: string; width?: number; height?: number };
export type VideoMeta = { id: string; name?: string; duration?: number };

export type VideoModelId = "h3";
export type VideoLoraChoice = { id: string; strength: number };
export type VideoLoraInfo = { id: string; label: string; high?: string | null; low?: string | null };
export type H3ModelInfo = { id: string; label: string };

export type JobResult = {
  id: string;
  video?: boolean;
  duration?: number;
  prompt?: string;
};

export type Job = {
  id: string;
  kind?: string;
  mode?: string;
  status: string;
  stage?: string;
  error?: string;
  audio_note?: string;
  estimate?: number;
  elapsed?: number;
  position?: number;
  result?: JobResult;
  results?: JobResult[];
  segment_prompts?: string[];
  segments_total?: number;
  video_id?: string;
};

export type SceneItem = {
  id: string;
  name: string;
  created?: number;
  video?: string;
  duration?: number;
  segments_total?: number;
  has_audio?: boolean;
  loras?: VideoLoraChoice[];
  h3_model?: string;
  h3_steps?: number;
  sound?: boolean;
  use_ref_audio?: boolean;
  preview_prompt?: string;
};

export type GalleryItem = {
  id: string;
  mode?: string;
  created?: number;
  video?: boolean;
  favorite?: boolean;
  engine?: string;
  duration?: number;
  quality?: string;
  loras?: { id?: string; file?: string; strength?: number }[];
  h3Model?: string;
  steps?: number;
  segments?: number;
  prompt?: string;
  segment_prompts?: string[];
};

export type Status = {
  captioner?: boolean;
  ffmpeg?: boolean;
  video?: {
    ready?: boolean;
    label?: string;
    maxLoras?: number;
    h3?: {
      loras?: VideoLoraInfo[];
      models?: H3ModelInfo[];
      steps?: number[];
    };
    models?: Record<string, { label: string; ready: boolean; audio?: boolean; estimates?: Record<string, number> }>;
  };
  engine?: { installed?: boolean; healthy?: boolean };
};