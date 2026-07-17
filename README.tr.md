<div align="center">

# WatchBridge Sync

**Puanlar, izlenen/ilerleme durumu, izleme listeleri, incelemeler, takip edilenler/takipçiler, yedekler ve güvenli tek ya da çift yönlü senkronizasyon için özgür/açık kaynak medya veri taşınabilirliği çalışma alanı.**

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

- Çalışan senkronizasyon; puanlar, izlenen/ilerleme durumu, izleme listeleri, incelemeler, takip edilenler ve takipçilerden oluşan altı kanonik özellik ailesinin tamamını kapsar. Doğrudan hesap uzlaştırması capability-gated kalır; takipçiler her zaman salt okunurdur. Çift yönlü izlenen uzlaştırması son durum odaklıdır; tam oynatma-olayı geçmişi birleştirmez.
- Seçilebilir, manuel, metadata, dosya, kısıtlı ve doğrudan hesap desteğini ayıran provider-capability ve shipped-runtime kayıtları.
- Letterboxd yarım yıldız puanlarını IMDb 1-10 çıktısına dönüştüren kural dahil puan dönüşüm motoru.
- Desteklenmeyen işlemleri engelleyen ve mevcut olmayan hedef dosya üreticilerini vaat etmeyen capability-aware tek/çift yönlü senkronizasyon planlayıcı.
- Uyumlu uygulanmış hesap connector'ları için API, CLI ve web üzerinden tek yönlü aktarım ve çift yönlü uzlaştırma; istekler varsayılan olarak dry-run'dır ve uzaktan yazma açık onay gerektirir.
- Kaydedilmiş resmi-connector yedekleri için korumalı ve silme yapmayan geri yükleme.
- On bir test edilmiş doğrudan hesap connector'ı: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, yalnızca animeyi kapsayan Bangumi, kullanıcı tarafından seçilen Jellyfin ve Emby sunucuları, açıkça sınırlandırılmış bir Kodi kitaplığı/profili ve seçilmiş bir Plex Media Server. Kayıtlı özellik kümeleri ve fidelity sınırları birbirinden farklıdır.
- TMDb, Trakt, Simkl, MyAnimeList, Shikimori ve Annict için API, CLI ve web üzerinden state doğrulamalı hesap yetkilendirme akışları; desteklenen yenileme veya iptal yolları dahil. Bangumi, Jellyfin, Emby, Kodi ve Plex belgelenmiş, çağıran tarafından sağlanan istek bağlamlarını kullanır; WatchBridge bunların kimlik bilgilerini kalıcı olarak saklamaz ve hayali bir Plex oturum açma yardımcısı sunmaz.
- IMDb puan, Check-ins ve izleme listesi dosyaları ile Letterboxd ve MovieLens dosyaları için katı API/CLI/web backup-v1 importları.
- Scraping veya tarayıcı otomasyonu olmadan, kayıtlı 13 manual-mapping servisten kullanıcıya ait çıktılar için yapılandırılabilir CSV import.
- Tek/çift yönlü doğrudan hesap senkronizasyonu, provider dosya dönüşümü, mapped-CSV önizlemesi, katı yedek yükleme, dosyadan hesaba senkronizasyon ve kimlik doğrulamalı yazma öncesi yedek indirmeleri için web arayüzü.
- Yedekleme öncelikli yürütme, ilk uzaktan değişiklikten önce seçili çalıştırılabilir özelliklerdeki hazırlanmış tüm yazma gruplarını preflight kontrolünden geçirir. Kalıcı işler `pending`, `succeeded` veya `failed` sonucunu ve mümkün olduğunda yazma öncesi yedek/hata ayrıntılarını saklar.
- TMDb, OMDb, TVmaze, TheTVDB ve anime, manga ve bölüm için açık, exact-ID Kitsu kaynaklarında metadata çözümlemesi ile API, CLI ve web paneli üzerinden TasteDive önerileri; bunlar kullanıcı hesabı senkronizasyonu anlamına gelmez.
- Connector ve OAuth istekleri için sınırlı dış istek zaman aşımı, güvenli okuma retry'ları ve temizlenmiş provider hataları.
- API, web ve CLI uygulamaları; yerel masaüstü/mobil istemciler yerine şimdilik paketleme notları.
- Kurulum, lint, test ve build doğrulaması için CI workflow.
- İngilizce, Türkçe, Fransızca ve Almanca tam README desteği.

## Desteklenen Servisler

WatchBridge Sync şu servisler için connector capability yaklaşımıyla tasarlanmıştır:

| Film ve TV | Metadata ve keşif | Anime ve uluslararası |
|---|---|---|
| IMDb | TMDb | MyAnimeList |
|  | OMDb |  |
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

