import { useMemo, useState } from "react";
import { Copy, ExternalLink, Film, Lightbulb, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ─── Types (mirror server/services/creative/creativePipeline.ts) ──────────────
interface CreativeFrame {
  t: number;
  segment: "hook" | "body" | "endcard";
  src: string;
}
interface Analysis {
  hook: { type: string; description: string; textOverlay: string; emotion: string };
  body: { type: string; description: string; mechanic: string };
  endcard: { type: string; description: string };
  authenticity: string;
  hookBodyLink: string;
  visualStyle: string;
  humanPresence: boolean;
  pattern: string;
}
interface Entry {
  libraryId: string;
  libraryUrl: string;
  score: number;
  daysRunning: number;
  variantCount: number;
  duration: number;
  cutsPer10s: number;
  hasAudio: boolean;
  frames: CreativeFrame[];
  analysis: Analysis;
}
interface TypeStat {
  type: string;
  count: number;
  weight: number;
  avgScore: number;
}
interface PairStat {
  hook: string;
  body: string;
  count: number;
  weight: number;
  avgScore: number;
  avgDays: number;
  brands: string[];
  lift: number;
  adIds: string[];
}
interface Concept {
  title: string;
  hook: { type: string; script: string };
  body: { type: string; script: string };
  endcard: string;
  beats: { time: string; visual: string; text: string }[];
  references: string[];
  productionNotes: string;
}
export interface CreativeReport {
  generatedAt: string;
  model: string;
  analyzed: Record<string, Entry[]>;
  summary: { analyzedCount: number; hooks: TypeStat[]; bodies: TypeStat[]; endcards: TypeStat[]; pairs: PairStat[] };
  synthesis: {
    playbook: { pattern: string; why: string; evidence: string[] }[];
    hookInsights: string[];
    gaps: string[];
    concepts: Concept[];
  } | null;
  failures: number;
  skipped?: string;
}

// Keep in sync with server/services/creative/taxonomy.ts
const TR: Record<string, string> = {
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
const tr = (k: string) => TR[k] ?? k;

const SEG_LABEL: Record<CreativeFrame["segment"], string> = { hook: "HOOK", body: "BODY", endcard: "END" };

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = pct >= 66 ? "bg-emerald-500" : pct >= 33 ? "bg-amber-500" : "bg-slate-400";
  return (
    <span className={`${cls} text-white text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums`} title="Kazanan skoru">
      {pct}
    </span>
  );
}

// ─── Hook × Body matrix ──────────────────────────────────────────────────────
function PairMatrix({
  report,
  selected,
  onSelect,
}: {
  report: CreativeReport;
  selected: { hook: string; body: string } | null;
  onSelect: (p: { hook: string; body: string } | null) => void;
}) {
  const hooks = report.summary.hooks.map((h) => h.type);
  const bodies = report.summary.bodies.map((b) => b.type);
  const cell = new Map(report.summary.pairs.map((p) => [`${p.hook}|${p.body}`, p]));
  const maxW = Math.max(0.01, ...report.summary.pairs.map((p) => p.weight));

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-slate-400 font-normal pr-2">hook ↓ / body →</th>
            {bodies.map((b) => (
              <th key={b} className="font-medium text-slate-600 px-1 min-w-[84px] align-bottom">
                {tr(b)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hooks.map((h) => (
            <tr key={h}>
              <td className="font-medium text-slate-600 pr-2 whitespace-nowrap">{tr(h)}</td>
              {bodies.map((b) => {
                const p = cell.get(`${h}|${b}`);
                const isSel = selected?.hook === h && selected?.body === b;
                if (!p) return <td key={b} className="h-10 rounded bg-slate-50" />;
                const alpha = 0.15 + 0.85 * (p.weight / maxW);
                return (
                  <td key={b} className="p-0">
                    <button
                      onClick={() => onSelect(isSel ? null : { hook: h, body: b })}
                      className={`w-full h-10 rounded text-center leading-tight transition ${
                        isSel ? "ring-2 ring-slate-900" : ""
                      }`}
                      style={{ backgroundColor: `rgba(124,58,237,${alpha})`, color: alpha > 0.55 ? "white" : "#3b0764" }}
                      title={`${p.count} reklam · ağırlık ${p.weight} · lift ${p.lift} · ort. ${p.avgDays} gün`}
                    >
                      <div className="font-bold">{p.count}</div>
                      <div className="text-[9px] opacity-80">lift {p.lift}</div>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-400 mt-2">
        Renk koyuluğu = kazanan skoru ağırlığı. <b>Lift &gt; 1</b>: bu hook bu body ile, tek tek sıklıklarından
        beklenenden daha çok birlikte kullanılıyor (bilinçli eşleşme). Hücreye tıkla → reklamları filtrele.
      </p>
    </div>
  );
}

// ─── Single analyzed ad ─────────────────────────────────────────────────────
function AdCard({ brand, color, e }: { brand: string; color: string; e: Entry }) {
  const a = e.analysis;
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-slate-800 truncate">{brand}</span>
          <ScoreBadge score={e.score} />
        </div>
        <a
          href={e.libraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1 shrink-0"
        >
          {e.libraryId} <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {e.frames.map((f, i) => (
          <figure key={i} className="shrink-0 w-[72px]">
            <img
              src={f.src}
              alt={`${f.segment} ${f.t}s`}
              loading="lazy"
              className={`w-[72px] h-[128px] object-cover rounded border-2 ${
                f.segment === "hook" ? "border-violet-400" : f.segment === "body" ? "border-sky-300" : "border-amber-300"
              }`}
            />
            <figcaption className="text-[9px] text-slate-500 text-center mt-0.5 tabular-nums">
              {SEG_LABEL[f.segment]} {f.t.toFixed(1)}s
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{e.daysRunning} gün yayında</span>
        <span>{e.variantCount} varyant</span>
        <span>{e.duration.toFixed(0)} sn</span>
        <span>{e.cutsPer10s.toFixed(1)} kesme/10sn</span>
        <span>{tr(a.authenticity)} gameplay</span>
        {a.humanPresence && <span>insan var</span>}
      </div>

      <div className="space-y-1.5 text-xs">
        <p>
          <span className="font-semibold text-violet-700">Hook · {tr(a.hook.type)}:</span>{" "}
          <span className="text-slate-700">{a.hook.description}</span>
          {a.hook.textOverlay && <span className="text-slate-500"> — “{a.hook.textOverlay}”</span>}
        </p>
        <p>
          <span className="font-semibold text-sky-700">Body · {tr(a.body.type)}:</span>{" "}
          <span className="text-slate-700">{a.body.description}</span>
        </p>
        <p>
          <span className="font-semibold text-amber-700">End · {tr(a.endcard.type)}:</span>{" "}
          <span className="text-slate-700">{a.endcard.description}</span>
        </p>
        <p className="text-slate-500 italic">{a.hookBodyLink}</p>
        {a.pattern && (
          <p className="bg-slate-50 rounded px-2 py-1 text-slate-700 font-medium">{a.pattern}</p>
        )}
      </div>
    </div>
  );
}

function conceptToText(c: Concept): string {
  const beats = c.beats.map((b) => `  ${b.time}: ${b.visual}${b.text ? ` | Yazı: "${b.text}"` : ""}`).join("\n");
  return `${c.title}
Hook (${tr(c.hook.type)}): ${c.hook.script}
Body (${tr(c.body.type)}): ${c.body.script}
End card: ${c.endcard}
Akış:
${beats}
Referans: ${c.references.join(", ")}
Üretim: ${c.productionNotes}`;
}

// ─── Tab ─────────────────────────────────────────────────────────────────────
export default function CreativeTab({
  report,
  brandColors,
}: {
  report: CreativeReport;
  brandColors: Record<string, string>;
}) {
  const [selected, setSelected] = useState<{ hook: string; body: string } | null>(null);

  const entries = useMemo(
    () =>
      Object.entries(report.analyzed)
        .flatMap(([brand, list]) => list.map((e) => ({ brand, e })))
        .sort((x, y) => y.e.score - x.e.score),
    [report]
  );
  const visible = selected
    ? entries.filter((x) => x.e.analysis.hook.type === selected.hook && x.e.analysis.body.type === selected.body)
    : entries;

  if (report.skipped || report.summary.analyzedCount === 0) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-100 text-sm text-slate-500">
        Kreatif analizi yapılamadı: {report.skipped ?? "hiçbir video işlenemedi"}
        {report.failures > 0 && ` (${report.failures} video hata verdi)`}
      </div>
    );
  }

  const syn = report.synthesis;

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Analiz edilen video", value: report.summary.analyzedCount },
          { label: "En sık hook", value: tr(report.summary.hooks[0]?.type ?? "-") },
          { label: "En sık body", value: tr(report.summary.bodies[0]?.type ?? "-") },
          {
            label: "En güçlü eşleşme",
            value: report.summary.pairs[0]
              ? `${tr(report.summary.pairs[0].hook)} × ${tr(report.summary.pairs[0].body)}`
              : "-",
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
            <p className="text-[11px] text-slate-400">{s.label}</p>
            <p className="text-sm font-bold text-slate-800 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Playbook */}
      {syn && syn.playbook.length > 0 && (
        <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-violet-500" /> Hook–Body Playbook
          </h3>
          <div className="space-y-2.5">
            {syn.playbook.map((p, i) => (
              <div key={i} className="border-l-2 border-violet-300 pl-3">
                <p className="text-sm font-medium text-slate-800">{p.pattern}</p>
                <p className="text-xs text-slate-500 mt-0.5">{p.why}</p>
                {p.evidence.length > 0 && (
                  <p className="text-[10px] text-slate-400 mt-0.5">Kanıt: {p.evidence.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
          {(syn.hookInsights.length > 0 || syn.gaps.length > 0) && (
            <div className="grid md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5">İlk 3 saniye</p>
                <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
                  {syn.hookInsights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Boşluklar / fırsatlar
                </p>
                <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
                  {syn.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Matrix */}
      <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">Hook × Body Matrisi</h3>
        <PairMatrix report={report} selected={selected} onSelect={setSelected} />
      </div>

      {/* Concepts */}
      {syn && syn.concepts.length > 0 && (
        <div className="bg-white rounded-xl p-5 border border-slate-100 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" /> Bizim oyun için konseptler
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            {syn.concepts.map((c, i) => (
              <div key={i} className="rounded-lg border border-violet-100 bg-violet-50/30 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{c.title}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(conceptToText(c));
                      toast.success("Konsept kopyalandı");
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-xs">
                  <b className="text-violet-700">Hook ({tr(c.hook.type)}):</b> {c.hook.script}
                </p>
                <p className="text-xs">
                  <b className="text-sky-700">Body ({tr(c.body.type)}):</b> {c.body.script}
                </p>
                <p className="text-xs">
                  <b className="text-amber-700">End:</b> {c.endcard}
                </p>
                {c.beats.length > 0 && (
                  <table className="w-full text-[11px] mt-1">
                    <tbody>
                      {c.beats.map((b, j) => (
                        <tr key={j} className="align-top border-t border-violet-100">
                          <td className="py-1 pr-2 font-mono text-slate-500 whitespace-nowrap">{b.time}</td>
                          <td className="py-1 pr-2 text-slate-700">{b.visual}</td>
                          <td className="py-1 text-slate-500 italic">{b.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-[11px] text-slate-500">{c.productionNotes}</p>
                {c.references.length > 0 && (
                  <p className="text-[10px] text-slate-400">Referans: {c.references.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ads */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Film className="w-4 h-4 text-slate-400" />
            Analiz edilen reklamlar {selected && `· ${tr(selected.hook)} × ${tr(selected.body)}`} ({visible.length})
          </h3>
          {selected && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>
              Filtreyi kaldır
            </Button>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {visible.map(({ brand, e }) => (
            <AdCard key={`${brand}-${e.libraryId}`} brand={brand} color={brandColors[brand] ?? "#64748b"} e={e} />
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400">
        Model: {report.model} · {new Date(report.generatedAt).toLocaleString("tr-TR")}
        {report.failures > 0 && ` · ${report.failures} video işlenemedi`}
      </p>
    </div>
  );
}
