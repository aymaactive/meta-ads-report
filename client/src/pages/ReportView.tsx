import { useState, type ReactNode } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, Copy, FileDown, Sparkles, Lightbulb, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import CreativeTab, { type CreativeReport } from "@/components/CreativeTab";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AdData {
  id: string;
  libraryId: string;
  body: string;
  startDate: string;
  daysRunning: number;
  cta: string;
  platforms: string[];
  format: string;
  libraryUrl: string;
  thumbnail?: string;
}

interface BrandInsight {
  angles: { name: string; count: number; example?: string }[];
  hooks: { name: string; count: number }[];
  tone: string;
}

interface ReportInsights {
  summary: string;
  keyInsights: string[];
  recommendations: string[];
  brands: Record<string, BrandInsight>;
  generatedAt: string;
  model: string;
}

interface BrandData {
  name: string;
  color: string;
  url: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatMonth(key: string) {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ComparisonTab({ brands }: { brands: BrandData[] }) {
  const barData = brands.map((b) => ({
    name: b.name,
    "Toplam Reklam": b.totalAds,
    Video: b.videoCount,
    Görsel: b.staticCount,
  }));

  // Normalize each metric to 0-100 so different scales (ad counts vs. diversity
  // counts) don't visually mislead on the same radar.
  const normalize = (values: number[]) => {
    const max = Math.max(...values, 1);
    return values.map((v) => Math.round((v / max) * 100));
  };
  const metrics: { subject: string; values: number[] }[] = [
    { subject: "Toplam Reklam", values: brands.map((b) => b.totalAds) },
    { subject: "Video", values: brands.map((b) => b.videoCount) },
    { subject: "Görsel", values: brands.map((b) => b.staticCount) },
    {
      subject: "Platform Çeşitliliği",
      values: brands.map((b) => Object.values(b.platformCounts).filter((v) => v > 0).length),
    },
    { subject: "CTA Çeşitliliği", values: brands.map((b) => Object.keys(b.ctaCounts).length) },
    {
      subject: "Ort. Yayın Süresi",
      values: brands.map((b) =>
        b.ads.length ? Math.round(b.ads.reduce((sum, a) => sum + a.daysRunning, 0) / b.ads.length) : 0
      ),
    },
  ];
  const radarData = metrics.map((m) => {
    const norm = normalize(m.values);
    return {
      subject: m.subject,
      ...Object.fromEntries(brands.map((b, i) => [b.name, norm[i]])),
    };
  });

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-4">Reklam Sayısı Karşılaştırması</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="Toplam Reklam" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Video" fill="#6366f1" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Görsel" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-1">Çok Boyutlu Karşılaştırma</h3>\n        <p className="text-xs text-slate-400 mb-4">Her eksen kendi içinde 0-100 normalize edilmiştir (100 = o metrikte lider marka)</p>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={radarData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
            {brands.map((b) => (
              <Radar
                key={b.name}
                name={b.name}
                dataKey={b.name}
                stroke={b.color}
                fill={b.color}
                fillOpacity={0.2}
              />
            ))}
            <Legend />
            <Tooltip />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {brands.map((b) => (
          <div
            key={b.name}
            className="bg-white rounded-xl p-5 shadow-sm border-l-4"
            style={{ borderLeftColor: b.color }}
          >
            <h4 className="font-bold text-slate-900 text-lg">{b.name}</h4>
            <div className="mt-3 space-y-1.5 text-sm text-slate-600">
              <div className="flex justify-between">
                <span>Analiz Edilen Reklam</span>
                <span className="font-semibold text-slate-900">{b.totalAds}</span>
              </div>
              {b.reportedTotal !== null && (
                <div className="flex justify-between">
                  <span>Kütüphane Toplamı</span>
                  <span className="font-semibold text-slate-500">≈{b.reportedTotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Video</span>
                <span className="font-semibold text-slate-900">{b.videoCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Görsel/Carousel</span>
                <span className="font-semibold text-slate-900">{b.staticCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformsTab({ brands }: { brands: BrandData[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {brands.map((b) => {
        const data = Object.entries(b.platformCounts)
          .filter(([, v]) => v > 0)
          .map(([name, value]) => ({ name, value }));
        const COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ec4899"];
        return (
          <div
            key={b.name}
            className="bg-white rounded-xl p-5 shadow-sm border border-slate-100"
          >
            <h4
              className="font-semibold text-slate-800 mb-4 pb-2 border-b-2"
              style={{ borderColor: b.color }}
            >
              {b.name}
            </h4>
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) =>
                      `${name} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center text-slate-400 py-8 text-sm">Platform verisi yok</div>
            )}
            <div className="mt-2 space-y-1">
              {data.map(({ name, value }, i) => (
                <div key={name} className="flex justify-between text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    {name}
                  </span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthlyTrendsTab({ brands }: { brands: BrandData[] }) {
  // Collect all months
  const allMonths = Array.from(
    new Set(brands.flatMap((b) => Object.keys(b.monthlyTrend)))
  ).sort();

  const data = allMonths.map((month) => ({
    month: formatMonth(month),
    ...Object.fromEntries(brands.map((b) => [b.name, b.monthlyTrend[month] || 0])),
  }));

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <h3 className="font-semibold text-slate-800 mb-4">Aylık Reklam Trendi</h3>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {brands.map((b) => (
              <Line
                key={b.name}
                type="monotone"
                dataKey={b.name}
                stroke={b.color}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="text-center text-slate-400 py-12">Trend verisi yok</div>
      )}
    </div>
  );
}

function AdDurationTab({ brands }: { brands: BrandData[] }) {
  return (
    <div className="space-y-6">
      {brands.map((b) => {
        const topAds = [...b.ads]
          .sort((a, z) => z.daysRunning - a.daysRunning)
          .slice(0, 20);
        return (
          <div key={b.name} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h4
              className="font-semibold text-slate-800 mb-4 pb-2 border-b-2"
              style={{ borderColor: b.color }}
            >
              {b.name} — En Uzun Süren Reklamlar
            </h4>
            {topAds.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="pb-2 pr-4">Library ID</th>
                      <th className="pb-2 pr-4">Başlangıç</th>
                      <th className="pb-2 pr-4">Süre (gün)</th>
                      <th className="pb-2 pr-4">CTA</th>
                      <th className="pb-2">İçerik</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAds.map((ad) => (
                      <tr key={ad.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 pr-4">
                          <a
                            href={ad.libraryUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline font-mono text-xs"
                          >
                            {ad.libraryId}
                          </a>
                        </td>
                        <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">{ad.startDate}</td>
                        <td className="py-2 pr-4">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                            style={{ backgroundColor: b.color }}
                          >
                            {ad.daysRunning} gün
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-slate-600">{ad.cta}</td>
                        <td className="py-2 text-slate-600 max-w-xs truncate">{ad.body}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center text-slate-400 py-6 text-sm">Reklam verisi yok</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CTAAnalysisTab({ brands }: { brands: BrandData[] }) {
  const allCTAs = Array.from(new Set(brands.flatMap((b) => Object.keys(b.ctaCounts))));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 overflow-x-auto">
        <h3 className="font-semibold text-slate-800 mb-4">CTA Karşılaştırma Tablosu</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="pb-2 pr-6">CTA</th>
              {brands.map((b) => (
                <th key={b.name} className="pb-2 pr-6">
                  <span
                    className="px-2 py-0.5 rounded-full text-white text-xs"
                    style={{ backgroundColor: b.color }}
                  >
                    {b.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allCTAs.map((cta) => (
              <tr key={cta} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-2 pr-6 font-medium text-slate-700">{cta}</td>
                {brands.map((b) => (
                  <td key={b.name} className="py-2 pr-6 text-slate-600">
                    {b.ctaCounts[cta] || 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {brands.map((b) => {
          const topCTA = Object.entries(b.ctaCounts).sort((a, z) => z[1] - a[1])[0];
          return (
            <div
              key={b.name}
              className="bg-white rounded-xl p-5 shadow-sm border-l-4"
              style={{ borderLeftColor: b.color }}
            >
              <h4 className="font-semibold text-slate-800">{b.name}</h4>
              <p className="text-xs text-slate-500 mt-1">En çok kullanılan CTA</p>
              <p className="text-2xl font-bold mt-2" style={{ color: b.color }}>
                {topCTA ? topCTA[0] : "—"}
              </p>
              {topCTA && (
                <p className="text-xs text-slate-500 mt-1">{topCTA[1]} reklamda kullanılmış</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdExamplesTab({ brands }: { brands: BrandData[] }) {
  return (
    <div className="space-y-6">
      {brands.map((b) => (
        <div key={b.name} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h4
            className="font-semibold text-slate-800 mb-4 pb-2 border-b-2"
            style={{ borderColor: b.color }}
          >
            {b.name} — Reklam Örnekleri
          </h4>
          {b.ads.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {b.ads.slice(0, 20).map((ad) => (
                <div
                  key={ad.id}
                  className="border border-slate-100 rounded-lg p-3 hover:border-slate-200 transition-colors"
                >
                  {ad.thumbnail && (
                    <a href={ad.libraryUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={ad.thumbnail}
                        alt={`${b.name} reklam kreatifi`}
                        className="w-full max-h-72 object-contain object-top rounded-md mb-3 bg-slate-50 border border-slate-100"
                      />
                    </a>
                  )}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                      style={{ backgroundColor: b.color }}
                    >
                      {ad.cta}
                    </span>
                    <a
                      href={ad.libraryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline font-mono shrink-0"
                    >
                      #{ad.libraryId}
                    </a>
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-2">{ad.body}</p>
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
                    <span>{ad.startDate}</span>
                    <span>{ad.daysRunning} gün</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-slate-400 py-6 text-sm">Reklam verisi yok</div>
          )}
        </div>
      ))}
    </div>
  );
}

function RecommendationsTab({
  brands,
  insights,
}: {
  brands: BrandData[];
  insights: ReportInsights | null;
}) {
  const topBrand = [...brands].sort((a, z) => z.totalAds - a.totalAds)[0];
  const mostVideoBrand = [...brands].sort((a, z) => z.videoCount - a.videoCount)[0];

  // ── AI-powered version ──
  if (insights) {
    return (
      <div className="space-y-4">
        {/* Key insights */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-500" />
            Temel Bulgular
          </h3>
          <div className="space-y-3">
            {insights.keyInsights.map((insight, i) => (
              <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center shrink-0 font-bold">
                  {i + 1}
                </span>
                <p className="text-sm text-slate-700 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Per-brand angle & hook breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {brands.map((b) => {
            const bi = insights.brands[b.name];
            if (!bi) return null;
            return (
              <div
                key={b.name}
                className="bg-white rounded-xl p-5 shadow-sm border-t-4"
                style={{ borderTopColor: b.color }}
              >
                <h4 className="font-bold text-slate-900">{b.name}</h4>
                {bi.tone && <p className="text-xs text-slate-500 mt-1 italic">{bi.tone}</p>}
                {bi.angles?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      Reklam Açıları
                    </p>
                    <div className="space-y-2">
                      {bi.angles.map((a, i) => (
                        <div key={i} className="text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-700">{a.name}</span>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                              style={{ backgroundColor: b.color }}
                            >
                              {a.count}
                            </span>
                          </div>
                          {a.example && (
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                              "{a.example}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bi.hooks?.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      Hook Tipleri
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {bi.hooks.map((h, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600"
                        >
                          {h.name} · {h.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recommendations */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            Stratejik Öneriler
          </h3>
          <div className="space-y-3">
            {insights.recommendations.map((rec, i) => (
              <div key={i} className="flex gap-3 p-3 bg-amber-50/60 rounded-lg border border-amber-100">
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs flex items-center justify-center shrink-0 font-bold">
                  {i + 1}
                </span>
                <p className="text-sm text-slate-700 leading-relaxed">{rec}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-300 mt-4">
            Bu analiz yapay zekâ ile üretilmiştir ({insights.model}).
          </p>
        </div>
      </div>
    );
  }

  // ── Heuristic fallback (no API key configured) ──
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-4">Temel Bulgular</h3>
        <div className="space-y-3">
          {topBrand && (
            <div className="flex gap-3 p-3 bg-emerald-50 rounded-lg border border-emerald-100">
              <div
                className="w-1 rounded-full shrink-0"
                style={{ backgroundColor: topBrand.color }}
              />
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{topBrand.name}</span>, {topBrand.totalAds} aktif
                reklam ile en yüksek reklam hacmine sahip marka.
              </p>
            </div>
          )}
          {mostVideoBrand && mostVideoBrand.videoCount > 0 && (
            <div className="flex gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div
                className="w-1 rounded-full shrink-0"
                style={{ backgroundColor: mostVideoBrand.color }}
              />
              <p className="text-sm text-slate-700">
                <span className="font-semibold">{mostVideoBrand.name}</span>, {mostVideoBrand.videoCount}{" "}
                video reklamla video içeriğe en çok yatırım yapan marka.
              </p>
            </div>
          )}
          {brands.map((b) => {
            const topCTA = Object.entries(b.ctaCounts).sort((a, z) => z[1] - a[1])[0];
            if (!topCTA) return null;
            return (
              <div key={b.name} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <p className="text-sm text-slate-700">
                  <span className="font-semibold">{b.name}</span> en çok{" "}
                  <span className="font-semibold">"{topCTA[0]}"</span> CTA'sını kullanıyor (
                  {topCTA[1]} reklam).
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-800 mb-4">Stratejik Öneriler</h3>
        <div className="space-y-3">
          {[
            "Video içerik oranını artırın — video reklamlar genellikle daha yüksek etkileşim sağlar.",
            "Rakiplerin uzun süre yayında kalan reklamlarını inceleyin — bunlar en iyi performans gösteren içeriklerdir.",
            "Farklı CTA'ları A/B test edin — rakiplerin kullandığı CTA'ları kendi stratejinizle karşılaştırın.",
            "Platforma özgü içerik üretin — Instagram ve Facebook için ayrı formatlar deneyin.",
            "Mevsimsel trendleri takip edin — aylık trend grafiğine göre reklam bütçenizi optimize edin.",
          ].map((rec, i) => (
            <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
              <span className="w-6 h-6 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center shrink-0 font-bold">
                {i + 1}
              </span>
              <p className="text-sm text-slate-700">{rec}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Captions Tab — tüm caption'lar bir arada ────────────────────────────────
function CaptionsTab({ brands }: { brands: BrandData[] }) {
  const [activeBrand, setActiveBrand] = useState<string>("all");

  const visibleBrands =
    activeBrand === "all" ? brands : brands.filter((b) => b.name === activeBrand);

  // Flatten all captions across the selected brand(s)
  const allCaptions = visibleBrands.flatMap((b) =>
    b.ads.map((ad) => ({
      brandName: b.name,
      color: b.color,
      source: b.source,
      libraryId: ad.libraryId,
      libraryUrl: ad.libraryUrl,
      body: ad.body,
      startDate: ad.startDate,
      cta: ad.cta,
    }))
  );

  const copyOne = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Caption kopyalandı");
  };

  const copyAll = () => {
    const text = allCaptions
      .map((c) => `[${c.brandName}] ${c.body}`)
      .join("\n\n———\n\n");
    navigator.clipboard.writeText(text);
    toast.success(`${allCaptions.length} caption kopyalandı`);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveBrand("all")}
            className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
              activeBrand === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Tümü ({brands.reduce((s, b) => s + b.ads.length, 0)})
          </button>
          {brands.map((b) => (
            <button
              key={b.name}
              onClick={() => setActiveBrand(b.name)}
              className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                activeBrand === b.name
                  ? "text-white border-transparent"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
              style={activeBrand === b.name ? { backgroundColor: b.color } : {}}
            >
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: b.color }}
              />
              {b.name} ({b.ads.length})
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={copyAll} className="gap-1.5 h-8 text-xs">
          <Copy className="w-3 h-3" />
          Tümünü Kopyala
        </Button>
      </div>

      {/* Caption grid */}
      {allCaptions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {allCaptions.map((c, i) => (
            <div
              key={`${c.brandName}-${c.libraryId}-${i}`}
              className="group bg-white rounded-xl border border-slate-100 p-4 shadow-sm hover:border-slate-200 transition-colors flex flex-col"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full text-white font-medium flex items-center gap-1.5"
                  style={{ backgroundColor: c.color }}
                >
                  {c.brandName}
                  <span className="opacity-70 uppercase">{c.source === "tiktok" ? "TT" : "Meta"}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-slate-400">{c.cta}</span>
                  <button
                    onClick={() => copyOne(c.body)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700"
                    title="Kopyala"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed flex-1">
                {c.body}
              </p>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-50 text-[11px] text-slate-400">
                <span>{c.startDate || "—"}</span>
                {c.libraryUrl ? (
                  <a
                    href={c.libraryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline font-mono"
                  >
                    #{c.libraryId}
                  </a>
                ) : (
                  <span className="font-mono">#{c.libraryId}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-slate-400 py-12 bg-white rounded-xl border border-slate-100">
          Caption verisi yok
        </div>
      )}
    </div>
  );
}

// ─── AI summary banner ────────────────────────────────────────────────────────
function InsightsSummary({ insights }: { insights: ReportInsights | null }) {
  if (!insights?.summary) return null;
  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 p-4">
      <div className="flex gap-3">
        <Sparkles className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">
            AI Özeti
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">{insights.summary}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Scrape coverage notice (reklam adedi uyuşmazlığı) ────────────────────────
function ScrapeNotice({ brands }: { brands: BrandData[] }) {
  const hasReported = brands.some((b) => b.reportedTotal !== null);
  if (!hasReported) return null;

  // Only warn when at least one brand's library reports more ads than we scraped.
  const partial = brands.filter(
    (b) => b.reportedTotal !== null && b.reportedTotal > b.totalAds
  );
  if (partial.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <p className="font-semibold mb-1">Reklam adedi hakkında</p>
      <p className="leading-relaxed">
        Raporlardaki sayılar, kütüphanenin gösterdiği toplam reklam sayısı değil,
        analiz için çekilen örneklem adedidir (rapor oluşturulurken seçilen marka başı limit kadar).
      </p>
      <ul className="mt-2 space-y-0.5">
        {partial.map((b) => (
          <li key={b.name} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: b.color }} />
            <span className="font-medium">{b.name}:</span> {b.totalAds} reklam analiz edildi
            <span className="text-amber-600"> · kütüphane ≈{b.reportedTotal} reklam bildiriyor</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


export default function ReportView() {
  const params = useParams<{ shareToken: string }>();
  const shareToken = params.shareToken;

  const { data: report, isLoading, error } = trpc.reports.getByShareToken.useQuery(
    shareToken ?? "",
    { enabled: !!shareToken }
  );

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link kopyalandı!");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-slate-500 mb-4">Rapor bulunamadı</p>
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Ana Sayfaya Dön
          </Button>
        </div>
      </div>
    );
  }

  // Parse report data — normalize old and new scraper formats
  const rawData = report.reportData as Record<string, any>;
  const insights: ReportInsights | null =
    rawData.__insights && typeof rawData.__insights === "object"
      ? (rawData.__insights as ReportInsights)
      : null;
  const creative: CreativeReport | null =
    rawData.__creative && typeof rawData.__creative === "object"
      ? (rawData.__creative as CreativeReport)
      : null;
  const brands: BrandData[] = Object.entries(rawData)
    .filter(([key]) => !key.startsWith("__"))
    .map(([, b]: [string, any]) => ({
    name: b.name || b.brandName || "Unknown",
    color: b.color || "#10b981",
    url: b.url || "",
    brandName: b.brandName || b.name || "Unknown",
    pageId: b.pageId || "",
    source: b.source === "tiktok" ? "tiktok" : "meta",
    totalAds: b.totalAds || 0,
    reportedTotal: typeof b.reportedTotal === "number" ? b.reportedTotal : null,
    ads: (b.ads || []).map((ad: any) => ({
      id: ad.id || "",
      libraryId: ad.libraryId || ad.id || "",
      body: ad.body || ad.title || "",
      startDate: ad.startDate || "",
      daysRunning: ad.daysRunning ?? ad.days ?? 0,
      cta: ad.cta || "Shop Now",
      platforms: ad.platforms || ["Facebook", "Instagram"],
      format: ad.format || "Image",
      libraryUrl: ad.libraryUrl || (ad.libraryId ? `https://www.facebook.com/ads/library/?id=${ad.libraryId}` : ""),
      thumbnail: typeof ad.thumbnail === "string" ? ad.thumbnail : undefined,
    })),
    platformCounts: b.platformCounts || b.platforms || { Facebook: 0, Instagram: 0, Messenger: 0, "Audience Network": 0 },
    videoCount: b.videoCount || 0,
    staticCount: b.staticCount || 0,
    ctaCounts: b.ctaCounts || {},
    monthlyTrend: b.monthlyTrend || {},
  }));

  const isPrint =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("print");

  const sections: { value: string; label: string; node: ReactNode }[] = [
    { value: "comparison", label: "Karşılaştırma", node: <ComparisonTab brands={brands} /> },
    ...(creative
      ? [
          {
            value: "creative",
            label: "Hook × Body",
            node: (
              <CreativeTab
                report={creative}
                brandColors={Object.fromEntries(brands.map((b) => [b.name, b.color]))}
              />
            ),
          },
        ]
      : []),
    { value: "captions", label: "Caption'lar", node: <CaptionsTab brands={brands} /> },
    { value: "platforms", label: "Platformlar", node: <PlatformsTab brands={brands} /> },
    { value: "monthly", label: "Aylık Trend", node: <MonthlyTrendsTab brands={brands} /> },
    { value: "duration", label: "Süre", node: <AdDurationTab brands={brands} /> },
    { value: "cta", label: "CTA Analizi", node: <CTAAnalysisTab brands={brands} /> },
    { value: "examples", label: "Örnekler", node: <AdExamplesTab brands={brands} /> },
    {
      value: "recommendations",
      label: "Öneriler",
      node: <RecommendationsTab brands={brands} insights={insights} />,
    },
  ];

  // ── Print / PDF layout: all sections stacked, no app chrome ──
  if (isPrint) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="border-b-2 border-slate-900 pb-5 mb-8">
            <h1 className="text-2xl font-bold text-slate-900">{report.reportName}</h1>
            <p className="text-sm text-slate-500 mt-1">
              Reklam Kütüphanesi İstihbarat Raporu ·{" "}
              {new Date(report.createdAt).toLocaleDateString("tr-TR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <div className="flex gap-1.5 mt-3">
              {brands.map((b) => (
                <span
                  key={b.name}
                  className="px-2.5 py-1 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: b.color }}
                >
                  {b.name}
                </span>
              ))}
            </div>
          </div>
          <InsightsSummary insights={insights} />
          <ScrapeNotice brands={brands} />
          {sections.map((sec) => (
            <section key={sec.value} className="mb-10" style={{ breakInside: "avoid" }}>
              <h2 className="text-lg font-bold text-slate-900 mb-4 pb-2 border-b border-slate-200">
                {sec.label}
              </h2>
              {sec.node}
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (window.location.href = "/")}
              className="gap-1.5 text-slate-500"
            >
              <ArrowLeft className="w-4 h-4" />
              Geri
            </Button>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{report.reportName}</h1>
              <p className="text-xs text-slate-500">
                {new Date(report.createdAt).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {brands.length} marka
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex gap-1.5">
              {brands.map((b) => (
                <span
                  key={b.name}
                  className="px-2.5 py-1 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: b.color }}
                >
                  {b.name}
                </span>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="gap-1.5 ml-2"
            >
              <Copy className="w-3.5 h-3.5" />
              Paylaş
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-1.5"
            >
              <a href={`/api/report-pdf/${shareToken}`} target="_blank" rel="noopener noreferrer">
                <FileDown className="w-3.5 h-3.5" />
                PDF
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <main className="container py-6">
        <InsightsSummary insights={insights} />
        <ScrapeNotice brands={brands} />
        <Tabs defaultValue="comparison" className="w-full">
          <TabsList className="flex flex-wrap w-full mb-6 bg-white border border-slate-200 p-1 rounded-lg h-auto gap-1">
            {sections.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex-1 min-w-[110px] text-xs py-1.5 data-[state=active]:bg-emerald-500 data-[state=active]:text-white"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((sec) => (
            <TabsContent key={sec.value} value={sec.value}>
              {sec.node}
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
