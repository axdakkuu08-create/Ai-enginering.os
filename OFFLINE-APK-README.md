# OS-10.3 Offline Android Review APK

This is a self-contained Android review shell for the OS-10.3 governance and evidence UI.

## Safety boundary

- Demo-only; no live backend, Auth0, GitHub, Neon, OAuth, agent runtime, or protected-operation integration.
- The Android manifest intentionally declares no Internet permission.
- WebView blocks network loads and loads only the packaged Android asset.
- Demo tasks are stored in local WebView storage on the device.
- No approval, merge, deployment, or protected action can be triggered from this APK.
- Exported JSON is local demo data only; do not import secrets or production records.

## Build and test

The GitHub Actions workflow named OS-10.3 Offline Android APK builds a debug APK on this dedicated feature branch. It runs on changes to app files or can be started manually. The APK is uploaded as the artifact aios-os103-offline-review-apk for 14 days.

Download the workflow artifact from GitHub Actions, extract the ZIP, and install app-debug.apk on an Android test device. This is a debug build, not signed for production distribution.

Overview, project registry, local task board, recorded evidence, and governance gates are rendered from packaged assets. Add/cycle tasks, export local JSON, and reset the demo to verify persistence. The app should remain usable with mobile data and Wi-Fi disabled.