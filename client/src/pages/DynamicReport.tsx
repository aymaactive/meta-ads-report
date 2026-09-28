import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Copy, ExternalLink, BarChart2, CheckCircle2, XCircle, Clock, Film } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const BRAND_COLORS = ["#10b981", "#ec4899", "#6366f1", "#f59e0b", "#0ea5e9"];
const MAX_BRANDS = 5;

type Filters = {
  maxAds: number;
  country: string;
  activeOnly: boolean;
  mediaType: "all" | "video" | "image";
  sortByImpressions: boolean;
};

type CreativeSettings = { enabled: boolean; maxPerBrand: number; gameContext: string };

const DEFAULT_FILTERS: Filters = {
  maxAds: 20,
  country: "ALL",
  activeOnly: true,
  mediaType: "all",
  sortByImpressions: true,
};

const COUNTRIES = ["ALL", "US", "PH", "TR", "GB", "DE", "BR", "IN"];
const STORAGE_KEY = "meta-ads-report-tokens";

function getSavedTokens(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToken(token: string) {
  const tokens = getSavedTokens();
  if (!tokens.includes(token)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([token, ...tokens]));
  }
}

function removeToken(token: string) {
  const tokens = getSavedTokens().filter((t) => t !== token);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

type Source = "meta" | "tiktok";

export default function DynamicReport() {
  const [brands, setBrands] = useState<Array<{ name: string; url: string; color: string; source: Source }>>([
    { name: "", url: "", color: BRAND_COLORS[0], source: "meta" },
  ]);
  const [isCreating, setIsCreating] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [creative, setCreative] = useState<CreativeSettings>({ enabled: false, maxPerBrand: 12, gameContext: "" });
  const [savedTokens, setSavedTokens] = useState<string[]>([]);

  useEffect(() => {
    setSavedTokens(getSavedTokens());
  }, []);

  const { data: savedReports, refetch: refetchReports } = trpc.reports.listByTokens.useQuery(
    savedTokens,
    { enabled: savedTokens.length > 0 }
  );

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const startJobMutation = trpc.reports.startScrapeJob.useMutation({
    onSuccess: (data) => setActiveJobId(data.jobId),
    onError: (err) => {
      toast.error(`Hata: ${err.message}`);
      setIsCreating(false);
    },
  });

  const { data: job } = trpc.reports.jobStatus.useQuery(
    { jobId: activeJobId ?? "" },
    { enabled: !!activeJobId, refetchInterval: 1500 }
  );

  useEffect(() => {
    if (!job) return;
    if (job.status === "done" && job.shareToken) {
      saveToken(job.shareToken);
      setSavedTokens(getSavedTokens());
      setTimeout(() => refetchReports(), 300);
      const summary = job.brands
        .filter((b) => b.status === "done")
        .map((b) => `${b.name}: ${b.adsCount ?? 0} reklam`)
        .join(", ");
      toast.success(`Rapor oluşturuldu! ${summary}`);
      const failedBrands = job.brands.filter((b) => b.status === "error");
      if (failedBrands.length > 0) {
        toast.warning(
          `Bazı markalar analiz edilemedi: ${failedBrands.map((b) => b.name).join(", ")}`
        );
      }
      setBrands([{ name: "", url: "", color: BRAND_COLORS[0], source: "meta" }]);
      setActiveJobId(null);
      setIsCreating(false);
      window.open(`/report/${job.shareToken}`, "_blank");
    } else if (job.status === "error") {
      toast.error(`Hata: ${job.error ?? "Bilinmeyen hata"}`);
      setActiveJobId(null);
      setIsCreating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.shareToken]);

  const deleteReportMutation = trpc.reports.delete.useMutation({
    onSuccess: (_, variables) => {
      removeToken(variables.shareToken);
      setSavedTokens(getSavedTokens());
      setTimeout(() => refetchReports(), 300);
      toast.success("Rapor silindi");
    },
  });

  const handleAddBrand = () => {
    if (brands.length < MAX_BRANDS) {
      setBrands([...brands, { name: "", url: "", color: BRAND_COLORS[brands.length], source: "meta" }]);
    } else {
      toast.error(`Maksimum ${MAX_BRANDS} marka ekleyebilirsiniz`);
    }
  };

  const handleRemoveBrand = (index: number) => {
    if (brands.length === 1) {
      toast.error("En az 1 marka gereklidir");
      return;
    }
    setBrands(brands.filter((_, i) => i !== index));
  };

  const handleBrandChange = (index: number, field: string, value: string) => {
    const updated = [...brands];
    updated[index] = { ...updated[index], [field]: value };
    setBrands(updated);
  };

  const handleCreate = async () => {
    if (brands.some((b) => !b.name.trim() || !b.url.trim())) {
      toast.error("Lütfen tüm marka adı ve URL alanlarını doldurun");
      return;
    }
    for (const brand of brands) {
      if (brand.source === "tiktok") {
        if (!brand.url.includes("library.tiktok.com")) {
          toast.error(`"${brand.name}" için geçerli bir TikTok Ads Library URL'si girin (library.tiktok.com)`);
          return;
        }
      } else {
        if (!brand.url.includes("facebook.com/ads/library")) {
          toast.error(`"${brand.name}" için geçerli bir Meta Ads Library URL'si girin`);
          return;
        }
      }
    }
    setIsCreating(true);
    startJobMutation.mutate({
      brands,
      filters,
      creative: creative.enabled
        ? {
            enabled: true,
            maxPerBrand: creative.maxPerBrand,
            ...(creative.gameContext.trim() ? { gameContext: creative.gameContext.trim() } : {}),
          }
        : undefined,
    });
  };

  const handleCopyShareLink = (shareToken: string) => {
    const shareUrl = `${window.location.origin}/report/${shareToken}`;
    navigator.clipboard.writeText(shareUrl);
    toast.success("Paylaşılabilir link kopyalandı!");
  };

  const handleViewReport = (shareToken: string) => {
    window.open(`/report/${shareToken}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8">
      <div className="container max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <BarChart2 className="w-8 h-8 text-emerald-500" />
            Meta Ads Raporu
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Meta ve TikTok Ads Library URL'lerini ekleyerek otomatik karşılaştırma raporu oluşturun
          </p>
        </div>

        {/* Brand Input Section */}
        <Card className="mb-6 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Marka Ekle</CardTitle>
            <CardDescription>
              1-5 marka arasında karşılaştırmalı rapor oluşturun. Marka adı ve Meta Ads Library URL'sini girin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {brands.map((brand, index) => (
              <div key={index} className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: brand.color }}
                    />
                    <span className="text-sm font-medium text-slate-700">Marka {index + 1}</span>
                  </div>
                  {brands.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveBrand(index)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 px-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Marka Adı</label>
                    <Input
                      placeholder="örn: Oysho"
                      value={brand.name}
                      onChange={(e) => handleBrandChange(index, "name", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">Renk</label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={brand.color}
                        onChange={(e) => handleBrandChange(index, "color", e.target.value)}
                        className="h-9 w-14 cursor-pointer rounded border border-slate-200 p-0.5"
                      />
                      <span className="text-xs text-slate-400 self-center">{brand.color}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Reklam Kütüphanesi</label>
                  <div className="flex gap-2">
                    {([
                      { key: "meta", label: "Meta (Facebook/Instagram)" },
                      { key: "tiktok", label: "TikTok" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => handleBrandChange(index, "source", opt.key)}
                        className={`flex-1 h-9 rounded-md border text-xs font-medium transition-colors ${
                          brand.source === opt.key
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {brand.source === "tiktok" && (
                    <p className="text-[11px] text-amber-600 mt-1.5 leading-snug">
                      Not: TikTok Ads Library yalnızca AB'de gösterilen reklamları kapsar.
                      Markanın Türkiye/global kampanyaları görünmeyebilir.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">
                    {brand.source === "tiktok" ? "TikTok Ads Library URL" : "Meta Ads Library URL"}
                  </label>
                  <Input
                    placeholder={
                      brand.source === "tiktok"
                        ? "https://library.tiktok.com/ads?...&advertiser_business_ids=..."
                        : "https://www.facebook.com/ads/library/?...&view_all_page_id=..."
                    }
                    value={brand.url}
                    onChange={(e) => handleBrandChange(index, "url", e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            ))}

            {/* Filters */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <span className="text-sm font-medium text-slate-700">Filtreler</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Ülke</label>
                  <select
                    value={filters.country}
                    onChange={(e) => setFilters({ ...filters, country: e.target.value })}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c === "ALL" ? "Tümü" : c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Medya</label>
                  <select
                    value={filters.mediaType}
                    onChange={(e) => setFilters({ ...filters, mediaType: e.target.value as Filters["mediaType"] })}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                  >
                    <option value="all">Tümü</option>
                    <option value="video">Video</option>
                    <option value="image">Görsel</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Marka başı reklam</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={filters.maxAds}
                    onChange={(e) =>
                      setFilters({ ...filters, maxAds: Math.max(1, Math.min(100, Number(e.target.value) || 20)) })
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex flex-col justify-end gap-1.5 text-xs text-slate-600">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={filters.activeOnly}
                      onChange={(e) => setFilters({ ...filters, activeOnly: e.target.checked })}
                    />
                    Sadece aktif
                  </label>
                  <label className="flex items-center gap-1.5" title="Meta: toplam gösterime göre sırala (kazanan sinyali)">
                    <input
                      type="checkbox"
                      checked={filters.sortByImpressions}
                      onChange={(e) => setFilters({ ...filters, sortByImpressions: e.target.checked })}
                    />
                    Gösterime göre sırala
                  </label>
                </div>
              </div>
            </div>

            {/* Creative (video) analysis */}
            <div
              className={`rounded-lg border p-4 space-y-3 ${
                creative.enabled ? "border-violet-300 bg-violet-50/40" : "border-slate-200"
              }`}
            >
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={creative.enabled}
                  onChange={(e) => {
                    setCreative({ ...creative, enabled: e.target.checked });
                    if (e.target.checked && filters.mediaType === "image") setFilters({ ...filters, mediaType: "video" });
                  }}
                />
                <Film className="w-4 h-4 text-violet-500" />
                Kreatif analizi (video hook / body / end card)
              </label>
              {creative.enabled && (
                <>
                  <p className="text-[11px] text-slate-500 leading-snug">
                    Her markanın en güçlü video reklamları (yayın süresi + varyant + gösterim sırası) indirilir, kare
                    kare AI ile incelenir ve hook × body eşleşmeleri çıkarılır. Reklam başına ~20-40 sn sürer.
                  </p>
                  <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">Marka başı video</label>
                      <Input
                        type="number"
                        min={1}
                        max={40}
                        value={creative.maxPerBrand}
                        onChange={(e) =>
                          setCreative({
                            ...creative,
                            maxPerBrand: Math.max(1, Math.min(40, Number(e.target.value) || 12)),
                          })
                        }
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1 block">
                        Bizim oyun (opsiyonel — doldurursan konsept önerileri üretilir)
                      </label>
                      <textarea
                        value={creative.gameContext}
                        onChange={(e) => setCreative({ ...creative, gameContext: e.target.value.slice(0, 2000) })}
                        rows={3}
                        placeholder="örn: Row Block — alttan renkli tile fırlatıp satır doldurma; yukarıdan inen tile grupları, roket/bomba power-up'ları, rakun maskot…"
                        className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                onClick={handleAddBrand}
                disabled={brands.length >= MAX_BRANDS}
                size="sm"
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Marka Ekle
              </Button>

              <Button
                onClick={handleCreate}
                disabled={isCreating}
                className="gap-2 flex-1 bg-emerald-500 hover:bg-emerald-600"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analiz ediliyor...
                  </>
                ) : (
                  "Rapor Oluştur"
                )}
              </Button>
            </div>

            {/* Live job progress */}
            {activeJobId && job && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-2.5">
                {job.status === "queued" && (
                  <p className="text-xs text-slate-600 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Sırada bekleniyor{job.queuePosition ? ` (sıra: ${job.queuePosition})` : ""}...
                  </p>
                )}
                {job.brands.map((b) => (
                  <div key={b.name} className="flex items-center gap-2.5">
                    {b.status === "done" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : b.status === "error" ? (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : b.status === "running" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-500 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-300 shrink-0" />
                    )}
                    <span className="text-sm font-medium text-slate-700 w-32 truncate">{b.name}</span>
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          b.status === "error" ? "bg-red-400" : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${
                            b.status === "done"
                              ? 100
                              : Math.min(95, Math.round(((b.scraped || 0) / (b.target || 20)) * 100))
                          }%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 w-14 text-right tabular-nums">
                      {b.status === "done"
                        ? `${b.adsCount ?? 0} reklam`
                        : b.status === "error"
                        ? "hata"
                        : `${b.scraped || 0}/${b.target || 20}`}
                    </span>
                  </div>
                ))}
                {job.status === "running" && job.phase === "creative" && (
                  <p className="text-xs text-slate-600 flex items-center gap-1.5 pt-1 border-t border-emerald-100">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Video kreatifler analiz ediliyor
                    {job.creative ? ` (${job.creative.done}/${job.creative.total})` : ""}...
                  </p>
                )}
                {job.status === "running" && job.phase === "insights" && (
                  <p className="text-xs text-slate-600 flex items-center gap-1.5 pt-1 border-t border-emerald-100">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    AI içgörüleri üretiliyor...
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reports List */}
        {savedTokens.length > 0 && (
          <Card className="bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Raporlarım</CardTitle>
            </CardHeader>
            <CardContent>
              {savedReports && savedReports.length > 0 ? (
                <div className="space-y-2">
                  {(savedReports as Array<{ id: number; reportName: string; shareToken: string; brandCount: number; createdAt: Date }>).map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <div>
                        <h4 className="font-medium text-slate-900 text-sm">{report.reportName}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {new Date(report.createdAt).toLocaleDateString("tr-TR", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}{" "}
                          · {report.brandCount} marka
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyShareLink(report.shareToken)}
                          className="gap-1.5 h-8 text-xs"
                        >
                          <Copy className="w-3 h-3" />
                          Paylaş
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleViewReport(report.shareToken)}
                          className="gap-1.5 h-8 text-xs bg-emerald-500 hover:bg-emerald-600"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Görüntüle
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            deleteReportMutation.mutate({ shareToken: report.shareToken })
                          }
                          className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
