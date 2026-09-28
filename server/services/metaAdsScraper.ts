import puppeteer from "puppeteer";
import { execSync } from "child_process";
import fs from "fs";

// ─── How many ads to collect ──────────────────────────────────────────────────
export const TARGET_ADS = 20;
/** Hard ceiling for a single brand (scroll time + thumbnail payload). */
export const MAX_ADS_LIMIT = 100;

/**
 * Library-level filters. Applied to the Ads Library URL server-side so the
 * user can paste any page/keyword URL and still get e.g. "active video ads in
 * the US, sorted by impressions".
 */
export interface ScrapeOptions {
  maxAds?: number;
  /** ISO-2 country code ("US", "PH", "TR") or "ALL". */
  country?: string;
  activeOnly?: boolean;
  mediaType?: "all" | "video" | "image";
  /** Meta can sort by total impressions — the best public "winner" proxy. */
  sortByImpressions?: boolean;
}

export function resolveMaxAds(opts?: ScrapeOptions): number {
  const n = Math.floor(opts?.maxAds ?? TARGET_ADS);
  return Math.max(1, Math.min(MAX_ADS_LIMIT, isNaN(n) ? TARGET_ADS : n));
}

/** Rewrite the Ads Library URL's query params according to the filters. */
export function applyMetaFilters(rawUrl: string, opts?: ScrapeOptions): string {
  if (!opts) return rawUrl;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const p = u.searchParams;
  if (opts.country) p.set("country", opts.country.toUpperCase());
  if (opts.activeOnly !== undefined) p.set("active_status", opts.activeOnly ? "active" : "all");
  if (opts.mediaType) p.set("media_type", opts.mediaType);
  if (opts.sortByImpressions) {
    p.set("sort_data[mode]", "total_impressions");
    p.set("sort_data[direction]", "desc");
  }
  if (!p.get("ad_type")) p.set("ad_type", "all");
  return u.toString();
}

// Max size guards for embedded thumbnails (base64 chars)
const MAX_THUMB_CHARS = 180_000; // ~135KB binary per thumbnail
const MAX_TOTAL_THUMB_CHARS = 4_500_000; // ~3.4MB binary per brand

export type ProgressFn = (scraped: number, target: number) => void;

// Resolve Chrome executable (shared with the PDF route)
export function findChrome(): string {
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
    const result = execSync("which chromium || which chromium-browser || which google-chrome", {
      encoding: "utf8",
    }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}
  throw new Error("Chrome/Chromium not found. Set PUPPETEER_EXECUTABLE_PATH or install chromium.");
}

export interface AdData {
  id: string;
  libraryId: string;
  body: string; // full caption text
  startDate: string;
  daysRunning: number;
  cta: string;
  platforms: string[];
  format: string;
  libraryUrl: string;
  /** Either a data-URI (Meta: embedded screenshot) or a remote URL (TikTok). */
  thumbnail?: string;
  /** Direct (short-lived, signed) CDN URL of the video creative, if any. */
  videoUrl?: string;
  /** Poster / first-frame image URL of the video (short-lived). */
  posterUrl?: string;
  /**
   * How many ads share this exact creative + text ("N ads use this creative
   * and text"). A strong scaling signal: advertisers duplicate winners.
   */
  variantCount?: number;
  isActive?: boolean;
  /** 0–1 heuristic "winner" score (longevity, variants, impression rank) */
  winnerScore?: number;
}

export interface BrandAdsData {
  brandName: string;
  pageId: string;
  source: "meta" | "tiktok";
  totalAds: number;
  reportedTotal: number | null;
  ads: AdData[];
  platformCounts: Record<string, number>;
  videoCount: number;
  staticCount: number;
  ctaCounts: Record<string, number>;
  monthlyTrend: Record<string, number>;
}

// ─── Locale-tolerant date parsing (EN + TR) ───────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  // Turkish 3-letter (lowercased, Turkish chars preserved)
  oca: 0, "şub": 1, sub: 1, nis: 3, haz: 5, tem: 6,
  "ağu": 7, agu: 7, eyl: 8, eki: 9, kas: 10, ara: 11,
  // "mar" and "may" overlap EN — already covered above
};

/**
 * Parse Meta's start-date strings in both EN ("20 Apr 2026", "Apr 20, 2026")
 * and TR ("20 Nis 2026") layouts. Returns null when unparseable instead of
 * silently falling back to "now" (which used to corrupt trend stats).
 */
