# Native packaging (optional)

The app is a Progressive Web App. On all three target platforms the browser install is the simplest, most reliable path and needs no store account:

- **Windows**: Edge or Chrome → install icon in the address bar. Edge-installed PWAs appear in Start, the taskbar and Settings → Apps like any program.
- **Android**: Chrome → ⋮ → *Install app*. Samsung Internet and Firefox also support it.
- **Huawei / HarmonyOS**: Huawei Browser → menu → *Add to* → *Home screen*. Huawei Browser is Chromium-based; service workers, IndexedDB and the camera API used for QR scanning all work. Google Play Services are not involved anywhere in this app.

Wrap it only if you need a store listing or an icon that arrives as a file.

## Android / Huawei APK with Capacitor

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init "Mae's Medical Tome" com.mae.medicaltome --web-dir dist
npm run build
npx cap add android
npx cap sync android
npx cap open android       # Android Studio: Build → Generate Signed Bundle/APK
```

`capacitor.config.json` in this repository already carries the right `webDir` and app id. The resulting APK:

- installs on any Android phone, and on Huawei phones without Google services (the app uses no Google APIs);
- can be submitted to Huawei AppGallery (sign up at developer.huawei.com, upload the APK/AAB) or Google Play;
- loads the web app from local files, so it is fully offline from the first launch, including the download files if you keep them in `dist/`.

Because the Capacitor app uses the system WebView, keep the WebView updated on test devices; very old WebViews (< Chromium 80) lack features such as `CompressionStream` fallbacks, which this app avoids, but PDF rendering performance improves markedly on recent ones.

## Windows executable

A plain PWA install is what Microsoft itself recommends and is what Store-listed PWAs use. If you want a signed `.exe`/`.msix`:

- **PWABuilder** (pwabuilder.com): paste the deployed URL, download the Windows package, optionally submit to the Microsoft Store.
- **Tauri** (small binary, uses Edge WebView2): `npm create tauri-app`, point `frontendDist` to `dist/`, `npm run tauri build`.

## Sync in a wrapped app

Nothing changes: the sync code is plain text. In a Capacitor app the Share button uses the native share sheet, and the camera is available to the QR scanner once the `CAMERA` permission is in `AndroidManifest.xml` (Capacitor adds it when `@capacitor/camera` is installed, or add `<uses-permission android:name="android.permission.CAMERA" />` manually).
