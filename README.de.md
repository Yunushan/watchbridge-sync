<div align="center">

# WatchBridge Sync

**Freier/Open-Source-Arbeitsbereich für Bewertungen, Gesehen-/Fortschrittsstatus, Watchlists, Rezensionen, Follows/Follower, Backups und sicheren ein- oder zweiseitigen Sync.**

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

[Schnellstart](#schnellstart) - [Funktionen](#funktionen) - [Unterstützte Dienste](#unterstützte-dienste) - [Sicherheitsmodell](#sicherheitsmodell) - [Architektur](#architektur) - [Mitwirken](#mitwirken) - [Lizenz](#lizenz)

</div>

WatchBridge Sync ist ein Web/API/CLI-Arbeitsbereich, um benutzereigene Mediendaten zwischen Film-, TV- und Anime-Tracking-Diensten zu übertragen; für zukünftige Clients enthält er außerdem Desktop- und Mobile-Paketierungshinweise. Der Fokus liegt auf sicherer Portabilität: offizielle APIs, wo sie verfügbar sind, nutzergesteuerte Import/Export-Dateien, wenn direktes Schreiben nicht möglich ist, Dry-Run-Vorschauen und dauerhafte lokale Backups vor bestätigten Remote-Schreibvorgängen.

Dieses Repository enthält ein kanonisches Datenmodell, Bewertungsumrechnung, einen Sync-Planer, vollständige Runtime-Supportmetriken, getestete Connector- und Dateiabläufe, eine funktionierende Node/Hono-API, eine React/Vite-Weboberfläche, eine CLI und Hinweise zur Plattform-Paketierung.

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

Führen Sie einen freigegebenen Connector-Sync über die lokale API mit einer Request-Datei aus. Ohne ausdrücklich gesetztes `confirmWrite: true` bleibt er ein Dry-Run:

```bash
watchbridge execute-sync sync-request.json
```

Request-Felder, Konfliktrichtlinien und Bestätigung beschreibt [Sync execution](docs/SYNC_EXECUTION.md). [OAuth setup](docs/OAUTH_SETUP.md) dokumentiert die Autorisierungshelfer für TMDb, Trakt, Simkl, MyAnimeList, Shikimori und Annict sowie die vom Aufrufer bereitzustellenden Kontexte für Bangumi, Jellyfin, Emby, Kodi und Plex.

Prüfen Sie die live aus dem Register berechneten Prozentsätze oder nutzen Sie die Datei- und Backup-Abläufe:

```bash
watchbridge support-summary
watchbridge import-provider-files provider-files.json
watchbridge generate-letterboxd-files backup.json selection.json
watchbridge execute-backup-sync backup-sync-request.json
watchbridge recommend recommendation-request.json
```

## Funktionen

- Die ausgelieferte Sync-Ausführung umfasst alle sechs kanonischen Funktionsfamilien: Bewertungen, Gesehen-/Fortschrittsstatus, Watchlists, Rezensionen, Follows und Follower. Direkter Account-Abgleich bleibt fähigkeitsgeprüft; Follower sind grundsätzlich schreibgeschützt. Der zweiseitige Gesehen-Abgleich übernimmt den neuesten Zustand und führt keinen vollständigen Wiedergabeereignisverlauf zusammen.
- Getrennte Register für Anbieterfähigkeiten und ausgelieferten Runtime-Support, damit Auswahl, manuelle Abläufe, Metadaten, Dateien, Einschränkungen und direkte Konten unterscheidbar bleiben.
- Bewertungsumrechnung inklusive Letterboxd-Halbstern-Bewertungen zu IMDb-Ausgabe im 1-10-Format.
- Fähigkeitsbasierter ein-/zweiseitiger Sync-Planer, der nicht unterstützte Operationen blockiert und keine nicht vorhandenen Zieldatei-Generatoren verspricht.
- Einseitige Account-Übertragung und zweiseitiger Abgleich über API, CLI und Web für kompatible implementierte Connectoren; Requests sind standardmäßig Dry-Runs und Remote-Schreibvorgänge benötigen eine ausdrückliche Bestätigung.
- Geschützte, nicht destruktive Wiederherstellung gespeicherter offizieller Connector-Backups.
- Elf getestete Direct-Account-Connectoren: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, das anime-spezifische Bangumi, benutzerausgewählte Jellyfin- und Emby-Server, ein explizit abgegrenztes Kodi-Bibliotheks-/Profilziel und ein ausgewählter Plex Media Server. Ihre registrierten Funktionsumfänge und Fidelity-Grenzen unterscheiden sich.
- State-geprüfte Account-Autorisierungsabläufe über API, CLI und Web für TMDb, Trakt, Simkl, MyAnimeList, Shikimori und Annict einschließlich der unterstützten Erneuerungs- oder Widerrufspfade. Bangumi, Jellyfin, Emby, Kodi und Plex nutzen dokumentierte, vom Aufrufer bereitgestellte Request-Kontexte; WatchBridge speichert ihre Zugangsdaten nicht dauerhaft und erfindet keinen Plex-Anmeldehelfer.
- Strikte API/CLI/Web-Backup-v1-Imports für IMDb-Bewertungs-, Check-ins- und Watchlist-Dateien sowie Letterboxd- und MovieLens-Dateien.
- Konfigurierbarer CSV-Import benutzereigener Exporte für die 13 registrierten `manual-mapping`-Dienste, ohne Scraping oder Browser-Automatisierung.
- Weboberfläche für ein-/zweiseitigen direkten Account-Sync, Provider-Dateikonvertierung, Mapped-CSV-Vorschau, strikten Backup-Upload, Datei-zu-Account-Sync und authentifizierte Downloads der Vorab-Backups.
- Die Backup-zuerst-Ausführung prüft jeden vorbereiteten Schreib-Batch der ausgewählten ausführbaren Funktionen vor der ersten Remote-Mutation. Dauerhafte Jobs speichern `pending`, `succeeded` oder `failed` sowie verfügbare Vorab-Backup- und Fehlerdetails.
- Metadatenauflösung für TMDb, OMDb, TVmaze, TheTVDB und öffentliche Kitsu-Ressourcen mit exakter ID für Anime, Manga und Episoden sowie TasteDive-Empfehlungen über API, CLI und das Webpanel; daraus folgt kein Zugriff auf Account-Nutzerdaten.
- Begrenzte Outbound-Timeouts, sichere Lese-Retries und bereinigte Providerfehler für Connector- und OAuth-Requests.
- API-, Web- und CLI-Anwendungen; Desktop und Mobile bestehen derzeit aus Paketierungshinweisen statt ausgelieferten nativen Clients.
- CI-Workflow für Installation, Linting, Tests und Build-Validierung.
- Vollständige README-Unterstützung in Englisch, Türkisch, Französisch und Deutsch.

## Unterstützte Dienste

WatchBridge Sync ist um Connector-Fähigkeiten für folgende Dienste herum aufgebaut:

| Filme und TV | Metadaten und Discovery | Anime und international |
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

Alle **35/35 (100 %)** Dienste sind auswählbar, das sind jedoch nicht 35 direkte Integrationen. Die aktuelle, aus dem Register abgeleitete Abdeckung beträgt **11/35 (31,4 %)** Direct-Account-Plattformen, **6/35 (17,1 %)** mit registrierten Account-Lese-/Schreibmethoden für die drei primären Familien Bewertungen, Gesehen/Fortschritt und Watchlist und **27/35 (77,1 %)** mit mindestens einem ausgelieferten Account- oder Datei-Quellpfad. Der überschneidungsfreie Workflow-Katalog umfasst 11 Direct-Account-, 3 Dedicated-File-, 5 Metadaten-/Empfehlungs-, 13 Manual-Mapping- und 3 eingeschränkte Dienste. Die querschnittliche Metadaten-/Empfehlungsmetrik, in der TMDb die Workflow-Sicht überschneidet, erreicht **6/35 (17,1 %)**.

Von den **210** Plattform-×-Funktions-Plätzen werden **116/210 (55,2 %)** Quellplätze unterstützt und **94/210 (44,8 %)** fehlen; **29/210 (13,8 %)** verfügen über verifizierte Account-Schreibmethoden und **181/210 (86,2 %)** nicht. Einschließlich erzeugter Importdateien beträgt die automatisierte Zielabdeckung **33/210 (15,7 %)**; **177/210 (84,3 %)** Ziele fehlen. Bewertungen erreichen **25/35 (71,4 %)** Quelle, **9/35 (25,7 %)** Account-Schreiben und **10/35 (28,6 %)** automatisiertes Ziel; Gesehen/Fortschritt erreicht **25/35 (71,4 %)**, **10/35 (28,6 %)** und **11/35 (31,4 %)**; Watchlists erreichen **23/35 (65,7 %)**, **8/35 (22,9 %)** und **9/35 (25,7 %)**; Rezensionen **15/35 (42,9 %)**, **1/35 (2,9 %)** und **2/35 (5,7 %)**; Follows **14/35 (40,0 %)**, **1/35 (2,9 %)** und **1/35 (2,9 %)**; Follower **14/35 (40,0 %)**, **0/35 (0 %)** und **0/35 (0 %)**. Den Live-Stand liefern `watchbridge support-summary`, `GET /v1/support-summary` oder das Web-Supportpanel.

Datei-, manuelle, Metadaten/Empfehlungs- und eingeschränkte Abläufe sind getrennt gekennzeichnet. Beide **2/2 (100 %)** Ausführungsrichtungsmodi und alle **6/6 (100 %)** kanonischen Funktionsfamilien sind ausgeliefert; zweiseitiger Sync erfordert jedoch zwei aktive direkte Account-Connectoren mit registrierten Lese-/Schreibmethoden für jede gewählte Funktion. Identitäts- und Fidelity-Prüfungen können eine konkrete Datenform weiterhin ablehnen; Backup-/Dateipfade bleiben einseitig. Trakt liest als **1/35 (2,9 %)** Plattform alle sechs Familien und schreibt die fünf veränderbaren Familien Bewertungen, Gesehen/Fortschritt, Watchlist, Rezensionen und additive Follows; Follower bleiben absichtlich schreibgeschützt.

Trakt liest alle sechs Familien und schreibt Bewertungen, Gesehen/Fortschritt, Watchlists, Rezensionen und additive Follows; Follower sind nur lesbar. Annict unterstützt Gesehen-Status und Watchlist, aber keine Bewertungen. Kodi unterstützt ganzzahlige Bewertungen und abgeschlossene Wiedergabezähler für Filme und exakte Episoden sowie eine verwaltete Film-Watchlist über ein bibliotheksweit abgegrenztes Tag. Plex ist servergebunden und unterstützt Bewertungen sowie abgeschlossene Wiedergabemitgliedschaft für Filme und exakte Episoden, mit einem vom Aufrufer bereitgestellten Token und einem Hinweis auf persönliche/nicht kommerzielle Nutzung. Jellyfin unterstützt Bewertungen plus abgeschlossenen Gesehen-Status, während Emby nur abgeschlossene Gesehen-Mitgliedschaft unterstützt; Favoriten und Likes zählen bei keinem der beiden Dienste als Watchlist. Kitsu und OMDb tragen **0/6** Account-Sync-Funktionen bei: OMDb löst ausschließlich Metadaten über exakte IMDb-IDs mit API-Key auf und unterliegt einem Hinweis auf persönliche/nicht kommerzielle Nutzung. WatchBridge importiert die dedizierten IMDb-Dateien für Bewertungen, Check-ins und Watchlists und kann aus einem strikten Backup nutzergesteuerte Letterboxd-CSV-Dateien für Bewertungen, gesehene Filme, Watchlist und Rezensionen über API, CLI oder Webpanel erzeugen; es meldet sich nicht bei Letterboxd an und lädt dort keine Dateien hoch. Die IMDb-förmige Bewertungs-CSV bleibt nur ein portabler Export-Helfer. Siehe [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) und [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

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
7. Bewertungsskalen in Plänen und Umrechnungsvorschauen explizit darstellen.
8. Blockierte, manuelle und partner-only Operationen klar kennzeichnen.

Mehr Details: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architektur

```text
apps/web                  React/Vite-Weboberfläche
apps/api                  Node/Hono-API für OAuth, Sync-Jobs, Backups, Metadaten und Empfehlungen
apps/desktop              Hinweise zur Desktop-Paketierung
apps/mobile               Hinweise zur Android/iOS-Paketierung
packages/core             Kanonisches Modell, Umrechnung, Runtime-Register, Planer, Supportmetriken
packages/connectors       Account-/Metadaten-Adapter, Executor, Backup-Schema, sichere Dateiabläufe
packages/cli              CLI für Planung, Import, OAuth, Sync, Restore, Metadaten und Empfehlungen
configs                   Service-Register, Richtlinien und Defaults
docs                      Architektur-, Deployment-, Sicherheits- und Roadmap-Doku
```

## Projektdokumentation

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

0BSD. Siehe [LICENSE](LICENSE).