export function parseDateToMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/·.*$/, "").replace(/,/g, " ").trim();

  // "20 Apr 2026" / "20 Nis 2026"
  let m = cleaned.match(/^(\d{1,2})\s+(\p{L}{3,})\s+(\d{4})$/u);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLocaleLowerCase("tr-TR")] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return Date.UTC(Number(m[3]), mon, Number(m[1]));
  }
  // "Apr 20 2026"
  m = cleaned.match(/^(\p{L}{3,})\s+(\d{1,2})\s+(\d{4})$/u);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLocaleLowerCase("tr-TR")] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return Date.UTC(Number(m[3]), mon, Number(m[2]));
  }
  // Last resort: native parser (handles ISO etc.)
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function daysSince(dateStr: string): number {
  const ms = parseDateToMs(dateStr);
  if (ms === null) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24)));
}

function extractPageId(url: string): string {
  const match = url.match(/view_all_page_id=(\d+)/);
  return match ? match[1] : "";
}

// ─── CTA catalogue (EN + TR, canonical labels) ────────────────────────────────
const CTA_LABELS = [
  "Shop Now", "Install Now", "Learn More", "Watch More", "Watch Now", "Sign Up",
  "Book Now", "Download", "Get Offer", "Contact Us", "Apply Now", "Subscribe",
  "Get Quote", "Request Time", "See Menu", "Send Message", "Call Now",
  "Order Now", "Get Directions", "Play Game", "Listen Now", "Read More",
  "Use App", "Get App", "Donate Now", "Get Tickets", "Open Link",
  // Turkish UI labels
  "Şimdi satın al", "Şimdi yükle", "Alışveriş yap", "Daha fazla bilgi al",
  "Daha fazlasını izle", "Kaydol", "Rezervasyon yap", "İndir", "Teklif al",
  "Bize ulaşın", "Başvur", "Abone ol", "Fiyat teklifi al", "Menüye bak",
  "Mesaj gönder", "Şimdi ara", "Sipariş ver", "Yol tarifi al", "Uygulamayı kullan",
  "Oyna", "Oyunu oyna", "Uygulamayı yükle", "Yükle", "Daha fazla bilgi",
];

// Case-insensitive lookup (both EN and TR lowercasing to handle İ/i correctly)
const CTA_LOOKUP = new Map<string, string>();
for (const label of CTA_LABELS) {
  CTA_LOOKUP.set(label.toLowerCase(), label);
  CTA_LOOKUP.set(label.toLocaleLowerCase("tr-TR"), label);
}

/** Match a single line against the CTA catalogue, case-insensitively. */
export function matchCtaLine(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 40) return null;
  return CTA_LOOKUP.get(t.toLowerCase()) ?? CTA_LOOKUP.get(t.toLocaleLowerCase("tr-TR")) ?? null;
}

// A line that is just a link-card domain (US.PUMA.COM, PLAY.GOOGLE.COM ...)
const DOMAIN_LINE_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i;
// A video scrubber line (0:00 / 0:06)
const TIMESTAMP_LINE_RE = /^\d+:\d{2}\s*\/\s*\d+:\d{2}$/;
// Card metadata lines that always end the caption
const META_LINE_RES = [
  /^library id\b/i,
  /^kitaplık kimliği/i,
  /^kimlik\s*:/i,
  /^kütüphane kodu/i,
  /^reklam detaylarını gör$/i,
  /\d+\s+(ads use this creative|reklam bu kreatifi)/i,
  /^see ad details$/i,
  /^see summary details$/i,
  /^reklam ayrıntılarını gör$/i,
  /^özet ayrıntılarını gör$/i,
  /^this ad has multiple versions/i,
  /^bu reklamın birden (çok|fazla) sürümü/i,
];

/** Does this line terminate the primary text (caption)? */
function isCaptionStopLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (matchCtaLine(t)) return true;
  if (DOMAIN_LINE_RE.test(t)) return true;
  if (TIMESTAMP_LINE_RE.test(t)) return true;
  return META_LINE_RES.some((re) => re.test(t));
}

