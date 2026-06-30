<div align="center">

# WatchBridge Sync

**Espace de travail libre/open-source pour la portabilité des données médias: notes, historique de visionnage, listes, critiques, abonnements, abonnés, sauvegardes et plans de synchronisation sûrs.**

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

[Démarrage Rapide](#démarrage-rapide) - [Fonctionnalités](#fonctionnalités) - [Services Pris en Charge](#services-pris-en-charge) - [Modèle de Sécurité](#modèle-de-sécurité) - [Architecture](#architecture) - [Contribution](#contribution) - [Licence](#licence)

</div>

WatchBridge Sync est un espace de travail desktop/web/API/CLI pour déplacer les données médias appartenant à l'utilisateur entre des services de suivi de films, séries TV et anime. Le projet se concentre sur une portabilité sûre: API officielles quand elles existent, fichiers d'import/export contrôlés par l'utilisateur quand l'écriture directe n'est pas disponible, plans de synchronisation en dry-run avant toute écriture, et sauvegardes locales avant toute opération destructive.

Le dépôt contient actuellement un modèle de données canonique, la conversion d'échelles de notes, un planificateur de synchronisation, un registre de capacités de connecteurs, des helpers CSV, un squelette d'API Node, une interface web React/Vite, une CLI et des notes de packaging multiplateforme.

## Démarrage Rapide

```bash
corepack enable
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm dev
```

Commandes utiles:

```bash
pnpm --filter @watchbridge/core test
pnpm --filter @watchbridge/api dev
pnpm --filter @watchbridge/web dev
pnpm --filter @watchbridge/cli build
```

## Fonctionnalités

- Modèle média canonique pour films, séries, saisons, épisodes, anime, notes, critiques, historique de visionnage, listes, abonnements et abonnés.
- Registre de capacités indiquant ce que chaque service peut lire, écrire, importer, exporter ou traiter manuellement de manière sûre.
- Moteur de conversion de notes, y compris la conversion des demi-étoiles Letterboxd vers la sortie IMDb 1-10.
- Planificateur de synchronisation qui bloque les opérations non prises en charge et explique les alternatives sûres.
- Primitives CSV d'import/export pour les sauvegardes et transferts appartenant à l'utilisateur.
- Structure de travail API, web, CLI, desktop et mobile.
- Workflow CI pour valider installation, lint, tests et build.
- Support README complet en anglais, turc, français et allemand.

## Services Pris en Charge

WatchBridge Sync est conçu autour des capacités de connecteurs pour:

| Films et TV | Métadonnées et découverte | Anime et international |
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

Le niveau de support dépend de l'API officielle de chaque service, de l'export de compte, de l'import de compte, de l'accès partenaire et des conditions d'utilisation. Voir [docs/CONNECTOR_CAPABILITIES.md](docs/CONNECTOR_CAPABILITIES.md).

## Exemple de Note

Letterboxd utilise une échelle de 0,5 à 5 étoiles. IMDb utilise une échelle de 1 à 10. WatchBridge garde cette transformation visible avant l'export ou la synchronisation:

```text
Letterboxd 4.5 / 5 -> IMDb 9 / 10
Letterboxd 3.0 / 5 -> IMDb 6 / 10
Letterboxd 5.0 / 5 -> IMDb 10 / 10
```

Implémentation: [packages/core/src/ratingScale.ts](packages/core/src/ratingScale.ts).

## Modèle de Sécurité

WatchBridge Sync ne fournit pas de scraping de sites, credential stuffing, automatisation de navigateur, collecte de mots de passe, contournement de paywall, contournement anti-bot ou logique de contournement des conditions d'utilisation.

Principes de production:

1. Préférer les API officielles.
2. Préférer OAuth ou les tokens API autorisés par l'utilisateur.
3. Préférer les fichiers export/import contrôlés par l'utilisateur quand les API d'écriture directe ne sont pas disponibles.
4. Ne jamais stocker de mots de passe bruts.
5. Toujours proposer un mode dry-run avant la synchronisation.
6. Toujours créer une sauvegarde locale téléchargeable avant d'écrire vers un service cible.
7. Toujours afficher les conversions d'échelles de notes avant de les appliquer.
8. Étiqueter clairement les opérations bloquées, manuelles et réservées aux partenaires.

Plus de détails: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architecture

```text
apps/web                  Interface web React/Vite et shell PWA
apps/api                  Serveur API Node pour callbacks OAuth et jobs de sync
apps/desktop              Notes de packaging desktop
apps/mobile               Notes de packaging Android/iOS
packages/core             Modèle canonique, conversion de notes, planificateur
packages/connectors       Interfaces d'adaptateurs et stubs de connecteurs
packages/cli              CLI pour import/export/sync
configs                   Registre de services, politiques et valeurs par défaut
docs                      Docs d'architecture, déploiement, sécurité et roadmap
```

## Documentation du Projet

- [Architecture](docs/ARCHITECTURE.md)
- [Connector capabilities](docs/CONNECTOR_CAPABILITIES.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Example syncs](docs/EXAMPLE_SYNCS.md)
- [Import/export formats](docs/IMPORT_EXPORT_FORMATS.md)
- [Rating mapping](docs/RATING_MAPPING.md)
- [Roadmap](docs/ROADMAP.md)
- [Supported platforms](docs/SUPPORTED_PLATFORMS.md)
- [Terms-safe integration](docs/TERMS_SAFE_INTEGRATION.md)

## Contribution

Les contributions sont bienvenues lorsqu'elles respectent le modèle de sécurité. Les bons premiers sujets incluent les métadonnées de capacités de connecteurs, les formats d'import/export, les tests, la documentation, les flux UI et le packaging de plateforme.

Avant d'ouvrir une modification:

```bash
pnpm lint
pnpm test
pnpm build
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. Voir [LICENSE](LICENSE).
