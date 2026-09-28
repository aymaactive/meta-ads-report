import puppeteer from "puppeteer";
import { execSync } from "child_process";
import fs from "fs";
import type { AdData, BrandAdsData } from "./metaAdsScraper";
import { resolveMaxAds, type ProgressFn, type ScrapeOptions } from "./metaAdsScraper";

/**
 * TikTok Commercial Content Library scraper.
 *
 * Targets https://library.tiktok.com/ads — TikTok's ad transparency archive
 * (the closest analogue to Meta Ads Library). NOTE: this archive only covers
 * ads SHOWN IN THE EU, so a brand's non-EU campaigns may not appear. That
 * caveat is surfaced to the user in the report UI.
 *
 * ── How it works (verified against the live site) ──
 * The page is a client-side React app. Ad data is loaded via an authenticated
 * POST to `/api/v1/search` whose request carries a generated `X-CCL-STR`
 * anti-bot/signature header. That header is produced by the page's own JS, so
 * the API cannot be called directly from a plain server-side request (it
 * returns 421). Instead we drive the real page in a headless browser and let
 * IT make the signed calls: we install a lightweight XHR interceptor, click the
 * "View more" button to trigger the page's own paginated API calls, and read
 * the JSON responses the page receives.
 *
 * The search API response items contain everything we need:
 *   - id                → ad id
 *   - title             → AD CAPTION (this is the caption text)
 *   - name              → advertiser name
 *   - first_shown_date  → epoch ms
 *   - last_shown_date   → epoch ms
 *   - videos[]          → non-empty ⇒ video ad, empty ⇒ image ad
 *   - image_urls[]      → thumbnail(s)
 * and the envelope carries `total` (the library's reported total) and
 * `has_more`. No per-ad detail page visit is needed.
 *
 * Returns the same BrandAdsData shape as the Meta scraper so the report UI can
 * render both sources uniformly. Meta-only platform buckets (Messenger /
 * Audience Network) are left at zero for TikTok.
 */

function findChrome(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "/usr/lib/chromium/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const result = execSync("which chromium || which chromium-browser || which google-chrome", { encoding: "utf8" }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}
  throw new Error("Chrome/Chromium not found. Set PUPPETEER_EXECUTABLE_PATH or install chromium.");
}