**35/35 (%100)** servisin tamamı seçilebilir; ancak bu, 35 doğrudan entegrasyon demek değildir. Registry'den türetilen mevcut kapsam: **11/35 (%31,4)** doğrudan hesap platformu, üç temel aile olan puan/izlenen/izleme listesi için kayıtlı hesap okuma-yazma metotlarına sahip **6/35 (%17,1)** platform ve en az bir çalışan hesap ya da dosya kaynak yoluna sahip **27/35 (%77,1)** platformdur. Birbirini dışlayan iş akışı kataloğu; 11 doğrudan hesap, 3 özel dosya, 5 metadata/öneri, 13 manual-mapping ve 3 kısıtlı servisten oluşur. TMDb'nin iş akışı görünümüyle kesiştiği çapraz metadata/öneri ölçümü **6/35'tir (%17,1)**.

**210** platform × özellik yuvasında **116/210 (%55,2)** kaynak yuvası desteklenir ve **94/210 (%44,8)** eksiktir; **29/210 (%13,8)** yuva doğrulanmış hesap yazımına sahiptir ve **181/210 (%86,2)** sahip değildir. Üretilmiş import dosyaları dahil otomatik hedef kapsamı **33/210'dur (%15,7)**; **177/210 (%84,3)** hedef eksik kalır. Puan desteği kaynakta **25/35 (%71,4)**, hesap yazımında **9/35 (%25,7)** ve otomatik hedefte **10/35'tir (%28,6)**; izlenen/ilerleme desteği **25/35 (%71,4)**, **10/35 (%28,6)** ve **11/35'tir (%31,4)**; izleme listesi **23/35 (%65,7)**, **8/35 (%22,9)** ve **9/35'tir (%25,7)**; incelemeler **15/35 (%42,9)**, **1/35 (%2,9)** ve **2/35'tir (%5,7)**; takip edilenler **14/35 (%40,0)**, **1/35 (%2,9)** ve **1/35'tir (%2,9)**; takipçiler **14/35 (%40,0)**, **0/35 (%0)** ve **0/35'tir (%0)**. Canlı durum için `watchbridge support-summary`, `GET /v1/support-summary` veya web destek panelini kullanın.

Dosya, manuel, metadata/öneri ve kısıtlı iş akışları ayrı etiketlenir. **2/2 (%100)** executor yön modunun ve **6/6 (%100)** kanonik özellik ailesinin tamamı çalışır; ancak çift yönlü çalışma, seçili her özellik için iki tarafta da kayıtlı okuma-yazma metotları bulunan iki canlı doğrudan hesap connector'ı gerektirir. Kayıt kimliği ve connector fidelity kontrolleri belirli bir veri biçimini yine de reddedebilir; yedek/dosya yolları tek yönlü kalır. Trakt, altı ailenin tamamını doğrudan okuyan ve değiştirilebilir beş aileyi — puanlar, izlenen/ilerleme, izleme listesi, incelemeler ve eklemeli takip edilenler — yazan **1/35 (%2,9)** platformdur; takipçiler tasarım gereği salt okunurdur.

Trakt altı ailenin tamamını okur; puanları, izlenen/ilerleme durumunu, izleme listelerini, incelemeleri ve eklemeli takip edilenleri yazar; takipçiler yalnızca okunabilir. Annict izlenen durumu ve izleme listesini destekler, ancak puanları desteklemez. Kodi tam sayı puanlarını, filmler ve exact bölümler için tamamlanmış oynatma sayılarını ve kitaplık kapsamlı bir etiketle yönetilen film izleme listesini destekler. Plex sunucu kapsamlıdır; puanları ve filmler ile exact bölümlerin tamamlanmış oynatma üyeliğini destekler, çağıran tarafından sağlanan token ile kişisel/ticari olmayan kullanım şartları uyarısı taşır. Jellyfin puanlar ile tamamlanmış izlenen durumunu, Emby ise yalnızca tamamlanmış izlenen üyeliğini destekler; iki serviste de favoriler ve beğeniler izleme listesi sayılmaz. Kitsu ve OMDb hesap senkronizasyonuna **0/6** özellik katar: OMDb, API anahtarıyla yalnızca exact IMDb kimliğinden metadata çözümler ve kişisel/ticari olmayan kullanım şartları uyarısı taşır. WatchBridge özel IMDb puan, Check-ins ve izleme listesi dosyalarını içe aktarır; ayrıca katı bir yedekten API, CLI veya web paneliyle kullanıcı denetimli Letterboxd puan, izlenen, izleme listesi ve inceleme CSV'leri üretebilir. Letterboxd'a giriş yapmaz veya dosya yüklemez. IMDb biçimli puan CSV'si yalnızca taşınabilir export yardımcısıdır. Bkz. [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) ve [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

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

0BSD. Bkz. [LICENSE](LICENSE).