const LIB_RE = /(?:Library ID|Kitaplık Kimliği|Kütüphane Kodu|Kimlik)\s*:?\s*(\d{6,})/;
const DATE_RE = /(?:Started running on|Yayınlanmaya başl[^\n:]*[:\s])\s*([^\n·]+)/i;
// Current TR layout puts the date first: "26 Ağu 2026 tarihinde yayınlanmaya başladı"
const DATE_TR_RE = /([^\n·]+?)\s+tarihinde yayınlanmaya başladı/i;
// "5 ads use this creative and text" / "5 reklam bu kreatifi ve metni kullanıyor"
const VARIANT_RE = /(\d+)\s+(?:ads use this creative|reklam bu kreatifi)/i;

/** Parse a single ad card's innerText into structured fields. */
export function parseAdCardText(
  block: string,
  idx: number
): Omit<AdData, "daysRunning" | "libraryUrl" | "thumbnail" | "videoUrl" | "posterUrl"> {
  const libMatch = block.match(LIB_RE);
  const dateMatch = block.match(DATE_TR_RE) ?? block.match(DATE_RE);
  const variantMatch = block.match(VARIANT_RE);
  const isActive = /^(Active|Aktif)$/m.test(block);
  const lines = block.split("\n");

  // ── Caption: lines after the standalone "Sponsored"/"Sponsorlu" line, up to
  //    the first stop line (CTA label, link-card domain, video scrubber,
  //    or card metadata). Line-based matching is locale/case tolerant. ──
  const sponsoredIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t === "Sponsored" || t === "Sponsorlu";
  });

  let captionLines: string[] = [];
  let afterCaption: string[] = [];
  if (sponsoredIdx >= 0) {
    let i = sponsoredIdx + 1;
    for (; i < lines.length; i++) {
      if (isCaptionStopLine(lines[i])) break;
      captionLines.push(lines[i]);
    }
    afterCaption = lines.slice(i);
  }
  const bodyText = captionLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Everything except the caption — for CTA & platform detection, so captions
  // containing phrases like "Learn More" or "Facebook" can't pollute stats.
  const beforeCaption = sponsoredIdx >= 0 ? lines.slice(0, sponsoredIdx + 1) : lines;
  const nonCaptionLines = sponsoredIdx >= 0 ? [...beforeCaption, ...afterCaption] : lines;

  // ── CTA: first catalogue match in the post-caption lines ──
  let cta: string | null = null;
  for (const line of afterCaption) {
    cta = matchCtaLine(line);
    if (cta) break;
  }
  if (!cta) {
    for (const line of nonCaptionLines) {
      cta = matchCtaLine(line);
      if (cta) break;
    }
  }
  if (!cta) cta = "Belirsiz";

  // ── Platforms: only what the text actually reveals. Meta renders platform
  //    icons without names, so most cards yield none — we report that honestly
  //    instead of fabricating a 50/50 Facebook/Instagram split. ──
  const nonCaption = nonCaptionLines.join("\n");
  const platforms: string[] = [];
  if (/\bFacebook\b/i.test(nonCaption)) platforms.push("Facebook");
  if (/\bInstagram\b/i.test(nonCaption)) platforms.push("Instagram");
  if (/\bMessenger\b/i.test(nonCaption)) platforms.push("Messenger");
  if (/\bAudience Network\b/i.test(nonCaption)) platforms.push("Audience Network");

  // ── Format ──
  const isVideo =
    /\d+:\d{2}\s*\/\s*\d+:\d{2}/.test(block) ||
    /Play Video/i.test(block) ||
    /Videoyu oynat/i.test(block);
  const format = isVideo ? "Video" : "Image/Carousel";

  const libraryId = libMatch ? libMatch[1] : `unknown_${idx}`;
  const startDate = dateMatch ? dateMatch[1].trim() : "";

  return {
    id: `ad_${idx}`,
    libraryId,
    body: bodyText || `Ad ${idx + 1}`,
    startDate,
    cta,
    platforms,
    format,
    ...(variantMatch ? { variantCount: Number(variantMatch[1]) } : {}),
    isActive,
  };
}

