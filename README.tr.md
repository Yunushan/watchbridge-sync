<div align="center">

# WatchBridge Sync

**Puanlar, izleme geçmişi, izleme listeleri, incelemeler, takipler, takipçiler, yedekler ve güvenli senkronizasyon planları için özgür/açık kaynak medya veri taşınabilirliği çalışma alanı.**

[![ci](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Yunushan/watchbridge-sync/actions/workflows/ci.yml)
![release](https://img.shields.io/badge/release-v0.1.0-0ea5e9)
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

WatchBridge Sync; film, dizi ve anime takip servisleri arasında kullanıcıya ait medya verilerini taşımak için tasarlanmış masaüstü/web/API/CLI çalışma alanıdır. Güvenli taşınabilirliğe odaklanır: mümkün olduğunda resmi API'ler, doğrudan yazma mümkün olmadığında kullanıcı kontrollü import/export dosyaları, yazmadan önce dry-run senkronizasyon planları ve yıkıcı bir işlemden önce yerel yedekler.

Bu depo şu anda kanonik veri modeli, puan ölçeği dönüşümü, senkronizasyon planlayıcı, connector capability registry, CSV yardımcıları, Node API iskeleti, React/Vite web arayüzü, CLI ve platform paketleme notları içerir.

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

## Özellikler

- Filmler, diziler, sezonlar, bölümler, anime, puanlar, incelemeler, izleme geçmişi, izleme listeleri, takipler ve takipçiler için kanonik medya modeli.
- Her servisin güvenli biçimde ne okuyabildiğini, yazabildiğini, içe aktarabildiğini, dışa aktarabildiğini veya manuel iş akışı gerektirdiğini işaretleyen connector capability registry.
- Letterboxd yarım yıldız puanlarını IMDb 1-10 çıktısına dönüştüren kural dahil puan dönüşüm motoru.
- Desteklenmeyen işlemleri engelleyen ve güvenli alternatifleri açıklayan senkronizasyon planlayıcı.
- Kullanıcıya ait yedek ve aktarım dosyaları için CSV import/export yardımcıları.
- API, web, CLI, masaüstü ve mobil çalışma alanı yapısı.
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

Destek seviyesi her servisin resmi API'sine, hesap dışa aktarımına, hesap içe aktarımına, partner erişimine ve kullanım şartlarına bağlıdır. Bkz. [docs/CONNECTOR_CAPABILITIES.md](docs/CONNECTOR_CAPABILITIES.md).

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
7. Puan ölçeği dönüşümlerini uygulamadan önce her zaman göster.
8. Engellenen, manuel ve partner-only işlemleri açıkça etiketle.

Daha fazla bilgi: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Mimari

```text
apps/web                  React/Vite web arayüzü ve PWA kabuğu
apps/api                  OAuth callback ve sync işleri için Node API sunucusu
apps/desktop              Masaüstü paketleme notları
apps/mobile               Android/iOS paketleme notları
packages/core             Kanonik model, puan dönüşümü, sync planlayıcı
packages/connectors       Servis adapter arayüzleri ve connector iskeletleri
packages/cli              Import/export/sync için komut satırı arayüzü
configs                   Servis registry, politikalar ve varsayılanlar
docs                      Mimari, dağıtım, güvenlik ve roadmap dokümanları
```

## Proje Dokümanları

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
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
