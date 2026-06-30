# Desktop App

Recommended packaging path:

1. Start with the web app as a local-first PWA.
2. Package with Tauri for Windows/Linux/macOS where supported.
3. Offer Electron as an alternative where Tauri/WebView dependencies are difficult.
4. For BSD, prefer the server + web app or CLI mode unless the chosen WebView runtime is available and tested.

Production requirement: desktop builds must keep OAuth tokens in the OS keychain where available, with encrypted file fallback.
