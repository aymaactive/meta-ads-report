import { execFile } from "child_process";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/**
 * Video → frames pipeline for creative analysis.
 *
 * Ad-library video URLs (fbcdn / TikTok CDN) are signed and short-lived, so
 * this runs right after scraping. We download the progressive mp4, probe it,
 * detect hard cuts (pacing) and pull a small set of JPEG frames split into the
 * three segments that matter for mobile-game ads:
 *
 *   hook    0–3s      → what stops the scroll
 *   body    3s–end-2s → the gameplay / scenario that sells the game
 *   endcard last ~1s  → CTA / store card / mascot
 *
 * Requires ffmpeg + ffprobe on PATH (or FFMPEG_PATH / FFPROBE_PATH).
 */

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const FRAME_WIDTH = 360;

export type Segment = "hook" | "body" | "endcard";

export interface FramePlanItem {
  t: number;
  segment: Segment;
}

export interface ExtractedFrame extends FramePlanItem {
  /** base64 JPEG (no data: prefix) */
  jpegBase64: string;
}

export interface VideoFrames {
  duration: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  /** Hard-cut timestamps (seconds) — pacing signal */
  cuts: number[];
  frames: ExtractedFrame[];
}

function run(bin: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Pick frame timestamps for a video of the given duration.
 * Dense in the hook (where game ads win or lose), sparse in the body,
 * one frame for the end card. Short videos degrade gracefully.
 */
export function planFrameTimes(duration: number, bodyFrames = 4): FramePlanItem[] {
  if (!isFinite(duration) || duration <= 0) return [{ t: 0, segment: "hook" }];
  const d = duration;
  const last = Math.max(0, d - 0.15);
  const plan: FramePlanItem[] = [];

  // Hook: 0.2s (first real frame), 1s, 2s, 3s
  for (const t of [0.2, 1, 2, 3]) {
    if (t < last) plan.push({ t, segment: "hook" });
  }

  // Body: evenly spaced between 3.5s and end-2s
  const bStart = 3.5;
  const bEnd = d - 2;
  if (bEnd - bStart >= 1) {
    for (let i = 0; i < bodyFrames; i++) {
      const t = bStart + ((bEnd - bStart) * (i + 0.5)) / bodyFrames;
      plan.push({ t: round1(t), segment: "body" });
    }
  }

  // End card: ~0.7s before the end
  if (d > 4) plan.push({ t: round1(Math.max(0, d - 0.7)), segment: "endcard" });

  if (plan.length === 0) plan.push({ t: 0, segment: "hook" });
  return plan;
}

/** Parse ffmpeg showinfo output for pts_time values of scene-change frames. */
export function parseSceneCuts(stderr: string): number[] {
  const out: number[] = [];
  const re = /pts_time:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) {
    const t = Number(m[1]);
    if (isFinite(t) && t > 0.15) out.push(round1(t));
  }
  return Array.from(new Set(out));
}

async function download(url: string, dest: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.facebook.com/",
      },
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_VIDEO_BYTES) throw new Error(`video too large (${len} bytes)`);

    let seen = 0;
    const body = Readable.fromWeb(res.body as any);
    body.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > MAX_VIDEO_BYTES) body.destroy(new Error("video too large"));
    });
    await pipeline(body, createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }
}

async function probe(file: string) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout);
  const streams: any[] = j.streams || [];
  const v = streams.find((s) => s.codec_type === "video");
  return {
    duration: Number(j.format?.duration) || 0,
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

async function detectCuts(file: string, threshold = 0.3): Promise<number[]> {
  try {
    const { stderr } = await run(
      FFMPEG,
      ["-hide_banner", "-i", file, "-an", "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
      60_000
    );
    return parseSceneCuts(stderr);
  } catch (e: any) {
    // showinfo writes to stderr even on success; on failure just skip pacing
    return e?.stderr ? parseSceneCuts(e.stderr) : [];
  }
}

async function grabFrame(file: string, t: number, out: string): Promise<string | null> {
  try {
    await run(FFMPEG, [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(t),
      "-i", file,
      "-frames:v", "1",
      "-vf", `scale=${FRAME_WIDTH}:-2`,
      "-q:v", "6",
      "-y", out,
    ]);
    return (await readFile(out)).toString("base64");
  } catch {
    return null;
  }
}

/** Analyze a local video file (exported separately for tests). */
export async function extractFramesFromFile(file: string, workDir: string): Promise<VideoFrames> {
  const meta = await probe(file);
  const plan = planFrameTimes(meta.duration);
  const cuts = await detectCuts(file);

  const frames: ExtractedFrame[] = [];
  for (let i = 0; i < plan.length; i++) {
    const b64 = await grabFrame(file, plan[i].t, path.join(workDir, `f${i}.jpg`));
    if (b64) frames.push({ ...plan[i], jpegBase64: b64 });
  }
  return { ...meta, cuts, frames };
}

/** Download a remote video and extract frames. Temp files are always removed. */
export async function extractVideoFrames(videoUrl: string): Promise<VideoFrames> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mar-vid-"));
  try {
    const file = path.join(dir, "video.mp4");
    await download(videoUrl, file);
    return await extractFramesFromFile(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Is ffmpeg available? Used to skip the creative layer gracefully. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run(FFMPEG, ["-version"], 10_000);
    await run(FFPROBE, ["-version"], 10_000);
    return true;
  } catch {
    return false;
  }
}
