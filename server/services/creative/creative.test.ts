import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMetaFilters, parseAdCardText, resolveMaxAds, type BrandAdsData } from "../metaAdsScraper";
import { normalizeAnalysis } from "./creativeAnalyzer";
import { runCreativeAnalysis, selectAdsForAnalysis } from "./creativePipeline";
import { summarizeHookBody, winnerScore, type AnalyzedAdRef } from "./hookBody";
import { extractFramesFromFile, parseSceneCuts, planFrameTimes } from "./videoFrames";

// ── Real card text captured from the TR Ads Library UI (Sep 2026) ──
const TR_CARD = `​
Aktif
Kütüphane Kodu: 1065236272870850
20 Ağu 2026 tarihinde yayınlanmaya başladı
Platformlar
​
AB şeffaflığı
​
Menü
​
Reklam Detaylarını Gör
Block Blast
Sponsorlu
A full board can change in one smart move.
That is why Block Blast! feels so fun.
Clear lines, make space, and keep going. 🧩
0:00 / 0:00
BLOCKBLASTGAME.ONELINK.ME
Block Blast
Oyna
5 reklam bu kreatifi ve metni kullanıyor`;

describe("scraper: TR layout + filters", () => {
  it("parses the current TR card layout (Kütüphane Kodu, date-first, Oyna, variants)", () => {
    const ad = parseAdCardText(TR_CARD, 0);
    expect(ad.libraryId).toBe("1065236272870850");
    expect(ad.startDate).toBe("20 Ağu 2026");
    expect(ad.cta).toBe("Oyna");
    expect(ad.variantCount).toBe(5);
    expect(ad.isActive).toBe(true);
    expect(ad.format).toBe("Video");
    expect(ad.body).toContain("A full board can change in one smart move.");
    expect(ad.body).not.toContain("BLOCKBLASTGAME");
  });

  it("parses the EN variant marker", () => {
    const ad = parseAdCardText("Active\nLibrary ID: 123456789\nSponsored\nHi\nInstall Now\n3 ads use this creative and text", 0);
    expect(ad.variantCount).toBe(3);
    expect(ad.cta).toBe("Install Now");
  });

  it("rewrites library URL filters", () => {
    const u = new URL(
      applyMetaFilters("https://www.facebook.com/ads/library/?view_all_page_id=123&country=ALL", {
        country: "us",
        activeOnly: true,
        mediaType: "video",
        sortByImpressions: true,
      })
    );
    expect(u.searchParams.get("view_all_page_id")).toBe("123");
    expect(u.searchParams.get("country")).toBe("US");
    expect(u.searchParams.get("active_status")).toBe("active");
    expect(u.searchParams.get("media_type")).toBe("video");
    expect(u.searchParams.get("sort_data[mode]")).toBe("total_impressions");
  });

  it("clamps maxAds", () => {
    expect(resolveMaxAds()).toBe(20);
    expect(resolveMaxAds({ maxAds: 500 })).toBe(100);
    expect(resolveMaxAds({ maxAds: 0 })).toBe(1);
  });
});

describe("frame planning", () => {
  it("dense hook, spread body, one endcard for a 30s ad", () => {
    const plan = planFrameTimes(30);
    expect(plan.filter((p) => p.segment === "hook").map((p) => p.t)).toEqual([0.2, 1, 2, 3]);
    const body = plan.filter((p) => p.segment === "body");
    expect(body).toHaveLength(4);
    expect(body.every((b) => b.t > 3 && b.t < 28)).toBe(true);
    expect(plan.at(-1)).toEqual({ t: 29.3, segment: "endcard" });
  });

  it("degrades for very short videos", () => {
    const plan = planFrameTimes(2.5);
    expect(plan.every((p) => p.segment === "hook")).toBe(true);
    expect(plan.map((p) => p.t)).toEqual([0.2, 1, 2]);
    expect(planFrameTimes(0)).toEqual([{ t: 0, segment: "hook" }]);
  });

  it("parses scene cuts from showinfo output", () => {
    const stderr = "[Parsed_showinfo_1] n:0 pts:1 pts_time:0.1 ...\n[Parsed_showinfo_1] n:1 pts:2 pts_time:2.04 ...\n x pts_time:5.5";
    expect(parseSceneCuts(stderr)).toEqual([2, 5.5]);
  });
});

