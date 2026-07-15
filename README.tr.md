<div align="center">

# WatchBridge Sync

**Puanlar, izlenen/ilerleme durumu, izleme listeleri, yedekler ve güvenli tek ya da çift yönlü senkronizasyon için özgür/açık kaynak medya veri taşınabilirliği çalışma alanı.**

[![ci](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-0.1.0-0ea5e9)
![license](https://img.shields.io/github/license/Yunushan/watchbridge-sync)
![node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-f69220?logo=pnpm&logoColor=white)

![typeScript](https://img.shields.io/badge/TypeScript-core-3178c6?logo=typescript&logoColor=white)
![react](https://img.shields.io/badge/web-React%20%7C%20Vite-61dafb?logo=react&logoColor=111827)
![api](https://img.shields.io/badge/api-Node%20%7C%20Hono-111827)
![connectors](https://img.shields.io/badge/connectors-safe%20API%20%2F%20import%20%2F%20export-22c55e)

![language-en](https://img.shields.io/badge/README-English%20100%25-2563eb)
![language-tr](https://img.shields.io/badge/README-Turkish%20100%25-dc2626)
![language-fr](https://img.shields.io/badge/README-French%20100%25-7c3aed)
![language-de](https://img.shields.io/badge/README-German%20100%25-111827)

[English](README.md) - [Türkçe](README.tr.md) - [Français](README.fr.md) - [Deutsch](README.de.md)

[Hızlı Başlangıç](#hızlı-başlangıç) - [Özellikler](#özellikler) - [Desteklenen Servisler](#desteklenen-servisler) - [Güvenlik Modeli](#güvenlik-modeli) - [Mimari](#mimari) - [Katkı](#katkı) - [Lisans](#lisans)

</div>

WatchBridge Sync; film, dizi ve anime takip servisleri arasında kullanıcıya ait medya verilerini taşımak için tasarlanmış bir web/API/CLI çalışma alanıdır; gelecekteki istemciler için masaüstü ve mobil paketleme notları da içerir. Güvenli taşınabilirliğe odaklanır: mümkün olduğunda resmi API'ler, doğrudan yazma mümkün olmadığında kullanıcı kontrollü import/export dosyaları, dry-run önizlemeleri ve onaylanmış uzaktan yazmalardan önce kalıcı yerel yedekler.

Bu depo kanonik veri modeli, puan ölçeği dönüşümü, senkronizasyon planlayıcı, eksiksiz runtime destek ölçümleri, test edilmiş connector/dosya iş akışları, çalışan Node/Hono API, React/Vite web arayüzü, CLI ve platform paketleme notları içerir.

## Hızlı Başlangıç

```bash
corepack enable
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm dev
```

Kullanışlı komutlar:

```bash
pnpm --filter @watchbridge/core test
pnpm --filter @watchbridge/api dev
pnpm --filter @watchbridge/web dev
pnpm --filter @watchbridge/cli build
```

Onaylı bir connector senkronizasyonunu yerel API üzerinden bir istek dosyasıyla çalıştırın. `confirmWrite` açıkça `true` yapılmadıkça işlem dry-run olarak kalır:

```bash
watchbridge execute-sync sync-request.json
```

İstek alanları, çakışma politikaları ve onay kapısı için [Sync execution](docs/SYNC_EXECUTION.md) belgesine bakın. [OAuth setup](docs/OAUTH_SETUP.md), TMDb, Trakt, Simkl, MyAnimeList, Shikimori ve Annict yetkilendirme yardımcıları ile Bangumi, Jellyfin, Emby, Kodi ve Plex için çağıranın sağlaması gereken bağlamları açıklar.

Registry'den canlı üretilen yüzdeleri inceleyin veya özel dosya/yedek iş akışlarını kullanın:

```bash
watchbridge support-summary
watchbridge import-provider-files provider-files.json
watchbridge generate-letterboxd-files backup.json selection.json
watchbridge execute-backup-sync backup-sync-request.json
watchbridge recommend recommendation-request.json
```

## Özellikler

- Kanonik medya tipleri incelemeleri ve sosyal ilişkileri içerir; çalışan senkronizasyon tek yönlü ve capability-gated çift yönlü doğrudan hesap puanlarını, izlenen/ilerleme durumunu ve izleme listelerini kapsar. Çift yönlü izlenen uzlaştırması son durum odaklıdır; tam oynatma-olayı geçmişi birleştirmez.
- Seçilebilir, manuel, metadata, dosya, kısıtlı ve doğrudan hesap desteğini ayıran provider-capability ve shipped-runtime kayıtları.
- Letterboxd yarım yıldız puanlarını IMDb 1-10 çıktısına dönüştüren kural dahil puan dönüşüm motoru.
- Desteklenmeyen işlemleri engelleyen ve mevcut olmayan hedef dosya üreticilerini vaat etmeyen capability-aware tek/çift yönlü senkronizasyon planlayıcı.
- Uyumlu uygulanmış hesap connector'ları için API, CLI ve web üzerinden tek yönlü aktarım ve çift yönlü uzlaştırma; istekler varsayılan olarak dry-run'dır ve uzaktan yazma açık onay gerektirir.
- Kaydedilmiş resmi-connector yedekleri için korumalı ve silme yapmayan geri yükleme.
- On bir test edilmiş doğrudan hesap connector'ı: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, yalnızca animeyi kapsayan Bangumi, kullanıcı tarafından seçilen Jellyfin ve Emby sunucuları, açıkça sınırlandırılmış bir Kodi kitaplığı/profili ve seçilmiş bir Plex Media Server. Kayıtlı özellik kümeleri ve fidelity sınırları birbirinden farklıdır.
- TMDb, Trakt, Simkl, MyAnimeList, Shikimori ve Annict için API, CLI ve web üzerinden state doğrulamalı hesap yetkilendirme akışları; desteklenen yenileme veya iptal yolları dahil. Bangumi, Jellyfin, Emby, Kodi ve Plex belgelenmiş, çağıran tarafından sağlanan istek bağlamlarını kullanır; WatchBridge bunların kimlik bilgilerini kalıcı olarak saklamaz ve hayali bir Plex oturum açma yardımcısı sunmaz.
- IMDb, Letterboxd ve MovieLens dosyaları için katı API/CLI/web backup-v1 importları.
- Scraping veya tarayıcı otomasyonu olmadan, kayıtlı 13 manual-mapping servisten kullanıcıya ait çıktılar için yapılandırılabilir CSV import.
- Tek/çift yönlü doğrudan hesap senkronizasyonu, provider dosya dönüşümü, mapped-CSV önizlemesi, katı yedek yükleme, dosyadan hesaba senkronizasyon ve kimlik doğrulamalı yazma öncesi yedek indirmeleri için web arayüzü.
- Yedekleme öncelikli yürütme, ilk uzaktan değişiklikten önce seçili çalıştırılabilir özelliklerdeki hazırlanmış tüm yazma gruplarını preflight kontrolünden geçirir. Kalıcı işler `pending`, `succeeded` veya `failed` sonucunu ve mümkün olduğunda yazma öncesi yedek/hata ayrıntılarını saklar.
- TMDb, TVmaze, TheTVDB ve anime, manga ve bölüm için açık, exact-ID Kitsu kaynaklarında metadata çözümlemesi ile API/CLI üzerinden TasteDive önerileri; bunlar kullanıcı hesabı senkronizasyonu anlamına gelmez.
- Connector ve OAuth istekleri için sınırlı dış istek zaman aşımı, güvenli okuma retry'ları ve temizlenmiş provider hataları.
- API, web ve CLI uygulamaları; yerel masaüstü/mobil istemciler yerine şimdilik paketleme notları.
- Kurulum, lint, test ve build doğrulaması için CI workflow.
- İngilizce, Türkçe, Fransızca ve Almanca tam README desteği.

## Desteklenen Servisler

WatchBridge Sync şu servisler için connector capability yaklaşımıyla tasarlanmıştır:

| Film ve TV | Metadata ve keşif | Anime ve uluslararası |
|---|---|---|
| IMDb | TMDb | MyAnimeList |
| Rotten Tomatoes | TheTVDB | AniList |
| Letterboxd | TVmaze | Douban Movie |
| Trakt | JustWatch | Kinopoisk |
| Simkl | Reelgood |  |
| TV Time | AllMovie |  |
| Metacritic | Criticker |  |
| MovieLens | Flickchart |  |
| FilmAffinity | TasteDive |  |
| Serializd | Taste.io |  |
| MUBI | Common Sense Media |  |
| Jellyfin |  | Bangumi |
| Emby |  | Kitsu |
| Kodi |  | Shikimori |
| Plex |  | Annict |

**34/34 (%100)** servisin tamamı seçilebilir; ancak bu, 34 doğrudan entegrasyon demek değildir. Registry'den türetilen mevcut kapsam: **11/34 (%32,4)** doğrudan hesap platformu, puan/izlenen/izleme listesi ailelerinin üçü için de kayıtlı hesap okuma-yazma metotlarına sahip **5/34 (%14,7)** platform ve en az bir çalışan hesap ya da dosya kaynak yoluna sahip **27/34 (%79,4)** platformdur. Birbirini dışlayan iş akışı kataloğu; 11 doğrudan hesap, 3 özel dosya, 4 metadata/öneri, 13 manual-mapping ve 3 kısıtlı servisten oluşur. TMDb bu iş akışı görünümüyle kesişen metadata/öneri ölçümünde de yer alır; bu çapraz ölçüm **5/34'tür (%14,7)**.

**102** platform × çalıştırılabilir özellik yuvasında **70/102 (%68,6)** kaynak yuvası desteklenir ve **32/102 (%31,4)** eksiktir; **25/102 (%24,5)** yuva doğrulanmış hesap yazımına sahiptir ve **77/102 (%75,5)** sahip değildir. Letterboxd üç üretilmiş import-dosyası hedefi ekleyerek otomatik hedef kapsamını **28/102'ye (%27,5)** çıkarır; **74/102 (%72,5)** hedef eksik kalır. Puan desteği kaynakta **25/34 (%73,5)**, hesap yazımında **9/34 (%26,5)** ve otomatik hedefte **10/34'tür (%29,4)**; izlenen/ilerleme desteği sırasıyla **23/34 (%67,6)**, **9/34 (%26,5)** ve **10/34'tür (%29,4)**; izleme listesi desteği ise **22/34 (%64,7)**, **7/34 (%20,6)** ve **8/34'tür (%23,5)**. Canlı durum için `watchbridge support-summary`, `GET /v1/support-summary` veya web destek panelini kullanın.

Dosya, manuel, metadata/öneri ve kısıtlı iş akışları ayrı etiketlenir. **2/2 (%100)** executor yön modu çalışır; ancak çift yönlü çalışma, seçili her özellik için iki tarafta da kayıtlı okuma-yazma metotları bulunan iki canlı doğrudan hesap connector'ı gerektirir. Kayıt kimliği ve connector fidelity kontrolleri belirli bir veri biçimini yine de reddedebilir; yedek/dosya yolları tek yönlü kalır. Kanonik özellik ailelerinin yalnızca **3/6'sı (%50)** çalıştırılabilir; bu nedenle incelemeler, takipler ve takipçiler model-only kalır ve altı özelliğin tamamı için doğrudan metot kaydeden platform sayısı **0/34'tür (%0)**.

Shikimori, katı anime/user-rate sınırları içinde üç özelliğin tamamını destekleyen beşinci doğrudan connector'dır. Annict izlenen durumu ve izleme listesini destekler, ancak puanları desteklemez; Kodi tam sayı puanları ile filmler ve exact bölümler için tamamlanmış oynatma sayılarını destekler, ancak izleme listesini desteklemez; Plex sunucu kapsamlı ve yalnızca puan desteklidir, çağıran tarafından sağlanan token ile kişisel/ticari olmayan kullanım şartları uyarısı taşır. Jellyfin puanlar ile tamamlanmış izlenen durumunu, Emby ise yalnızca tamamlanmış izlenen üyeliğini destekler; iki serviste de favoriler ve beğeniler izleme listesi sayılmaz. Kitsu yalnızca açık exact-ID metadata sağlar ve hesap senkronizasyonuna **0/3** özellik katar. WatchBridge, katı bir yedekten API, CLI veya web paneliyle kullanıcı denetimli Letterboxd puan, izlenen ve izleme listesi CSV'leri üretebilir; Letterboxd'a giriş yapmaz veya dosya yüklemez. IMDb biçimli puan CSV'si yalnızca taşınabilir export yardımcısıdır. Bkz. [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) ve [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

## Puan Örneği

Letterboxd puanları 0.5-5 yıldız ölçeğini kullanır. IMDb 1-10 ölçeğini kullanır. WatchBridge bu dönüşümü export veya sync öncesinde görünür tutar:

```text
Letterboxd 4.5 / 5 -> IMDb 9 / 10
Letterboxd 3.0 / 5 -> IMDb 6 / 10
Letterboxd 5.0 / 5 -> IMDb 10 / 10
```

Uygulama: [packages/core/src/ratingScale.ts](packages/core/src/ratingScale.ts).

## Güvenlik Modeli

WatchBridge Sync site scraping, credential stuffing, tarayıcı otomasyonu, parola toplama, paywall bypass, anti-bot bypass veya kullanım şartlarını aşan mantık içermez.

Üretim prensipleri:

1. Resmi API'leri tercih et.
2. Kullanıcı onaylı OAuth veya API token'larını tercih et.
3. Doğrudan yazma API'si yoksa kullanıcı kontrollü export/import dosyalarını tercih et.
4. Ham parolaları asla saklama.
5. Senkronizasyondan önce her zaman dry-run modunu destekle.
6. Hedef servise yazmadan önce her zaman indirilebilir yerel yedek oluştur.
7. Puan ölçeği kurallarını planlarda ve dönüşüm önizlemelerinde açık tut.
8. Engellenen, manuel ve partner-only işlemleri açıkça etiketle.

Daha fazla bilgi: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Mimari

```text
apps/web                  React/Vite web arayüzü
apps/api                  OAuth, sync işleri, yedekler, metadata ve öneriler için Node/Hono API
apps/desktop              Masaüstü paketleme notları
apps/mobile               Android/iOS paketleme notları
packages/core             Kanonik model, puan dönüşümü, runtime registry, planlayıcı, destek ölçümleri
packages/connectors       Resmi hesap/metadata adapter'ları, executor, yedek şeması, güvenli dosya akışları
packages/cli              Planlama, import, OAuth, sync, restore, metadata ve öneriler için CLI
configs                   Servis registry, politikalar ve varsayılanlar
docs                      Mimari, dağıtım, güvenlik ve roadmap dokümanları
```

## Proje Dokümanları

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Manual CSV import](docs/MANUAL_CSV_IMPORT.md)
- [OAuth setup](docs/OAUTH_SETUP.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
- [Sync execution](docs/SYNC_EXECUTION.md)
- [Terms-safe integration](docs/TERMS_SAFE_INTEGRATION.md)

## Katkı

Güvenlik modeline uyduğu sürece katkılar memnuniyetle karşılanır. İlk katkı için iyi alanlar: connector capability metadata, import/export formatları, testler, dokümanlar, UI akışları ve platform paketleme.

Değişiklik açmadan önce:

```bash
pnpm lint
pnpm test
pnpm build
```

Bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

## Lisans

MIT. Bkz. [LICENSE](LICENSE).
