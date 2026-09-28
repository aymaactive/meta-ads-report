# Meta Ads Report — Deploy Rehberi

## Railway ile Deploy (Önerilen)

### 1. Gereksinimler
- [Railway](https://railway.app) hesabı (GitHub ile giriş yapabilirsiniz)
- Bu projeyi GitHub'a push etmiş olmanız

### 2. Adımlar

**a) GitHub'a push edin:**
```bash
cd meta-ads-report
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/KULLANICI_ADINIZ/meta-ads-report.git
git push -u origin main
```

**b) Railway'de yeni proje oluşturun:**
1. https://railway.app adresine gidin
2. "New Project" → "Deploy from GitHub repo" seçin
3. Bu repo'yu seçin

**c) MySQL veritabanı ekleyin:**
1. Railway dashboard'da "+" butonuna tıklayın
2. "Database" → "MySQL" seçin
3. MySQL servisinin "Variables" sekmesinden `DATABASE_URL` değişkenini kopyalayın
4. Ana servisinizin "Variables" sekmesine gidin ve `DATABASE_URL` olarak yapıştırın

**d) Veritabanı tablolarını oluşturun:**
Railway shell'den veya lokal olarak:
```bash
# Railway CLI ile
railway run pnpm db:push
```

Veya MySQL client ile doğrudan SQL'leri çalıştırın:
- `drizzle/0000_material_menace.sql`
- `drizzle/0001_magical_absorbing_man.sql`

**e) Deploy otomatik başlayacaktır.** Birkaç dakika sonra URL'niz hazır olacak.

### 3. Ortam Değişkenleri

