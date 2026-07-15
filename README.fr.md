<div align="center">

# WatchBridge Sync

**Espace de travail libre/open-source pour la portabilité des notes, de l'état vu/progression, des listes, des critiques, des abonnements/abonnés et des sauvegardes, avec une synchronisation sûre à sens unique ou bidirectionnelle.**

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

[Démarrage Rapide](#démarrage-rapide) - [Fonctionnalités](#fonctionnalités) - [Services Pris en Charge](#services-pris-en-charge) - [Modèle de Sécurité](#modèle-de-sécurité) - [Architecture](#architecture) - [Contribution](#contribution) - [Licence](#licence)

</div>

WatchBridge Sync est un espace de travail web/API/CLI pour déplacer les données médias appartenant à l'utilisateur entre des services de suivi de films, séries TV et anime; il contient aussi des notes de packaging desktop et mobile pour de futurs clients. Le projet se concentre sur une portabilité sûre: API officielles quand elles existent, fichiers d'import/export contrôlés par l'utilisateur quand l'écriture directe n'est pas disponible, prévisualisations en dry-run et sauvegardes locales durables avant toute écriture distante confirmée.

Le dépôt contient un modèle de données canonique, la conversion d'échelles de notes, un planificateur de synchronisation, des métriques exhaustives du support runtime, des flux de connecteurs/fichiers testés, une API Node/Hono fonctionnelle, une interface web React/Vite, une CLI et des notes de packaging multiplateforme.

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

Lancez une synchronisation approuvée via l'API locale avec un fichier de requête. Elle reste en dry-run tant que `confirmWrite` n'est pas explicitement défini sur `true`:

```bash
watchbridge execute-sync sync-request.json
```

Consultez [Sync execution](docs/SYNC_EXECUTION.md) pour les champs, les politiques de conflit et la confirmation. [OAuth setup](docs/OAUTH_SETUP.md) décrit les helpers d'autorisation de TMDb, Trakt, Simkl, MyAnimeList, Shikimori et Annict, ainsi que les contextes fournis par l'appelant requis par Bangumi, Jellyfin, Emby, Kodi et Plex.

Consultez les pourcentages calculés en direct depuis le registre ou utilisez les flux dédiés aux fichiers et sauvegardes:

```bash
watchbridge support-summary
watchbridge import-provider-files provider-files.json
watchbridge generate-letterboxd-files backup.json selection.json
watchbridge execute-backup-sync backup-sync-request.json
watchbridge recommend recommendation-request.json
```

## Fonctionnalités

- L'exécution de synchronisation livrée couvre les six familles canoniques: notes, état vu/progression, listes, critiques, abonnements et abonnés. La réconciliation directe des comptes reste conditionnée par les capacités; les abonnés sont toujours en lecture seule. La réconciliation bidirectionnelle des vues conserve l'état le plus récent; elle ne fusionne pas un historique complet des lectures.
- Registres distincts pour les capacités fournisseur et le runtime livré, séparant sélection, flux manuel, métadonnées, fichiers, restrictions et comptes directs.
- Moteur de conversion de notes, y compris la conversion des demi-étoiles Letterboxd vers la sortie IMDb 1-10.
- Planificateur unidirectionnel/bidirectionnel fondé sur les capacités, qui bloque les opérations non prises en charge sans inventer de générateur de fichier cible.
- Transfert à sens unique et réconciliation bidirectionnelle conditionnée par les méthodes enregistrées via l'API, la CLI et le web; les requêtes sont en dry-run par défaut et toute écriture distante exige une confirmation explicite.
- Restauration protégée et non destructive des sauvegardes de connecteurs officiels.
- Onze connecteurs de compte direct testés: TMDb, Trakt, Simkl, MyAnimeList, Shikimori, Annict, Bangumi limité à l'anime, les serveurs Jellyfin et Emby choisis par l'utilisateur, une bibliothèque/un profil Kodi explicitement délimité et un Plex Media Server sélectionné. Leurs fonctionnalités enregistrées et leurs limites de fidélité diffèrent.
- Flux d'autorisation de compte avec vérification de state via l'API, la CLI et le web pour TMDb, Trakt, Simkl, MyAnimeList, Shikimori et Annict, y compris les chemins de renouvellement ou de révocation pris en charge. Bangumi, Jellyfin, Emby, Kodi et Plex utilisent des contextes de requête documentés et fournis par l'appelant; WatchBridge ne conserve pas leurs identifiants et n'invente pas de helper de connexion Plex.
- Imports backup-v1 stricts par API/CLI/web pour les fichiers IMDb de notes, check-ins et watchlist, ainsi que pour les fichiers Letterboxd et MovieLens.
- Import CSV configurable des exports utilisateur pour les 13 services `manual-mapping` enregistrés, sans scraping ni automatisation de navigateur.
- Interface web pour la synchronisation directe à sens unique/bidirectionnelle, la conversion de fichiers fournisseur, la prévisualisation mapped-CSV, l'envoi de sauvegardes strictes, la synchronisation fichier-vers-compte et le téléchargement authentifié des sauvegardes préalables.
- L'exécution avec sauvegarde préalable effectue le preflight de chaque lot d'écriture préparé parmi les fonctionnalités exécutables sélectionnées avant la première mutation distante. Les jobs durables enregistrent les états `pending`, `succeeded` ou `failed` et conservent, quand ils existent, la sauvegarde préalable et les détails d'échec.
- Résolution de métadonnées pour TMDb, OMDb, TVmaze, TheTVDB et les ressources publiques Kitsu d'anime, manga et épisode par identifiant exact, plus recommandations TasteDive via l'API, la CLI et le panneau web; cela n'implique aucun accès aux données de compte.
- Timeouts sortants bornés, retries sûrs pour les lectures et erreurs fournisseur assainies pour les requêtes connecteur et OAuth.
- Applications API, web et CLI, avec des notes de packaging desktop/mobile plutôt que des clients natifs livrés.
- Workflow CI pour valider installation, lint, tests et build.
- Support README complet en anglais, turc, français et allemand.

## Services Pris en Charge

WatchBridge Sync est conçu autour des capacités de connecteurs pour:

| Films et TV | Métadonnées et découverte | Anime et international |
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

Les **35/35 (100 %)** services sont sélectionnables, mais cela ne représente pas 35 intégrations directes. La couverture actuelle dérivée du registre est de **11/35 (31,4 %)** plateformes à compte direct, **6/35 (17,1 %)** avec des méthodes de lecture/écriture de compte enregistrées pour les trois familles principales — notes, état vu/progression et watchlist — et **27/35 (77,1 %)** avec au moins un chemin source de compte ou de fichier livré. Le catalogue de flux mutuellement exclusifs comprend 11 services de compte direct, 3 dédiés aux fichiers, 5 de métadonnées/recommandations, 13 à mapping manuel et 3 restreints. La métrique transversale métadonnées/recommandations, dans laquelle TMDb recoupe cette vue des flux, atteint **6/35 (17,1 %)**.

Sur les **210** emplacements plateforme × fonctionnalité, **116/210 (55,2 %)** emplacements source sont pris en charge et **94/210 (44,8 %)** manquent; **29/210 (13,8 %)** disposent d'écritures de compte vérifiées et **181/210 (86,2 %)** n'en disposent pas. En comptant les fichiers d'import générés, la couverture des cibles automatisées atteint **33/210 (15,7 %)**, avec **177/210 (84,3 %)** cibles manquantes. Les notes couvrent **25/35 (71,4 %)** en source, **9/35 (25,7 %)** en écriture de compte et **10/35 (28,6 %)** en cible automatisée; l'état vu/progression couvre **25/35 (71,4 %)**, **10/35 (28,6 %)** et **11/35 (31,4 %)**; la watchlist **23/35 (65,7 %)**, **8/35 (22,9 %)** et **9/35 (25,7 %)**; les critiques **15/35 (42,9 %)**, **1/35 (2,9 %)** et **2/35 (5,7 %)**; les abonnements **14/35 (40,0 %)**, **1/35 (2,9 %)** et **1/35 (2,9 %)**; les abonnés **14/35 (40,0 %)**, **0/35 (0 %)** et **0/35 (0 %)**. Utilisez `watchbridge support-summary`, `GET /v1/support-summary` ou le panneau web pour l'instantané en direct.

Les flux fichier, manuel, métadonnées/recommandations et restreint sont étiquetés séparément. Les **2/2 (100 %)** modes de direction de l'exécuteur et les **6/6 (100 %)** familles canoniques sont livrés, mais le bidirectionnel exige deux connecteurs de compte directs actifs avec des méthodes de lecture/écriture enregistrées pour chaque fonctionnalité choisie. Les contrôles d'identité et de fidélité peuvent encore rejeter une forme de données particulière; les chemins fichier/sauvegarde restent à sens unique. Trakt est la seule plateforme, soit **1/35 (2,9 %)**, qui lit directement les six familles et écrit les cinq familles modifiables — notes, état vu/progression, watchlist, critiques et abonnements additifs; les abonnés restent volontairement en lecture seule.

Trakt lit les six familles et écrit les notes, l'état vu/progression, les watchlists, les critiques et les abonnements additifs; les abonnés sont uniquement lisibles. Annict prend en charge l'état vu et la watchlist, mais pas les notes. Kodi prend en charge les notes entières, les compteurs de lectures terminées pour les films et épisodes exacts, ainsi qu'une watchlist de films gérée par une étiquette limitée à la bibliothèque. Plex est lié à un serveur et prend en charge les notes ainsi que l'appartenance aux lectures terminées pour les films et épisodes exacts, avec un jeton fourni par l'appelant et une réserve concernant les conditions d'usage personnel/non commercial. Jellyfin prend en charge les notes et l'état vu terminé, tandis qu'Emby ne prend en charge que l'appartenance à l'état vu terminé; les favoris et mentions J'aime ne comptent comme watchlist pour aucun des deux services. Kitsu et OMDb contribuent **0/6** fonctionnalités de synchronisation de compte: OMDb résout uniquement des métadonnées par identifiant IMDb exact avec une clé API, sous réserve de conditions d'usage personnel/non commercial. WatchBridge importe les fichiers IMDb dédiés aux notes, check-ins et watchlists, et peut générer depuis une sauvegarde stricte des CSV Letterboxd contrôlés par l'utilisateur pour les notes, les films vus, la watchlist et les critiques via l'API, la CLI ou le panneau web; il ne se connecte pas à Letterboxd et n'y envoie aucun fichier. Le CSV de notes au format IMDb reste seulement un helper d'export portable. Voir [Connector and Runtime Support](docs/CONNECTOR_CAPABILITIES.md) et [Import and Export Formats](docs/IMPORT_EXPORT_FORMATS.md).

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
7. Garder les règles d'échelle explicites dans les plans et les aperçus de conversion.
8. Étiqueter clairement les opérations bloquées, manuelles et réservées aux partenaires.

Plus de détails: [docs/TERMS_SAFE_INTEGRATION.md](docs/TERMS_SAFE_INTEGRATION.md).

## Architecture

```text
apps/web                  Interface web React/Vite
apps/api                  API Node/Hono pour OAuth, jobs, sauvegardes, métadonnées et recommandations
apps/desktop              Notes de packaging desktop
apps/mobile               Notes de packaging Android/iOS
packages/core             Modèle canonique, conversion, registre runtime, planificateur, métriques
packages/connectors       Adaptateurs compte/métadonnées, exécuteur, schéma de sauvegarde, flux fichiers
packages/cli              CLI pour planification, import, OAuth, sync, restauration, métadonnées et recommandations
configs                   Registre de services, politiques et valeurs par défaut
docs                      Docs d'architecture, déploiement, sécurité et roadmap
```

## Documentation du Projet

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
