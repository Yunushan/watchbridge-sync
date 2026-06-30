<div align="center">

# WatchBridge Sync

**Freier/Open-Source-Arbeitsbereich für Medien-Datenportabilität: Bewertungen, Verlauf, Watchlists, Rezensionen, Follows, Follower, Backups und sichere Sync-Pläne.**

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

[Schnellstart](#schnellstart) - [Funktionen](#funktionen) - [Unterstützte Dienste](#unterstützte-dienste) - [Sicherheitsmodell](#sicherheitsmodell) - [Architektur](#architektur) - [Mitwirken](#mitwirken) - [Lizenz](#lizenz)

</div>

WatchBridge Sync ist ein Desktop/Web/API/CLI-Arbeitsbereich, um benutzereigene Mediendaten zwischen Film-, TV- und Anime-Tracking-Diensten zu übertragen. Der Fokus liegt auf sicherer Portabilität: offizielle APIs, wo sie verfügbar sind, nutzergesteuerte Import/Export-Dateien, wenn direktes Schreiben nicht möglich ist, Dry-Run-Sync-Pläne vor Schreibvorgängen und lokale Backups vor destruktiven Operationen.

Dieses Repository enthält derzeit ein kanonisches Datenmodell, Bewertungsumrechnung, einen Sync-Planer, ein Connector-Capability-Register, CSV-Helfer, ein Node-API-Skelett, eine React/Vite-Weboberfläche, eine CLI und Hinweise zur Plattform-Paketierung.

## Schnellstart

```bash
corepack enable
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm dev
```

Nützliche Befehle:

```bash
pnpm --filter @watchbridge/core test
pnpm --filter @watchbridge/api dev
pnpm --filter @watchbridge/web dev
pnpm --filter @watchbridge/cli build
```

## Funktionen

- Kanonisches Medienmodell für Filme, Serien, Staffeln, Episoden, Anime, Bewertungen, Rezensionen, Verlauf, Watchlists, Follows und Follower.
- Connector-Capability-Register, das markiert, was jeder Dienst sicher lesen, schreiben, importieren, exportieren oder manuell verarbeiten kann.
- Bewertungsumrechnung inklusive Letterboxd-Halbstern-Bewertungen zu IMDb-Ausgabe im 1-10-Format.
- Sync-Planer, der nicht unterstützte Operationen blockiert und sichere Alternativen erklärt.
- CSV-Import/Export-Grundlagen für benutzereigene Backup- und Transferdateien.
- Arbeitsbereichsstruktur für API, Web, CLI, Desktop und Mobile.
- CI-Workflow für Installation, Linting, Tests und Build-Validierung.
- Vollständige README-Unterstützung in Englisch, Türkisch, Französisch und Deutsch.

## Unterstützte Dienste

WatchBridge Sync ist um Connector-Fähigkeiten für folgende Dienste herum aufgebaut:

| Filme und TV | Metadaten und Discovery | Anime und international |
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

Der Unterstützungsgrad hängt von offizieller API, Kontoexport, Kontoimport, Partnerzugang und Nutzungsbedingungen des jeweiligen Dienstes ab. Siehe [docs/CONNECTOR_CAPABILITIES.md](docs/CONNECTOR_CAPABILITIES.md).

## Bewertungsbeispiel

Letterboxd verwendet eine Skala von 0,5 bis 5 Sternen. IMDb verwendet eine Skala von 1 bis 10. WatchBridge macht diese Umrechnung vor Export oder Sync sichtbar:

```text
Letterboxd 4.5 / 5 -> IMDb 9 / 10
Letterboxd 3.0 / 5 -> IMDb 6 / 10
Letterboxd 5.0 / 5 -> IMDb 10 / 10
```

Implementierung: [packages/core/src/ratingScale.ts](packages/core/src/ratingScale.ts).

## Sicherheitsmodell

WatchBridge Sync enthält kein Site-Scraping, Credential Stuffing, Browser-Automatisierung, Passwortsammlung, Paywall-Bypass, Anti-Bot-Bypass oder Logik zur Umgehung von Nutzungsbedingungen.

Produktionsprinzipien:

1. Offizielle APIs bevorzugen.
2. Benutzerautorisierte OAuth-Flows oder API-Tokens bevorzugen.
3. Nutzergesteuerte Export/Import-Dateien bevorzugen, wenn direkte Schreib-APIs nicht verfügbar sind.
4. Rohe Passwörter niemals speichern.
5. Vor der Synchronisierung immer einen Dry-Run-Modus unterstützen.
6. Vor Schreibvorgängen auf einen Zieldienst immer ein herunterladbares lokales Backup erstellen.
7. Bewertungsumrechnungen vor der Anwendung immer anzeigen.
8. Blockierte, manuelle und partner-only Operationen klar kennzeichnen.

Mehr Details: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architektur

```text
apps/web                  React/Vite-Weboberfläche und PWA-Shell
apps/api                  Node-API-Server für OAuth-Callbacks und Sync-Jobs
apps/desktop              Hinweise zur Desktop-Paketierung
apps/mobile               Hinweise zur Android/iOS-Paketierung
packages/core             Kanonisches Modell, Bewertungsumrechnung, Sync-Planer
packages/connectors       Service-Adapter-Interfaces und Connector-Stubs
packages/cli              Kommandozeile für Import/Export/Sync
configs                   Service-Register, Richtlinien und Defaults
docs                      Architektur-, Deployment-, Sicherheits- und Roadmap-Doku
```

## Projektdokumentation

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
- [Terms-safe integration](docs/TERMS_SAFE_INTEGRATION.md)

## Mitwirken

Beiträge sind willkommen, wenn sie dem Sicherheitsmodell folgen. Gute erste Bereiche sind Connector-Capability-Metadaten, Import/Export-Formate, Tests, Dokumentation, UI-Flows und Plattform-Paketierung.

Vor einer Änderung:

```bash
pnpm lint
pnpm test
pnpm build
```

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

MIT. Siehe [LICENSE](LICENSE).
