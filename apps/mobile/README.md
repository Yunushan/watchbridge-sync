# Mobile App

Recommended packaging path:

1. Share the web UI and core sync logic.
2. Package Android/iOS with Capacitor or React Native.
3. Use OAuth PKCE flows for services that support OAuth.
4. Store tokens in secure storage, not localStorage.
5. Support offline export/import files through the platform file picker.
