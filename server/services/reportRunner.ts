import { nanoid } from "nanoid";
import { createReport } from "../db";
import {
  scrapeMetaAdsLibrary,
  TARGET_ADS,
  type BrandAdsData,
  type ProgressFn,
  type ScrapeOptions,
} from "./metaAdsScraper";
import { runCreativeAnalysis } from "./creative/creativePipeline";
import { scrapeTikTokAdsLibrary } from "./tiktokAdsScraper";
import { generateInsights } from "./adInsights";

export interface BrandInput {
  name: string;
  url: string;
  color: string;
  source: "meta" | "tiktok";
}

export interface RunReportInput {
  brands: BrandInput[];
  reportName?: string;
  filters?: ScrapeOptions;
  creative?: {
    enabled: boolean;
    maxPerBrand?: number;
    gameContext?: string;
  };
}

export interface RunReportHooks {
  onBrandStart?: (index: number) => void;
  onBrandProgress?: (index: number, scraped: number, target: number) => void;
  onBrandDone?: (index: number, adsCount: number) => void;
  onBrandError?: (index: number, error: string) => void;
  onPhase?: (phase: "scrape" | "creative" | "insights" | "save") => void;
  onCreativeProgress?: (done: number, total: number) => void;
}

export interface RunReportResult {
  success: true;
  shareToken: string;
  reportName: string;
  brands: {
    name: string;
    adsCount: number;
    reportedTotal: number | null;
    source: "meta" | "tiktok" | undefined;
  }[];
  failed: { name: string; error: string }[];
}

/**
 * Shared report pipeline used by both the synchronous tRPC mutation (legacy)
 * and the job queue. Brands are scraped SEQUENTIALLY — one Chrome instance at
 * a time — to keep memory bounded on small Railway instances. A single brand
 * failure no longer kills the whole report: partial reports are created as
 * long as at least one brand succeeds.
 */
export async function runReport(
  input: RunReportInput,
  hooks: RunReportHooks = {}
): Promise<RunReportResult> {
  hooks.onPhase?.("scrape");

  const results: (BrandAdsData | null)[] = [];
  const failed: { name: string; error: string }[] = [];

  for (let i = 0; i < input.brands.length; i++) {
    const brand = input.brands[i];
    hooks.onBrandStart?.(i);
    const onProgress: ProgressFn = (scraped, target) =>
      hooks.onBrandProgress?.(i, scraped, target);
    try {
      const data =
        brand.source === "tiktok"
          ? await scrapeTikTokAdsLibrary(brand.url, brand.name, onProgress, input.filters)
          : await scrapeMetaAdsLibrary(brand.url, brand.name, onProgress, input.filters);
      results.push(data);
      hooks.onBrandDone?.(i, data.totalAds);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ReportRunner] Brand "${brand.name}" failed:`, msg);
      results.push(null);
      failed.push({ name: brand.name, error: msg });
      hooks.onBrandError?.(i, msg);
    }
  }

  const succeeded = results
    .map((r, i) => ({ r, brand: input.brands[i] }))
    .filter((x): x is { r: BrandAdsData; brand: BrandInput } => x.r !== null);

  if (succeeded.length === 0) {
    throw new Error(
      `Hiçbir marka analiz edilemedi. ${failed.map((f) => `${f.name}: ${f.error}`).join(" | ")}`
    );
  }

  // ── Creative (video) analysis layer — must run right after scraping,
  //    while the signed CDN video URLs are still valid ──
  let creative = null;
  if (input.creative?.enabled) {
    hooks.onPhase?.("creative");
    creative = await runCreativeAnalysis(
      succeeded.map((s) => s.r),
      {
        maxPerBrand: input.creative.maxPerBrand,
        gameContext: input.creative.gameContext,
        sortedByImpressions: Boolean(input.filters?.sortByImpressions),
        onProgress: hooks.onCreativeProgress,
      }
    ).catch((e) => {
      console.error("[ReportRunner] creative analysis failed:", (e as Error).message);
      return null;
    });
  }

  // ── AI insight layer (optional, never blocks report creation) ──
  hooks.onPhase?.("insights");
  const insights = await generateInsights(succeeded.map((s) => s.r)).catch(() => null);

  // ── Persist ──
  hooks.onPhase?.("save");
  const shareToken = nanoid(32);
  const brandNames = input.brands.map((b) => b.name).join(", ");
  const reportName = input.reportName || `${brandNames} Raporu`;

  const reportData: Record<string, any> = {};
  succeeded.forEach(({ r, brand }) => {
    reportData[brand.name] = {
      name: brand.name,
      color: brand.color,
      url: brand.url,
      ...r,
    };
  });
  if (insights) reportData.__insights = insights;
  if (creative) reportData.__creative = creative;
  // Signed CDN URLs expire within hours — don't persist dead links
  for (const key of Object.keys(reportData)) {
    const b = reportData[key];
    if (b && Array.isArray(b.ads)) {
      b.ads = b.ads.map(({ videoUrl, posterUrl, ...rest }: any) => ({ ...rest, hasVideo: Boolean(videoUrl) }));
    }
  }

  await createReport({
    userId: 0,
    shareToken,
    reportName,
    brandCount: succeeded.length,
    reportData: reportData as any,
  });

  return {
    success: true,
    shareToken,
    reportName,
    brands: succeeded.map(({ r }) => ({
      name: r.brandName,
      adsCount: r.totalAds,
      reportedTotal: r.reportedTotal ?? null,
      source: r.source,
    })),
    failed,
  };
}

export { TARGET_ADS };
