import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getReportByShareToken, deleteReport } from "../db";
import { runReport } from "../services/reportRunner";
import { enqueueScrapeJob, getJob } from "../services/jobQueue";

/**
 * Server-side host validation (SSRF guard).
 *
 * The scraper drives a real headless Chrome from inside the container, so the
 * target URL must be restricted to the two ad libraries — otherwise a public
 * caller could point the browser at internal network addresses. Client-side
 * checks alone are not enough; tRPC can be called directly.
 */
function isAllowedHost(rawUrl: string, source: "meta" | "tiktok"): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (source === "tiktok") return host === "library.tiktok.com";
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
}

const brandInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    url: z.string().url(),
    color: z.string().regex(/^#[0-9A-F]{6}$/i),
    source: z.enum(["meta", "tiktok"]).default("meta"),
  })
  .refine((b) => isAllowedHost(b.url, b.source), {
    message:
      "URL yalnızca facebook.com/ads/library veya library.tiktok.com adreslerinden olabilir",
    path: ["url"],
  });

const scrapeInputSchema = z.object({
  brands: z.array(brandInputSchema).min(1).max(5),
  reportName: z.string().min(1).max(255).optional(),
  filters: z
    .object({
      maxAds: z.number().int().min(1).max(100).optional(),
      country: z
        .string()
        .regex(/^([A-Za-z]{2}|ALL)$/)
        .optional(),
      activeOnly: z.boolean().optional(),
      mediaType: z.enum(["all", "video", "image"]).optional(),
      sortByImpressions: z.boolean().optional(),
    })
    .optional(),
  creative: z
    .object({
      enabled: z.boolean(),
      maxPerBrand: z.number().int().min(1).max(40).optional(),
      gameContext: z.string().max(2000).optional(),
    })
    .optional(),
});

export const reportsRouter = router({
  // ── Job-based flow (preferred): enqueue, then poll jobStatus ──────────────
  startScrapeJob: publicProcedure
    .input(scrapeInputSchema)
    .mutation(async ({ input }) => {
      return enqueueScrapeJob(input);
    }),

  jobStatus: publicProcedure
    .input(z.object({ jobId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const job = getJob(input.jobId);
      if (!job) throw new Error("İş bulunamadı (süresi dolmuş olabilir)");
      return job;
    }),

  // ── Legacy synchronous flow (kept for compatibility) ──────────────────────
  scrapeAndCreateMulti: publicProcedure
    .input(scrapeInputSchema)
    .mutation(async ({ input }) => {
      try {
        const result = await runReport(input);
        return result;
      } catch (error) {
        console.error("[Reports] Scrape error:", error);
        throw new Error(
          `Failed to scrape ads library: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }),

  // Get reports by a list of shareTokens (stored in localStorage on client)
  listByTokens: publicProcedure
    .input(z.array(z.string()))
    .query(async ({ input }) => {
      if (input.length === 0) return [];
      const results = await Promise.all(
        input.map((token) => getReportByShareToken(token))
      );
      return results.filter(Boolean);
    }),

  // Get a report by share token (public)
  getByShareToken: publicProcedure
    .input(z.string())
    .query(async ({ input }) => {
      return await getReportByShareToken(input);
    }),

  // Delete a report by shareToken (token acts as ownership proof)
  delete: publicProcedure
    .input(z.object({ shareToken: z.string() }))
    .mutation(async ({ input }) => {
      const report = await getReportByShareToken(input.shareToken);
      if (!report) throw new Error("Report not found");
      await deleteReport(report.id);
      return { success: true };
    }),
});