describe("winner scoring + hook×body", () => {
  it("rewards longevity, variants and impression rank", () => {
    const fresh = winnerScore({ daysRunning: 1, variantCount: 1 });
    const old = winnerScore({ daysRunning: 90, variantCount: 1 });
    const scaled = winnerScore({ daysRunning: 90, variantCount: 10 });
    expect(fresh).toBeLessThan(old);
    expect(old).toBeLessThan(scaled);
    expect(scaled).toBe(1);
    expect(winnerScore({ daysRunning: 0, impressionRank: 0, listSize: 10 })).toBeGreaterThan(
      winnerScore({ daysRunning: 0, impressionRank: 9, listSize: 10 })
    );
  });

  it("aggregates pairs and computes lift", () => {
    const r = (id: string, hook: any, body: any, score: number, brand = "A"): AnalyzedAdRef => ({
      brand,
      libraryId: id,
      hook,
      body,
      endcard: "store_card",
      score,
      daysRunning: Math.round(score * 90),
    });
    const s = summarizeHookBody([
      r("1", "fail_bait", "fail_then_success", 0.9),
      r("2", "fail_bait", "fail_then_success", 0.8, "B"),
      r("3", "satisfying_asmr", "real_gameplay_loop", 0.2),
      r("4", "satisfying_asmr", "real_gameplay_loop", 0.1),
      r("5", "fail_bait", "real_gameplay_loop", 0.05),
    ]);
    expect(s.analyzedCount).toBe(5);
    const top = s.pairs[0];
    expect(top.hook).toBe("fail_bait");
    expect(top.body).toBe("fail_then_success");
    expect(top.count).toBe(2);
    expect(top.brands.sort()).toEqual(["A", "B"]);
    expect(top.adIds).toEqual(["1", "2"]);
    expect(top.lift).toBeGreaterThan(1);
    expect(s.hooks[0].type).toBe("fail_bait");
  });

  it("normalizes off-taxonomy model output", () => {
    const a = normalizeAnalysis({ hook: { type: "Fail_Bait" }, body: { type: "made-up" }, authenticity: "FAKE" });
    expect(a.hook.type).toBe("fail_bait");
    expect(a.body.type).toBe("other");
    expect(a.endcard.type).toBe("none");
    expect(a.authenticity).toBe("fake");
  });
});

// ── End-to-end: real ffmpeg on a synthetic video, served over HTTP, Claude mocked ──
let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

