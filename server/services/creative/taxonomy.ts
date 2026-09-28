/**
 * Mobile-game ad creative taxonomy.
 *
 * Kept deliberately small and mutually exclusive so that hook × body pairs
 * can be counted across competitors. Labels are English keys (stable for
 * aggregation); Turkish display names live in the UI map below.
 */

export const HOOK_TYPES = [
  "fail_bait", //            player about to lose / obvious wrong move — "can you do better?"
  "challenge_iq", //         "only 1% can solve", IQ / level-number challenge
  "satisfying_asmr", //      oddly satisfying clears, sorting, smooth combos
  "near_win_tension", //     board almost full, timer running out, one move left
  "big_combo_reward", //     explosive multi-clear, gem/coin rain, jackpot moment
  "noob_vs_pro", //          split / comparison of two players or two strategies
  "choice_prompt", //        "which one would you pick?" A/B choice
  "character_story", //      mascot / character in trouble, narrative drama
  "ugc_human", //            real person, hand-on-phone, face reaction, voice-over
  "text_claim", //           bold text statement/offer ("no wifi needed", "relaxing")
  "other",
] as const;

export const BODY_TYPES = [
  "real_gameplay_loop", //   actual core loop played straight
  "fake_gameplay", //        mechanic/visual not in the real game (misleading ad)
  "level_progression", //    difficulty ramps across levels / level-number jumps
  "fail_then_success", //    fail sequence resolved by a smart move / power-up
  "powerup_showcase", //     boosters/power-ups doing the heavy lifting
  "compilation", //          fast montage of best moments
  "scenario_story", //       scripted "content" style scenario, not pure gameplay
  "ugc_testimonial", //      person talking/playing on camera
  "tutorial_explainer", //   explains rules step by step
  "other",
] as const;

export const ENDCARD_TYPES = [
  "store_card", //  app icon + stars + install button
  "logo_cta", //    logo/title + CTA text
  "mascot", //      character/mascot outro
  "cliffhanger", // ends on a fail/unsolved board ("can you finish it?")
  "none", //        no distinct end card
] as const;

export const AUTHENTICITY = ["real", "fake", "mixed", "unclear"] as const;

export type HookType = (typeof HOOK_TYPES)[number];
export type BodyType = (typeof BODY_TYPES)[number];
export type EndcardType = (typeof ENDCARD_TYPES)[number];
export type Authenticity = (typeof AUTHENTICITY)[number];

export const TAXONOMY_TR: Record<string, string> = {
  fail_bait: "Fail / yanlış hamle",
  challenge_iq: "Meydan okuma / IQ",
  satisfying_asmr: "Satisfying / ASMR",
  near_win_tension: "Son hamle gerilimi",
  big_combo_reward: "Büyük kombo / ödül",
  noob_vs_pro: "Noob vs Pro",
  choice_prompt: "Seçim sorusu",
  character_story: "Karakter / hikaye",
  ugc_human: "UGC / insan",
  text_claim: "Metin iddiası",
  real_gameplay_loop: "Gerçek gameplay",
  fake_gameplay: "Fake gameplay",
  level_progression: "Level ilerlemesi",
  fail_then_success: "Fail → başarı",
  powerup_showcase: "Power-up gösterimi",
  compilation: "Montaj / derleme",
  scenario_story: "Senaryolu içerik",
  ugc_testimonial: "UGC anlatım",
  tutorial_explainer: "Kural anlatımı",
  store_card: "Store kartı",
  logo_cta: "Logo + CTA",
  mascot: "Maskot",
  cliffhanger: "Cliffhanger",
  none: "Yok",
  real: "Gerçek",
  fake: "Fake",
  mixed: "Karışık",
  unclear: "Belirsiz",
  other: "Diğer",
};

export function normalizeEnum<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  const v = String(value ?? "").trim().toLowerCase();
  return (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}