/** Pull the advertiser business id out of a TikTok library URL (for pageId). */
function extractTikTokId(url: string): string {
  const patterns = [
    /adv_biz_ids=([^&]+)/i,
    /advertiser_business_ids=([^&]+)/i,
    /advertiser_id=([^&]+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return decodeURIComponent(m[1]);
  }
  return "";
}

/** Shape of an ad item as captured from the page's /api/v1/search responses. */
interface RawTikTokAd {
  id: string;
  caption: string;
  advertiser: string;
  isVideo: boolean;
  first: number | null; // epoch ms
  last: number | null; // epoch ms
  image: string | null; // first thumbnail URL from the library API
  video: string | null; // direct video URL, when the API exposes one
  cover: string | null;
}

function daysSinceMs(ms: number | null): number {
  if (!ms) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

function msToDateString(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  // Match the human format used elsewhere, e.g. "20 Apr 2026"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export async function scrapeTikTokAdsLibrary(
  url: string,
  brandName: string,
  onProgress?: ProgressFn,
  opts?: ScrapeOptions
): Promise<BrandAdsData> {
  const TARGET_ADS = resolveMaxAds(opts);
  const pageId = extractTikTokId(url);
  let browser;

  try {
    const chromePath = findChrome();
    console.log(`[TikTok Scraper] Using Chrome: ${chromePath}`);
    browser = await puppeteer.launch({
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Install the XHR interceptor BEFORE any navigation so we capture the very
    // first /api/v1/search response too. We accumulate ad items keyed by id and
    // remember the reported total from the response envelope.
    await page.evaluateOnNewDocument(() => {
      (window as any).__ttAds = {};
      (window as any).__ttTotal = null;
      const OrigOpen = XMLHttpRequest.prototype.open;
      const OrigSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (this: any, method: string, u: string, ...rest: any[]) {
        this.__ttUrl = u;
        // @ts-ignore
        return OrigOpen.call(this, method, u, ...rest);
      };
      XMLHttpRequest.prototype.send = function (this: any, body?: any) {
        if (/\/api\/v1\/search/.test(this.__ttUrl || "")) {
          this.addEventListener("load", () => {
            try {
              const j = JSON.parse(this.responseText);
              if (j && Array.isArray(j.data)) {
                j.data.forEach((d: any) => {
                  (window as any).__ttAds[d.id] = {
                    id: d.id,
                    caption: d.title || "",
                    advertiser: d.name || "",
                    isVideo: Array.isArray(d.videos) && d.videos.length > 0,
                    first: d.first_shown_date || null,
                    last: d.last_shown_date || null,
                    image: Array.isArray(d.image_urls) && d.image_urls.length > 0 ? d.image_urls[0] : null,
                    // Field names vary between API versions — probe defensively
                    video: (() => {
                      const v = Array.isArray(d.videos) ? d.videos[0] : null;
                      if (!v) return null;
                      if (typeof v === "string") return v;
                      return v.video_url || v.play_url || v.url || v.download_url || null;
                    })(),
                    cover: (() => {
                      const v = Array.isArray(d.videos) ? d.videos[0] : null;
                      return (v && typeof v === "object" && (v.cover_img || v.cover || v.poster)) || null;
                    })(),
                  };
                });
                if (typeof j.total === "number") (window as any).__ttTotal = j.total;
              }
            } catch (e) {
              /* ignore non-JSON */
            }
          });
        }
        return OrigSend.call(this, body);
      };
    });

    console.log(`[TikTok Scraper] Loading: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    // Let the initial search call resolve.
    await new Promise((r) => setTimeout(r, 4000));

    // Click "View more" until we have at least TARGET_ADS ads captured, or the
    // button disappears / stops yielding new ads.
    let stagnant = 0;
    for (let i = 0; i < Math.ceil(TARGET_ADS / 10) + 4; i++) {
      const count = await page.evaluate(() => Object.keys((window as any).__ttAds || {}).length);
      onProgress?.(Math.min(count, TARGET_ADS), TARGET_ADS);
      if (count >= TARGET_ADS) break;

      const clicked = await page.evaluate(() => {
        const btn = document.querySelector("div.loading_more") as HTMLElement | null;
        if (!btn) return false;
        btn.scrollIntoView();
        btn.click();
        return true;
      });
      if (!clicked) break;

      await new Promise((r) => setTimeout(r, 2800));

      const after = await page.evaluate(() => Object.keys((window as any).__ttAds || {}).length);
      if (after === count) {
        stagnant++;
        if (stagnant >= 2) break;
      } else {
        stagnant = 0;
      }
    }

    // Pull captured ads + reported total out of the page.
    const { rawAds, reportedTotal } = await page.evaluate(() => {
      return {
        rawAds: Object.values((window as any).__ttAds || {}),
        reportedTotal: (window as any).__ttTotal,
      };
    });

    await browser.close();

    const limited = (rawAds as RawTikTokAd[]).slice(0, TARGET_ADS);

    const ads: AdData[] = limited.map((ad, idx) => ({
      id: `ad_${idx}`,
      libraryId: ad.id,
      body: ad.caption || `Ad ${idx + 1}`,
      startDate: msToDateString(ad.first),
      daysRunning: daysSinceMs(ad.first),
      cta: "Belirsiz", // TikTok library doesn't expose a discrete CTA label
      platforms: ["TikTok"],
      format: ad.isVideo ? "Video" : "Image/Carousel",
      libraryUrl: `https://library.tiktok.com/ads/detail/?ad_id=${ad.id}`,
      ...(ad.image ? { thumbnail: ad.image } : {}),
      ...(ad.video ? { videoUrl: ad.video } : {}),
      ...(ad.cover ? { posterUrl: ad.cover } : {}),
    }));

    onProgress?.(ads.length, TARGET_ADS);

    const platformCounts: Record<string, number> = {
      TikTok: ads.length,
      Facebook: 0,
      Instagram: 0,
      Messenger: 0,
      "Audience Network": 0,
    };

    const ctaCounts: Record<string, number> = {};
    ads.forEach((ad) => {
      ctaCounts[ad.cta] = (ctaCounts[ad.cta] || 0) + 1;
    });

    const videoCount = ads.filter((a) => a.format === "Video").length;
    const staticCount = ads.length - videoCount;

    const monthlyTrend: Record<string, number> = {};
    limited.forEach((ad) => {
      if (!ad.first) return;
      const d = new Date(ad.first);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyTrend[key] = (monthlyTrend[key] || 0) + 1;
    });

    return {
      brandName,
      pageId,
      source: "tiktok",
      totalAds: ads.length,
      reportedTotal: typeof reportedTotal === "number" ? reportedTotal : null,
      ads,
      platformCounts,
      videoCount,
      staticCount,
      ctaCounts,
      monthlyTrend,
    };
  } catch (error) {
    console.error("[TikTok Scraper] Error:", error);
    if (browser) await browser.close();
    throw error;
  }
}
