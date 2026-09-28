import type { AdData } from "../metaAdsScraper";
import { callClaude, extractJsonObject, type ContentBlock } from "./anthropic";
import {
  AUTHENTICITY,
  BODY_TYPES,
  ENDCARD_TYPES,
  HOOK_TYPES,
  normalizeEnum,
  type Authenticity,
  type BodyType,
  type EndcardType,
  type HookType,
} from "./taxonomy";
import type { VideoFrames } from "./videoFrames";

/**
 * Per-ad vision analysis: sends the hook/body/endcard frames of one video ad
 * (plus caption and longevity signals) to Claude and gets back a structured,
 * taxonomy-constrained breakdown tuned for mobile-game creatives.
 */

export interface AdCreativeAnalysis {
  hook: {
    type: HookType;
    /** What happens in the first 3 seconds, concretely */
    description: string;
    /** On-screen text in the hook, verbatim if legible */
    textOverlay: string;
    emotion: string;
  };
  body: {
    type: BodyType;
    description: string;
    /** Game mechanic shown (e.g. "blok yerleştirip satır temizleme") */
    mechanic: string;
  };
  endcard: { type: EndcardType; description: string };
  authenticity: Authenticity;
  /** Does the body pay off the hook's promise? Why this pair works (or not). */
  hookBodyLink: string;
  visualStyle: string;
  humanPresence: boolean;
  /** 1-line reusable pattern, e.g. "Dolu board fail → power-up ile kurtarış → store kartı" */
  pattern: string;
}

const SYSTEM = `Sen mobil oyun user acquisition kreatif stratejistisin. Rakip oyunların video reklamlarını kare kare inceler, hook (ilk 3 sn), body (gameplay/senaryo) ve end card'ı sınıflandırırsın. Sadece karelerde gördüğüne dayan; göremediğin şeyi uydurma. Çıktın her zaman geçerli JSON'dur.`;

function fmtT(t: number) {
  return `${t.toFixed(1)}sn`;
}

export function buildAnalysisContent(ad: AdData, frames: VideoFrames, brandName: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const pace = frames.duration > 0 ? (frames.cuts.length / frames.duration) * 10 : 0;

  blocks.push({
    type: "text",
    text: `Reklamveren: ${brandName}
Süre: ${frames.duration.toFixed(1)} sn | Kesme sayısı: ${frames.cuts.length} (~${pace.toFixed(1)} kesme/10sn) | Ses: ${frames.hasAudio ? "var" : "yok"} | Oran: ${frames.width ?? "?"}x${frames.height ?? "?"}
Yayında: ${ad.daysRunning} gün | Aynı kreatifi kullanan reklam sayısı: ${ad.variantCount ?? 1} | CTA: ${ad.cta}
Caption: ${(ad.body || "").replace(/\s+/g, " ").slice(0, 400)}

Aşağıda videonun zaman damgalı kareleri var.`,
  });

  for (const f of frames.frames) {
    blocks.push({ type: "text", text: `[${f.segment.toUpperCase()} @ ${fmtT(f.t)}]` });
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.jpegBase64 } });
  }

  blocks.push({
    type: "text",
    text: `Bu reklamı sınıflandır. Enum alanlarında SADECE listedeki değerlerden birini kullan.

hook.type: ${HOOK_TYPES.join(" | ")}
body.type: ${BODY_TYPES.join(" | ")}
endcard.type: ${ENDCARD_TYPES.join(" | ")}
authenticity (body'deki gameplay gerçek oyunda var mı?): ${AUTHENTICITY.join(" | ")}

Serbest metin alanları Türkçe ve kısa (max ~140 karakter) olsun. SADECE şu JSON'u döndür:
{
  "hook": {"type": "...", "description": "ilk 3 sn'de somut olarak ne oluyor", "textOverlay": "ekrandaki yazı (okunabiliyorsa birebir, yoksa boş)", "emotion": "merak/sinir/tatmin/rekabet..."},
  "body": {"type": "...", "description": "...", "mechanic": "gösterilen oyun mekaniği"},
  "endcard": {"type": "...", "description": "..."},
  "authenticity": "...",
  "hookBodyLink": "body hook'un vaadini nasıl karşılıyor, bu ikili neden birlikte çalışıyor",
  "visualStyle": "renk/kamera/çerçeve (örn: telefon içinde el, full-screen gameplay)",
  "humanPresence": false,
  "pattern": "tek satır tekrar kullanılabilir kalıp: hook → body → endcard"
}`,
  });
  return blocks;
}

export function normalizeAnalysis(raw: any): AdCreativeAnalysis {
  const s = (v: unknown, n = 200) => String(v ?? "").slice(0, n);
  return {
    hook: {
      type: normalizeEnum(HOOK_TYPES, raw?.hook?.type, "other"),
      description: s(raw?.hook?.description),
      textOverlay: s(raw?.hook?.textOverlay, 160),
      emotion: s(raw?.hook?.emotion, 60),
    },
    body: {
      type: normalizeEnum(BODY_TYPES, raw?.body?.type, "other"),
      description: s(raw?.body?.description),
      mechanic: s(raw?.body?.mechanic, 120),
    },
    endcard: {
      type: normalizeEnum(ENDCARD_TYPES, raw?.endcard?.type, "none"),
      description: s(raw?.endcard?.description, 120),
    },
    authenticity: normalizeEnum(AUTHENTICITY, raw?.authenticity, "unclear"),
    hookBodyLink: s(raw?.hookBodyLink, 240),
    visualStyle: s(raw?.visualStyle, 140),
    humanPresence: Boolean(raw?.humanPresence),
    pattern: s(raw?.pattern, 160),
  };
}

export async function analyzeAdCreative(
  ad: AdData,
  frames: VideoFrames,
  brandName: string
): Promise<AdCreativeAnalysis> {
  const text = await callClaude({
    system: SYSTEM,
    content: buildAnalysisContent(ad, frames, brandName),
    maxTokens: 1200,
    timeoutMs: 90_000,
  });
  return normalizeAnalysis(extractJsonObject(text));
}