/** Aggregate per-ad data into brand-level stats. */
export function aggregateBrandStats(ads: AdData[]) {
  const platformCounts: Record<string, number> = {
    Facebook: 0,
    Instagram: 0,
    Messenger: 0,
    "Audience Network": 0,
  };
  ads.forEach((ad) => {
    ad.platforms.forEach((p) => {
      if (platformCounts[p] !== undefined) platformCounts[p]++;
    });
  });

  const ctaCounts: Record<string, number> = {};
  ads.forEach((ad) => {
    ctaCounts[ad.cta] = (ctaCounts[ad.cta] || 0) + 1;
  });

  const videoCount = ads.filter((a) => a.format === "Video").length;
  const staticCount = ads.length - videoCount;

  const monthlyTrend: Record<string, number> = {};
  ads.forEach((ad) => {
    const ms = parseDateToMs(ad.startDate);
    if (ms === null) return;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthlyTrend[key] = (monthlyTrend[key] || 0) + 1;
  });

  return { platformCounts, ctaCounts, videoCount, staticCount, monthlyTrend };
}

export async function scrapeMetaAdsLibrary(
  rawUrl: string,
  brandName: string,
  onProgress?: ProgressFn,
  opts?: ScrapeOptions
): Promise<BrandAdsData> {
  const url = applyMetaFilters(rawUrl, opts);
  const target = resolveMaxAds(opts);
  const pageId = extractPageId(url);
  let browser;

  try {
    const chromePath = findChrome();
    console.log(`[Scraper] Using Chrome: ${chromePath}`);
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    // Force English UI when possible so date/CTA parsing stays predictable;
    // the parser still tolerates Turkish strings as a fallback.
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9,tr;q=0.6" });

    console.log(`[Scraper] Loading: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // ── Reported total ("~N results" / "N sonuç") ──
    const reportedTotal = await page.evaluate(() => {
      const text = document.body.innerText;
      const patterns = [
        /~?\s*([\d.,]+)\s+results?/i,
        /([\d.,]+)\s+sonu[çc]/i,
        /about\s+([\d.,]+)\s+results?/i,
      ];
      for (const re of patterns) {
        const m = text.match(re);
        if (m) {
          const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
          if (!isNaN(n)) return n;
        }
      }
      return null;
    });
    console.log(`[Scraper] Reported total for ${brandName}: ${reportedTotal ?? "unknown"}`);

    // ── Scroll until enough ads loaded ──
    const countLoadedAds = () =>
      page.evaluate(() => {
        const t = document.body.innerText;
        return (t.match(/Library ID:|Kitaplık Kimliği|Kütüphane Kodu/g) || []).length;
      });

    let lastCount = 0;
    let stagnant = 0;
    // ~1.5 cards per viewport scroll; leave headroom for slow lazy loads
    const maxScrolls = Math.min(80, Math.ceil(target / 1.5) + 4);
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, 2500));
      await new Promise((r) => setTimeout(r, 1300));

      const count = await countLoadedAds();
      onProgress?.(Math.min(count, target), target);

      if (count >= target) break;
      if (count === lastCount) {
        stagnant++;
        if (stagnant >= 3) break;
      } else {
        stagnant = 0;
      }
      lastCount = count;
    }

    // ── Locate individual ad CARD elements (deepest containers holding both a
    //    library-id marker and a sponsored/date marker), tag them, and return
    //    their innerText. Card-level extraction keeps text↔thumbnail aligned. ──
    const cardTexts: string[] = await page.evaluate((target: number) => {
      const libMarker = (t: string) =>
        t.includes("Library ID:") || t.includes("Kitaplık Kimliği") || t.includes("Kütüphane Kodu");
      // "Sponsored" lives inside the ad-preview branch while Library ID lives
      // in the metadata header branch — the deepest element containing BOTH is
      // the full ad card. (Using the start-date as a marker was the v2 bug:
      // the metadata strip alone contains Library ID + date, so the detector
      // grabbed just the strip and lost captions + creatives.)
      const adMarker = (t: string) => t.includes("Sponsored") || t.includes("Sponsorlu");

      const all = Array.from(document.querySelectorAll("div")) as HTMLElement[];
      const cands = all.filter((el) => {
        const t = el.innerText || "";
        return t.length > 80 && t.length < 12000 && libMarker(t) && adMarker(t);
      });
      // deepest: a card has no candidate descendant
      const cards = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
      const limited = cards.slice(0, target);
      limited.forEach((el, i) => el.setAttribute("data-mar-card", String(i)));
      return limited.map((el) => el.innerText || "");
    }, target);

    // ── Video creative URLs (progressive mp4 on fbcdn) + poster per card ──
    const cardMedia: { videoUrl?: string; posterUrl?: string }[] = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("div[data-mar-card]")) as HTMLElement[];
      return cards.map((card) => {
        const v = card.querySelector("video") as HTMLVideoElement | null;
        if (!v) return {};
        const src =
          v.currentSrc ||
          v.src ||
          (v.querySelector("source") as HTMLSourceElement | null)?.src ||
          "";
        return {
          ...(src.startsWith("http") ? { videoUrl: src } : {}),
          ...(v.poster ? { posterUrl: v.poster } : {}),
        };
      });
    });

    let parsed: ReturnType<typeof parseAdCardText>[] = [];
    let thumbnails: (string | undefined)[] = [];

    if (cardTexts.length > 0) {
      console.log(`[Scraper] Card detection: ${cardTexts.length} cards for ${brandName}`);
      parsed = cardTexts.map((t, i) => parseAdCardText(t, i));
      const emptyCaptions = parsed.filter((a) => a.body.startsWith("Ad ")).length;
      if (emptyCaptions > parsed.length / 2) {
        console.warn(
          `[Scraper] WARNING: ${emptyCaptions}/${parsed.length} cards have no caption — Meta layout may have changed. First card text sample: ${JSON.stringify(cardTexts[0]?.slice(0, 400))}`
        );
      }

      // ── Thumbnails: clipped JPEG screenshots of each card, embedded as
      //    data-URIs so the report stays self-contained (fbcdn URLs expire) ──
      let totalChars = 0;
      const handles = await page.$$("div[data-mar-card]");
      for (let i = 0; i < handles.length; i++) {
        let thumb: string | undefined;
        try {
          if (totalChars < MAX_TOTAL_THUMB_CHARS) {
            // Bring the card into view and give lazy-loaded creatives a moment
            await handles[i].evaluate((el) => el.scrollIntoView({ block: "center" }));
            await new Promise((r) => setTimeout(r, 350));
            await handles[i].evaluate(async (el) => {
              const imgs = Array.from(el.querySelectorAll("img"));
              await Promise.race([
                Promise.all(
                  imgs.map((im) =>
                    (im as HTMLImageElement).complete
                      ? Promise.resolve()
                      : new Promise<void>((res) => {
                          im.addEventListener("load", () => res(), { once: true });
                          im.addEventListener("error", () => res(), { once: true });
                        })
                  )
                ),
                new Promise((res) => setTimeout(res, 1500)),
              ]);
            });
            const b64 = (await handles[i].screenshot({
              type: "jpeg",
              quality: 50,
              encoding: "base64",
            })) as string;
            if (b64 && b64.length <= MAX_THUMB_CHARS) {
              thumb = `data:image/jpeg;base64,${b64}`;
              totalChars += b64.length;
            }
          }
        } catch (e) {
          console.warn(`[Scraper] Thumbnail failed for card ${i}:`, (e as Error).message);
        }
        thumbnails.push(thumb);
      }
    } else {
      // ── Fallback: legacy whole-page innerText split (no thumbnails) ──
      console.warn("[Scraper] Card detection found 0 cards — falling back to text split");
      const blocks: string[] = await page.evaluate((target: number) => {
        const text = document.body.innerText;
        const parts = text.split(/\n(?=(?:Active|Aktif)\n)/);
        return parts
          .filter((b) => b.includes("Library ID:") || b.includes("Kitaplık Kimliği") || b.includes("Kütüphane Kodu"))
          .slice(0, target);
      }, target);
      parsed = blocks.map((b, i) => parseAdCardText(b, i));
      thumbnails = blocks.map(() => undefined);
    }

    await browser.close();
    browser = undefined;

    const ads: AdData[] = parsed.map((ad, i) => ({
      ...ad,
      daysRunning: daysSince(ad.startDate),
      libraryUrl: `https://www.facebook.com/ads/library/?id=${ad.libraryId}`,
      ...(thumbnails[i] ? { thumbnail: thumbnails[i] } : {}),
      ...(cardMedia[i] ?? {}),
      // A video element is the most reliable format signal
      ...(cardMedia[i]?.videoUrl ? { format: "Video" } : {}),
    }));

    onProgress?.(ads.length, target);

    const stats = aggregateBrandStats(ads);

    return {
      brandName,
      pageId,
      source: "meta",
      totalAds: ads.length,
      reportedTotal,
      ads,
      ...stats,
    };
  } catch (error) {
    console.error("[Scraper] Error:", error);
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}