| Değişken | Açıklama | Zorunlu |
|----------|----------|---------|
| `DATABASE_URL` | MySQL bağlantı URL'si | Evet |
| `PORT` | Sunucu portu (Railway otomatik atar) | Hayır |
| `PUPPETEER_EXECUTABLE_PATH` | Chrome yolu (Dockerfile'da ayarlı) | Hayır |

### 4. Özel Domain (Opsiyonel)
Railway Settings → Networking → Custom Domain bölümünden kendi domain'inizi ekleyebilirsiniz.

---

## Render ile Deploy (Alternatif)

1. https://render.com → New Web Service → GitHub repo'nuzu bağlayın
2. Environment: Docker
3. `DATABASE_URL` env var ekleyin (harici MySQL gerekir)
4. Deploy

---

## Lokal Geliştirme

```bash
# Bağımlılıkları yükle
pnpm install

# MySQL'in çalıştığından emin ol
export DATABASE_URL="mysql://user:pass@localhost:3306/meta_ads"

# Tabloları oluştur
pnpm db:push

# Dev sunucuyu başlat
pnpm dev
```

Not: Lokal geliştirme için Chrome/Chromium yüklü olmalıdır.


---

## v2 Güncellemesi (Haziran 2026)

### Yeni özellikler
- **Job kuyruğu + canlı ilerleme:** Rapor oluşturma artık kuyruk üzerinden çalışır; arayüzde marka bazlı ilerleme çubuğu gösterilir. Aynı anda tek scrape çalışır (RAM güvenliği + doğal rate limit).
- **Kreatif thumbnail'ları:** Meta reklam kartlarının ekran görüntüsü (JPEG, data-URI) rapora gömülür — fbcdn URL'leri zamanla ölse de rapor bozulmaz. TikTok'ta kütüphanenin kendi thumbnail URL'i kullanılır.
- **AI içgörü katmanı:** `ANTHROPIC_API_KEY` tanımlıysa her rapor için Claude ile açı/hook analizi, temel bulgular ve stratejik öneriler üretilir (Öneriler sekmesi + üstte AI özeti). Key yoksa rapor normal şekilde, AI bloğu olmadan oluşur.
- **PDF export:** Rapor sayfasındaki "PDF" butonu `GET /api/report-pdf/:token` ile A4 PDF üretir (mevcut Chromium kullanılır, ek bağımlılık yok).
- **OG meta tag'leri:** Paylaşılan `/report/:token` linkleri Slack/WhatsApp'ta başlıklı önizleme ile açılır.
- **Güvenlik:** Scrape URL'leri sunucu tarafında facebook.com / library.tiktok.com ile sınırlandı (SSRF koruması). TR/EN locale tarih parsing düzeltildi; tek marka hatası artık tüm raporu düşürmez.

### Ortam değişkenleri
| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `DATABASE_URL` | Evet | Railway MySQL bağlantısı |
| `PUPPETEER_EXECUTABLE_PATH` | Hayır | Dockerfile'da `/usr/bin/chromium` olarak set ediliyor |
| `ANTHROPIC_API_KEY` | Hayır | AI içgörüleri için. Yoksa rapor AI'sız oluşur |
| `INSIGHTS_MODEL` | Hayır | Varsayılan: `claude-sonnet-4-6` |

### Yeniden deploy
```bash
git add .
git commit -m "v2: thumbnails, AI insights, job queue, PDF export"
git push
```
Railway push'u algılayıp Dockerfile ile otomatik build alır. Sonrasında ana servisin **Variables** sekmesine `ANTHROPIC_API_KEY` ekleyin (eklediğiniz anda servis yeniden başlar).

### Deploy sonrası doğrulama
1. `/` → 1 markayla rapor başlat, ilerleme çubuğunun aktığını gör.
2. Rapor açıldığında **Örnekler** sekmesinde thumbnail'lar görünüyor mu? (Görünmüyorsa Railway loglarında `[Scraper] Card detection found 0 cards` uyarısını ara — Meta layout değişmiş demektir, eski metin-parse yoluna düşer ama rapor yine oluşur.)
3. **Öneriler** sekmesinde AI analizi var mı? (Yoksa loglarda `[Insights]` satırlarına bak.)
4. **PDF** butonunu test et — ilk PDF ~10-15 sn sürebilir.


---

## v3 — Oyun kreatifi analizi (Eylül 2026, `feature/creative-analysis`)

### Yeni özellikler
- **Filtreler:** Ülke, sadece aktif, medya tipi (video/görsel), marka başı reklam limiti (1-100), **gösterime göre sıralama** (Meta'nın `total_impressions` sıralaması — kamuya açık en iyi "kazanan" sinyali). Filtreler yapıştırılan URL'nin üzerine sunucu tarafında uygulanır. Marka limiti 3 → 5.
- **Kazanan skoru (0-1):** yayın süresi + "N reklam bu kreatifi kullanıyor" varyant sayısı + gösterim sırası.
- **Kreatif analizi (opsiyonel, formda kutucuk):** Her markanın en yüksek skorlu video reklamları indirilir → ffmpeg ile hook (0.2/1/2/3 sn), body (4 kare) ve end card kareleri + kesme (tempo) tespiti → Claude vision ile oyun reklamı taksonomisine göre etiketleme → **Hook × Body matrisi** (lift ile) → playbook, ilk 3 sn gözlemleri, boşluklar.
- **Konsept üretici:** Formdaki "Bizim oyun" alanı doldurulursa, kanıtlanmış hook×body eşleşmelerine dayanan 5 adet saniye saniye video konsepti üretilir (kopyala butonu ile brief olarak alınır).
- **TR arayüz desteği:** Meta'nın güncel TR kart düzeni ("Kütüphane Kodu", "… tarihinde yayınlanmaya başladı", "Oyna") parse ediliyor.

### Ortam değişkenleri
| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `ANTHROPIC_API_KEY` | Kreatif analiz için evet | Yoksa rapor oluşur, kreatif sekmesi "atlandı" der |
| `CREATIVE_MODEL` | Hayır | Varsayılan `INSIGHTS_MODEL` → `claude-sonnet-4-6` |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Hayır | Dockerfile artık ffmpeg kuruyor |

### Maliyet / süre
- Reklam başına ~9 kare (360px) + ~1.2k çıktı token'ı; marka başı 12 video × 3 marka ≈ 36 vision çağrısı + 1 sentez çağrısı.
- Aynı anda 2 video işlenir; reklam başına ~20-40 sn.

### Bilinen sınırlar
- Video URL'leri imzalı ve kısa ömürlü — analiz scrape'ten hemen sonra yapılır; URL'ler rapora kaydedilmez.
- Kareler rapor JSON'una gömülü (base64). Çok büyük raporlarda S3/R2'ye taşınmalı (sonraki faz).
- Ses analiz edilmiyor (sadece var/yok bilgisi); voice-over/müzik analizi sonraki faz.
