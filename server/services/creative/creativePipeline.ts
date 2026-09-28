import type { AdData, BrandAdsData } from "../metaAdsScraper";
import { callClaude, creativeModel, extractJsonObject, hasAnthropicKey, mapLimit } from "./anthropic";
import { analyzeAdCreative, type AdCreativeAnalysis } from "./creativeAnalyzer";
import { adWinnerScore, summarizeHookBody, type AnalyzedAdRef, type HookBodySummary } from "./hookBody";
import { TAXONOMY_TR } from "./taxonomy";
import { extractVideoFrames, ffmpegAvailable } from "./videoFrames";

/**
 * Creative analysis orchestrator:
 *   score every ad → pick top video ads per brand → download + frames →
 *   per-ad vision analysis → hook × body aggregation → playbook / concept synthesis.
 *
 * Optional and failure-tolerant like the insights layer: missing key, missing
 * ffmpeg or individual video failures never block report creation.
 */

export interface CreativeOptions {
  /** Max video ads analyzed per brand (cost control). */
  maxPerBrand?: number;
  /** Listing was sorted by impressions → use rank as a winner signal. */
  sortedByImpressions?: boolean;
  /** Free-text description of OUR game — enables concept generation. */
  gameContext?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface CreativeFrame {
  t: number;
  segment: "hook" | "body" | "endcard";
  src: string; // data URI
}

export interface AdCreativeEntry {
  libraryId: string;
  libraryUrl: string;
  score: number;
  daysRunning: number;
  variantCount: number;
  duration: number;
  cutsPer10s: number;
  hasAudio: boolean;
  frames: CreativeFrame[];
  analysis: AdCreativeAnalysis;
}

export interface CreativeConcept {
  title: string;
  hook: { type: string; script: string };
  body: { type: string; script: string };
  endcard: string;
  beats: { time: string; visual: string; text: string }[];
  references: string[];
  productionNotes: string;
}

export interface CreativeSynthesis {
  playbook: { pattern: string; why: string; evidence: string[] }[];
  hookInsights: string[];
  gaps: string[];
  concepts: CreativeConcept[];
}

export interface CreativeReport {
  generatedAt: string;
  model: string;
  analyzed: Record<string, AdCreativeEntry[]>;
  summary: HookBodySummary;
  synthesis: CreativeSynthesis | null;
  failures: number;
  skipped?: string;
}

const DEFAULT_MAX_PER_BRAND = 12;
const CONCURRENCY = 2;

/** Frames we keep in the report (the analyzer sees all of them). */
function keepFrames(frames: { t: number; segment: CreativeFrame["segment"]; jpegBase64: string }[]): CreativeFrame[] {
  const hook = frames.filter((f) => f.segment === "hook").slice(0, 4);
  const body = frames.filter((f) => f.segment === "body");
  const mid = body.length ? [body[Math.floor(body.length / 2)]] : [];
  const end = frames.filter((f) => f.segment === "endcard").slice(-1);
  return [...hook, ...mid, ...end].map((f) => ({
    t: f.t,
    segment: f.segment,
    src: `data:image/jpeg;base64,${f.jpegBase64}`,
  }));
}

/** Attach winnerScore to every ad (mutates) and return the top video ads. */
export function selectAdsForAnalysis(brand: BrandAdsData, max: number, sortedByImpressions: boolean): AdData[] {
  brand.ads.forEach((ad, i) => {
    ad.winnerScore = adWinnerScore(ad, i, brand.ads.length, sortedByImpressions);
  });
  return brand.ads
    .filter((a) => a.videoUrl)
    .slice()
    .sort((a, b) => (b.winnerScore ?? 0) - (a.winnerScore ?? 0))
    .slice(0, max);
}

const SYNTH_SYSTEM =
  "Sen mobil oyun UA kreatif direktörüsün. Rakip reklam analizlerinden tekrar kullanılabilir hook-body kalıpları çıkarır ve üretime hazır kreatif konseptleri yazarsın. Çıktın her zaman geçerli JSON'dur.";

function buildSynthesisPrompt(
  analyzed: Record<string, AdCreativeEntry[]>,
  summary: HookBodySummary,
  gameContext?: string
): string {
  const adLines = Object.entries(analyzed)
    .flatMap(([brand, list]) =>
      list.map(
        (e) =>
          `- [${e.libraryId}] ${brand} | skor ${e.score} | ${e.daysRunning}g | ${e.variantCount} varyant | ${e.duration.toFixed(0)}sn, ${e.cutsPer10s.toFixed(1)} kesme/10sn
  HOOK ${e.analysis.hook.type}: ${e.analysis.hook.description}${e.analysis.hook.textOverlay ? ` (yazı: "${e.analysis.hook.textOverlay}")` : ""}
  BODY ${e.analysis.body.type} (${e.analysis.authenticity}): ${e.analysis.body.description} | mekanik: ${e.analysis.body.mechanic}
  END ${e.analysis.endcard.type} | bağ: ${e.analysis.hookBodyLink}`
      )
    )
    .join("\n");

  const pairLines = summary.pairs
    .slice(0, 12)
    .map(
      (p) =>
        `- ${p.hook} × ${p.body}: ${p.count} reklam, ağırlık ${p.weight}, ort. skor ${p.avgScore}, ort. ${p.avgDays}g, lift ${p.lift}, markalar: ${p.brands.join("/")}`
    )
    .join("\n");

  const conceptsPart = gameContext
    ? `
BİZİM OYUN:
${gameContext.slice(0, 1500)}

"concepts": Bizim oyun için 5 adet üretime hazır video reklam konsepti. Her biri yukarıdaki kanıtlanmış hook×body eşleşmelerinden birine dayansın ama bizim mekaniğimize uyarlansın (rakibi kopyalama). "beats" 0-3sn hook'tan end card'a saniye saniye akış. "references" dayandığın rakip reklam id'leri. "productionNotes": gerçek gameplay kaydı mı, motion/AI üretim mi gerekiyor, süre, oran.`
    : `
"concepts": boş dizi [] döndür (oyun bilgisi verilmedi).`;

  return `Rakip mobil oyun video reklamlarının kare bazlı analizleri (skor = kazanan olma olasılığı; uzun yayın + çok varyant + yüksek gösterim sırası):

${adLines}

HOOK × BODY EŞLEŞMELERİ (ağırlığa göre):
${pairLines}

Görev:
"playbook": 3-6 kalıp. Her biri "hook → body → endcard" formülü, "why" neden çalıştığı (veriyle), "evidence" reklam id'leri.
"hookInsights": ilk 3 saniyeye dair 3-5 somut gözlem (yazı kullanımı, tempo, ilk kare vb.).
"gaps": rakiplerin kullanmadığı / az kullandığı ama denenmeye değer 2-4 boşluk.
${conceptsPart}

Türkçe yaz. SADECE şu şemada JSON döndür:
{"playbook":[{"pattern":"","why":"","evidence":[""]}],"hookInsights":[""],"gaps":[""],"concepts":[{"title":"","hook":{"type":"","script":""},"body":{"type":"","script":""},"endcard":"","beats":[{"time":"0-1sn","visual":"","text":""}],"references":[""],"productionNotes":""}]}`;
}

function normalizeSynthesis(raw: any): CreativeSynthesis {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const str = (v: any) => String(v ?? "");
  return {
    playbook: arr(raw?.playbook).map((p: any) => ({
      pattern: str(p?.pattern),
      why: str(p?.why),
      evidence: arr(p?.evidence).map(str),
    })),
    hookInsights: arr(raw?.hookInsights).map(str),
    gaps: arr(raw?.gaps).map(str),
    concepts: arr(raw?.concepts).map((c: any) => ({
      title: str(c?.title),
      hook: { type: str(c?.hook?.type), script: str(c?.hook?.script) },
      body: { type: str(c?.body?.type), script: str(c?.body?.script) },
      endcard: str(c?.endcard),
      beats: arr(c?.beats).map((b: any) => ({ time: str(b?.time), visual: str(b?.visual), text: str(b?.text) })),
      references: arr(c?.references).map(str),
      productionNotes: str(c?.productionNotes),
    })),
  };
}

export async function runCreativeAnalysis(
  brands: BrandAdsData[],
  opts: CreativeOptions = {}
): Promise<CreativeReport | null> {
  const empty = (skipped: string): CreativeReport => ({
    generatedAt: new Date().toISOString(),
    model: creativeModel(),
    analyzed: {},
    summary: { analyzedCount: 0, hooks: [], bodies: [], endcards: [], pairs: [] },
    synthesis: null,
    failures: 0,
    skipped,
  });

  if (!hasAnthropicKey()) return empty("ANTHROPIC_API_KEY tanımlı değil");
  if (!(await ffmpegAvailable())) return empty("Sunucuda ffmpeg bulunamadı");

  const max = Math.max(1, Math.min(40, opts.maxPerBrand ?? DEFAULT_MAX_PER_BRAND));
  const jobs: { brand: BrandAdsData; ad: AdData }[] = [];
  for (const b of brands) {
    for (const ad of selectAdsForAnalysis(b, max, Boolean(opts.sortedByImpressions))) jobs.push({ brand: b, ad });
  }
  if (jobs.length === 0) return empty("Analiz edilecek video reklam bulunamadı");

  let done = 0;
  let failures = 0;
  opts.onProgress?.(0, jobs.length);

  const results = await mapLimit(jobs, CONCURRENCY, async ({ brand, ad }) => {
    try {
      const frames = await extractVideoFrames(ad.videoUrl!);
      if (frames.frames.length === 0) throw new Error("no frames extracted");
      const analysis = await analyzeAdCreative(ad, frames, brand.brandName);
      const entry: AdCreativeEntry = {
        libraryId: ad.libraryId,
        libraryUrl: ad.libraryUrl,
        score: ad.winnerScore ?? 0,
        daysRunning: ad.daysRunning,
        variantCount: ad.variantCount ?? 1,
        duration: frames.duration,
        cutsPer10s: frames.duration > 0 ? Math.round((frames.cuts.length / frames.duration) * 100) / 10 : 0,
        hasAudio: frames.hasAudio,
        frames: keepFrames(frames.frames),
        analysis,
      };
      return { brand: brand.brandName, entry };
    } catch (e) {
      failures++;
      console.warn(`[Creative] ${brand.brandName} ${ad.libraryId} failed:`, (e as Error).message);
      return null;
    } finally {
      opts.onProgress?.(++done, jobs.length);
    }
  });

  const analyzed: Record<string, AdCreativeEntry[]> = {};
  for (const r of results) {
    if (!r) continue;
    (analyzed[r.brand] ??= []).push(r.entry);
  }

  const refs: AnalyzedAdRef[] = Object.entries(analyzed).flatMap(([brand, list]) =>
    list.map((e) => ({
      brand,
      libraryId: e.libraryId,
      hook: e.analysis.hook.type,
      body: e.analysis.body.type,
      endcard: e.analysis.endcard.type,
      score: e.score,
      daysRunning: e.daysRunning,
    }))
  );
  const summary = summarizeHookBody(refs);

  let synthesis: CreativeSynthesis | null = null;
  if (refs.length >= 3) {
    try {
      const text = await callClaude({
        system: SYNTH_SYSTEM,
        content: [{ type: "text", text: buildSynthesisPrompt(analyzed, summary, opts.gameContext) }],
        maxTokens: opts.gameContext ? 6000 : 2500,
        timeoutMs: 150_000,
      });
      synthesis = normalizeSynthesis(extractJsonObject(text));
    } catch (e) {
      console.warn("[Creative] synthesis failed:", (e as Error).message);
    }
  }

  console.log(
    `[Creative] analyzed ${refs.length}/${jobs.length} ads (${failures} failed); top pair: ${
      summary.pairs[0] ? `${TAXONOMY_TR[summary.pairs[0].hook]} × ${TAXONOMY_TR[summary.pairs[0].body]}` : "-"
    }`
  );

  return {
    generatedAt: new Date().toISOString(),
    model: creativeModel(),
    analyzed,
    summary,
    synthesis,
    failures,
  };
}
