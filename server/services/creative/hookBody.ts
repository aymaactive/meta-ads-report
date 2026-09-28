import type { AdData } from "../metaAdsScraper";
import type { BodyType, EndcardType, HookType } from "./taxonomy";

/**
 * Winner scoring + hook × body co-occurrence.
 *
 * Public ad libraries expose no spend/CTR, so "winner" is inferred from:
 *   - longevity (days running): advertisers kill losers fast
 *   - variant count ("N ads use this creative"): winners get duplicated across
 *     ad sets / geos
 *   - impression rank: when the library is sorted by total impressions, the
 *     position itself is a delivery signal
 */

export interface WinnerInput {
  daysRunning: number;
  variantCount?: number;
  /** 0-based position in an impressions-sorted listing, if known */
  impressionRank?: number;
  listSize?: number;
}

export function winnerScore(w: WinnerInput): number {
  const days = Math.min(Math.max(w.daysRunning || 0, 0), 90) / 90; // saturates at 90d
  const variants = Math.min(Math.max((w.variantCount ?? 1) - 1, 0), 9) / 9; // 1 → 0, 10+ → 1
  let score: number;
  if (w.impressionRank !== undefined && w.listSize && w.listSize > 1) {
    const rank = 1 - w.impressionRank / (w.listSize - 1);
    score = 0.45 * days + 0.25 * variants + 0.3 * rank;
  } else {
    score = 0.65 * days + 0.35 * variants;
  }
  return Math.round(score * 100) / 100;
}

export function adWinnerScore(ad: AdData, index: number, listSize: number, sortedByImpressions: boolean): number {
  return winnerScore({
    daysRunning: ad.daysRunning,
    variantCount: ad.variantCount,
    ...(sortedByImpressions ? { impressionRank: index, listSize } : {}),
  });
}

export interface AnalyzedAdRef {
  brand: string;
  libraryId: string;
  hook: HookType;
  body: BodyType;
  endcard: EndcardType;
  score: number;
  daysRunning: number;
}

export interface PairStat {
  hook: HookType;
  body: BodyType;
  count: number;
  /** sum of winner scores */
  weight: number;
  avgScore: number;
  avgDays: number;
  brands: string[];
  /**
   * Co-occurrence lift vs independence: >1 means this hook shows up with this
   * body (weighted by winner score) more than their individual frequencies
   * would predict — i.e. advertisers deliberately pair them.
   */
  lift: number;
  adIds: string[];
}

export interface TypeStat {
  type: string;
  count: number;
  weight: number;
  avgScore: number;
}

export interface HookBodySummary {
  analyzedCount: number;
  hooks: TypeStat[];
  bodies: TypeStat[];
  endcards: TypeStat[];
  pairs: PairStat[];
}

function typeStats(refs: AnalyzedAdRef[], key: "hook" | "body" | "endcard"): TypeStat[] {
  const m = new Map<string, { count: number; weight: number }>();
  for (const r of refs) {
    const k = r[key];
    const cur = m.get(k) ?? { count: 0, weight: 0 };
    cur.count++;
    cur.weight += r.score;
    m.set(k, cur);
  }
  return Array.from(m.entries())
    .map(([type, v]) => ({
      type,
      count: v.count,
      weight: Math.round(v.weight * 100) / 100,
      avgScore: Math.round((v.weight / v.count) * 100) / 100,
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count);
}

// Small floor so ads with score 0 (brand-new, single variant) still count a bit
const W_FLOOR = 0.05;

export function summarizeHookBody(refs: AnalyzedAdRef[]): HookBodySummary {
  const w = (r: AnalyzedAdRef) => r.score + W_FLOOR;
  const total = refs.reduce((s, r) => s + w(r), 0) || 1;

  const hookW = new Map<string, number>();
  const bodyW = new Map<string, number>();
  for (const r of refs) {
    hookW.set(r.hook, (hookW.get(r.hook) ?? 0) + w(r));
    bodyW.set(r.body, (bodyW.get(r.body) ?? 0) + w(r));
  }

  const pairMap = new Map<string, AnalyzedAdRef[]>();
  for (const r of refs) {
    const k = `${r.hook}|${r.body}`;
    pairMap.set(k, [...(pairMap.get(k) ?? []), r]);
  }

  const pairs: PairStat[] = Array.from(pairMap.values()).map((list) => {
    const { hook, body } = list[0];
    const weight = list.reduce((s, r) => s + w(r), 0);
    const expected = ((hookW.get(hook) ?? 0) / total) * ((bodyW.get(body) ?? 0) / total);
    const lift = expected > 0 ? weight / total / expected : 0;
    return {
      hook,
      body,
      count: list.length,
      weight: Math.round(list.reduce((s, r) => s + r.score, 0) * 100) / 100,
      avgScore: Math.round((list.reduce((s, r) => s + r.score, 0) / list.length) * 100) / 100,
      avgDays: Math.round(list.reduce((s, r) => s + r.daysRunning, 0) / list.length),
      brands: Array.from(new Set(list.map((r) => r.brand))),
      lift: Math.round(lift * 100) / 100,
      adIds: list
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((r) => r.libraryId),
    };
  });
  pairs.sort((a, b) => b.weight - a.weight || b.count - a.count);

  return {
    analyzedCount: refs.length,
    hooks: typeStats(refs, "hook"),
    bodies: typeStats(refs, "body"),
    endcards: typeStats(refs, "endcard"),
    pairs,
  };
}