describe.skipIf(!hasFfmpeg)("video pipeline (ffmpeg)", () => {
  let dir: string;
  let videoFile: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "mar-test-"));
    videoFile = path.join(dir, "ad.mp4");
    // 12s portrait video with 3 hard cuts (colour changes) + audio tone
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=red:s=360x640:d=3,format=yuv420p",
      "-f", "lavfi", "-i", "color=c=blue:s=360x640:d=3,format=yuv420p",
      "-f", "lavfi", "-i", "color=c=green:s=360x640:d=3,format=yuv420p",
      "-f", "lavfi", "-i", "color=c=white:s=360x640:d=3,format=yuv420p",
      "-f", "lavfi", "-i", "sine=f=440:d=12",
      "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
      "-map", "[v]", "-map", "4:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", "-y", videoFile,
    ]);
    const bytes = readFileSync(videoFile);
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": bytes.length });
      res.end(bytes);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("extracts hook/body/endcard frames, cuts and audio", async () => {
    const out = await extractFramesFromFile(videoFile, dir);
    expect(out.duration).toBeGreaterThan(11);
    expect(out.hasAudio).toBe(true);
    expect(out.width).toBe(360);
    expect(out.cuts).toEqual([3, 6, 9]);
    const segs = out.frames.map((f) => f.segment);
    expect(segs.filter((s) => s === "hook")).toHaveLength(4);
    expect(segs).toContain("body");
    expect(segs.at(-1)).toBe("endcard");
    // JPEG magic bytes
    expect(Buffer.from(out.frames[0].jpegBase64, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
  }, 60_000);

  it("runs the full creative pipeline with a mocked Claude API", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const realFetch = globalThis.fetch;
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (url: any, init?: any) => {
      if (String(url).includes("api.anthropic.com")) {
        const body = JSON.parse(init.body);
        calls.push(body);
        const hasImages = body.messages[0].content.some((c: any) => c.type === "image");
        const text = hasImages
          ? JSON.stringify({
              hook: { type: "fail_bait", description: "Board dolu, yanlış blok", textOverlay: "Only 1% can", emotion: "sinir" },
              body: { type: "fail_then_success", description: "Kurtarış", mechanic: "satır temizleme" },
              endcard: { type: "store_card", description: "Store" },
              authenticity: "real",
              hookBodyLink: "Fail vaadi kurtarışla ödeniyor",
              visualStyle: "full-screen",
              humanPresence: false,
              pattern: "fail → kurtarış → store",
            })
          : JSON.stringify({
              playbook: [{ pattern: "fail → kurtarış", why: "uzun yayın", evidence: ["111"] }],
              hookInsights: ["İlk karede yazı var"],
              gaps: ["UGC yok"],
              concepts: [
                {
                  title: "Son satır",
                  hook: { type: "fail_bait", script: "..." },
                  body: { type: "fail_then_success", script: "..." },
                  endcard: "rakun",
                  beats: [{ time: "0-1sn", visual: "dolu board", text: "Can you?" }],
                  references: ["111"],
                  productionNotes: "gerçek gameplay kaydı",
                },
              ],
            });
        return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
      }
      return realFetch(url, init);
    });

    const mkBrand = (name: string, ids: string[]): BrandAdsData => ({
      brandName: name,
      pageId: "",
      source: "meta",
      totalAds: ids.length,
      reportedTotal: null,
      ads: ids.map((id, i) => ({
        id: `ad_${i}`,
        libraryId: id,
        body: "caption",
        startDate: "",
        daysRunning: 30 * (i + 1),
        cta: "Install Now",
        platforms: [],
        format: "Video",
        libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
        videoUrl: `${baseUrl}/${id}.mp4`,
        variantCount: i + 1,
      })),
      platformCounts: {},
      videoCount: ids.length,
      staticCount: 0,
      ctaCounts: {},
      monthlyTrend: {},
    });

    const brands = [mkBrand("Rival A", ["111", "112"]), mkBrand("Rival B", ["221"])];
    const progress: number[] = [];
    const report = await runCreativeAnalysis(brands, {
      maxPerBrand: 5,
      gameContext: "Row Block: alttan tile fırlatıp satır doldurma",
      onProgress: (d) => progress.push(d),
    });

    expect(report).not.toBeNull();
    expect(report!.skipped).toBeUndefined();
    expect(report!.failures).toBe(0);
    expect(report!.summary.analyzedCount).toBe(3);
    expect(report!.summary.pairs[0]).toMatchObject({ hook: "fail_bait", body: "fail_then_success", count: 3 });
    expect(report!.analyzed["Rival A"]).toHaveLength(2);
    // Highest score first (older, more variants)
    expect(report!.analyzed["Rival A"][0].libraryId).toBe("112");
    expect(report!.analyzed["Rival A"][0].frames.length).toBeGreaterThanOrEqual(5);
    expect(report!.analyzed["Rival A"][0].frames[0].src.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(report!.synthesis?.concepts[0].title).toBe("Son satır");
    expect(progress.at(-1)).toBe(3);
    // 3 vision calls + 1 synthesis call; vision call carries hook frames
    expect(calls).toHaveLength(4);
    const vision = calls.find((c) => c.messages[0].content.some((x: any) => x.type === "image"));
    expect(vision.messages[0].content.filter((x: any) => x.type === "image").length).toBeGreaterThanOrEqual(8);
    const synth = calls.find((c) => !c.messages[0].content.some((x: any) => x.type === "image"));
    expect(synth.messages[0].content[0].text).toContain("BİZİM OYUN");
    delete process.env.ANTHROPIC_API_KEY;
  }, 120_000);

  it("skips cleanly without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await runCreativeAnalysis([]);
    expect(r?.skipped).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("selectAdsForAnalysis ignores non-video ads and ranks by score", () => {
    const b: BrandAdsData = {
      brandName: "X",
      pageId: "",
      source: "meta",
      totalAds: 3,
      reportedTotal: null,
      ads: [
        { id: "a", libraryId: "1", body: "", startDate: "", daysRunning: 1, cta: "", platforms: [], format: "Video", libraryUrl: "", videoUrl: "u1" },
        { id: "b", libraryId: "2", body: "", startDate: "", daysRunning: 80, cta: "", platforms: [], format: "Image/Carousel", libraryUrl: "" },
        { id: "c", libraryId: "3", body: "", startDate: "", daysRunning: 60, cta: "", platforms: [], format: "Video", libraryUrl: "", videoUrl: "u3" },
      ],
      platformCounts: {},
      videoCount: 2,
      staticCount: 1,
      ctaCounts: {},
      monthlyTrend: {},
    };
    expect(selectAdsForAnalysis(b, 10, false).map((a) => a.libraryId)).toEqual(["3", "1"]);
    expect(b.ads[1].winnerScore).toBeGreaterThan(0);
  });
});
