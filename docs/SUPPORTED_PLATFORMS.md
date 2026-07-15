# Supported Platforms

| Platform/runtime | Current status | Notes |
|---|---|---|
| Web browser | Shipped | React/Vite UI; serve the built static assets and point them at the API. This is not currently packaged as an installed PWA. |
| Ubuntu Linux | CI-verified | Node 24 API/CLI and web build are installed, linted, tested, and built on `ubuntu-latest`. No native desktop wrapper is shipped. |
| Windows / Windows Server | Source runtime, not CI-certified | The Node 24 API/CLI and static web build are intended to be portable, but this repository's CI matrix does not currently certify Windows and no native desktop binary is shipped. |
| macOS | Source runtime, not CI-certified | The Node 24 API/CLI and static web build are intended to be portable; no native desktop binary is shipped. |
| BSD | Unverified | A compatible Node 24 runtime may work, but the repository does not test or package BSD. |
| Windows/Linux/macOS desktop app | Planned | `apps/desktop` contains packaging guidance only; it is not a Tauri or Electron application today. |
| Android/iOS app | Planned | `apps/mobile` contains packaging guidance only; no Capacitor, React Native, Android, or iOS client is shipped. |

The executable JavaScript workspace requires Node.js 24 or newer and pnpm 9 or newer. “Source runtime” is not a support certification: run the full install/lint/test/build suite on the intended OS before deployment.
