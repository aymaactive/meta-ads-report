import { nanoid } from "nanoid";
import { runReport, TARGET_ADS, type RunReportInput } from "./reportRunner";

/**
 * Minimal in-memory job queue for scrape jobs.
 *
 * - Concurrency 1: only one report is processed at a time (each report itself
 *   scrapes brands sequentially), bounding Chrome memory usage on Railway and
 *   acting as a natural rate limit for this public endpoint.
 * - Clients poll `getJob(jobId)` for per-brand progress.
 * - Jobs are evicted 1 hour after completion.
 *
 * NOTE: state is per-process. Fine for a single Railway instance; if the app
 * ever scales horizontally, move this to Redis/DB.
 */

export type JobStatus = "queued" | "running" | "done" | "error";

export interface BrandJobState {
  name: string;
  status: JobStatus;
  scraped: number;
  target: number;
  adsCount?: number;
  error?: string;
}

export interface ScrapeJob {
  id: string;
  status: JobStatus;
  phase?: "scrape" | "creative" | "insights" | "save";
  creative?: { done: number; total: number };
  brands: BrandJobState[];
  queuePosition?: number;
  shareToken?: string;
  reportName?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, ScrapeJob>();
const queue: { id: string; input: RunReportInput }[] = [];
let processing = false;

const MAX_QUEUE = 5;
const JOB_TTL_MS = 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function enqueueScrapeJob(input: RunReportInput): { jobId: string } {
  gc();
  if (queue.length >= MAX_QUEUE) {
    throw new Error("Sunucu şu an yoğun — lütfen birkaç dakika sonra tekrar deneyin.");
  }

  const id = nanoid(16);
  jobs.set(id, {
    id,
    status: "queued",
    brands: input.brands.map((b) => ({
      name: b.name,
      status: "queued",
      scraped: 0,
      target: input.filters?.maxAds ?? TARGET_ADS,
    })),
    createdAt: Date.now(),
  });
  queue.push({ id, input });
  void processNext();
  return { jobId: id };
}

export function getJob(jobId: string): ScrapeJob | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === "queued") {
    job.queuePosition = queue.findIndex((q) => q.id === jobId) + 1;
  } else {
    job.queuePosition = undefined;
  }
  return job;
}

async function processNext(): Promise<void> {
  if (processing) return;
  const next = queue.shift();
  if (!next) return;

  const job = jobs.get(next.id);
  if (!job) {
    void processNext();
    return;
  }

  processing = true;
  job.status = "running";

  try {
    const result = await runReport(next.input, {
      onPhase: (phase) => {
        job.phase = phase;
      },
      onCreativeProgress: (done, total) => {
        job.creative = { done, total };
      },
      onBrandStart: (i) => {
        job.brands[i].status = "running";
      },
      onBrandProgress: (i, scraped, target) => {
        job.brands[i].scraped = scraped;
        job.brands[i].target = target;
      },
      onBrandDone: (i, adsCount) => {
        job.brands[i].status = "done";
        job.brands[i].adsCount = adsCount;
        job.brands[i].scraped = adsCount;
      },
      onBrandError: (i, error) => {
        job.brands[i].status = "error";
        job.brands[i].error = error;
      },
    });

    job.status = "done";
    job.shareToken = result.shareToken;
    job.reportName = result.reportName;
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : "Unknown error";
  } finally {
    job.finishedAt = Date.now();
    processing = false;
    void processNext();
  }
}
